import { publicProcedure, router } from "../_core/trpc";
import { runDailyPropsJob } from "../jobs/daily-props";

/**
 * Admin router — handles admin operations like triggering jobs
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
});
