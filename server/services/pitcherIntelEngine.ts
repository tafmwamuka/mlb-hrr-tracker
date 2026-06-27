/**
 * pitcherEdgeEngine.ts
 *
 * Powers the Pitchers tab with deep, real-data pitcher analysis.
 *
 * For each game on today's slate it provides:
 *  - Starting pitcher season stats (ERA, WHIP, K%, BB%, HR/9)
 *  - Statcast quality metrics (xFIP, xwOBA-against, barrel% allowed)
 *  - Recent form (last 3 starts: ERA, hits per IP, K rate)
 *  - Opposing lineup weakness (team OPS vs this pitcher's hand)
 *  - Park + weather context
 *  - Pitcher "Edge Score" 0–100 (how favorable for the BATTER to attack)
 *  - Diamond Edge verdict: ATTACK / NEUTRAL / AVOID
 *
 * The Pitchers tab uses this data to show users which pitchers
 * are exploitable (ATTACK) vs which ones to fade today.
 *
 * Connects to:
 *   - MLB Stats API (free, no key needed)
 *   - Statcast/Pybaseball cache (already in your app)
 *   - Your existing mlbMatchupVSGate park factor lookup
 */

import { getParkFactor } from './mlbMatchupVSGate';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PitcherRecentStart {
  date: string;
  opponent: string;
  inningsPitched: number;
  earnedRuns: number;
  hits: number;
  strikeouts: number;
  walks: number;
  era: number;
  result: 'W' | 'L' | 'ND';
}

export interface PitcherEdgeProfile {
  pitcherId: number;
  name: string;
  team: string;
  hand: 'L' | 'R';

  // Season stats
  era: number;
  whip: number;
  kPct: number;
  bbPct: number;
  hrPer9: number;
  inningsPitched: number;
  wins: number;
  losses: number;

  // Statcast (from your pybaseball cache)
  xwoba_against: number;   // xwOBA allowed — key vulnerability metric
  barrelPctAllowed: number; // barrel% allowed
  hardHitPctAllowed: number;
  exitVeloAllowed: number;

  // Recent form (last 3 starts)
  recentStarts: PitcherRecentStart[];
  recentERA: number;       // ERA over last 3 starts
  recentForm: 'HOT' | 'COLD' | 'NEUTRAL'; // pitcher's form

  // Game context
  opponent: string;
  venueId: number;
  venueName: string;
  gameTime: string;
  parkRunFactor: number;

  // Opposing team vs this pitcher's hand
  oppTeamOPS: number;      // opponent's team OPS vs LHP or RHP

  // Diamond Edge verdict
  edgeScore: number;       // 0–100 (higher = more exploitable by batters)
  verdict: 'ATTACK' | 'NEUTRAL' | 'AVOID';
  verdictReasoning: string[];
  attackStat: 'HITS' | 'RUNS' | 'RBI' | 'HRR'; // best stat to target vs this pitcher
  riskFlags: string[];
}

export interface PitchersTabData {
  slateDate: string;
  lastUpdated: string;
  pitchers: PitcherEdgeProfile[];
  topAttack: PitcherEdgeProfile[];   // top 3 most exploitable
  topAvoid: PitcherEdgeProfile[];    // top 3 hardest to attack
}

// ─── MLB Stats API helpers ────────────────────────────────────────────────────

const MLB_API = 'https://statsapi.mlb.com/api/v1';

