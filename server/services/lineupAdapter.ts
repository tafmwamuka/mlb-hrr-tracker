/**
 * Lineup Adapter
 * Converts real MLB lineup data from mlbLineupService into the format
 * expected by aiRankingService and hrrService.
 *
 * Phase AJ upgrade: fetches real batter/pitcher handedness from MLB API
 * and passes platoon splits (vsRHP/vsLHP avg) into MatchupData so that
 * the PLT factor in aiRankingService uses real data instead of the
 * hardcoded 'R' vs 'R' = 45 fallback.
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

async function safeFetch(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MLB-HRR-Tracker/1.0' },
      signal: AbortSignal.timeout(3000),
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

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface PlayerData {
  playerId: number;
  name: string;
  team: string;
  position: string;
  battingPosition: number;
  handedness: 'R' | 'L' | 'S';
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
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes — lineups don't change every 5 min

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
    stats: {
      hits: player.hits,
      runs: player.runs,
      rbi: player.rbi,
      slg: slgNum,
      avg: avgNum,
      obp: obpNum,
      power: Math.max(0.05, iso),
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
 * Phase AJ: enriches with real batter/pitcher handedness and platoon splits.
 * Falls back to empty arrays if MLB API is unavailable.
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

    // Phase AJ: Fetch real handedness for all batters and pitchers in parallel
    // Use Promise.allSettled so one failure doesn't block the whole lineup
    const batterIds = players.map(p => p.playerId);
    const pitcherIds = Array.from(new Set(
      players.map(p => p.opposingPitcher?.id).filter((id): id is number => !!id)
    ));

    const [batterHandResults, pitcherHandResults] = await Promise.all([
      Promise.allSettled(batterIds.map(id => getBatterHandedness(id))),
      Promise.allSettled(pitcherIds.map(id => getPitcherHandedness(id))),
    ]);

    const batterHandMap = new Map<number, 'R' | 'L' | 'S'>();
    batterIds.forEach((id, i) => {
      const r = batterHandResults[i];
      batterHandMap.set(id, r.status === 'fulfilled' ? r.value : 'R');
    });

    const pitcherHandMap = new Map<number, 'R' | 'L'>();
    pitcherIds.forEach((id, i) => {
      const r = pitcherHandResults[i];
      pitcherHandMap.set(id, r.status === 'fulfilled' ? r.value : 'R');
    });

    // Phase AJ: Fetch platoon splits for all batters in parallel
    const platoonResults = await Promise.allSettled(
      players.map(p => {
        const avgNum = parseFloat(p.avg) || 0.250;
        return getBatterPlatoonSplits(p.playerId, avgNum);
      })
    );

    const platoonMap = new Map<number, { vsRHP: number; vsLHP: number }>();
    players.forEach((p, i) => {
      const r = platoonResults[i];
      if (r.status === 'fulfilled') platoonMap.set(p.playerId, r.value);
    });

    const handednessCount = Array.from(batterHandMap.values()).filter(h => h !== 'R').length;
    const platoonCount = platoonMap.size;
    console.log(`[LineupAdapter] Handedness enriched: ${batterHandMap.size} batters (${handednessCount} non-R), ${pitcherHandMap.size} pitchers. Platoon splits: ${platoonCount}/${players.length}`);

    const matchups: MatchupData[] = [];
    const playerDataMap = new Map<number, PlayerData>();

    for (const player of players) {
      const batHand = batterHandMap.get(player.playerId) ?? 'R';
      const pitcherId = player.opposingPitcher?.id;
      const pitchHand = pitcherId ? (pitcherHandMap.get(pitcherId) ?? 'R') : 'R';
      const platoon = platoonMap.get(player.playerId);

      matchups.push(toMatchupData(player, pitchHand, platoon));
      playerDataMap.set(player.playerId, toPlayerData(player, batHand));
    }

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
