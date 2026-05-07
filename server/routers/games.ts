import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";

/**
 * Games router — handles fetching MLB games schedule and results
 * Uses the official MLB Stats API
 */

const MLB_API_BASE = "https://statsapi.mlb.com/api/v1";

interface Game {
  id: string;
  date: string;
  status: string;
  awayTeam: {
    name: string;
    teamId: number;
    score?: number;
  };
  homeTeam: {
    name: string;
    teamId: number;
    score?: number;
  };
  venue: string;
  gameTime: string;
}

async function fetchGames(date: string): Promise<Game[]> {
  const url = `${MLB_API_BASE}/schedule?sportId=1&date=${date}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`MLB API error: ${response.status}`);
    }

    const json = await response.json();
    // MLB schedule API returns an array of games directly
    const games = Array.isArray(json) ? json : [];

    return games.map((g: any) => ({
      id: g.gamePk?.toString() || "",
      date: g.gameDate || "",
      status: g.status?.abstractGameState || "Scheduled",
      awayTeam: {
        name: g.teams?.away?.team?.name || "Unknown",
        teamId: g.teams?.away?.team?.id || 0,
        score: g.teams?.away?.score,
      },
      homeTeam: {
        name: g.teams?.home?.team?.name || "Unknown",
        teamId: g.teams?.home?.team?.id || 0,
        score: g.teams?.home?.score,
      },
      venue: g.venue?.name || "Unknown",
      gameTime: g.gameDate ? new Date(g.gameDate).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "",
    }));
  } catch (error) {
    console.error("Error fetching games:", error);
    return [];
  }
}

export const gamesRouter = router({
  /**
   * Get today's games
   */
  getTodayGames: publicProcedure.query(async () => {
    const today = new Date();
    const dateStr = today.toISOString().split("T")[0]; // YYYY-MM-DD format
    return fetchGames(dateStr);
  }),

  /**
   * Get games for a specific date
   */
  getGamesByDate: publicProcedure
    .input((val: any) => {
      if (typeof val === "string" && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
        return val;
      }
      throw new Error("Invalid date format. Use YYYY-MM-DD");
    })
    .query(async ({ input }) => {
      return fetchGames(input);
    }),

  /**
   * Get yesterday's games (for results)
   */
  getYesterdayGames: publicProcedure.query(async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split("T")[0];
    return fetchGames(dateStr);
  }),

  /**
   * Get games for the last 7 days (for results)
   */
  getRecentGames: publicProcedure.query(async () => {
    const games: Game[] = [];
    
    for (let i = 0; i < 7; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split("T")[0];
      const dayGames = await fetchGames(dateStr);
      games.push(...dayGames);
    }

    return games.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }),
});