async function fetchWithTimeout(url: string, ms = 5000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

/**
 * Fetch today's MLB schedule with probable pitchers and venue info.
 */
async function fetchTodaySchedule(date: string): Promise<any[]> {
  try {
    const url = `${MLB_API}/schedule?sportId=1&date=${date}&hydrate=probablePitcher,team,venue,game(content(editorial(recap)))`;
    const data = await fetchWithTimeout(url);
    return data?.dates?.[0]?.games ?? [];
  } catch {
    return [];
  }
}

/**
 * Fetch a pitcher's season stats.
 */
async function fetchPitcherSeasonStats(pitcherId: number, season: number): Promise<any> {
  try {
    const url = `${MLB_API}/people/${pitcherId}/stats?stats=season&group=pitching&season=${season}`;
    const data = await fetchWithTimeout(url);
    return data?.stats?.[0]?.splits?.[0]?.stat ?? {};
  } catch {
    return {};
  }
}

/**
 * Fetch a pitcher's last N game logs (recent starts).
 */
async function fetchPitcherGameLog(pitcherId: number, season: number, limit = 5): Promise<PitcherRecentStart[]> {
  try {
    const url = `${MLB_API}/people/${pitcherId}/stats?stats=gameLog&group=pitching&season=${season}&limit=${limit}`;
    const data = await fetchWithTimeout(url);
    const splits: any[] = data?.stats?.[0]?.splits ?? [];
    return splits.slice(0, limit).map(s => {
      const st = s.stat;
      const ip = parseFloat(st.inningsPitched ?? '0');
      return {
        date: s.date ?? '',
        opponent: s.team?.name ?? 'Unknown',
        inningsPitched: ip,
        earnedRuns: st.earnedRuns ?? 0,
        hits: st.hits ?? 0,
        strikeouts: st.strikeOuts ?? 0,
        walks: st.baseOnBalls ?? 0,
        era: ip > 0 ? ((st.earnedRuns ?? 0) / ip) * 9 : 0,
        result: (st.wins > 0 ? 'W' : st.losses > 0 ? 'L' : 'ND') as 'W' | 'L' | 'ND',
      };
    });
  } catch {
    return [];
  }
}

/**
 * Fetch a team's hitting stats vs LHP or RHP this season.
 */
async function fetchTeamSplitOPS(teamId: number, vsHand: 'L' | 'R', season: number): Promise<number> {
  try {
    const sitCode = vsHand === 'L' ? 'vl' : 'vr';
    const url = `${MLB_API}/teams/${teamId}/stats?stats=statSplits&group=hitting&season=${season}&sitCodes=${sitCode}`;
    const data = await fetchWithTimeout(url);
    const splits: any[] = data?.stats?.[0]?.splits ?? [];
    const ops = parseFloat(splits[0]?.stat?.ops ?? '0.720');
    return ops;
  } catch {
    return 0.720; // league average fallback
  }
}

// ─── Statcast cache interface ─────────────────────────────────────────────────

export interface PitcherStatcastEntry {
  playerId: number;
  xwobaAgainst: number;
  barrelPctAllowed: number;
  hardHitPctAllowed: number;
  exitVeloAllowed: number;
}

// ─── Edge Score calculation ───────────────────────────────────────────────────

function computeEdgeScore(profile: Omit<PitcherEdgeProfile, 'edgeScore' | 'verdict' | 'verdictReasoning' | 'attackStat' | 'riskFlags'>): number {
  // Higher edgeScore = more exploitable by batters

  // 1. ERA score: 6.00+ = 100, 2.50 = 0
  const eraScore = Math.max(0, Math.min(100, ((profile.era - 2.50) / 3.50) * 100));

  // 2. xwOBA allowed: 0.400+ = 100, 0.250 = 0
  const xwobaScore = Math.max(0, Math.min(100, ((profile.xwoba_against - 0.250) / 0.150) * 100));

  // 3. Recent form: cold pitcher (high recent ERA) = more exploitable
  const recentERAScore = profile.recentForm === 'COLD' ? 70 : profile.recentForm === 'HOT' ? 20 : 45;

  // 4. Opposing team OPS: high OPS vs this hand = good for batters
  const opsScore = Math.max(0, Math.min(100, ((profile.oppTeamOPS - 0.640) / 0.200) * 100));

  // 5. Park factor: hitter-friendly = more exploitable
  const parkScore = Math.max(0, Math.min(100, ((profile.parkRunFactor - 0.88) / 0.40) * 100));

  // 6. K rate: high K = bad for batters (lower edge for hits/RBI)
  const kScore = Math.max(0, Math.min(100, ((30 - profile.kPct) / 22) * 100));

  // Weighted average
  return Math.round(
    eraScore    * 0.25 +
    xwobaScore  * 0.25 +
    recentERAScore * 0.20 +
    opsScore    * 0.15 +
    parkScore   * 0.10 +
    kScore      * 0.05
  );
}

function computeVerdict(edgeScore: number): 'ATTACK' | 'NEUTRAL' | 'AVOID' {
  if (edgeScore >= 65) return 'ATTACK';
  if (edgeScore <= 35) return 'AVOID';
  return 'NEUTRAL';
}

function computeAttackStat(profile: Partial<PitcherEdgeProfile>): 'HITS' | 'RUNS' | 'RBI' | 'HRR' {
  // High WHIP/hits allowed → target HITS
  // High ERA + park factor → target RUNS
  // High HR/9 + park factor → target RBI or HRR
  const hrRisk = (profile.hrPer9 ?? 1.2) > 1.4;
  const hitterPark = (profile.parkRunFactor ?? 1.0) > 1.05;
  const leakyPitcher = (profile.era ?? 4.5) > 4.8;
  const highWhip = (profile.whip ?? 1.30) > 1.40;

  if (hrRisk && hitterPark) return 'HRR';
  if (highWhip && leakyPitcher) return 'HITS';
  if (leakyPitcher && hitterPark) return 'RUNS';
  return 'HITS'; // default safest stat
}

function buildReasoning(profile: Omit<PitcherEdgeProfile, 'edgeScore' | 'verdict' | 'verdictReasoning' | 'attackStat' | 'riskFlags'>): string[] {
  const reasons: string[] = [];
  if (profile.era > 5.0) reasons.push(`Elevated ERA ${profile.era.toFixed(2)} — batters scoring freely`);
  if (profile.xwoba_against > 0.360) reasons.push(`High xwOBA allowed (${profile.xwoba_against.toFixed(3)}) — contact quality poor`);
  if (profile.recentForm === 'COLD') reasons.push(`Cold stretch: ${profile.recentERA.toFixed(2)} ERA over last 3 starts`);
  if (profile.recentForm === 'HOT') reasons.push(`Pitcher in HOT form: ${profile.recentERA.toFixed(2)} ERA last 3 starts — fade risk`);
  if (profile.oppTeamOPS > 0.780) reasons.push(`Opponent team OPS ${profile.oppTeamOPS.toFixed(3)} vs ${profile.hand}HP — dangerous lineup`);
  if (profile.parkRunFactor > 1.08) reasons.push(`${profile.venueName} is hitter-friendly (run factor ${profile.parkRunFactor.toFixed(2)})`);
  if (profile.whip > 1.45) reasons.push(`High WHIP ${profile.whip.toFixed(2)} — base runners expected`);
  if (profile.barrelPctAllowed > 10) reasons.push(`Allows barrels at ${profile.barrelPctAllowed.toFixed(1)}% — power threat`);
  if (profile.era < 3.00) reasons.push(`Ace-level ERA ${profile.era.toFixed(2)} — elite pitcher, limit exposure`);
  if (profile.kPct > 28) reasons.push(`High K rate ${profile.kPct.toFixed(1)}% — strikeout threat, hits suppressed`);
  return reasons;
}

function buildRiskFlags(profile: Omit<PitcherEdgeProfile, 'edgeScore' | 'verdict' | 'verdictReasoning' | 'attackStat' | 'riskFlags'>): string[] {
  const flags: string[] = [];
  if (profile.kPct > 27) flags.push(`⚠️ High K rate (${profile.kPct.toFixed(1)}%) — hits props at risk`);
  if (profile.era < 3.20) flags.push(`🔒 Elite ERA — avoid if possible`);
  if (profile.recentForm === 'HOT') flags.push(`🔥 Pitcher on hot streak — regression risk`);
  if (profile.parkRunFactor < 0.93) flags.push(`🏟️ Pitcher-friendly park — suppress run expectations`);
  if (profile.inningsPitched < 30) flags.push(`📊 Small sample — ERA may not be stable`);
  return flags;
}

// ─── Main engine ──────────────────────────────────────────────────────────────

export async function buildPitchersTabData(
  statcastPitcherCache?: Map<number, PitcherStatcastEntry>
): Promise<PitchersTabData> {
  const season = new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10);

  const games = await fetchTodaySchedule(today);

  const profiles: PitcherEdgeProfile[] = [];

  // Process each game's two starting pitchers
  for (const game of games) {
    const venueId: number = game.venue?.id ?? 0;
    const venueName: string = game.venue?.name ?? 'Unknown';
    const gameTime: string = game.gameDate ?? '';
    const park = getParkFactor(venueId);

    const pitchers = [
      { pitcher: game.teams?.away?.probablePitcher, team: game.teams?.away?.team, opponent: game.teams?.home?.team },
      { pitcher: game.teams?.home?.probablePitcher, team: game.teams?.home?.team, opponent: game.teams?.away?.team },
    ].filter(p => p.pitcher?.id);

    for (const { pitcher, team, opponent } of pitchers) {
      if (!pitcher?.id) continue;

      const [seasonStats, recentStarts, oppOPS] = await Promise.allSettled([
        fetchPitcherSeasonStats(pitcher.id, season),
        fetchPitcherGameLog(pitcher.id, season, 4),
        fetchTeamSplitOPS(opponent?.id ?? 0, pitcher.pitchHand?.code as 'L' | 'R' ?? 'R', season),
      ]);

      const stats = seasonStats.status === 'fulfilled' ? seasonStats.value : {};
      const starts = recentStarts.status === 'fulfilled' ? recentStarts.value : [];
      const teamOPS = oppOPS.status === 'fulfilled' ? oppOPS.value : 0.720;

      const ip = parseFloat(stats.inningsPitched ?? '0');
      const bf = stats.battersFaced ?? 1;

      // Compute recent ERA
      const recentIP = starts.reduce((s: number, g: PitcherRecentStart) => s + g.inningsPitched, 0);
      const recentER = starts.reduce((s: number, g: PitcherRecentStart) => s + g.earnedRuns, 0);
      const recentERA = recentIP > 0 ? (recentER / recentIP) * 9 : parseFloat(stats.era ?? '4.50');
      const seasonERA = parseFloat(stats.era ?? '4.50');
      const recentForm: 'HOT' | 'COLD' | 'NEUTRAL' =
        recentERA < seasonERA - 1.0 ? 'HOT' :
        recentERA > seasonERA + 1.0 ? 'COLD' : 'NEUTRAL';

      // Statcast enrichment
      const sc = statcastPitcherCache?.get(pitcher.id);

      const baseProfile = {
        pitcherId: pitcher.id,
        name: pitcher.fullName ?? pitcher.lastName ?? 'Unknown',
        team: team?.abbreviation ?? '???',
        hand: (pitcher.pitchHand?.code as 'L' | 'R') ?? 'R',
        era: seasonERA,
        whip: parseFloat(stats.whip ?? '1.30'),
        kPct: ip > 0 ? ((stats.strikeOuts ?? 0) / bf) * 100 : 20,
        bbPct: ip > 0 ? ((stats.baseOnBalls ?? 0) / bf) * 100 : 8,
        hrPer9: ip > 0 ? ((stats.homeRuns ?? 0) / ip) * 9 : 1.2,
        inningsPitched: ip,
        wins: stats.wins ?? 0,
        losses: stats.losses ?? 0,
        xwoba_against: sc?.xwobaAgainst ?? 0.320,
        barrelPctAllowed: sc?.barrelPctAllowed ?? 8.0,
        hardHitPctAllowed: sc?.hardHitPctAllowed ?? 38.0,
        exitVeloAllowed: sc?.exitVeloAllowed ?? 89.0,
        recentStarts: starts.slice(0, 3),
        recentERA,
        recentForm,
        opponent: opponent?.abbreviation ?? '???',
        venueId,
        venueName,
        gameTime,
        parkRunFactor: park.runFactor,
        oppTeamOPS: teamOPS,
      };

      const edgeScore = computeEdgeScore(baseProfile);
      const verdict = computeVerdict(edgeScore);
      const verdictReasoning = buildReasoning(baseProfile);
      const attackStat = computeAttackStat(baseProfile);
      const riskFlags = buildRiskFlags(baseProfile);

      profiles.push({
        ...baseProfile,
        edgeScore,
        verdict,
        verdictReasoning,
        attackStat,
        riskFlags,
      });
    }
  }

  // Sort by edgeScore descending
  profiles.sort((a, b) => b.edgeScore - a.edgeScore);

  return {
    slateDate: today,
    lastUpdated: new Date().toISOString(),
    pitchers: profiles,
    topAttack: profiles.filter(p => p.verdict === 'ATTACK').slice(0, 3),
    topAvoid: profiles.filter(p => p.verdict === 'AVOID').slice(0, 3),
  };
}
