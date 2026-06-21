import { publicProcedure, router } from "../_core/trpc";
import { runDailyPropsJob } from "../jobs/daily-props";
import { invalidateEnrichmentCache } from "../services/enrichmentCache";
import { clearGameTotalsCache } from "../services/gameTotalsService";
import { clearPitcherOddsCache } from "../services/oddsApiService";

/**
 * Admin router — handles admin operations like triggering jobs and cache management
 */

export const adminRouter = router({
  /**
   * Manually trigger the daily props generation job
   * (In production, this would be restricted to admin users only)
   */
  /**
   * Bust all in-memory caches so the next request re-fetches with the current API key.
   * Useful after rotating the Odds API key.
   */
  bustCache: publicProcedure.mutation(async () => {
    invalidateEnrichmentCache();
    clearGameTotalsCache();
    clearPitcherOddsCache();
    console.log('[Admin] Cache busted — enrichment + game totals + pitcher odds cleared');
    return { success: true, message: 'All caches cleared. Next request will re-fetch with the current API key.' };
  }),

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
});
