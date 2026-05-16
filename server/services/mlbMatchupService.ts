/**
 * MLB-Native Matchup Quality Service
 *
 * Computes a VS-equivalent matchup score (0-10 scale) for each batter
 * using real MLB Stats API data, modelled after hrtargets.com's "Sweet Spot" formula.
 *
 * Score components (mirrors hrtargets pq() function):
 *   1. Pitcher vulnerability  — ERA score (0-25 pts)
 *   2. Zone/power metrics     — barrel% + hard-hit% from Statcast (0-25 pts)
 *   3. Park factor            — pitcher's home park (0-15 pts)
 *   4. Matchup tier           — STRONG/MODERATE/BAD from platoon splits (0-15 pts)
 *   5. Streak bonus           — recent form boost (0-5 pts)
 *
 * Total raw 0-85 pts → normalized to 0-10 scale.
 *
 * Gate thresholds:
 *   - Score >= 7.0 → always included (equivalent to VS=10 / STRONG)
 *   - Score >= 5.5 → included if other strong signals present (equivalent to VS=9 / MODERATE)
 *   - Score < 5.5  → excluded
 *
 * Cached per-player for 30 minutes to avoid hammering the MLB API.
 */

const MLB_API = 'https://statsapi.mlb.com/api/v1';
const PLAYER_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// Park factors by MLB team ID (home run park factor, 1.0 = neutral)
// Source: approximate 2024-2026 multi-year park factors
const PARK_FACTORS: Record<number, number> = {
  108: 0.97,  // LAA - Angel Stadium
  109: 1.03,  // ARI - Chase Field (roof open)
  110: 0.95,  // BAL - Camden Yards
  111: 0.98,  // BOS - Fenway Park
  112: 1.02,  // CHC - Wrigley Field
  113: 1.05,  // CIN - Great American Ball Park
  114: 0.97,  // CLE - Progressive Field
  115: 1.15,  // COL - Coors Field
  116: 0.98,  // DET - Comerica Park
  117: 1.02,  // HOU - Minute Maid Park
  118: 0.97,  // KC - Kauffman Stadium
  119: 1.05,  // LAD - Dodger Stadium
  120: 0.98,  // WSH - Nationals Park
  121: 1.00,  // NYM - Citi Field
  133: 0.97,  // OAK/ATH - Oakland Coliseum
  134: 0.96,  // PIT - PNC Park
  135: 0.96,  // SD - Petco Park
  136: 0.97,  // SEA - T-Mobile Park
  137: 0.98,  // SF - Oracle Park
  138: 0.99,  // STL - Busch Stadium
  139: 0.97,  // TB - Tropicana Field
  140: 1.02,  // TEX - Globe Life Field
  141: 1.01,  // TOR - Rogers Centre
  142: 0.98,  // MIN - Target Field
  143: 1.03,  // PHI - Citizens Bank Park
  144: 1.02,  // ATL - Truist Park
  145: 1.00,  // CWS - Guaranteed Rate Field
  146: 0.97,  // MIA - loanDepot park
  147: 1.05,  // NYY - Yankee Stadium
  158: 0.98,  // MIL - American Family Field
};

interface PlatoonSplit {
  vsRight: { avg: number; ops: number } | null;
  vsLeft: { avg: number; ops: number } | null;
  seasonAvg: number;
  seasonOps: number;
}

interface PitcherStats {
  era: number;
  whip: number;
  oppAvg: number;
  homeTeamId: number | null; // for park factor lookup
  kPer9: number;
  bbPer9: number;
  xwOBAAgainst?: number; // Statcast xwOBA-against (injected from StatcastCache.pitchers)
}

export interface MatchupScore {
  playerId: number;
  pitcherId: number;
  score: number;          // 0-10 (VS-equivalent)
  tier: 'STRONG' | 'MODERATE' | 'BAD';
  platoonBoost: number;   // -1 to +1 (positive = batter has platoon advantage)
  pitcherVulnerability: number; // 0-100
  batterAvgVsPitcherHand: number;
  pitcherEra: number;
  pitcherWhip: number;
  parkFactor: number;
  xwOBADelta?: number;    // batter xwOBA - pitcher xwOBA-against (positive = batter edge)
  // Component scores for debugging
  components: {
    pitcherScore: number;
    powerScore: number;
    parkScore: number;
    tierScore: number;
    streakBonus: number;
    xwOBAScore: number;   // bonus/penalty from xwOBA delta
  };
}

