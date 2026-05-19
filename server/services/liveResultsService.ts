/**
 * Live Results Service
 * Fetches real-time game statuses and player boxscore stats from MLB API.
 * Used by the Results page to show pick outcomes as games finish.
 *
 * Phase BN: added player-name secondary index so grading works even when
 * the stored playerId doesn't match the MLB boxscore person.id.
 */

const MLB_API_BASE = "https://statsapi.mlb.com/api/v1";

// Cache for game statuses (short TTL since games are live)
let gameStatusCache: { data: GameStatus[]; timestamp: number } | null = null;
const GAME_STATUS_TTL = 60 * 1000; // 1 minute

// Cache for boxscores (longer TTL since final games don't change)
const boxscoreCache = new Map<number, { data: Map<number, PlayerBoxStats>; timestamp: number }>();
// Phase BN: secondary name-based index for fallback grading
const boxscoreNameCache = new Map<number, { data: Map<string, PlayerBoxStats>; timestamp: number }>();
const BOXSCORE_TTL = 5 * 60 * 1000; // 5 minutes for final games
const LIVE_BOXSCORE_TTL = 90 * 1000; // 90 seconds for live games

export interface GameStatus {
  gamePk: number;
  status: "Scheduled" | "Pre-Game" | "In Progress" | "Final" | "Postponed" | "Suspended";
  abstractGameState: string;
  detailedState: string;
  inning?: number;
  inningHalf?: string;
  awayTeamId: number;
  homeTeamId: number;
  awayScore?: number;
  homeScore?: number;
  startTime: string;
}

export interface PlayerBoxStats {
  playerId: number;
  hits: number;
  runs: number;
  rbi: number;
  atBats: number;
  homeRuns: number;
  gameStatus: string; // "Final", "In Progress", etc.
  gamePk: number;
}

/**
 * Fetch today's game statuses from MLB API
 */
export async function fetchGameStatuses(dateStr: string): Promise<GameStatus[]> {
  // Check cache
  if (gameStatusCache && Date.now() - gameStatusCache.timestamp < GAME_STATUS_TTL) {
    return gameStatusCache.data;
  }

  try {
    const url = `${MLB_API_BASE}/schedule?sportId=1&date=${dateStr}&hydrate=linescore`;
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`[LiveResults] MLB schedule API returned ${response.status}`);
      return gameStatusCache?.data || [];
    }

    const data = await response.json();
    const games = data?.dates?.[0]?.games || [];

    const statuses: GameStatus[] = games.map((game: any) => ({
      gamePk: game.gamePk,
      status: mapGameStatus(game.status?.abstractGameState || "Scheduled"),
      abstractGameState: game.status?.abstractGameState || "Scheduled",
      detailedState: game.status?.detailedState || "Scheduled",
      inning: game.linescore?.currentInning,
      inningHalf: game.linescore?.inningHalf,
      awayTeamId: game.teams?.away?.team?.id,
      homeTeamId: game.teams?.home?.team?.id,
      awayScore: game.teams?.away?.score,
      homeScore: game.teams?.home?.score,
      startTime: game.gameDate || "",
    }));

    gameStatusCache = { data: statuses, timestamp: Date.now() };
    return statuses;
  } catch (error) {
    console.error("[LiveResults] Error fetching game statuses:", error);
    return gameStatusCache?.data || [];
  }
}

function mapGameStatus(abstractState: string): GameStatus["status"] {
  switch (abstractState) {
    case "Final": return "Final";
    case "Live": return "In Progress";
    case "Preview": return "Scheduled";
    default: return "Scheduled";
  }
}

/**
 * Fetch boxscore stats for a specific game.
 * Returns a map of playerId -> PlayerBoxStats.
 * Also populates the name-based secondary index (boxscoreNameCache).
 */
