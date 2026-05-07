/**
 * Results Router
 * Shows yesterday's AI predictions vs actual MLB outcomes
 * 
 * Flow:
 * 1. Scheduled task stores today's AI picks via `scheduled.refreshData`
 * 2. Next day, `backfillResults` fetches actual stats from MLB Stats API
 * 3. `getYesterdayResults` returns predictions with actual outcomes
 */

import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { propPredictions } from "../../drizzle/schema";
import { eq, and, gte, lt, desc, sql } from "drizzle-orm";

export interface YesterdayResult {
  id: number;
  playerId: number;
  playerName: string;
  stat: "hits" | "runs" | "rbi";
  line: number;
  prediction: "over";
  confidence: number;
  actualValue: number | null;
  hit: boolean | null;
  reasoning: string;
  gameId: string;
}

/**
 * Parse prediction JSON from the database column
 */
function parsePrediction(predJson: string | null): { line: number; confidence: number; direction: string } | null {
  if (!predJson) return null;
  try {
    const parsed = JSON.parse(predJson);
    return {
      line: parsed.line || 0,
      confidence: parsed.confidence || 0,
      direction: parsed.direction || "over",
    };
  } catch {
    return null;
  }
}

/**
 * Fetch actual player stats from MLB Stats API for a given date
 * Returns a map of playerId -> { hits, runs, rbi }
 */
async function fetchActualStatsFromMLB(dateStr: string): Promise<Map<number, { hits: number; runs: number; rbi: number }>> {
  const statsMap = new Map<number, { hits: number; runs: number; rbi: number }>();
  
  try {
    // Fetch games for the date
    const scheduleUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${dateStr}&hydrate=boxscore`;
    const response = await fetch(scheduleUrl);
    
    if (!response.ok) {
      console.error(`[Results] MLB API returned ${response.status} for ${dateStr}`);
      return statsMap;
    }
    
    const data = await response.json();
    const dates = data?.dates || [];
    
    for (const dateEntry of dates) {
      for (const game of dateEntry.games || []) {
        const boxscore = game?.boxscore;
        if (!boxscore) continue;
        
        // Process both teams
        for (const teamType of ["home", "away"] as const) {
          const team = boxscore.teams?.[teamType];
          if (!team?.players) continue;
          
          for (const [, player] of Object.entries(team.players) as [string, any][]) {
            const playerId = player?.person?.id;
            const batting = player?.stats?.batting;
            
            if (playerId && batting) {
              statsMap.set(playerId, {
                hits: batting.hits || 0,
                runs: batting.runs || 0,
                rbi: batting.rbi || 0,
              });
            }
          }
        }
      }
    }
  } catch (error) {
    console.error("[Results] Error fetching MLB stats:", error);
  }
  
  return statsMap;
}

/**
 * Alternative: Fetch player game stats using the simpler game endpoint
 */
async function fetchPlayerStatsForDate(dateStr: string): Promise<Map<number, { hits: number; runs: number; rbi: number }>> {
  const statsMap = new Map<number, { hits: number; runs: number; rbi: number }>();
  
  try {
    // First get the schedule to find game IDs
    const scheduleUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${dateStr}`;
    const schedResponse = await fetch(scheduleUrl);
    
    if (!schedResponse.ok) return statsMap;
    
    const schedData = await schedResponse.json();
    const games = schedData?.dates?.[0]?.games || [];
    
    // For each game, fetch the boxscore
    for (const game of games) {
      const gamePk = game.gamePk;
      if (!gamePk) continue;
      
      try {
        const boxUrl = `https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`;
        const boxResponse = await fetch(boxUrl);
        
        if (!boxResponse.ok) continue;
        
        const boxData = await boxResponse.json();
        
        // Process both teams
        for (const teamType of ["home", "away"] as const) {
          const team = boxData.teams?.[teamType];
          if (!team?.players) continue;
          
          for (const [, player] of Object.entries(team.players) as [string, any][]) {
            const playerId = player?.person?.id;
            const batting = player?.stats?.batting;
            
            if (playerId && batting) {
              statsMap.set(playerId, {
                hits: batting.hits || 0,
                runs: batting.runs || 0,
                rbi: batting.rbi || 0,
              });
            }
          }
        }
      } catch {
        // Skip individual game errors
      }
    }
  } catch (error) {
    console.error("[Results] Error fetching player stats:", error);
  }
  
  return statsMap;
}

