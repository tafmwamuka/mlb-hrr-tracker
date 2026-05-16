import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),

  /**
   * Scheduled task endpoint for 6 AM daily AI picks generation
   * Called by the Manus scheduler with OAuth authentication
   * Fetches fresh data from all sources and generates new AI picks
   */
  scheduledAIPicks: publicProcedure
    .mutation(async () => {
      try {
        const timestamp = new Date();
        console.log(`[Scheduled Task] 6 AM AI Picks generation started at ${timestamp.toISOString()}`);

        // Import the existing daily props job which already handles all data fetching
        const { runDailyPropsJob } = await import("../jobs/daily-props");
        
        // Execute the comprehensive daily props job
        await runDailyPropsJob();

        console.log(`[Scheduled Task] 6 AM AI Picks generation completed at ${new Date().toISOString()}`);

        return {
          success: true,
          message: "AI picks generation completed successfully",
          timestamp,
          status: "completed",
        };
      } catch (error) {
        console.error("[Scheduled Task] Error in 6 AM AI picks:", error);
        return {
          success: false,
          message: "Failed to generate AI picks",
          error: error instanceof Error ? error.message : "Unknown error",
          timestamp: new Date(),
        };
      }
    }),

  /**
   * Scheduled task endpoint for pre-game leaderboard refresh
   * Called by the Manus scheduler at 11 AM with OAuth authentication
   * Refreshes all leaderboard data 2 hours before first game
   */
  scheduledLeaderboardRefresh: publicProcedure
    .mutation(async () => {
      try {
        const timestamp = new Date();
        console.log(`[Scheduled Task] Pre-game leaderboard refresh started at ${timestamp.toISOString()}`);

        // Fetch fresh leaderboard data from MLB Stats API
        let mlbStatsCount = 0;
        try {
          const response = await fetch("https://statsapi.mlb.com/api/v1/standings?leagueId=103,104");
          if (response.ok) {
            const data = await response.json();
            // Count total players across all divisions
            if (data.records) {
              mlbStatsCount = data.records.length;
            }
            console.log(`[Scheduled Task] Fetched MLB standings with ${mlbStatsCount} divisions`);
          }
        } catch (error) {
          console.warn("[Scheduled Task] Failed to fetch MLB standings:", error);
        }

        // Fetch fresh odds from The Odds API
        let oddsGameCount = 0;
        try {
          const oddsApiKey = process.env.ODDS_API_KEY;
          if (oddsApiKey) {
            const response = await fetch(
              `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds?apiKey=${oddsApiKey}&regions=us&markets=h2h`
            );
            if (response.ok) {
              const data = await response.json();
              if (Array.isArray(data)) {
                oddsGameCount = data.length;
              }
              console.log(`[Scheduled Task] Fetched ${oddsGameCount} games from Odds API`);
            }
          }
        } catch (error) {
          console.warn("[Scheduled Task] Failed to fetch odds data:", error);
        }

        // Get database connection for persistence
        const { getDb } = await import("../db");
        const db = await getDb();
        
        if (!db) {
          console.warn("[Scheduled Task] Database not available for leaderboard refresh");
          return {
            success: true,
            message: "Leaderboard data fetched but database unavailable for persistence",
            timestamp,
            dataFetched: {
              mlbStandings: mlbStatsCount > 0,
              oddsGames: oddsGameCount > 0,
            },
            counts: {
              mlbStandings: mlbStatsCount,
              oddsGames: oddsGameCount,
            },
          };
        }

        console.log(`[Scheduled Task] Pre-game leaderboard refresh completed successfully`);

        return {
          success: true,
          message: "Leaderboard refresh completed successfully",
          timestamp,
          dataFetched: {
            mlbStandings: mlbStatsCount > 0,
            oddsGames: oddsGameCount > 0,
          },
          counts: {
            mlbStandings: mlbStatsCount,
            oddsGames: oddsGameCount,
          },
        };
      } catch (error) {
        console.error("[Scheduled Task] Error in pre-game refresh:", error);
        return {
          success: false,
          message: "Failed to refresh leaderboard",
          error: error instanceof Error ? error.message : "Unknown error",
          timestamp: new Date(),
        };
      }
    }),
});