// Per-player cache
const batterSplitsCache = new Map<number, { data: PlatoonSplit; ts: number }>();
const pitcherStatsCache = new Map<number, { data: PitcherStats; ts: number }>();

async function fetchJSON(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'MLB-HRR-Tracker/1.0' },
    signal: AbortSignal.timeout(3000), // 3s per call — fail fast, use fallback
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

/**
 * Fetch batter platoon splits (vs LHP and vs RHP) for the current season.
 */
async function getBatterSplits(playerId: number, season: number): Promise<PlatoonSplit> {
  const cached = batterSplitsCache.get(playerId);
  if (cached && Date.now() - cached.ts < PLAYER_CACHE_TTL) return cached.data;

  try {
    const url = `${MLB_API}/people/${playerId}/stats?stats=statSplits&group=hitting&season=${season}&sitCodes=vr,vl`;
    const data = await fetchJSON(url) as { stats?: { splits?: { split?: { description?: string }; stat?: { avg?: string; ops?: string } }[] }[] };
    const splits = data.stats?.[0]?.splits || [];

    let vsRight: { avg: number; ops: number } | null = null;
    let vsLeft: { avg: number; ops: number } | null = null;

    for (const s of splits) {
      const desc = s.split?.description || '';
      const avg = parseFloat(s.stat?.avg || '0') || 0;
      const ops = parseFloat(s.stat?.ops || '0') || 0;
      if (desc === 'vs Right') vsRight = { avg, ops };
      if (desc === 'vs Left') vsLeft = { avg, ops };
    }

    // Fetch season overall avg/ops for comparison
    const seasonUrl = `${MLB_API}/people/${playerId}/stats?stats=season&group=hitting&season=${season}`;
    const seasonData = await fetchJSON(seasonUrl) as { stats?: { splits?: { stat?: { avg?: string; ops?: string } }[] }[] };
    const seasonStat = seasonData.stats?.[0]?.splits?.[0]?.stat;
    const seasonAvg = parseFloat(seasonStat?.avg || '0') || 0.250;
    const seasonOps = parseFloat(seasonStat?.ops || '0') || 0.700;

    const result: PlatoonSplit = { vsRight, vsLeft, seasonAvg, seasonOps };
    batterSplitsCache.set(playerId, { data: result, ts: Date.now() });
    return result;
  } catch {
    return { vsRight: null, vsLeft: null, seasonAvg: 0.250, seasonOps: 0.700 };
  }
}

/**
 * Fetch pitcher season stats.
 */
async function getPitcherStats(pitcherId: number, season: number): Promise<PitcherStats> {
  const cached = pitcherStatsCache.get(pitcherId);
  if (cached && Date.now() - cached.ts < PLAYER_CACHE_TTL) return cached.data;

  try {
    const url = `${MLB_API}/people/${pitcherId}/stats?stats=season&group=pitching&season=${season}&hydrate=currentTeam`;
    const data = await fetchJSON(url) as {
      stats?: { splits?: { stat?: { era?: string; whip?: string; avg?: string; strikeOuts?: number; inningsPitched?: string; baseOnBalls?: number } }[] }[];
      people?: { currentTeam?: { id: number } }[];
    };
    const stat = data.stats?.[0]?.splits?.[0]?.stat;

    const era = parseFloat(stat?.era || '4.50') || 4.50;
    const whip = parseFloat(stat?.whip || '1.30') || 1.30;
    const oppAvg = parseFloat(stat?.avg || '.250') || 0.250;
    const ip = parseFloat(stat?.inningsPitched || '0') || 1;
    const kPer9 = stat?.strikeOuts ? (stat.strikeOuts / ip) * 9 : 8.0;
    const bbPer9 = stat?.baseOnBalls ? (stat.baseOnBalls / ip) * 9 : 3.0;

    // Try to get home team ID for park factor
    const personUrl = `${MLB_API}/people/${pitcherId}?hydrate=currentTeam`;
    let homeTeamId: number | null = null;
    try {
      const personData = await fetchJSON(personUrl) as { people?: { currentTeam?: { id: number } }[] };
      homeTeamId = personData.people?.[0]?.currentTeam?.id ?? null;
    } catch { /* ignore */ }

    const result: PitcherStats = { era, whip, oppAvg, homeTeamId, kPer9, bbPer9 };
    pitcherStatsCache.set(pitcherId, { data: result, ts: Date.now() });
    return result;
  } catch {
    return { era: 4.50, whip: 1.30, oppAvg: 0.250, homeTeamId: null, kPer9: 8.0, bbPer9: 3.0 };
  }
}