export async function fetchGameBoxscore(gamePk: number, gameStatus: string): Promise<Map<number, PlayerBoxStats>> {
  // Check cache
  const cached = boxscoreCache.get(gamePk);
  const ttl = gameStatus === "Final" ? BOXSCORE_TTL : LIVE_BOXSCORE_TTL;
  if (cached && Date.now() - cached.timestamp < ttl) {
    return cached.data;
  }

  const statsMap = new Map<number, PlayerBoxStats>();
  const nameMap = new Map<string, PlayerBoxStats>(); // Phase BN: name-keyed fallback

  try {
    const url = `${MLB_API_BASE}/game/${gamePk}/boxscore`;
    const response = await fetch(url);
    if (!response.ok) return statsMap;

    const boxData = await response.json();

    for (const teamType of ["home", "away"] as const) {
      const team = boxData.teams?.[teamType];
      if (!team?.players) continue;

      for (const [, player] of Object.entries(team.players) as [string, any][]) {
        const playerId = player?.person?.id;
        const fullName: string = (player?.person?.fullName || "").toLowerCase().trim();
        const batting = player?.stats?.batting;

        if (playerId && batting) {
          const stats: PlayerBoxStats = {
            playerId,
            hits: batting.hits || 0,
            runs: batting.runs || 0,
            rbi: batting.rbi || 0,
            atBats: batting.atBats || 0,
            homeRuns: batting.homeRuns || 0,
            gameStatus,
            gamePk,
          };
          statsMap.set(playerId, stats);
          if (fullName) nameMap.set(fullName, stats);
        }
      }
    }

    // Cache both indexes
    boxscoreCache.set(gamePk, { data: statsMap, timestamp: Date.now() });
    boxscoreNameCache.set(gamePk, { data: nameMap, timestamp: Date.now() });
  } catch (error) {
    console.error(`[LiveResults] Error fetching boxscore for game ${gamePk}:`, error);
  }

  return statsMap;
}

/**
 * Get live stats for specific players across all today's games.
 * Only fetches boxscores for games that are In Progress or Final.
 * Phase BN: also returns a name-based map for fallback grading.
 */
export async function getLivePlayerStats(
  playerIds: number[],
  dateStr: string,
  playerNames?: string[] // Phase BN: optional name list for fallback lookup
): Promise<Map<number, PlayerBoxStats>> {
  const result = new Map<number, PlayerBoxStats>();

  // Get game statuses
  const statuses = await fetchGameStatuses(dateStr);

  // Only fetch boxscores for games that have started
  const activeGames = statuses.filter(
    (g) => g.status === "In Progress" || g.status === "Final"
  );

  if (activeGames.length === 0) {
    return result;
  }

  // Fetch boxscores in parallel (max 5 concurrent)
  const batchSize = 5;
  for (let i = 0; i < activeGames.length; i += batchSize) {
    const batch = activeGames.slice(i, i + batchSize);
    const boxscores = await Promise.all(
      batch.map((g) => fetchGameBoxscore(g.gamePk, g.status))
    );

    for (let j = 0; j < batch.length; j++) {
      const boxscore = boxscores[j];
      const gamePk = batch[j].gamePk;

      for (const playerId of playerIds) {
        const stats = boxscore.get(playerId);
        if (stats) {
          result.set(playerId, stats);
        }
      }

      // Phase BN: fallback by player name for IDs that didn't resolve
      if (playerNames && playerNames.length > 0) {
        const nameBoxscore = boxscoreNameCache.get(gamePk)?.data;
        if (nameBoxscore) {
          for (let k = 0; k < playerIds.length; k++) {
            if (!result.has(playerIds[k]) && playerNames[k]) {
              const nameLower = playerNames[k].toLowerCase().trim();
              // Try exact match first
              let nameStats = nameBoxscore.get(nameLower);
              // Try partial match (last name) if exact fails
              if (!nameStats) {
                const lastName = nameLower.split(" ").pop() || "";
                if (lastName.length > 2) {
                  Array.from(nameBoxscore.entries()).some(([key, val]) => {
                    if (key.includes(lastName)) {
                      nameStats = val;
                      return true;
                    }
                    return false;
                  });
                }
              }
              if (nameStats) {
                result.set(playerIds[k], nameStats);
              }
            }
          }
        }
      }
    }
  }

  return result;
}

/**
 * Clear caches (useful for testing)
 */
export function clearLiveResultsCache() {
  gameStatusCache = null;
  boxscoreCache.clear();
  boxscoreNameCache.clear();
}
