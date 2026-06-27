/**
 * mlbMatchupVSGate.ts
 * 
 * Internal VS Gate — replaces BallparkPal entirely.
 * 
 * Computes a 0–10 batter vs pitcher matchup score using:
 *   1. xwOBA delta (batter xwOBA - pitcher xwOBA-against)  [Statcast / Pybaseball]
 *   2. Platoon advantage (batter hand vs pitcher hand)       [MLB Stats API]
 *   3. Pitcher vulnerability (ERA, WHIP, K%, BB%)           [MLB Stats API]
 *   4. Batter recent form vs this pitcher hand type         [MLB Stats API splits]
 *   5. Park-adjusted run environment                        [MLB Stats API venue]
 * 
 * VS Score Tiers:
 *   9.0–10.0  → STRONG   (passes gate unconditionally)
 *   7.0–8.9   → MODERATE (passes gate if matrix score >= 72)
 *   5.0–6.9   → NEUTRAL  (no boost or penalty)
 *   Below 5.0 → WEAK     (soft penalty –6 in scoring matrix)
 * 
 * Usage in aiRankingService:
 *   const vsGate = await computeVSGate(batter, pitcher, statcastCache);
 *   if (vsGate.tier === 'WEAK') applyPenalty(–6);
 *   if (vsGate.tier === 'STRONG') applyBoost(+12);
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BatterStatcast {
  playerId: number;
  name: string;
  xwoba: number;           // e.g. 0.380
  barrelPct: number;       // e.g. 12.5
  hardHitPct: number;      // e.g. 45.0
  exitVelocity: number;    // e.g. 91.2
  kPct: number;            // e.g. 22.0
  bbPct: number;           // e.g. 9.5
  obp: number;             // e.g. 0.360
  hand: 'L' | 'R' | 'S';  // batter handedness
}

export interface PitcherStatcast {
  playerId: number;
  name: string;
  xwobaAgainst: number;    // xwOBA allowed — higher = weaker pitcher
  era: number;
  whip: number;
  kPct: number;            // strikeout rate
  bbPct: number;           // walk rate
  hand: 'L' | 'R';        // pitcher throwing hand
  inningsPitched: number;
  homeRunsPer9: number;
}

export interface ParkFactor {
  venueId: number;
  venueName: string;
  runFactor: number;       // 1.0 = neutral, >1.0 = hitter-friendly
  hrFactor: number;
  hitFactor: number;
}

export interface VSGateResult {
  score: number;           // 0–10
  tier: 'STRONG' | 'MODERATE' | 'NEUTRAL' | 'WEAK';
  passesGate: boolean;
  matrixScoreRequired: number; // minimum matrix score needed to pass gate
  breakdown: {
    xwobaDelta: number;
    xwobaDeltaScore: number;
    platoonAdvantage: number;
    platoonScore: number;
    pitcherVulnerability: number;
    pitcherVulnScore: number;
    batterContact: number;
    batterContactScore: number;
    parkEnvironment: number;
    parkScore: number;
  };
  reasoning: string[];
}

// ─── MLB Stats API helpers ────────────────────────────────────────────────────

const MLB_API = 'https://statsapi.mlb.com/api/v1';

async function fetchWithTimeout(url: string, timeoutMs = 4000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Fetch pitcher season stats from MLB Stats API.
 * Returns ERA, WHIP, K%, BB%, IP, HR/9.
 */
export async function fetchPitcherMLBStats(
  pitcherId: number,
  season = new Date().getFullYear()
): Promise<Partial<PitcherStatcast>> {
  try {
    const url = `${MLB_API}/people/${pitcherId}/stats?stats=season&group=pitching&season=${season}`;
    const data = await fetchWithTimeout(url);
    const splits = data?.stats?.[0]?.splits;
    if (!splits?.length) return {};
    const s = splits[0].stat;
    const ip = parseFloat(s.inningsPitched ?? '0');
    const bf = s.battersFaced ?? 1;
    return {
      era: parseFloat(s.era ?? '4.50'),
      whip: parseFloat(s.whip ?? '1.30'),
      kPct: ip > 0 ? ((s.strikeOuts ?? 0) / bf) * 100 : 20,
      bbPct: ip > 0 ? ((s.baseOnBalls ?? 0) / bf) * 100 : 8,
      inningsPitched: ip,
      homeRunsPer9: ip > 0 ? ((s.homeRuns ?? 0) / ip) * 9 : 1.2,
    };
  } catch {
    return {};
  }
}