/**
 * Compute the hrtargets-style "pq" score for a matchup.
 *
 * Mirrors the hrtargets pq() function:
 *   - pitcher: ERA score (0-25 pts)
 *   - power: barrel% + hard-hit% (0-25 pts)
 *   - park: park factor bonus (0-15 pts)
 *   - tier: STRONG=15, MODERATE=7, BAD=0
 *   - streak: recent form bonus (0-5 pts)
 *
 * Total max = 85 pts → normalized to 0-10 scale.
 */
function computeHRTargetsScore(params: {
  era: number;
  parkFactor: number;
  tier: 'STRONG' | 'MODERATE' | 'BAD';
  barrelPct: number;    // e.g. 8.5 = 8.5%
  hardHitPct: number;   // e.g. 42.0 = 42%
  seasonHr: number;
  streakBonus: number;  // 0-5
  xwOBADelta?: number;  // batter xwOBA - pitcher xwOBA-against (e.g. +0.040 = batter edge)
}): { total: number; components: { pitcherScore: number; powerScore: number; parkScore: number; tierScore: number; streakBonus: number; xwOBAScore: number } } {
  const { era, parkFactor, tier, barrelPct, hardHitPct, seasonHr, streakBonus, xwOBADelta } = params;

  // Pitcher score: higher ERA = more hittable = higher score
  // ERA 3.5 → 0 pts, ERA 7.0 → 25 pts (same as hrtargets formula)
  const pitcherScore = Math.min(25, Math.max(0, ((era - 3.5) / 3.0) * 25));

  // Power score: barrel% (0-10 pts) + hard-hit% (0-8 pts) + season HR (0-7 pts)
  const barrelScore = Math.min(10, (barrelPct / 15) * 10);
  const hardHitScore = Math.min(8, (hardHitPct / 50) * 8);
  const hrScore = Math.min(7, (seasonHr / 30) * 7);
  const powerScore = barrelScore + hardHitScore + hrScore;

  // Park factor score: 0.90 → 0 pts, 1.30 → 15 pts
  const parkScore = Math.min(15, Math.max(0, ((parkFactor - 0.90) / 0.40) * 15));

  // Tier score: STRONG=15, MODERATE=7, BAD=0
  const tierScore = tier === 'STRONG' ? 15 : tier === 'MODERATE' ? 7 : 0;

  // xwOBA delta score: batter xwOBA advantage over pitcher xwOBA-against
  // Delta +0.050 = strong batter edge (+10 pts), Delta -0.050 = pitcher dominates (-10 pts)
  // League avg xwOBA ~.320; delta of 0 = neutral
  // Max bonus: +10 pts (delta >= +0.050), Max penalty: -10 pts (delta <= -0.050)
  let xwOBAScore = 0;
  if (xwOBADelta !== undefined && xwOBADelta !== null) {
    xwOBAScore = Math.min(10, Math.max(-10, (xwOBADelta / 0.050) * 10));
  }

  const rawTotal = pitcherScore + powerScore + parkScore + tierScore + streakBonus + xwOBAScore;
  const total = Math.min(95, Math.max(0, Math.round(rawTotal))); // max bumped to 95 to allow xwOBA bonus

  return {
    total,
    components: {
      pitcherScore: Math.round(pitcherScore),
      powerScore: Math.round(powerScore),
      parkScore: Math.round(parkScore),
      tierScore,
      streakBonus,
      xwOBAScore: Math.round(xwOBAScore),
    },
  };
}

