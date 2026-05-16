/**
 * Lineup Adapter
 * Converts real MLB lineup data from mlbLineupService into the format
 * expected by aiRankingService and hrrService.
 *
 * Phase AJ upgrade: fetches real batter/pitcher handedness from MLB API
 * Phase AN perf fix: handedness + platoon fetches are NON-BLOCKING background tasks.
 *   - On cold cache: returns 'R' default immediately (no blocking)
 *   - Background pre-warm populates the cache within 30-60s
 *   - Subsequent calls use the warm cache instantly
 *   - This eliminates the 150+ sequential timeout calls that caused 30-60s buffering
 */

import { getTodaysPlayersWithStats, getTodaysGamesSummary, type PlayerWithContext, type MLBGame } from "./mlbLineupService";

const MLB_API_BASE = "https://statsapi.mlb.com/api/v1";

// ─── Handedness cache ─────────────────────────────────────────────────────────
// Caches batter batSide + pitcher pitchHand for 6 hours (doesn't change during season)
interface HandednessEntry {
  batSide: 'R' | 'L' | 'S';
  ts: number;
}
interface PitcherHandEntry {
  pitchHand: 'R' | 'L';
  ts: number;
}
const batterHandCache = new Map<number, HandednessEntry>();
const pitcherHandCache = new Map<number, PitcherHandEntry>();
const HAND_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

// ─── Platoon split cache ──────────────────────────────────────────────────────
// Caches batter vs RHP / vs LHP avg for 30 minutes
interface PlatoonEntry {
  vsRHP: number;
  vsLHP: number;
  ts: number;
}
const platoonCache = new Map<number, PlatoonEntry>();
const PLATOON_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// ─── Background pre-warm state ────────────────────────────────────────────────
let handednessWarmInProgress = false;
let lastHandednessWarm = 0;
const HANDEDNESS_WARM_INTERVAL = 60 * 60 * 1000; // Re-warm every 60 min

