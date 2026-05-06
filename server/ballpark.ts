import { ENV } from "./_core/env";

/**
 * Ballpark.com API integration for fetching park-adjusted player stats
 * Used to calculate prop lines with ballpark factors
 */

export interface BallparkPlayerStats {
  playerId: number;
  playerName: string;
  team: string;
  position: string;
  hits: number;
  runs: number;
  rbi: number;
  hr: number;
  avg: number;
  ab: number;
  parkFactor: {
    hits: number;
    runs: number;
    rbi: number;
  };
}

export interface BallparkSession {
  token: string;
  expiresAt: number;
}

let cachedSession: BallparkSession | null = null;

/**
 * Authenticate with ballpark.com and get session token
 */
async function getBallparkSession(): Promise<string> {
  // Return cached session if still valid
  if (cachedSession && cachedSession.expiresAt > Date.now()) {
    return cachedSession.token;
  }

  const email = process.env.BALLPARK_EMAIL;
  const password = process.env.BALLPARK_PASSWORD;

  if (!email || !password) {
    throw new Error("Ballpark.com credentials not configured");
  }

  try {
    const response = await fetch("https://www.ballpark.com/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      throw new Error(`Ballpark login failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      token: string;
      expiresIn?: number;
    };
    const token = data.token;

    // Cache for 23 hours
    cachedSession = {
      token,
      expiresAt: Date.now() + (data.expiresIn || 86400) * 1000,
    };

    return token;
  } catch (error) {
    console.error("[Ballpark] Authentication failed:", error);
    throw error;
  }
}

/**
 * Fetch park-adjusted stats for a specific player
 */
export async function getPlayerParkStats(
  playerId: number
): Promise<BallparkPlayerStats | null> {
  try {
    const token = await getBallparkSession();

    const response = await fetch(
      `https://www.ballpark.com/api/players/${playerId}/stats?season=2025`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Failed to fetch player stats: ${response.status}`);
    }

    const data = (await response.json()) as BallparkPlayerStats;
    return data;
  } catch (error) {
    console.error(`[Ballpark] Failed to fetch stats for player ${playerId}:`, error);
    return null;
  }
}

/**
 * Fetch today's games with park factors
 */
export async function getTodayGamesWithParkFactors(): Promise<
  Array<{
    gameId: string;
    homeTeam: string;
    awayTeam: string;
    homeParkFactor: { hits: number; runs: number; rbi: number };
    awayParkFactor: { hits: number; runs: number; rbi: number };
  }>
> {
  try {
    const token = await getBallparkSession();

    const response = await fetch("https://www.ballpark.com/api/games/today", {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch games: ${response.status}`);
    }

    const data = (await response.json()) as Array<{
      gameId: string;
      homeTeam: string;
      awayTeam: string;
      homeParkFactor: { hits: number; runs: number; rbi: number };
      awayParkFactor: { hits: number; runs: number; rbi: number };
    }>;

    return data;
  } catch (error) {
    console.error("[Ballpark] Failed to fetch today's games:", error);
    return [];
  }
}

/**
 * Get all player stats for a team
 */
export async function getTeamPlayerStats(
  teamId: number
): Promise<BallparkPlayerStats[]> {
  try {
    const token = await getBallparkSession();

    const response = await fetch(
      `https://www.ballpark.com/api/teams/${teamId}/players/stats?season=2025`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch team stats: ${response.status}`);
    }

    const data = (await response.json()) as BallparkPlayerStats[];
    return data;
  } catch (error) {
    console.error(`[Ballpark] Failed to fetch team stats for team ${teamId}:`, error);
    return [];
  }
}