/**
 * Compute a 0-10 matchup quality score for a batter vs pitcher.
 *
 * Incorporates:
 * - Pitcher ERA/WHIP vulnerability
 * - Batter platoon advantage vs pitcher handedness
 * - Park factor (pitcher's home park)
 * - Optional Statcast barrel%/hard-hit% for power grading
 * - Optional streak bonus
 */
export async function computeMatchupScore(
  playerId: number,
  pitcherId: number,
  pitcherHand: 'L' | 'R' | 'S' | string,
  season: number,
  options?: {
    barrelPct?: number;
    hardHitPct?: number;
    seasonHr?: number;
    streakBonus?: number;
    batterXwOBA?: number;     // batter's xwOBA from Statcast (e.g. 0.360)
    pitcherXwOBAAgainst?: number; // pitcher's xwOBA-against from Statcast (e.g. 0.290)
  }
): Promise<MatchupScore> {
  const [splits, pitcherStats] = await Promise.all([
    getBatterSplits(playerId, season),
    getPitcherStats(pitcherId, season),
  ]);

  // Get batter's avg vs this pitcher's handedness
  const relevantSplit = pitcherHand === 'L' ? splits.vsLeft : splits.vsRight;
  const batterAvgVsPitcherHand = relevantSplit?.avg ?? splits.seasonAvg;
  const batterOpsVsPitcherHand = relevantSplit?.ops ?? splits.seasonOps;

  // Platoon boost: how much better/worse does batter hit vs this handedness?
  const avgDiff = batterAvgVsPitcherHand - splits.seasonAvg;
  const opsDiff = batterOpsVsPitcherHand - splits.seasonOps;
  const platoonBoost = Math.max(-1, Math.min(1, (avgDiff * 10 + opsDiff * 3) / 2));

  // Determine matchup tier from platoon advantage + pitcher vulnerability
  // ERA >= 4.50 = primary HR target (STRONG if platoon advantage, else MODERATE)
  // ERA 3.50-4.50 = MODERATE
  // ERA < 3.50 = BAD unless strong platoon advantage
  let tier: 'STRONG' | 'MODERATE' | 'BAD';
  const isPrimaryTarget = pitcherStats.era >= 4.50;
  const hasGoodPlatoon = platoonBoost > 0.1;
  const hasBadPlatoon = platoonBoost < -0.1;

  if (isPrimaryTarget && hasGoodPlatoon) tier = 'STRONG';
  else if (isPrimaryTarget || hasGoodPlatoon) tier = 'MODERATE';
  else if (hasBadPlatoon && !isPrimaryTarget) tier = 'BAD';
  else tier = 'MODERATE';

  // Park factor for the pitcher's home park
  const parkFactor = pitcherStats.homeTeamId ? (PARK_FACTORS[pitcherStats.homeTeamId] ?? 1.0) : 1.0;

  // Statcast power metrics (use provided or defaults)
  const barrelPct = options?.barrelPct ?? 7.0;    // league avg ~7%
  const hardHitPct = options?.hardHitPct ?? 38.0; // league avg ~38%
  const seasonHr = options?.seasonHr ?? 10;
  const streakBonus = options?.streakBonus ?? 0;

  // xwOBA delta: batter advantage over pitcher
  // League avg xwOBA ~.320 for both batters and pitchers-against
  let xwOBADelta: number | undefined;
  if (options?.batterXwOBA !== undefined && options?.pitcherXwOBAAgainst !== undefined) {
    // Positive delta = batter is above-average, pitcher is below-average suppressor = good matchup
    xwOBADelta = options.batterXwOBA - options.pitcherXwOBAAgainst;
  } else if (options?.batterXwOBA !== undefined) {
    // Only batter data: compare to league avg pitcher (.320)
    xwOBADelta = options.batterXwOBA - 0.320;
  } else if (options?.pitcherXwOBAAgainst !== undefined) {
    // Only pitcher data: compare to league avg batter (.320)
    xwOBADelta = 0.320 - options.pitcherXwOBAAgainst;
  }

  // Compute hrtargets-style score (max 95 with xwOBA bonus)
  const { total: rawScore, components } = computeHRTargetsScore({
    era: pitcherStats.era,
    parkFactor,
    tier,
    barrelPct,
    hardHitPct,
    seasonHr,
    streakBonus,
    xwOBADelta,
  });

  // Normalize raw score (0-95) to 0-10 scale
  const score = Math.round((rawScore / 95) * 10 * 10) / 10;

  // Pitcher vulnerability for backward compatibility
  const eraScore = Math.min(100, Math.max(0, ((pitcherStats.era - 2.0) / 5.0) * 100));
  const whipScore = Math.min(100, Math.max(0, ((pitcherStats.whip - 0.90) / 0.90) * 100));
  const avgScore = Math.min(100, Math.max(0, ((pitcherStats.oppAvg - 0.18) / 0.13) * 100));
  const pitcherVulnerability = (eraScore * 0.40 + whipScore * 0.35 + avgScore * 0.25);

  return {
    playerId,
    pitcherId,
    score,
    tier,
    platoonBoost,
    pitcherVulnerability,
    batterAvgVsPitcherHand,
    pitcherEra: pitcherStats.era,
    xwOBADelta,
    pitcherWhip: pitcherStats.whip,
    parkFactor,
    components,
  };
}

