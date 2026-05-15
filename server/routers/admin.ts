import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { runDailyPropsJob } from "../jobs/daily-props";
import { getBallparkPalCacheStatus, saveBallparkPalCache } from "../db";

/**
 * Admin router — handles admin operations like triggering jobs and cache management
 */

export const adminRouter = router({
  /**
   * Manually trigger the daily props generation job
   * (In production, this would be restricted to admin users only)
   */
  triggerDailyPropsJob: publicProcedure.mutation(async () => {
    try {
      await runDailyPropsJob();
      return {
        success: true,
        message: "Daily props job completed successfully",
      };
    } catch (error) {
      console.error("[Admin] Error triggering daily props job:", error);
      return {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }),

  /**
   * Get BallparkPal cache status — shows when data was last saved and how many matchups are cached.
   * Used to diagnose why picks may not be showing (cache miss = no BallparkPal data).
   */
  getBallparkPalCacheStatus: publicProcedure
    .input(z.object({ slateDate: z.string().optional() }))
    .query(async ({ input }) => {
      const today = new Date();
      const etOffset = (today.getMonth() >= 2 && today.getMonth() <= 10) ? -4 : -5;
      const etDate = new Date(today.getTime() + etOffset * 60 * 60 * 1000);
      const slateDate = input.slateDate || etDate.toISOString().slice(0, 10);
      const status = await getBallparkPalCacheStatus(slateDate);
      return status || { exists: false, slateDate, fetchedAt: null, matchupCount: 0, ageMinutes: null, source: null };
    }),

  /**
   * Manually seed BallparkPal cache with matchup data.
   * Used when the scheduled task needs to push data directly to the server.
   */
  seedBallparkPalCache: publicProcedure
    .input(z.object({
      slateDate: z.string(),
      matchups: z.array(z.record(z.string(), z.unknown())),
      source: z.string().optional().default('manual'),
    }))
    .mutation(async ({ input }) => {
      try {
        await saveBallparkPalCache(input.slateDate, input.matchups, input.source);
        return { success: true, matchupCount: input.matchups.length };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }),
});
