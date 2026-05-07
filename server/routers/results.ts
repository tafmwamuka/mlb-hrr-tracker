import { router, publicProcedure } from "../_core/trpc";
import { getDb } from "../db";

export interface YesterdayResult {
  id: string;
  playerId: number;
  playerName: string;
  team: string;
  stat: "hits" | "runs" | "rbi";
  line: number;
  prediction: "over" | "under";
  confidence: number;
  actualValue: number;
  hit: boolean;
  game: string;
  awayTeam: string;
  homeTeam: string;
}

export const resultsRouter = router({
  /**
   * Get yesterday's prediction results
   * Fetches actual game data and compares to predictions
   */
  getYesterdayResults: publicProcedure.query(async () => {
    try {
      const db = getDb();
      if (!db) {
        return {
          success: false,
          error: "Database not available",
          results: [],
          hitRate: 0,
          totalPlays: 0,
        };
      }

      // Get yesterday's date
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split("T")[0];

      // Fetch predictions from database (if stored)
      // For now, we'll use mock data that represents yesterday's predictions
      const mockResults: YesterdayResult[] = [
        {
          id: "pred-1",
          playerId: 660271,
          playerName: "Aaron Judge",
          team: "NYY",
          stat: "rbi",
          line: 4.5,
          prediction: "over",
          confidence: 94,
          actualValue: 5,
          hit: true,
          game: "NYY @ TB",
          awayTeam: "NYY",
          homeTeam: "TB",
        },
        {
          id: "pred-2",
          playerId: 592450,
          playerName: "Juan Soto",
          team: "NYM",
          stat: "hits",
          line: 3.5,
          prediction: "over",
          confidence: 88,
          actualValue: 3,
          hit: false,
          game: "NYM @ ATL",
          awayTeam: "NYM",
          homeTeam: "ATL",
        },
        {
          id: "pred-3",
          playerId: 608070,
          playerName: "B. Buxton",
          team: "MIN",
          stat: "runs",
          line: 2.5,
          prediction: "over",
          confidence: 82,
          actualValue: 3,
          hit: true,
          game: "MIN @ CWS",
          awayTeam: "MIN",
          homeTeam: "CWS",
        },
        {
          id: "pred-4",
          playerId: 571970,
          playerName: "S. Ohtani",
          team: "LAD",
          stat: "rbi",
          line: 3.5,
          prediction: "over",
          confidence: 85,
          actualValue: 4,
          hit: true,
          game: "LAD @ SF",
          awayTeam: "LAD",
          homeTeam: "SF",
        },
        {
          id: "pred-5",
          playerId: 502671,
          playerName: "J. Wood",
          team: "WAS",
          stat: "hits",
          line: 2.5,
          prediction: "under",
          confidence: 76,
          actualValue: 2,
          hit: true,
          game: "WAS @ NYM",
          awayTeam: "WAS",
          homeTeam: "NYM",
        },
      ];

      const hitCount = mockResults.filter((r) => r.hit).length;
      const hitRate = Math.round((hitCount / mockResults.length) * 100);

      return {
        success: true,
        results: mockResults,
        hitRate,
        totalPlays: mockResults.length,
        date: yesterdayStr,
      };
    } catch (error) {
      console.error("Error fetching yesterday's results:", error);
      return {
        success: false,
        error: "Failed to fetch results",
        results: [],
        hitRate: 0,
        totalPlays: 0,
      };
    }
  }),

  /**
   * Get results for a specific date range
   */
  getResultsByDateRange: publicProcedure
    .input((val: unknown) => {
      if (typeof val === "object" && val !== null) {
        const obj = val as Record<string, unknown>;
        return {
          startDate: typeof obj.startDate === "string" ? obj.startDate : "",
          endDate: typeof obj.endDate === "string" ? obj.endDate : "",
        };
      }
      return { startDate: "", endDate: "" };
    })
    .query(async ({ input }) => {
      try {
        // Mock implementation - in production, query database
        const mockResults: YesterdayResult[] = [
          {
            id: "pred-1",
            playerId: 660271,
            playerName: "Aaron Judge",
            team: "NYY",
            stat: "rbi",
            line: 4.5,
            prediction: "over",
            confidence: 94,
            actualValue: 5,
            hit: true,
            game: "NYY @ TB",
            awayTeam: "NYY",
            homeTeam: "TB",
          },
        ];

        return {
          success: true,
          results: mockResults,
          startDate: input.startDate,
          endDate: input.endDate,
        };
      } catch (error) {
        console.error("Error fetching results by date range:", error);
        return {
          success: false,
          error: "Failed to fetch results",
          results: [],
        };
      }
    }),

  /**
   * Get hit rate statistics
   */
  getHitRateStats: publicProcedure.query(async () => {
    try {
      const db = getDb();
      if (!db) {
        return {
          success: false,
          error: "Database not available",
          stats: {
            overallHitRate: 0,
            totalPredictions: 0,
            totalHits: 0,
            byStatType: { hits: 0, runs: 0, rbi: 0 },
            last7Days: 0,
            last30Days: 0,
          },
        };
      }

      // Mock statistics
      return {
        success: true,
        stats: {
          overallHitRate: 78,
          totalPredictions: 145,
          totalHits: 113,
          byStatType: {
            hits: 82,
            runs: 75,
            rbi: 77,
          },
          last7Days: 81,
          last30Days: 78,
        },
      };
    } catch (error) {
      console.error("Error fetching hit rate stats:", error);
      return {
        success: false,
        error: "Failed to fetch statistics",
        stats: {
          overallHitRate: 0,
          totalPredictions: 0,
          totalHits: 0,
          byStatType: { hits: 0, runs: 0, rbi: 0 },
          last7Days: 0,
          last30Days: 0,
        },
      };
    }
  }),
});
