import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, saveBallparkPalCache } from "../db";
import { propPredictions } from "../../drizzle/schema";

/**
 * Scheduled data refresh endpoint
 * Called by the Manus scheduled task agent at 10 AM, 1 PM, 4 PM, 8 PM EST
 * 
 * The scheduled task agent:
 * 1. Fetches today's MLB schedule from statsapi.mlb.com
 * 2. Scrapes Baseball Savant data (xwOBA, Hard Hit%, EV, Barrel%)
 * 3. Fetches ballpark.com RC matchup data
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

  /**
   * Save BallparkPal matchup data to the database.
   * Called by the scheduled task after a successful BallparkPal fetch.
   * The live server then reads from DB instead of fetching BallparkPal directly
   * (BallparkPal blocks server IPs via Cloudflare; the scheduled task runs on a
   * user device that is not blocked).
   */
  saveBallparkPalData: protectedProcedure
    .input(z.object({
      slateDate: z.string(), // YYYY-MM-DD
      matchups: z.array(z.record(z.string(), z.unknown())), // raw BallparkMatchup objects
      source: z.string().optional().default('scheduled_task'),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user) {
        return { success: false, error: 'Unauthorized' };
      }
      try {
        await saveBallparkPalCache(input.slateDate, input.matchups, input.source);
        console.log(`[Scheduled] BallparkPal cache saved: ${input.matchups.length} matchups for ${input.slateDate}`);
        return { success: true, matchupCount: input.matchups.length, slateDate: input.slateDate };
      } catch (error) {
        console.error('[Scheduled] Failed to save BallparkPal cache:', error);
        return { success: false, error: String(error) };
      }
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