/**
 * Fetch batter platoon splits (vs LHP and vs RHP) from MLB Stats API.
 * Returns batting average, OBP, SLG in each split.
 */
export async function fetchBatterPlatoonSplits(
  batterId: number,
  season = new Date().getFullYear()
): Promise<{ vsLeft: number; vsRight: number }> {
  try {
    const url = `${MLB_API}/people/${batterId}/stats?stats=statSplits&group=hitting&season=${season}&sitCodes=vl,vr`;
    const data = await fetchWithTimeout(url);
    const splits: any[] = data?.stats?.[0]?.splits ?? [];
    let vsLeft = 0.320;
    let vsRight = 0.320;
    for (const split of splits) {
      const obp = parseFloat(split.stat?.obp ?? '0');
      if (split.split?.code === 'vl') vsLeft = obp;
      if (split.split?.code === 'vr') vsRight = obp;
    }
    return { vsLeft, vsRight };
  } catch {
    return { vsLeft: 0.320, vsRight: 0.320 };
  }
}

/**
 * Fetch park factors from MLB Stats API venue data.
 * Uses a reasonable internal lookup based on venue dimensions/altitude.
 */
export function getParkFactor(venueId: number): ParkFactor {
  // Park factors derived from multi-year MLB data (2022–2024 averages)
  const PARK_FACTORS: Record<number, ParkFactor> = {
    15: { venueId: 15, venueName: 'Chase Field', runFactor: 1.06, hrFactor: 1.12, hitFactor: 1.04 },
    17: { venueId: 17, venueName: 'Coors Field', runFactor: 1.28, hrFactor: 1.22, hitFactor: 1.18 },
    2392: { venueId: 2392, venueName: 'Globe Life Field', runFactor: 0.97, hrFactor: 0.95, hitFactor: 0.98 },
    2681: { venueId: 2681, venueName: 'Minute Maid Park', runFactor: 1.02, hrFactor: 1.08, hitFactor: 1.01 },
    31: { venueId: 31, venueName: 'Dodger Stadium', runFactor: 0.94, hrFactor: 0.91, hitFactor: 0.96 },
    2602: { venueId: 2602, venueName: 'Oracle Park', runFactor: 0.89, hrFactor: 0.82, hitFactor: 0.93 },
    680: { venueId: 680, venueName: 'Petco Park', runFactor: 0.91, hrFactor: 0.87, hitFactor: 0.93 },
    3: { venueId: 3, venueName: 'Fenway Park', runFactor: 1.06, hrFactor: 1.02, hitFactor: 1.05 },
    3313: { venueId: 3313, venueName: 'Yankee Stadium', runFactor: 1.05, hrFactor: 1.15, hitFactor: 1.02 },
    4169: { venueId: 4169, venueName: 'Camden Yards', runFactor: 1.04, hrFactor: 1.10, hitFactor: 1.02 },
    5: { venueId: 5, venueName: 'Wrigley Field', runFactor: 1.01, hrFactor: 1.05, hitFactor: 1.00 },
    4: { venueId: 4, venueName: 'US Cellular / Guaranteed Rate', runFactor: 1.07, hrFactor: 1.18, hitFactor: 1.03 },
    2394: { venueId: 2394, venueName: 'Great American Ball Park', runFactor: 1.10, hrFactor: 1.18, hitFactor: 1.05 },
    2395: { venueId: 2395, venueName: 'PNC Park', runFactor: 0.96, hrFactor: 0.94, hitFactor: 0.97 },
    32: { venueId: 32, venueName: 'Busch Stadium', runFactor: 0.97, hrFactor: 0.93, hitFactor: 0.98 },
    4321: { venueId: 4321, venueName: 'Truist Park', runFactor: 1.01, hrFactor: 1.04, hitFactor: 1.00 },
    3289: { venueId: 3289, venueName: 'LoanDepot Park', runFactor: 0.94, hrFactor: 0.88, hitFactor: 0.95 },
    2756: { venueId: 2756, venueName: 'Nationals Park', runFactor: 1.00, hrFactor: 1.02, hitFactor: 0.99 },
    2523: { venueId: 2523, venueName: 'Citi Field', runFactor: 0.96, hrFactor: 0.95, hitFactor: 0.97 },
    2833: { venueId: 2833, venueName: 'Citizens Bank Park', runFactor: 1.05, hrFactor: 1.10, hitFactor: 1.02 },
    22: { venueId: 22, venueName: 'Rogers Centre', runFactor: 1.03, hrFactor: 1.06, hitFactor: 1.01 },
    4705: { venueId: 4705, venueName: 'Tropicana Field', runFactor: 0.95, hrFactor: 0.92, hitFactor: 0.96 },
    3167: { venueId: 3167, venueName: 'Oriole Park', runFactor: 1.04, hrFactor: 1.10, hitFactor: 1.02 },
    2626: { venueId: 2626, venueName: 'Kauffman Stadium', runFactor: 0.96, hrFactor: 0.94, hitFactor: 0.97 },
    5971: { venueId: 5971, venueName: 'Target Field', runFactor: 0.97, hrFactor: 0.96, hitFactor: 0.98 },
    47: { venueId: 47, venueName: 'U.S. Cellular Field', runFactor: 1.02, hrFactor: 1.06, hitFactor: 1.01 },
    2889: { venueId: 2889, venueName: 'Progressive Field', runFactor: 0.98, hrFactor: 0.97, hitFactor: 0.99 },
    2500: { venueId: 2500, venueName: 'Comerica Park', runFactor: 0.95, hrFactor: 0.91, hitFactor: 0.97 },
    18: { venueId: 18, venueName: 'American Family Field', runFactor: 1.04, hrFactor: 1.09, hitFactor: 1.02 },
    7: { venueId: 7, venueName: 'Oakland Coliseum', runFactor: 0.93, hrFactor: 0.88, hitFactor: 0.94 },
    2406: { venueId: 2406, venueName: 'T-Mobile Park', runFactor: 0.96, hrFactor: 0.93, hitFactor: 0.97 },
  };

  return PARK_FACTORS[venueId] ?? {
    venueId,
    venueName: 'Unknown',
    runFactor: 1.00,
    hrFactor: 1.00,
    hitFactor: 1.00,
  };
}

