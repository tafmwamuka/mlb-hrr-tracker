import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";

export const notificationsRouter = router({
  getNotifications: protectedProcedure.query(async ({ ctx }) => {
    // Mock notifications - in production, query database
    return [
      {
        id: 1,
        title: "High Confidence Prop Alert",
        message: "Aaron Judge RBI OVER 4.5 - 94% confidence",
        confidence: 94,
        createdAt: new Date(),
        read: false,
      },
      {
        id: 2,
        title: "New Top Play",
        message: "Juan Soto Slg % OVER 0.450 - 88% confidence",
        confidence: 88,
        createdAt: new Date(Date.now() - 3600000),
        read: false,
      },
    ];
  }),

  markAsRead: protectedProcedure
    .input(z.object({ notificationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      // In production, update database
      return { success: true };
    }),

  clearAll: protectedProcedure.mutation(async ({ ctx }) => {
    // In production, delete all notifications for user
    return { success: true };
  }),

  subscribeToAlerts: protectedProcedure
    .input(
      z.object({
        minConfidence: z.number().min(0).max(100),
        enablePushNotifications: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // In production, save subscription preferences
      return { success: true, subscribed: true };
    }),
});
