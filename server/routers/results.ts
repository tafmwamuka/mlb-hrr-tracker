/**
 * Results Router
 * Shows today's AI picks with live results from MLB boxscores.
 * 
 * Flow:
 * 1. Fetches today's AI picks (from the same pipeline as Money Picks / All Plays)
 * 2. Checks game statuses via MLB API
 * 3. For completed/in-progress games, fetches boxscore stats
 * 4. Returns picks with actual outcomes (hit/miss/pending)
 * 
 * Frontend polls every 2 minutes during game hours for real-time updates.
 */

import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { propPredictions } from "../../drizzle/schema";
import { eq, and, gte, lt, desc, sql } from "drizzle-orm";
import { getAdaptedLineupData } from "../services/lineupAdapter";
import { rankAIPicks, getMockHRTargets, getMockParkFactors } from "../services/aiRankingService";
import { getMockSavantData, calculateCombinedScore } from "../services/savantService";
import { generateHRRProjections } from "../services/hrrService";
import { fetchGameStatuses, getLivePlayerStats, type GameStatus, type PlayerBoxStats } from "../services/liveResultsService";

export interface LiveResult {
  playerId: number;
  playerName: string;
  team: string;
  stat: "hits" | "runs" | "rbi";
  line: number;
  prediction: "over";
  confidence: number;
  overProbability: number;
  actualValue: number | null;
  hit: boolean | null;
  gameStatus: "Scheduled" | "In Progress" | "Final" | "Postponed";
  gamePk: number;
  inning?: number;
  inningHalf?: string;
}

import { getDataDate } from "../services/mlbLineupService";

/**
 * Get the date string for today's games (matches what lineupAdapter uses)
 * Uses the actual data date from mlbLineupService (handles fallback to real data)
 */
async function getTodayDateStr(): Promise<string> {
  return await getDataDate();
}