async function safeFetch(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MLB-HRR-Tracker/1.0' },
      signal: AbortSignal.timeout(4000), // 4s per call — fail fast
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch batter handedness (batSide) from MLB API.
 * Returns 'R' as safe default on failure.
 */
async function getBatterHandedness(playerId: number): Promise<'R' | 'L' | 'S'> {
  const cached = batterHandCache.get(playerId);
  if (cached && Date.now() - cached.ts < HAND_CACHE_TTL) return cached.batSide;

  const data = await safeFetch(`${MLB_API_BASE}/people/${playerId}`);
  const code = data?.people?.[0]?.batSide?.code;
  const batSide: 'R' | 'L' | 'S' = code === 'L' ? 'L' : code === 'S' ? 'S' : 'R';
  batterHandCache.set(playerId, { batSide, ts: Date.now() });
  return batSide;
}

/**
 * Fetch pitcher handedness (pitchHand) from MLB API.
 * Returns 'R' as safe default on failure.
 */
async function getPitcherHandedness(pitcherId: number): Promise<'R' | 'L'> {
  const cached = pitcherHandCache.get(pitcherId);
  if (cached && Date.now() - cached.ts < HAND_CACHE_TTL) return cached.pitchHand;

  const data = await safeFetch(`${MLB_API_BASE}/people/${pitcherId}`);
  const code = data?.people?.[0]?.pitchHand?.code;
  const pitchHand: 'R' | 'L' = code === 'L' ? 'L' : 'R';
  pitcherHandCache.set(pitcherId, { pitchHand, ts: Date.now() });
  return pitchHand;
}

/**
 * Fetch batter platoon splits (vs RHP avg, vs LHP avg) for the current season.
 * Returns season avg as fallback for both if splits are unavailable.
 */
async function getBatterPlatoonSplits(playerId: number, seasonAvg: number): Promise<{ vsRHP: number; vsLHP: number }> {
  const cached = platoonCache.get(playerId);
  if (cached && Date.now() - cached.ts < PLATOON_CACHE_TTL) {
    return { vsRHP: cached.vsRHP, vsLHP: cached.vsLHP };
  }

  const season = new Date().getFullYear();
  const data = await safeFetch(
    `${MLB_API_BASE}/people/${playerId}/stats?stats=statSplits&group=hitting&season=${season}&sitCodes=vr,vl`
  );

  let vsRHP = seasonAvg;
  let vsLHP = seasonAvg;

  const splits = data?.stats?.[0]?.splits ?? [];
  for (const s of splits) {
    const desc = s.split?.description || '';
    const avg = parseFloat(s.stat?.avg || '0') || 0;
    if (avg > 0) {
      if (desc === 'vs Right') vsRHP = avg;
      if (desc === 'vs Left') vsLHP = avg;
    }
  }

  platoonCache.set(playerId, { vsRHP, vsLHP, ts: Date.now() });
  return { vsRHP, vsLHP };
}

/**
 * Background pre-warm: fetches handedness + platoon splits for all players
 * WITHOUT blocking the critical path. Called after lineup data is ready.
 * Runs in batches of 10 with small delays to avoid rate-limiting.
 */
async function prewarmHandednessInBackground(players: PlayerWithContext[]): Promise<void> {
  if (handednessWarmInProgress) return;
  if (Date.now() - lastHandednessWarm < HANDEDNESS_WARM_INTERVAL) return;

  handednessWarmInProgress = true;
  const startMs = Date.now();

  try {
    const batterIds = players.map(p => p.playerId);
    const pitcherIds = Array.from(new Set(
      players.map(p => p.opposingPitcher?.id).filter((id): id is number => !!id)
    ));

    // Filter to only uncached players to minimize API calls
    const uncachedBatterIds = batterIds.filter(id => {
      const c = batterHandCache.get(id);
      return !c || Date.now() - c.ts >= HAND_CACHE_TTL;
    });
    const uncachedPitcherIds = pitcherIds.filter(id => {
      const c = pitcherHandCache.get(id);
      return !c || Date.now() - c.ts >= HAND_CACHE_TTL;
    });
    const uncachedPlatoonIds = players
      .filter(p => {
        const c = platoonCache.get(p.playerId);
        return !c || Date.now() - c.ts >= PLATOON_CACHE_TTL;
      })
      .map(p => ({ id: p.playerId, avg: parseFloat(p.avg) || 0.250 }));

    if (uncachedBatterIds.length === 0 && uncachedPitcherIds.length === 0 && uncachedPlatoonIds.length === 0) {
      lastHandednessWarm = Date.now();
      return;
    }

    console.log(`[LineupAdapter] Background handedness pre-warm: ${uncachedBatterIds.length} batters, ${uncachedPitcherIds.length} pitchers, ${uncachedPlatoonIds.length} platoon splits`);

    // Fetch in small parallel batches with a 50ms pause between batches to avoid rate limits
    const BATCH = 10;

    // Batter handedness
    for (let i = 0; i < uncachedBatterIds.length; i += BATCH) {
      const batch = uncachedBatterIds.slice(i, i + BATCH);
      await Promise.allSettled(batch.map(id => getBatterHandedness(id)));
      if (i + BATCH < uncachedBatterIds.length) await new Promise(r => setTimeout(r, 50));
    }

    // Pitcher handedness
    for (let i = 0; i < uncachedPitcherIds.length; i += BATCH) {
      const batch = uncachedPitcherIds.slice(i, i + BATCH);
      await Promise.allSettled(batch.map(id => getPitcherHandedness(id)));
      if (i + BATCH < uncachedPitcherIds.length) await new Promise(r => setTimeout(r, 50));
    }

    // Platoon splits
    for (let i = 0; i < uncachedPlatoonIds.length; i += BATCH) {
      const batch = uncachedPlatoonIds.slice(i, i + BATCH);
      await Promise.allSettled(batch.map(({ id, avg }) => getBatterPlatoonSplits(id, avg)));
      if (i + BATCH < uncachedPlatoonIds.length) await new Promise(r => setTimeout(r, 50));
    }

    lastHandednessWarm = Date.now();
    const elapsed = Date.now() - startMs;
    const handednessCount = Array.from(batterHandCache.values()).filter(h => h.batSide !== 'R').length;
    console.log(`[LineupAdapter] Background pre-warm complete in ${elapsed}ms. Non-R batters: ${handednessCount}/${batterHandCache.size}`);
  } catch (err) {
    console.error('[LineupAdapter] Background pre-warm error:', err);
  } finally {
    handednessWarmInProgress = false;
  }
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface PlayerData {
  playerId: number;
  name: string;
  team: string;
  position: string;
  battingPosition: number;
  handedness: 'R' | 'L' | 'S';
  gamesPlayed?: number; // Phase AO: real games played for per-game normalization
  stats: {
    hits: number;
    runs: number;
    rbi: number;
    slg: number;
    avg: number;
    obp: number;
    power: number;
  };
  recentForm?: {
    last15Games: {
      hits: number;
      runs: number;
      rbi: number;
      avg: number;
    };
    trend: 'hot' | 'cold' | 'neutral';
  };
}

export interface MatchupData {
  playerId: number;
  playerName: string;
  team: string;
  position: string;
  battingPosition: number;
  pitcher: {
    id: number | null;       // MLB pitcher ID (for mlbMatchupService)
    name: string;
    team: string;
    handedness: 'R' | 'L';
    era: number;
  };
  rc: number;
  confidence: number;
  gameTime?: string; // ISO string of game start time (UTC)
  // S3/S5: Team identifiers for bullpen fatigue and correlation engine
  teamId?: number;           // MLB team ID for this batter's team
  opponentTeamId?: number;   // MLB team ID for the opposing pitcher's team
  gamePk?: number;           // MLB game ID for correlation grouping
  isHome?: boolean;          // True if batter is playing at home
  // Phase AJ: real platoon splits for PLT factor
  platoonSplit?: {
    vsRHP: number; // Batter avg vs RHP
    vsLHP: number; // Batter avg vs LHP
  };
}

// Cache for adapted data
interface AdaptedData {
  matchups: MatchupData[];
  playerDataMap: Map<number, PlayerData>;
  games: MLBGame[];
  lineupSource: 'confirmed' | 'projected';
  timestamp: number;
}

let cachedData: AdaptedData | null = null;
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes — Phase AN: extended to reduce cold-cache frequency

/**
 * Convert PlayerWithContext to PlayerData format for ranking services.
 * Uses real batter handedness if provided, defaults to 'R'.
 */
function toPlayerData(player: PlayerWithContext, handedness: 'R' | 'L' | 'S' = 'R'): PlayerData {
  const avgNum = parseFloat(player.avg) || 0.250;
  const obpNum = parseFloat(player.obp) || 0.320;
  const slgNum = parseFloat(player.slg) || 0.400;
  const iso = slgNum - avgNum; // Isolated Power

  // Estimate recent form from per-game averages
  const hrrPerGame = player.hrrPerGame;
  let trend: 'hot' | 'cold' | 'neutral' = 'neutral';
  if (hrrPerGame > 2.8) trend = 'hot';
  else if (hrrPerGame < 1.5) trend = 'cold';

  return {
    playerId: player.playerId,
    name: player.fullName,
    team: player.teamAbbreviation,
    position: "DH",
    battingPosition: player.battingPosition,
    handedness,
    gamesPlayed: player.gamesPlayed || 40, // Phase AO: real games played for per-game normalization
    stats: {
      hits: player.hits,
      runs: player.runs,
      rbi: player.rbi,
      slg: slgNum,
      avg: avgNum,
      obp: obpNum,
      power: Math.min(100, Math.max(0, iso * 200)),
    },
    recentForm: {
      last15Games: {
        hits: Math.round(player.hitsPerGame * 15),
        runs: Math.round(player.runsPerGame * 15),
        rbi: Math.round(player.rbiPerGame * 15),
        avg: avgNum,
      },
      trend,
    },
  };
}

/**
 * Convert PlayerWithContext to MatchupData format for ranking services.
 * Uses real pitcher handedness and platoon splits if provided.
 */
function toMatchupData(
  player: PlayerWithContext,
  pitcherHand: 'R' | 'L' = 'R',
  platoonSplit?: { vsRHP: number; vsLHP: number }
): MatchupData {
  const pitcher = player.opposingPitcher;

  // Calculate a base confidence from the player's OPS
  const opsNum = parseFloat(player.ops) || 0.700;
  const baseConfidence = Math.min(95, Math.max(55, Math.round(opsNum * 100)));

  // Estimate RC score from HRR per game
  const rcEstimate = Math.min(50, Math.max(15, Math.round(player.hrrPerGame * 15)));

  return {
    playerId: player.playerId,
    playerName: player.fullName,
    team: player.teamAbbreviation,
    position: "DH",
    battingPosition: player.battingPosition,
    pitcher: {
      id: pitcher?.id ?? null,
      name: pitcher?.fullName || "TBD",
      team: player.isHome
        ? player.game.awayTeam.abbreviation
        : player.game.homeTeam.abbreviation,
      handedness: pitcherHand,
      era: 4.00, // Default; mlbMatchupService fetches real ERA during VS gate scoring
    },
    rc: rcEstimate,
    confidence: baseConfidence,
    gameTime: player.game.gameDate ?? undefined,
    teamId: player.isHome ? player.game.homeTeam.id : player.game.awayTeam.id,
    opponentTeamId: player.isHome ? player.game.awayTeam.id : player.game.homeTeam.id,
    gamePk: player.game.gamePk,
    isHome: player.isHome,
    platoonSplit,
  };
}

/**
 * Get today's real lineup data adapted for the ranking services.
 * Phase AN perf fix: handedness + platoon fetches are NON-BLOCKING.
 *   - Uses cached handedness/platoon data if available (warm path: instant)
 *   - Fires background pre-warm if cache is cold (cold path: returns defaults immediately)
 *   - Falls back to empty arrays if MLB API is unavailable.
 * IMPORTANT: Does NOT cache empty results to avoid stale empty cache blocking real data.
 */
export async function getAdaptedLineupData(): Promise<AdaptedData> {
  // Check cache - only use cache if it has actual player data
  if (cachedData && cachedData.matchups.length > 0 && Date.now() - cachedData.timestamp < CACHE_TTL) {
    return cachedData;
  }

  try {
    const [players, games] = await Promise.all([
      getTodaysPlayersWithStats(),
      getTodaysGamesSummary(),
    ]);

    // Determine overall lineup source from games
    const allConfirmed = games.length > 0 && games.every(g => g.lineupSource === 'confirmed');
    const lineupSource: 'confirmed' | 'projected' = allConfirmed ? 'confirmed' : 'projected';

    if (players.length === 0) {
      return {
        matchups: [],
        playerDataMap: new Map(),
        games,
        lineupSource,
        timestamp: Date.now(),
      };
    }

    // Phase AN: Use cached handedness/platoon data IMMEDIATELY (no blocking)
    // Fire background pre-warm if cache is cold — it will populate on next request cycle
    prewarmHandednessInBackground(players).catch(() => {}); // fire-and-forget

    const matchups: MatchupData[] = [];
    const playerDataMap = new Map<number, PlayerData>();

    for (const player of players) {
      // Use cached handedness if available, otherwise default to 'R' (non-blocking)
      const batCached = batterHandCache.get(player.playerId);
      const batHand: 'R' | 'L' | 'S' = (batCached && Date.now() - batCached.ts < HAND_CACHE_TTL)
        ? batCached.batSide
        : 'R';

      const pitcherId = player.opposingPitcher?.id;
      const pitchCached = pitcherId ? pitcherHandCache.get(pitcherId) : undefined;
      const pitchHand: 'R' | 'L' = (pitchCached && Date.now() - pitchCached.ts < HAND_CACHE_TTL)
        ? pitchCached.pitchHand
        : 'R';

      // Use cached platoon splits if available, otherwise undefined (non-blocking)
      const platoonCached = platoonCache.get(player.playerId);
      const platoon = (platoonCached && Date.now() - platoonCached.ts < PLATOON_CACHE_TTL)
        ? { vsRHP: platoonCached.vsRHP, vsLHP: platoonCached.vsLHP }
        : undefined;

      matchups.push(toMatchupData(player, pitchHand, platoon));
      playerDataMap.set(player.playerId, toPlayerData(player, batHand));
    }

    const handednessCount = matchups.filter(m => m.pitcher.handedness !== 'R').length;
    const platoonCount = matchups.filter(m => m.platoonSplit !== undefined).length;
    console.log(`[LineupAdapter] Built ${matchups.length} matchups. Cached handedness: ${handednessCount} non-R pitchers, ${platoonCount} platoon splits. Background pre-warm: ${handednessWarmInProgress ? 'running' : 'idle'}`);

    // Only cache when we have real data
    cachedData = {
      matchups,
      playerDataMap,
      games,
      lineupSource,
      timestamp: Date.now(),
    };

    return cachedData;
  } catch (error) {
    console.error("Error adapting lineup data:", error);
    return {
      matchups: [],
      playerDataMap: new Map(),
      games: [],
      lineupSource: 'projected',
      timestamp: Date.now(),
    };
  }
}

/**
 * Check if real lineup data is available (lineups posted ~1-2 hours before games)
 */
export async function hasLineupData(): Promise<boolean> {
  const data = await getAdaptedLineupData();
  return data.matchups.length > 0;
}

/**
 * Get today's games for the game cards UI
 */
export async function getGamesForUI(): Promise<MLBGame[]> {
  const data = await getAdaptedLineupData();
  return data.games;
}