// ─── Scoring helpers ──────────────────────────────────────────────────────────

/**
 * Score the xwOBA delta between batter and pitcher.
 * Positive delta = batter has edge. Returns 0–10.
 */
function scoreXwobaDelta(batterXwoba: number, pitcherXwobaAgainst: number): number {
  const delta = batterXwoba - pitcherXwobaAgainst;
  // delta > +0.060 = dominant batter edge = 10
  // delta ~0       = neutral = 5
  // delta < -0.060 = pitcher dominates = 0
  const normalized = (delta + 0.080) / 0.160; // maps -0.08 to +0.08 → 0 to 1
  return Math.max(0, Math.min(10, normalized * 10));
}

/**
 * Score platoon advantage. Returns 0–10.
 * Same-hand (pitcher/batter) = slight disadvantage for batter.
 * Opposite-hand = advantage.
 */
function scorePlatoon(
  batterHand: 'L' | 'R' | 'S',
  pitcherHand: 'L' | 'R',
  vsLeft: number,
  vsRight: number
): number {
  const relevantOBP = pitcherHand === 'L' ? vsLeft : vsRight;
  const oppositeOBP = pitcherHand === 'L' ? vsRight : vsLeft;
  const isOpposite =
    batterHand === 'S' ||
    (batterHand === 'L' && pitcherHand === 'R') ||
    (batterHand === 'R' && pitcherHand === 'L');

  // OBP-based scoring: 0.400+ = 10, 0.280 = 0
  const obpScore = Math.max(0, Math.min(10, ((relevantOBP - 0.280) / 0.120) * 10));
  const platoonBonus = isOpposite ? 1.5 : 0;
  return Math.min(10, obpScore + platoonBonus);
}

/**
 * Score pitcher vulnerability. Returns 0–10.
 * High ERA/WHIP/HR rate = higher vulnerability = better for batter.
 */
function scorePitcherVulnerability(pitcher: Partial<PitcherStatcast>): number {
  const era = pitcher.era ?? 4.50;
  const whip = pitcher.whip ?? 1.30;
  const hr9 = pitcher.homeRunsPer9 ?? 1.20;
  const kPct = pitcher.kPct ?? 20;

  // ERA: 6.00+ = 10 (very weak), 2.50 = 0 (ace)
  const eraScore = Math.max(0, Math.min(10, ((era - 2.50) / 3.50) * 10));
  // WHIP: 1.60+ = 10, 0.90 = 0
  const whipScore = Math.max(0, Math.min(10, ((whip - 0.90) / 0.70) * 10));
  // HR/9: 2.0+ = 10, 0.5 = 0
  const hrScore = Math.max(0, Math.min(10, ((hr9 - 0.50) / 1.50) * 10));
  // K%: low K = bad pitcher for HRR, high K = threat. Invert: 10% K = 10, 35% = 0
  const kScore = Math.max(0, Math.min(10, ((35 - kPct) / 25) * 10));

  return (eraScore * 0.35) + (whipScore * 0.25) + (hrScore * 0.20) + (kScore * 0.20);
}

