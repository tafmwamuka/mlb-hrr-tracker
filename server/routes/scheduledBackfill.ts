/**
 * REST endpoint for scheduled task to backfill yesterday's results
 * 
 * The scheduled task agent calls this endpoint each morning to:
 * 1. Fetch actual player stats from MLB Stats API for yesterday
 * 2. Compare against stored predictions
 * 3. Mark each prediction as hit/miss
 * 
 * Route: POST /api/scheduled/backfill-results
 * Auth: Uses app_session_id cookie (scheduled task gets user role automatically)
 */

import { Router } from "express";
import { getDb } from "../db";
import { propPredictions } from "../../drizzle/schema";
import { and, gte, lt, eq } from "drizzle-orm";
import { sdk } from "../_core/sdk";

const router = Router();

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
      
      // Only process completed games
      const status = game.status?.abstractGameState;
      if (status !== "Final") continue;
      
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
    console.error("[Backfill] Error fetching player stats:", error);
  }
  
  return statsMap;
}

router.post("/backfill-results", async (req, res) => {
  try {
    // Authenticate the request
    const user = await sdk.authenticateRequest(req);
    if (!user) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const db = await getDb();
    if (!db) {
      return res.status(500).json({ success: false, error: "Database not available" });
    }

    // Get yesterday's date (or date from request body)
    const targetDate = req.body?.date;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let startDate: Date;
    let endDate: Date;
    
    if (targetDate) {
      startDate = new Date(targetDate + "T00:00:00Z");
      endDate = new Date(targetDate + "T23:59:59Z");
    } else {
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 1);
      endDate = new Date(today);
    }
    
    const dateStr = startDate.toISOString().split("T")[0];
    console.log(`[Backfill] Starting backfill for ${dateStr}`);

    // Fetch actual stats from MLB API
    const actualStats = await fetchPlayerStatsForDate(dateStr);
    
    if (actualStats.size === 0) {
      return res.json({
        success: true,
        message: `No completed game data available from MLB API for ${dateStr}`,
        updated: 0,
        date: dateStr,
      });
    }

    // Get predictions for that date that don't have actuals yet
    const predictions = await db
      .select()
      .from(propPredictions)
      .where(
        and(
          gte(propPredictions.gameDate, startDate),
          lt(propPredictions.gameDate, endDate)
        )
      );

    if (predictions.length === 0) {
      return res.json({
        success: true,
        message: `No predictions found for ${dateStr}`,
        updated: 0,
        date: dateStr,
        playersInGames: actualStats.size,
      });
    }

    let updated = 0;
    let alreadyFilled = 0;

    for (const pred of predictions) {
      // Skip if already has actuals
      if (pred.hitsActual !== null || pred.runsActual !== null || pred.rbiActual !== null) {
        alreadyFilled++;
        continue;
      }

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

    console.log(`[Backfill] Complete for ${dateStr}: ${updated} updated, ${alreadyFilled} already filled, ${predictions.length} total predictions`);

    return res.json({
      success: true,
      date: dateStr,
      updated,
      alreadyFilled,
      totalPredictions: predictions.length,
      playersInGames: actualStats.size,
    });
  } catch (error: any) {
    console.error("[Backfill] Error:", error);
    return res.status(500).json({
      success: false,
      error: error?.message || "Internal server error",
    });
  }
});

export default router;
