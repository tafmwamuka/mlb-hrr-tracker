import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { propPredictions } from "../../drizzle/schema";

/**
 * Scheduled data refresh endpoint
 * Called by the Manus scheduled task agent at 10 AM, 1 PM, 4 PM, 8 PM EST
 * 
 * The scheduled task agent:
 * 1. Fetches today's MLB schedule from statsapi.mlb.com
 * 2. Scrapes Baseball Savant data (xwOBA, Hard Hit%, EV, Barrel%)
 * 3. Fetches Diamond Edge VS gate matchup data
 * 4. Generates AI picks with combined scoring
 * 5. POSTs the results here to update the database
 */

const savantMetricsSchema = z.object({
  xwOBA: z.number().optional(),
  hardHitPct: z.number().optional(),
  exitVelocity: z.number().optional(),
  barrelPct: z.number().optional(),
  xBA: z.number().optional(),
  xSLG: z.number().optional(),
  kPct: z.number().optional(),
  bbPct: z.number().optional(),
});

const pickSchema = z.object({
  playerId: z.number(),
  playerName: z.string(),
  team: z.string(),
  pitcher: z.string(),
  pitcherTeam: z.string(),
  statType: z.enum(["hits", "runs", "rbi"]),
  propLine: z.number(),
  confidence: z.number(),
  reasoning: z.string(),
  ballparkReasoning: z.string().optional(),
  rcScore: z.number().optional(),
  combinedScore: z.number().optional(),
  savantMetrics: savantMetricsSchema.optional(),
  factorBreakdown: z.object({
    rc: z.number(),
    playerStats: z.number(),
    parkFactor: z.number(),
    hrTargets: z.number(),
    pitcherMatchup: z.number(),
    battingPosition: z.number(),
  }).optional(),
});

const refreshDataSchema = z.object({
  picks: z.array(pickSchema),
  gameDate: z.string(), // ISO date string
  source: z.string().optional(),
  refreshedAt: z.string(), // ISO timestamp
});

export const scheduledRouter = router({
  refreshData: protectedProcedure
    .input(refreshDataSchema)
    .mutation(async ({ input, ctx }) => {
      // Allow user role (scheduled task gets user role automatically)
      if (!ctx.user) {
        return { success: false, error: "Unauthorized" };
      }

      const { picks, gameDate, refreshedAt } = input;
      const today = new Date(gameDate);

      let inserted = 0;
      let updated = 0;

      const db = await getDb();
      if (!db) {
        return { success: false, error: "Database not available" };
      }

      for (const pick of picks) {
        try {
          // Build prediction fields based on stat type
          const predictionData: any = {
            gameId: `${pick.team}-vs-${pick.pitcherTeam}-${gameDate}`,
            playerId: pick.playerId,
            playerName: pick.playerName,
            predictionDate: today,
            gameDate: today,
          };

          // Set prediction and reasoning for the specific stat type
          if (pick.statType === "hits") {
            predictionData.hitsPrediction = JSON.stringify({
              line: pick.propLine,
              direction: "over",
              confidence: pick.confidence,
              combinedScore: pick.combinedScore,
              savantMetrics: pick.savantMetrics,
            });
            predictionData.hitsReasoning = pick.reasoning;
          } else if (pick.statType === "runs") {
            predictionData.runsPrediction = JSON.stringify({
              line: pick.propLine,
              direction: "over",
              confidence: pick.confidence,
              combinedScore: pick.combinedScore,
              savantMetrics: pick.savantMetrics,
            });
            predictionData.runsReasoning = pick.reasoning;
          } else if (pick.statType === "rbi") {
            predictionData.rbiPrediction = JSON.stringify({
              line: pick.propLine,
              direction: "over",
              confidence: pick.confidence,
              combinedScore: pick.combinedScore,
              savantMetrics: pick.savantMetrics,
            });
            predictionData.rbiReasoning = pick.reasoning;
          }

          await db.insert(propPredictions).values(predictionData);
          inserted++;
        } catch (err: any) {
          // If duplicate, count as updated
          if (err?.code === "ER_DUP_ENTRY") {
            updated++;
          } else {
            console.error(`[Scheduled] Error inserting pick for ${pick.playerName}:`, err);
          }
        }
      }

      console.log(`[Scheduled] Refresh complete: ${inserted} inserted, ${updated} updated, ${picks.length} total picks at ${refreshedAt}`);

      return {
        success: true,
        inserted,
        updated,
        total: picks.length,
        refreshedAt,
      };
    }),

  getLastRefresh: protectedProcedure.query(async () => {
    // Get the most recent prediction to show when data was last refreshed
    const db = await getDb();
    if (!db) {
      return { lastRefreshedAt: null, hasData: false };
    }
    const [latest] = await db.select().from(propPredictions).orderBy(propPredictions.createdAt).limit(1);

    return {
      lastRefreshedAt: latest?.createdAt?.toISOString() || null,
      hasData: !!latest,
    };
  }),
});