export const resultsRouter = router({
  /**
   * Get yesterday's prediction results
   * Fetches stored predictions and their outcomes (actual values + hit/miss)
   */
  getYesterdayResults: publicProcedure.query(async () => {
    try {
      const db = await getDb();
      if (!db) {
        return {
          success: false,
          error: "Database not available",
          results: [],
          hitRate: 0,
          totalPlays: 0,
          date: "",
          hasActuals: false,
        };
      }

      // Get yesterday's date range
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split("T")[0];

      // Fetch predictions from database for yesterday
      const predictions = await db
        .select()
        .from(propPredictions)
        .where(
          and(
            gte(propPredictions.gameDate, yesterday),
            lt(propPredictions.gameDate, today)
          )
        )
        .orderBy(desc(propPredictions.createdAt));

      if (predictions.length === 0) {
        return {
          success: true,
          results: [],
          hitRate: 0,
          totalPlays: 0,
          date: yesterdayStr,
          hasActuals: false,
          message: "No predictions found for yesterday. Picks are stored daily by the scheduled task.",
        };
      }

      // Transform predictions into results
      const results: YesterdayResult[] = [];
      
      for (const pred of predictions) {
        // Check each stat type for this prediction
        const statTypes = [
          { key: "hits" as const, predCol: pred.hitsPrediction, actualCol: pred.hitsActual, correctCol: pred.hitsCorrect, reasoning: pred.hitsReasoning },
          { key: "runs" as const, predCol: pred.runsPrediction, actualCol: pred.runsActual, correctCol: pred.runsCorrect, reasoning: pred.runsReasoning },
          { key: "rbi" as const, predCol: pred.rbiPrediction, actualCol: pred.rbiActual, correctCol: pred.rbiCorrect, reasoning: pred.rbiReasoning },
        ];
        
        for (const st of statTypes) {
          const parsed = parsePrediction(st.predCol);
          if (!parsed) continue;
          
          results.push({
            id: pred.id,
            playerId: pred.playerId,
            playerName: pred.playerName,
            stat: st.key,
            line: parsed.line,
            prediction: "over",
            confidence: parsed.confidence,
            actualValue: st.actualCol,
            hit: st.correctCol !== null ? st.correctCol === 1 : null,
            reasoning: st.reasoning || "",
            gameId: pred.gameId,
          });
        }
      }

      // Calculate hit rate (only for results that have actuals)
      const resultsWithActuals = results.filter(r => r.actualValue !== null);
      const hitCount = resultsWithActuals.filter(r => r.hit === true).length;
      const hitRate = resultsWithActuals.length > 0
        ? Math.round((hitCount / resultsWithActuals.length) * 100)
        : 0;

      return {
        success: true,
        results,
        hitRate,
        totalPlays: results.length,
        totalWithActuals: resultsWithActuals.length,
        totalHits: hitCount,
        date: yesterdayStr,
        hasActuals: resultsWithActuals.length > 0,
      };
    } catch (error) {
      console.error("Error fetching yesterday's results:", error);
      return {
        success: false,
        error: "Failed to fetch results",
        results: [],
        hitRate: 0,
        totalPlays: 0,
        date: "",
        hasActuals: false,
      };
    }
  }),

  /**
   * Backfill actual results for yesterday's predictions
   * Called by scheduled task the morning after games are played
   * Fetches actual player stats from MLB Stats API and updates predictions
   */
  backfillResults: protectedProcedure.mutation(async ({ ctx }) => {
    if (!ctx.user) {
      return { success: false, error: "Unauthorized" };
    }

    const db = await getDb();
    if (!db) {
      return { success: false, error: "Database not available" };
    }

    try {
      // Get yesterday's date
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split("T")[0];

      // Fetch actual stats from MLB API
      const actualStats = await fetchPlayerStatsForDate(yesterdayStr);
      
      if (actualStats.size === 0) {
        return {
          success: false,
          error: "No game data available from MLB API for " + yesterdayStr,
          updated: 0,
        };
      }

      // Get yesterday's predictions that don't have actuals yet
      const predictions = await db
        .select()
        .from(propPredictions)
        .where(
          and(
            gte(propPredictions.gameDate, yesterday),
            lt(propPredictions.gameDate, today)
          )
        );

      let updated = 0;

      for (const pred of predictions) {
        const playerStats = actualStats.get(pred.playerId);
        if (!playerStats) continue;

        // Parse predictions and determine correctness
        const hitsPred = parsePrediction(pred.hitsPrediction);
        const runsPred = parsePrediction(pred.runsPrediction);
        const rbiPred = parsePrediction(pred.rbiPrediction);

        const updateData: any = {
          hitsActual: playerStats.hits,
          runsActual: playerStats.runs,
          rbiActual: playerStats.rbi,
        };

        // Determine if each prediction was correct (OVER = actual > line)
        if (hitsPred) {
          updateData.hitsCorrect = playerStats.hits > hitsPred.line ? 1 : 0;
        }
        if (runsPred) {
          updateData.runsCorrect = playerStats.runs > runsPred.line ? 1 : 0;
        }
        if (rbiPred) {
          updateData.rbiCorrect = playerStats.rbi > rbiPred.line ? 1 : 0;
        }

        await db
          .update(propPredictions)
          .set(updateData)
          .where(eq(propPredictions.id, pred.id));

        updated++;
      }

      console.log(`[Results] Backfilled ${updated} predictions with actual stats for ${yesterdayStr}`);

      return {
        success: true,
        updated,
        date: yesterdayStr,
        playersFound: actualStats.size,
      };
    } catch (error) {
      console.error("[Results] Error backfilling results:", error);
      return {
        success: false,
        error: "Failed to backfill results",
        updated: 0,
      };
    }
  }),

  /**
   * Get hit rate statistics across all tracked days
   */
  getHitRateStats: publicProcedure.query(async () => {
    try {
      const db = await getDb();
      if (!db) {
        return {
          success: false,
          stats: {
            overallHitRate: 0,
            totalPredictions: 0,
            totalHits: 0,
            byStatType: { hits: 0, runs: 0, rbi: 0 },
            last7Days: 0,
            last30Days: 0,
          },
        };
      }

      // Get all predictions that have actual results
      const allPreds = await db
        .select()
        .from(propPredictions)
        .where(sql`${propPredictions.hitsActual} IS NOT NULL OR ${propPredictions.runsActual} IS NOT NULL OR ${propPredictions.rbiActual} IS NOT NULL`);

      let totalPredictions = 0;
      let totalHits = 0;
      const byStatType = { hits: { total: 0, correct: 0 }, runs: { total: 0, correct: 0 }, rbi: { total: 0, correct: 0 } };

      for (const pred of allPreds) {
        if (pred.hitsCorrect !== null) {
          totalPredictions++;
          byStatType.hits.total++;
          if (pred.hitsCorrect === 1) { totalHits++; byStatType.hits.correct++; }
        }
        if (pred.runsCorrect !== null) {
          totalPredictions++;
          byStatType.runs.total++;
          if (pred.runsCorrect === 1) { totalHits++; byStatType.runs.correct++; }
        }
        if (pred.rbiCorrect !== null) {
          totalPredictions++;
          byStatType.rbi.total++;
          if (pred.rbiCorrect === 1) { totalHits++; byStatType.rbi.correct++; }
        }
      }

      const overallHitRate = totalPredictions > 0 ? Math.round((totalHits / totalPredictions) * 100) : 0;

      // Last 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const last7Preds = allPreds.filter((p: any) => p.gameDate >= sevenDaysAgo);
      let last7Hits = 0, last7Total = 0;
      for (const pred of last7Preds) {
        if (pred.hitsCorrect !== null) { last7Total++; if (pred.hitsCorrect === 1) last7Hits++; }
        if (pred.runsCorrect !== null) { last7Total++; if (pred.runsCorrect === 1) last7Hits++; }
        if (pred.rbiCorrect !== null) { last7Total++; if (pred.rbiCorrect === 1) last7Hits++; }
      }

      return {
        success: true,
        stats: {
          overallHitRate,
          totalPredictions,
          totalHits,
          byStatType: {
            hits: byStatType.hits.total > 0 ? Math.round((byStatType.hits.correct / byStatType.hits.total) * 100) : 0,
            runs: byStatType.runs.total > 0 ? Math.round((byStatType.runs.correct / byStatType.runs.total) * 100) : 0,
            rbi: byStatType.rbi.total > 0 ? Math.round((byStatType.rbi.correct / byStatType.rbi.total) * 100) : 0,
          },
          last7Days: last7Total > 0 ? Math.round((last7Hits / last7Total) * 100) : 0,
          last30Days: overallHitRate, // Same as overall for now
        },
      };
    } catch (error) {
      console.error("Error fetching hit rate stats:", error);
      return {
        success: false,
        stats: {
          overallHitRate: 0,
          totalPredictions: 0,
          totalHits: 0,
          byStatType: { hits: 0, runs: 0, rbi: 0 },
          last7Days: 0,
          last30Days: 0,
        },
      };
    }
  }),
});