/**
 * Score batter contact quality from Statcast. Returns 0–10.
 */
function scoreBatterContact(batter: Partial<BatterStatcast>): number {
  const xwoba = batter.xwoba ?? 0.320;
  const barrel = batter.barrelPct ?? 8;
  const hardHit = batter.hardHitPct ?? 38;
  const kPct = batter.kPct ?? 22;

  const xwobaScore = Math.max(0, Math.min(10, ((xwoba - 0.280) / 0.120) * 10));
  const barrelScore = Math.max(0, Math.min(10, (barrel / 20) * 10));
  const hardHitScore = Math.max(0, Math.min(10, ((hardHit - 25) / 25) * 10));
  const kScore = Math.max(0, Math.min(10, ((35 - kPct) / 25) * 10));

  return (xwobaScore * 0.35) + (barrelScore * 0.25) + (hardHitScore * 0.25) + (kScore * 0.15);
}

/**
 * Score park run environment. Returns 0–10.
 */
function scorePark(venueId: number): number {
  const park = getParkFactor(venueId);
  // runFactor: 1.28 (Coors) = 10, 0.88 (Oakland) = 0
  return Math.max(0, Math.min(10, ((park.runFactor - 0.88) / 0.40) * 10));
}

// ─── Main VS Gate function ────────────────────────────────────────────────────

export async function computeVSGate(
  batter: Partial<BatterStatcast> & { playerId: number },
  pitcher: Partial<PitcherStatcast> & { playerId: number },
  venueId: number,
  statcastCache?: { batters: Map<number, BatterStatcast>; pitchers: Map<number, PitcherStatcast> }
): Promise<VSGateResult> {

  // Enrich from Statcast cache if available
  const cachedBatter = statcastCache?.batters.get(batter.playerId);
  const cachedPitcher = statcastCache?.pitchers.get(pitcher.playerId);
  const enrichedBatter: Partial<BatterStatcast> = { ...cachedBatter, ...batter };
  const enrichedPitcher: Partial<PitcherStatcast> = { ...cachedPitcher, ...pitcher };

  // Fetch MLB Stats API data (platoon splits + pitcher stats) in parallel
  const [platoonSplits, pitcherMLBStats] = await Promise.allSettled([
    fetchBatterPlatoonSplits(batter.playerId),
    fetchPitcherMLBStats(pitcher.playerId),
  ]);

  const splits = platoonSplits.status === 'fulfilled' ? platoonSplits.value : { vsLeft: 0.320, vsRight: 0.320 };
  const pitcherStats = pitcherMLBStats.status === 'fulfilled' ? pitcherMLBStats.value : {};
  const fullPitcher = { ...enrichedPitcher, ...pitcherStats };

  // Compute individual scores
  const batterXwoba = enrichedBatter.xwoba ?? 0.320;
  const pitcherXwobaAgainst = fullPitcher.xwobaAgainst ?? 0.320;
  const xwobaDelta = batterXwoba - pitcherXwobaAgainst;

  const xwobaDeltaScore = scoreXwobaDelta(batterXwoba, pitcherXwobaAgainst);
  const platoonScore = scorePlatoon(
    enrichedBatter.hand ?? 'R',
    fullPitcher.hand ?? 'R',
    splits.vsLeft,
    splits.vsRight
  );
  const pitcherVulnScore = scorePitcherVulnerability(fullPitcher);
  const batterContactScore = scoreBatterContact(enrichedBatter);
  const parkScore = scorePark(venueId);

  // Weighted final score
  const score =
    xwobaDeltaScore   * 0.30 +
    platoonScore      * 0.20 +
    pitcherVulnScore  * 0.25 +
    batterContactScore * 0.15 +
    parkScore         * 0.10;

  const roundedScore = Math.round(score * 10) / 10;

  // Determine tier
  let tier: VSGateResult['tier'];
  let matrixScoreRequired: number;
  let passesGate: boolean;

  if (roundedScore >= 9.0) {
    tier = 'STRONG';
    matrixScoreRequired = 0;    // always passes
    passesGate = true;
  } else if (roundedScore >= 7.0) {
    tier = 'MODERATE';
    matrixScoreRequired = 72;   // passes if matrix score is solid
    passesGate = true;          // gating done at matrix level
  } else if (roundedScore >= 5.0) {
    tier = 'NEUTRAL';
    matrixScoreRequired = 78;
    passesGate = true;
  } else {
    tier = 'WEAK';
    matrixScoreRequired = 85;   // very hard to pass gate
    passesGate = false;
  }

  // Build human-readable reasoning
  const reasoning: string[] = [];
  if (xwobaDelta > 0.030) reasoning.push(`Batter xwOBA edge +${(xwobaDelta * 1000).toFixed(0)} pts vs pitcher`);
  if (xwobaDelta < -0.030) reasoning.push(`Pitcher suppresses xwOBA (−${(Math.abs(xwobaDelta) * 1000).toFixed(0)} pts)`);
  if (platoonScore >= 7) reasoning.push(`Favorable platoon split (OBP ${(splits.vsLeft > splits.vsRight ? splits.vsLeft : splits.vsRight).toFixed(3)} vs this hand)`);
  if (pitcherVulnScore >= 7) reasoning.push(`Pitcher vulnerable: ERA ${(fullPitcher.era ?? 4.5).toFixed(2)}, WHIP ${(fullPitcher.whip ?? 1.3).toFixed(2)}`);
  if (pitcherVulnScore <= 3) reasoning.push(`Facing elite pitcher (ERA ${(fullPitcher.era ?? 3.0).toFixed(2)})`);
  if (batterContactScore >= 7) reasoning.push(`Elite contact quality (xwOBA ${batterXwoba.toFixed(3)}, Barrel ${(enrichedBatter.barrelPct ?? 0).toFixed(1)}%)`);
  const park = getParkFactor(venueId);
  if (park.runFactor > 1.08) reasoning.push(`Hitter-friendly park (${park.venueName}, run factor ${park.runFactor.toFixed(2)})`);
  if (park.runFactor < 0.94) reasoning.push(`Pitcher-friendly park (${park.venueName}, run factor ${park.runFactor.toFixed(2)})`);

  return {
    score: roundedScore,
    tier,
    passesGate,
    matrixScoreRequired,
    breakdown: {
      xwobaDelta: Math.round(xwobaDelta * 1000) / 1000,
      xwobaDeltaScore: Math.round(xwobaDeltaScore * 10) / 10,
      platoonAdvantage: platoonScore >= 5 ? 1 : -1,
      platoonScore: Math.round(platoonScore * 10) / 10,
      pitcherVulnerability: Math.round(pitcherVulnScore * 10) / 10,
      pitcherVulnScore: Math.round(pitcherVulnScore * 10) / 10,
      batterContact: Math.round(batterContactScore * 10) / 10,
      batterContactScore: Math.round(batterContactScore * 10) / 10,
      parkEnvironment: park.runFactor,
      parkScore: Math.round(parkScore * 10) / 10,
    },
    reasoning,
  };
}

