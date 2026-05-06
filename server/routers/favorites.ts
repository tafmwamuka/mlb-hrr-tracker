import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { userFavorites } from "../../drizzle/schema";
import { eq, and, desc, gte, lt } from "drizzle-orm";

/**
 * Favorites router — handles user's favorite prop predictions
 */

export const favoritesRouter = router({
  /**
   * Add a prop prediction to favorites
   */
  addFavorite: protectedProcedure
    .input(
      z.object({
        gameId: z.string(),
        playerId: z.number(),
        playerName: z.string(),
        playerTeam: z.string(),
        statType: z.enum(["hits", "runs", "rbi"]),
        prediction: z.enum(["over", "under"]),
        line: z.number(),
        confidence: z.number(),
        reasoning: z.string(),
        gameDate: z.date(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      try {
        await db.insert(userFavorites).values({
          userId: ctx.user.id,
          gameId: input.gameId,
          playerId: input.playerId,
          playerName: input.playerName,
          playerTeam: input.playerTeam,
          statType: input.statType,
          prediction: input.prediction,
          line: input.line,
          confidence: input.confidence,
          reasoning: input.reasoning,
          gameDate: input.gameDate,
          result: "pending",
        });

        return { success: true };
      } catch (error) {
        console.error("[Favorites] Error adding favorite:", error);
        throw new Error("Failed to add favorite");
      }
    }),

  /**
   * Remove a favorite
   */
  removeFavorite: protectedProcedure
    .input(z.object({ favoriteId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      try {
        await db
          .delete(userFavorites)
          .where(
            and(
              eq(userFavorites.id, input.favoriteId),
              eq(userFavorites.userId, ctx.user.id)
            )
          );

        return { success: true };
      } catch (error) {
        console.error("[Favorites] Error removing favorite:", error);
        throw new Error("Failed to remove favorite");
      }
    }),

  /**
   * Get all favorites for the current user
   */
  getAllFavorites: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    try {
      const favorites = await db
        .select()
        .from(userFavorites)
        .where(eq(userFavorites.userId, ctx.user.id))
        .orderBy(desc(userFavorites.confidence), desc(userFavorites.createdAt));

      return favorites;
    } catch (error) {
      console.error("[Favorites] Error fetching favorites:", error);
      return [];
    }
  }),

  /**
   * Get top 3 favorites for today (highest confidence)
   */
  getTopThreePlays: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      const favorites = await db
        .select()
        .from(userFavorites)
        .where(
          and(
            eq(userFavorites.userId, ctx.user.id),
            eq(userFavorites.result, "pending"),
            gte(userFavorites.gameDate, today),
            lt(userFavorites.gameDate, tomorrow)
          )
        )
        .orderBy(desc(userFavorites.confidence))
        .limit(3);

      return favorites;
    } catch (error) {
      console.error("[Favorites] Error fetching top 3 plays:", error);
      return [];
    }
  }),

  /**
   * Get favorites history with results
   */
  getFavoritesHistory: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    try {
      const favorites = await db
        .select()
        .from(userFavorites)
        .where(eq(userFavorites.userId, ctx.user.id))
        .orderBy(desc(userFavorites.gameDate), desc(userFavorites.createdAt));

      return favorites;
    } catch (error) {
      console.error("[Favorites] Error fetching history:", error);
      return [];
    }
  }),

  /**
   * Mark a favorite as hit or miss
   */
  updateFavoriteResult: protectedProcedure
    .input(
      z.object({
        favoriteId: z.number(),
        result: z.enum(["hit", "miss"]),
        actualValue: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      try {
        await db
          .update(userFavorites)
          .set({
            result: input.result,
            actualValue: input.actualValue,
            resultDate: new Date(),
          })
          .where(
            and(
              eq(userFavorites.id, input.favoriteId),
              eq(userFavorites.userId, ctx.user.id)
            )
          );

        return { success: true };
      } catch (error) {
        console.error("[Favorites] Error updating result:", error);
        throw new Error("Failed to update result");
      }
    }),

  /**
   * Get user's personal hit rate
   */
  getUserHitRate: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    try {
      const favorites = await db
        .select()
        .from(userFavorites)
        .where(
          and(
            eq(userFavorites.userId, ctx.user.id)
            // Only count completed predictions (result != 'pending')
          )
        );

      // Filter out pending predictions
      const completed = favorites.filter((f) => f.result !== "pending");
      const total = completed.length;
      const hits = completed.filter((f) => f.result === "hit").length;
      const hitRate = total > 0 ? Math.round((hits / total) * 100) : 0;

      return {
        total,
        hits,
        misses: total - hits,
        hitRate,
      };
    } catch (error) {
      console.error("[Favorites] Error calculating hit rate:", error);
      return { total: 0, hits: 0, misses: 0, hitRate: 0 };
    }
  }),

  /**
   * Check if a specific prediction is already favorited
   */
  isFavorited: protectedProcedure
    .input(
      z.object({
        gameId: z.string(),
        playerId: z.number(),
        statType: z.enum(["hits", "runs", "rbi"]),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      try {
        const favorite = await db
          .select()
          .from(userFavorites)
          .where(
            and(
              eq(userFavorites.userId, ctx.user.id),
              eq(userFavorites.gameId, input.gameId),
              eq(userFavorites.playerId, input.playerId),
              eq(userFavorites.statType, input.statType)
            )
          )
          .limit(1);

        return favorite.length > 0 ? favorite[0] : null;
      } catch (error) {
        console.error("[Favorites] Error checking favorite:", error);
        return null;
      }
    }),
});