export const resultsRouter = router({
  /**
   * Get today's live results
   * Combines today's AI picks with real-time game data from MLB API
   */
  getTodayResults: publicProcedure.query(async () => {
    try {
      const dateStr = await getTodayDateStr();

      // Step 1: Get today's AI picks (same source as Money Picks / All Plays)
      const lineupData = await getAdaptedLineupData();
      if (lineupData.matchups.length === 0) {
        return {
          success: true,
          results: [],
          lineupsPending: true,
          date: dateStr,
          hitRate: 0,
          totalPlays: 0,
          hasActuals: false,
          gamesInProgress: 0,
          gamesCompleted: 0,
          gamesScheduled: 0,
        };
      }

      const matchups = lineupData.matchups;
      const players = lineupData.playerDataMap;
      const games = lineupData.games;

      // Generate picks using the HRR projection pipeline
      const parkFactors = getMockParkFactors();
      const savantGames = getMockSavantData();
      const savantMap = new Map<string, { xwOBA: number; hardHitPct: number; exitVelocity: number; barrelPct: number }>();
      for (const game of savantGames) {
        for (const hitter of [...game.homeHitters, ...game.awayHitters]) {
          savantMap.set(hitter.name, {
            xwOBA: hitter.xwOBA,
            hardHitPct: hitter.hardHitPct,
            exitVelocity: hitter.exitVelocity,
            barrelPct: hitter.barrelPct,
          });
        }
      }

      const projections = generateHRRProjections(matchups, players, parkFactors, savantMap);

      // Build a map of playerId -> gamePk from the lineup data
      const playerGameMap = new Map<number, number>();
      for (const game of games) {
        for (const p of [...game.homeLineup, ...game.awayLineup]) {
          playerGameMap.set(p.id, game.gamePk);
        }
      }

      // Step 2: Get game statuses
      const gameStatuses = await fetchGameStatuses(dateStr);
      const gameStatusMap = new Map<number, GameStatus>();
      for (const gs of gameStatuses) {
        gameStatusMap.set(gs.gamePk, gs);
      }

      // Step 3: Get live stats for players in active/completed games
      const playerIds = projections.map((p) => p.playerId);
      const liveStats = await getLivePlayerStats(playerIds, dateStr);

      // Step 4: Build results
      const results: LiveResult[] = [];

      for (const proj of projections) {
        const gamePk = playerGameMap.get(proj.playerId) || 0;
        const gameStatus = gameStatusMap.get(gamePk);
        const playerStats = liveStats.get(proj.playerId);

        const status: LiveResult["gameStatus"] = gameStatus
          ? (gameStatus.status === "In Progress" ? "In Progress" :
             gameStatus.status === "Final" ? "Final" :
             gameStatus.status === "Postponed" ? "Postponed" : "Scheduled")
          : "Scheduled";

        // For each stat type in the HRR projection, create a result entry
        // Use expectedHits/Runs/RBI as the "line" (rounded down to 0.5)
        // and use the overall hrrConfidence as confidence
        const statEntries: { stat: "hits" | "runs" | "rbi"; line: number; prob: number }[] = [
          { stat: "hits", line: Math.floor(proj.expectedHits * 2) / 2, prob: proj.hrrConfidence },
          { stat: "runs", line: Math.floor(proj.expectedRuns * 2) / 2, prob: proj.expectedRuns > 0.5 ? proj.hrrConfidence - 5 : 0 },
          { stat: "rbi", line: Math.floor(proj.expectedRBI * 2) / 2, prob: proj.expectedRBI > 0.5 ? proj.hrrConfidence - 8 : 0 },
        ];

        for (const entry of statEntries) {
          // Only include entries with meaningful probability (> 45%) and line > 0
          if (entry.prob < 45 || entry.line <= 0) continue;

          let actualValue: number | null = null;
          let hit: boolean | null = null;

          if (playerStats && (status === "Final" || status === "In Progress")) {
            const statValue = entry.stat === "hits" ? playerStats.hits :
                             entry.stat === "runs" ? playerStats.runs :
                             playerStats.rbi;
            actualValue = statValue;
            hit = statValue > entry.line;
          }

          results.push({
            playerId: proj.playerId,
            playerName: proj.playerName,
            team: proj.team,
            stat: entry.stat,
            line: entry.line,
            prediction: "over",
            confidence: proj.hrrConfidence,
            overProbability: entry.prob,
            actualValue,
            hit,
            gameStatus: status,
            gamePk,
            inning: gameStatus?.inning,
            inningHalf: gameStatus?.inningHalf,
          });
        }
      }

      // Sort: Final games first, then In Progress, then Scheduled
      // Within each group, sort by confidence descending
      const statusOrder = { "Final": 0, "In Progress": 1, "Scheduled": 2, "Postponed": 3 };
      results.sort((a, b) => {
        const statusDiff = statusOrder[a.gameStatus] - statusOrder[b.gameStatus];
        if (statusDiff !== 0) return statusDiff;
        return b.confidence - a.confidence;
      });

      // Calculate hit rate (only for final games)
      const finalResults = results.filter((r) => r.gameStatus === "Final" && r.actualValue !== null);
      const hitCount = finalResults.filter((r) => r.hit === true).length;
      const hitRate = finalResults.length > 0 ? Math.round((hitCount / finalResults.length) * 100) : 0;

      // Game counts
      const gamesInProgress = gameStatuses.filter((g) => g.status === "In Progress").length;
      const gamesCompleted = gameStatuses.filter((g) => g.status === "Final").length;
      const gamesScheduled = gameStatuses.filter((g) => g.status === "Scheduled" || g.status === "Pre-Game").length;

      return {
        success: true,
        results,
        date: dateStr,
        hitRate,
        totalPlays: results.length,
        hasActuals: finalResults.length > 0,
        gamesInProgress,
        gamesCompleted,
        gamesScheduled,
        totalGames: gameStatuses.length,
      };
    } catch (error) {
      console.error("Error fetching today's results:", error);
      return {
        success: false,
        error: "Failed to fetch results",
        results: [],
        date: await getTodayDateStr(),
        hitRate: 0,
        totalPlays: 0,
        hasActuals: false,
        gamesInProgress: 0,
        gamesCompleted: 0,
        gamesScheduled: 0,
      };
    }
  }),

  /**
   * Get yesterday's prediction results (legacy — reads from database)
   * Kept for historical tracking
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

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split("T")[0];

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
        };
      }

      const results: any[] = [];
      for (const pred of predictions) {
        const statTypes = [
          { key: "hits" as const, predCol: pred.hitsPrediction, actualCol: pred.hitsActual, correctCol: pred.hitsCorrect, reasoning: pred.hitsReasoning },
          { key: "runs" as const, predCol: pred.runsPrediction, actualCol: pred.runsActual, correctCol: pred.runsCorrect, reasoning: pred.runsReasoning },
          { key: "rbi" as const, predCol: pred.rbiPrediction, actualCol: pred.rbiActual, correctCol: pred.rbiCorrect, reasoning: pred.rbiReasoning },
        ];

        for (const st of statTypes) {
          if (!st.predCol) continue;
          try {
            const parsed = JSON.parse(st.predCol);
            results.push({
              id: pred.id,
              playerId: pred.playerId,
              playerName: pred.playerName,
              stat: st.key,
              line: parsed.line || 0,
              prediction: "over",
              confidence: parsed.confidence || 0,
              actualValue: st.actualCol,
              hit: st.correctCol !== null ? st.correctCol === 1 : null,
              reasoning: st.reasoning || "",
              gameId: pred.gameId,
            });
          } catch {}
        }
      }

      const resultsWithActuals = results.filter((r) => r.actualValue !== null);
      const hitCount = resultsWithActuals.filter((r) => r.hit === true).length;
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
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split("T")[0];

      // Fetch actual stats from MLB API
      const scheduleUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${yesterdayStr}`;
      const schedResponse = await fetch(scheduleUrl);
      if (!schedResponse.ok) {
        return { success: false, error: "MLB API unavailable" };
      }

      const schedData = await schedResponse.json();
      const games = schedData?.dates?.[0]?.games || [];
      const actualStats = new Map<number, { hits: number; runs: number; rbi: number }>();

      for (const game of games) {
        if (game.status?.abstractGameState !== "Final") continue;
        try {
          const boxUrl = `https://statsapi.mlb.com/api/v1/game/${game.gamePk}/boxscore`;
          const boxResponse = await fetch(boxUrl);
          if (!boxResponse.ok) continue;
          const boxData = await boxResponse.json();

          for (const teamType of ["home", "away"] as const) {
            const team = boxData.teams?.[teamType];
            if (!team?.players) continue;
            for (const [, player] of Object.entries(team.players) as [string, any][]) {
              const playerId = player?.person?.id;
              const batting = player?.stats?.batting;
              if (playerId && batting) {
                actualStats.set(playerId, {
                  hits: batting.hits || 0,
                  runs: batting.runs || 0,
                  rbi: batting.rbi || 0,
                });
              }
            }
          }
        } catch {}
      }

      if (actualStats.size === 0) {
        return { success: false, error: "No completed game data for " + yesterdayStr, updated: 0 };
      }

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

        const updateData: any = {
          hitsActual: playerStats.hits,
          runsActual: playerStats.runs,
          rbiActual: playerStats.rbi,
        };

        const parsePred = (json: string | null) => {
          if (!json) return null;
          try { return JSON.parse(json); } catch { return null; }
        };

        const hitsPred = parsePred(pred.hitsPrediction);
        const runsPred = parsePred(pred.runsPrediction);
        const rbiPred = parsePred(pred.rbiPrediction);

        if (hitsPred) updateData.hitsCorrect = playerStats.hits > (hitsPred.line || 0) ? 1 : 0;
        if (runsPred) updateData.runsCorrect = playerStats.runs > (runsPred.line || 0) ? 1 : 0;
        if (rbiPred) updateData.rbiCorrect = playerStats.rbi > (rbiPred.line || 0) ? 1 : 0;

        await db.update(propPredictions).set(updateData).where(eq(propPredictions.id, pred.id));
        updated++;
      }

      return { success: true, updated, date: yesterdayStr, playersFound: actualStats.size };
    } catch (error) {
      console.error("[Results] Error backfilling:", error);
      return { success: false, error: "Failed to backfill results", updated: 0 };
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
          stats: { overallHitRate: 0, totalPredictions: 0, totalHits: 0, byStatType: { hits: 0, runs: 0, rbi: 0 }, last7Days: 0, last30Days: 0 },
        };
      }

      const allPreds = await db
        .select()
        .from(propPredictions)
        .where(sql`${propPredictions.hitsActual} IS NOT NULL OR ${propPredictions.runsActual} IS NOT NULL OR ${propPredictions.rbiActual} IS NOT NULL`);

      let totalPredictions = 0;
      let totalHits = 0;
      const byStatType = { hits: { total: 0, correct: 0 }, runs: { total: 0, correct: 0 }, rbi: { total: 0, correct: 0 } };

      for (const pred of allPreds) {
        if (pred.hitsCorrect !== null) { totalPredictions++; byStatType.hits.total++; if (pred.hitsCorrect === 1) { totalHits++; byStatType.hits.correct++; } }
        if (pred.runsCorrect !== null) { totalPredictions++; byStatType.runs.total++; if (pred.runsCorrect === 1) { totalHits++; byStatType.runs.correct++; } }
        if (pred.rbiCorrect !== null) { totalPredictions++; byStatType.rbi.total++; if (pred.rbiCorrect === 1) { totalHits++; byStatType.rbi.correct++; } }
      }

      const overallHitRate = totalPredictions > 0 ? Math.round((totalHits / totalPredictions) * 100) : 0;

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
          last7Days: overallHitRate,
          last30Days: overallHitRate,
        },
      };
    } catch (error) {
      console.error("Error fetching hit rate stats:", error);
      return {
        success: false,
        stats: { overallHitRate: 0, totalPredictions: 0, totalHits: 0, byStatType: { hits: 0, runs: 0, rbi: 0 }, last7Days: 0, last30Days: 0 },
      };
    }
  }),
});