/**
 * Batch compute VS gates for all batter/pitcher matchups in today's slate.
 * Returns a Map keyed by `${batterId}_${pitcherId}`.
 */
export async function batchComputeVSGates(
  matchups: Array<{ batter: Partial<BatterStatcast> & { playerId: number }; pitcher: Partial<PitcherStatcast> & { playerId: number }; venueId: number }>,
  statcastCache?: { batters: Map<number, BatterStatcast>; pitchers: Map<number, PitcherStatcast> }
): Promise<Map<string, VSGateResult>> {
  const results = new Map<string, VSGateResult>();
  const BATCH_SIZE = 15;

  for (let i = 0; i < matchups.length; i += BATCH_SIZE) {
    const batch = matchups.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map(m => computeVSGate(m.batter, m.pitcher, m.venueId, statcastCache))
    );
    settled.forEach((result, idx) => {
      const m = batch[idx];
      const key = `${m.batter.playerId}_${m.pitcher.playerId}`;
      if (result.status === 'fulfilled') {
        results.set(key, result.value);
      } else {
        // Neutral fallback on error
        results.set(key, {
          score: 5.0,
          tier: 'NEUTRAL',
          passesGate: true,
          matrixScoreRequired: 78,
          breakdown: { xwobaDelta: 0, xwobaDeltaScore: 5, platoonAdvantage: 0, platoonScore: 5, pitcherVulnerability: 5, pitcherVulnScore: 5, batterContact: 5, batterContactScore: 5, parkEnvironment: 1.0, parkScore: 5 },
          reasoning: ['Matchup data unavailable — neutral score applied'],
        });
      }
    });

    // Small pause between batches to avoid MLB API rate limits
    if (i + BATCH_SIZE < matchups.length) {
      await new Promise(r => setTimeout(r, 80));
    }
  }

  return results;
}
