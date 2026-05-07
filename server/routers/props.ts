import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { playerProps, propPredictions } from "../../drizzle/schema";
import { eq, gte, and } from "drizzle-orm";

/**
 * Props router — handles fetching and managing prop lines
 */

export const propsRouter = router({
  /**
   * Get today's prop predictions
   */
  getTodayProps: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      throw new Error("Database not available");
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const predictions = await db
      .select()
      .from(propPredictions)
      .where(gte(propPredictions.gameDate, today))
      .orderBy(propPredictions.gameDate);

    return predictions.map((p) => ({
      id: p.id,
      gameId: p.gameId,
      playerId: p.playerId,
      playerName: p.playerName,
      hitsPrediction: p.hitsPrediction ? JSON.parse(p.hitsPrediction) : null,
      runsPrediction: p.runsPrediction ? JSON.parse(p.runsPrediction) : null,
      rbiPrediction: p.rbiPrediction ? JSON.parse(p.rbiPrediction) : null,
      hitsReasoning: p.hitsReasoning,
      runsReasoning: p.runsReasoning,
      rbiReasoning: p.rbiReasoning,
      gameDate: p.gameDate,
    }));
  }),

  /**
   * Get props for a specific player
   */
  getPlayerProps: publicProcedure
    .input(z.object({ playerId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const predictions = await db
        .select()
        .from(propPredictions)
        .where(
          and(
            eq(propPredictions.playerId, input.playerId),
            gte(propPredictions.gameDate, today)
          )
        );

      return predictions.map((p) => ({
        id: p.id,
        gameId: p.gameId,
        playerName: p.playerName,
        hitsPrediction: p.hitsPrediction ? JSON.parse(p.hitsPrediction) : null,
        runsPrediction: p.runsPrediction ? JSON.parse(p.runsPrediction) : null,
        rbiPrediction: p.rbiPrediction ? JSON.parse(p.rbiPrediction) : null,
        hitsConfidence: p.hitsCorrect,
        runsConfidence: p.runsCorrect,
        rbiConfidence: p.rbiCorrect,
        gameDate: p.gameDate,
      }));
    }),

  /**
   * Get high-confidence props (75%+ confidence)
   */
  getHighConfidenceProps: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      throw new Error("Database not available");
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const predictions = await db
      .select()
      .from(propPredictions)
      .where(gte(propPredictions.gameDate, today))
      .orderBy(propPredictions.gameDate);

    // Filter for high confidence predictions
    const highConfidence = predictions
      .map((p) => {
        const hits = p.hitsPrediction ? JSON.parse(p.hitsPrediction) : null;
        const runs = p.runsPrediction ? JSON.parse(p.runsPrediction) : null;
        const rbi = p.rbiPrediction ? JSON.parse(p.rbiPrediction) : null;

        const avgConfidence =
          ((hits?.confidence || 0) +
            (runs?.confidence || 0) +
            (rbi?.confidence || 0)) /
          3;

        return {
          ...p,
          hitsPrediction: hits,
          runsPrediction: runs,
          rbiPrediction: rbi,
          avgConfidence,
        };
      })
      .filter((p) => p.avgConfidence >= 75)
      .sort((a, b) => b.avgConfidence - a.avgConfidence);

    return highConfidence;
  }),

  /**
   * Get model performance metrics
   */
  getModelPerformance: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      throw new Error("Database not available");
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const predictions = await db
      .select()
      .from(propPredictions)
      .where(
        and(
          gte(propPredictions.gameDate, sevenDaysAgo),
          gte(propPredictions.gameDate, today)
        )
      );

    // Calculate hit rates
    let hitsCorrect = 0;
    let runsCorrect = 0;
    let rbiCorrect = 0;
    let slgCorrect = 0;
    let totalPredictions = 0;

    predictions.forEach((p) => {
      if (p.hitsCorrect !== null) {
        hitsCorrect += p.hitsCorrect;
        totalPredictions++;
      }
      if (p.runsCorrect !== null) {
        runsCorrect += p.runsCorrect;
      }
      if (p.rbiCorrect !== null) {
        rbiCorrect += p.rbiCorrect;
      }
      if (p.slgCorrect !== null) {
        slgCorrect += p.slgCorrect;
      }
    });

    const hitsHitRate =
      totalPredictions > 0
        ? Math.round((hitsCorrect / totalPredictions) * 100)
        : 0;
    const runsHitRate =
      totalPredictions > 0
        ? Math.round((runsCorrect / totalPredictions) * 100)
        : 0;
    const rbiHitRate =
      totalPredictions > 0
        ? Math.round((rbiCorrect / totalPredictions) * 100)
        : 0;
    const slgHitRate =
      totalPredictions > 0
        ? Math.round((slgCorrect / totalPredictions) * 100)
        : 0;
    const overallHitRate = Math.round(
      ((hitsCorrect + runsCorrect + rbiCorrect + slgCorrect) / (totalPredictions * 4)) * 100
    );

    return {
      period: "7 days",
      totalPredictions,
      hitsHitRate,
      runsHitRate,
      rbiHitRate,
      slgHitRate,
      overallHitRate,
    };
  }),
});
