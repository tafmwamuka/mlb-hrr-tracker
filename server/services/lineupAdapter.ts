/**
 * Lineup Adapter
 * Converts real MLB lineup data from mlbLineupService into the format
 * expected by aiRankingService and hrrService.
 * 
 * This bridges the gap between real API data and the existing scoring pipeline.
 */

import { getTodaysPlayersWithStats, getTodaysGamesSummary, type PlayerWithContext, type MLBGame } from "./mlbLineupService";

// Interfaces matching what aiRankingService and hrrService expect
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

interface MatchupData {
  playerId: number;
  playerName: string;
  team: string;
  position: string;
  battingPosition: number;
  pitcher: {
    name: string;
    team: string;
    handedness: 'R' | 'L';
    era: number;
  };
  rc: number;
  confidence: number;
}

// Cache for adapted data
interface AdaptedData {
  matchups: MatchupData[];
  playerDataMap: Map<number, PlayerData>;
  games: MLBGame[];
  timestamp: number;
}

let cachedData: AdaptedData | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Convert PlayerWithContext to PlayerData format for ranking services
 */
function toPlayerData(player: PlayerWithContext): PlayerData {
  const avgNum = parseFloat(player.avg) || 0.250;
  const obpNum = parseFloat(player.obp) || 0.320;
  const slgNum = parseFloat(player.slg) || 0.400;
  const iso = slgNum - avgNum; // Isolated Power

  // Estimate recent form from per-game averages
  // If per-game HRR > 2.5, player is "hot"; < 1.5 is "cold"
  const hrrPerGame = player.hrrPerGame;
  let trend: 'hot' | 'cold' | 'neutral' = 'neutral';
  if (hrrPerGame > 2.8) trend = 'hot';
  else if (hrrPerGame < 1.5) trend = 'cold';

  return {
    playerId: player.playerId,
    name: player.fullName,
    team: player.teamAbbreviation,
    position: "DH", // Position from lineup
    battingPosition: player.battingPosition,
    handedness: 'R', // Default; MLB API doesn't always provide this easily
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
        // Estimate last 15 games from per-game averages
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
 * Convert PlayerWithContext to MatchupData format for ranking services
 */
function toMatchupData(player: PlayerWithContext): MatchupData {
  const pitcher = player.opposingPitcher;
  
  // Calculate a base confidence from the player's OPS
  const opsNum = parseFloat(player.ops) || 0.700;
  const baseConfidence = Math.min(95, Math.max(55, Math.round(opsNum * 100)));
  
  // Estimate RC score from HRR per game (higher HRR/game = better matchup potential)
  const rcEstimate = Math.min(50, Math.max(15, Math.round(player.hrrPerGame * 15)));

  return {
    playerId: player.playerId,
    playerName: player.fullName,
    team: player.teamAbbreviation,
    position: "DH",
    battingPosition: player.battingPosition,
    pitcher: {
      name: pitcher?.fullName || "TBD",
      team: player.isHome 
        ? player.game.awayTeam.abbreviation 
        : player.game.homeTeam.abbreviation,
      handedness: 'R', // Default; we'd need pitcher stats to know this
      era: 4.00, // Default; we'd need pitcher stats endpoint
    },
    rc: rcEstimate,
    confidence: baseConfidence,
  };
}

/**
 * Get today's real lineup data adapted for the ranking services.
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

    if (players.length === 0) {
      // No lineup data available yet - do NOT cache empty results
      // so next request will try again immediately
      return {
        matchups: [],
        playerDataMap: new Map(),
        games,
        timestamp: Date.now(),
      };
    }

    const matchups: MatchupData[] = [];
    const playerDataMap = new Map<number, PlayerData>();

    for (const player of players) {
      matchups.push(toMatchupData(player));
      playerDataMap.set(player.playerId, toPlayerData(player));
    }

    // Only cache when we have real data
    cachedData = {
      matchups,
      playerDataMap,
      games,
      timestamp: Date.now(),
    };

    return cachedData;
  } catch (error) {
    console.error("Error adapting lineup data:", error);
    return {
      matchups: [],
      playerDataMap: new Map(),
      games: [],
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