/**
 * Batch compute matchup scores for all players in today's lineup.
 * Returns a Map<playerName, score> for use in the VS gate.
 *
 * Players with no pitcher data get a neutral score of 5.0.
 * Accepts optional Statcast data to improve power grading.
 */
export async function batchComputeMatchupScores(
  players: Array<{
    playerId: number;
    playerName: string;
    pitcherId?: number | null;
    pitcherHand?: string | null;
    // Optional Statcast enrichment for hrtargets-style power grading
    barrelPct?: number | null;
    hardHitPct?: number | null;
    seasonHr?: number | null;
    streakBonus?: number | null;
    // xwOBA fields for VS gate upgrade (Phase AC)
    batterXwOBA?: number | null;         // batter's Statcast xwOBA
    pitcherXwOBAAgainst?: number | null; // pitcher's Statcast xwOBA-against
  }>,
  season: number
): Promise<Map<string, number>> {
  const results = new Map<string, number>();

  // Process in batches of 25 — larger batches = fewer round trips = faster cold cache
  const BATCH_SIZE = 25;
  for (let i = 0; i < players.length; i += BATCH_SIZE) {
    const batch = players.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (p) => {
        if (!p.pitcherId) {
          results.set(p.playerName, 5.0); // neutral if no pitcher
          return;
        }
        try {
          const ms = await computeMatchupScore(
            p.playerId,
            p.pitcherId,
            p.pitcherHand || 'R',
            season,
            {
              barrelPct: p.barrelPct ?? undefined,
              hardHitPct: p.hardHitPct ?? undefined,
              seasonHr: p.seasonHr ?? undefined,
              streakBonus: p.streakBonus ?? undefined,
              batterXwOBA: p.batterXwOBA ?? undefined,
              pitcherXwOBAAgainst: p.pitcherXwOBAAgainst ?? undefined,
            }
          );
          results.set(p.playerName, ms.score);
        } catch {
          results.set(p.playerName, 5.0);
        }
      })
    );
  }

  const allScores = Array.from(results.values());
  console.log(`[MLBMatchup] Computed ${results.size} matchup scores (hrtargets-style). ` +
    `STRONG (>=7): ${allScores.filter(v => v >= 7).length}, ` +
    `MODERATE (5.5-7): ${allScores.filter(v => v >= 5.5 && v < 7).length}, ` +
    `BAD (<5.5): ${allScores.filter(v => v < 5.5).length}`);

  return results;
}

/**
 * Clear the matchup caches (call on daily reset).
 */
export function clearMatchupCache(): void {
  batterSplitsCache.clear();
  pitcherStatsCache.clear();
}
