import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";

export const settingsRouter = router({
  getSettings: protectedProcedure.query(async ({ ctx }) => {
    // Mock settings - in production, query database
    return {
      minConfidence: 75,
      enableNotifications: true,
      notificationThreshold: 80,
      preferredStats: ["hits", "runs", "rbi", "slg"],
    };
  }),

  updateSettings: protectedProcedure
    .input(
      z.object({
        minConfidence: z.number().min(0).max(100),
        enableNotifications: z.boolean(),
        notificationThreshold: z.number().min(0).max(100),
        preferredStats: z.array(z.enum(["hits", "runs", "rbi", "slg"])),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // In production, save to database
      return { success: true, settings: input };
    }),
});
