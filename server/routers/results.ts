/**
 * Results Router
 * Shows EXACTLY the same picks from Money Picks, All Plays, AI Props, and Parlays
 * with real-time game outcomes from MLB boxscores.
 * 
 * Flow:
 * 1. Fetches the same HRR picks shown on Money Picks (75%+ alternate lines)
 * 2. Fetches the same singular picks shown on All Plays
 * 3. Checks game statuses via MLB API
 * 4. For completed/in-progress games, fetches boxscore stats
 * 5. Returns picks with actual outcomes (hit/miss/pending)
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
import { fetchHRRMarketData, getBestHRRLine } from "../services/oddsApiService";
import { poissonOverProbability, calculateAlternateLines } from "../services/poissonModel";
import { fetchGameStatuses, getLivePlayerStats, type GameStatus, type PlayerBoxStats } from "../services/liveResultsService";
import { getDataDate } from "../services/mlbLineupService";

export interface LiveResult {
  playerId: number;
  playerName: string;
  team: string;
  source: "money" | "allPlays"; // Which tab this pick came from
  // For money picks (HRR combined)
  stat: "hrr" | "hits" | "runs" | "rbi";
  line: number;
  probability: number;
  prediction: "over";
  // Actuals
  actualValue: number | null;
  hit: boolean | null;
  gameStatus: "Scheduled" | "In Progress" | "Final" | "Postponed";
  gamePk: number;
  inning?: number;
  inningHalf?: string;
  // Extra context
  pitcher?: string;
  pitcherTeam?: string;
  expectedTotal?: number;
  reasoning?: string;
}

export const resultsRouter = router({
  /**
   * Get today's live results — mirrors exactly what Money Picks and All Plays show
   */
  getTodayResults: publicProcedure.query(async () => {
    try {
      const dateStr = await getDataDate();

      // Step 1: Get lineup data (same source as all tabs)
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

      // ═══════════════════════════════════════════════════════════════════
      // MONEY PICKS: HRR combined props with 75%+ alternate lines
      // (Same logic as getHRRPicks → MoneyPicksTab filter)
      // ═══════════════════════════════════════════════════════════════════
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

      // Fetch real sportsbook lines (non-blocking)
      let marketData = new Map<string, any>();
      try {
        marketData = await fetchHRRMarketData();
      } catch (e) {
        // Odds API unavailable, use model-only
      }

      // Enrich with Poisson probabilities (same as getHRRPicks)
      const hrrPicks = projections.map((proj) => {
        const lambda = proj.expectedTotal;
        const bestLine = getBestHRRLine(proj.playerName, marketData, proj.hrrLine);
        const activeLine = bestLine.line;
        const alternates = calculateAlternateLines(lambda, 5.5);
        return {
          ...proj,
          hrrLine: activeLine,
          alternateLines: alternates.map(alt => ({
            line: alt.line,
            overProb: Math.round(alt.overProb * 100),
          })),
        };
      });

      // Filter to Money Picks: only those with at least one alternate line at 75%+
      // Then pick the HIGHEST line with 75%+ (same as MoneyPicksTab logic)
      const moneyPickResults: { playerId: number; playerName: string; team: string; line: number; probability: number; pitcher: string; pitcherTeam: string; expectedTotal: number; reasoning: string }[] = [];
      
      for (const pick of hrrPicks) {
        const qualifyingLines = (pick.alternateLines || [])
          .filter(a => a.overProb >= 75)
          .sort((a, b) => b.line - a.line); // Highest line first

        if (qualifyingLines.length === 0) continue;

        const recommended = qualifyingLines[0];
        moneyPickResults.push({
          playerId: pick.playerId,
          playerName: pick.playerName,
          team: pick.team,
          line: recommended.line,
          probability: recommended.overProb,
          pitcher: pick.pitcher,
          pitcherTeam: pick.pitcherTeam,
          expectedTotal: pick.expectedTotal,
          reasoning: pick.reasoning,
        });
      }

      // ═══════════════════════════════════════════════════════════════════
      // ALL PLAYS: Singular stat picks (same as getComprehensivePicks)
      // ═══════════════════════════════════════════════════════════════════
      const allPicks = rankAIPicks(matchups, players, getMockHRTargets(), parkFactors);
      
      // Enrich with Savant data (same as getComprehensivePicks)
      const savantAllGames = getMockSavantData();
      const enrichedAllPicks = allPicks.map(pick => {
        let savantMetrics = null;
        for (const game of savantAllGames) {
          for (const hitter of [...game.homeHitters, ...game.awayHitters]) {
            if (hitter.name === pick.playerName) {
              savantMetrics = { xwOBA: hitter.xwOBA, hardHitPct: hitter.hardHitPct, exitVelocity: hitter.exitVelocity, barrelPct: hitter.barrelPct };
            }
          }
        }
        const combined = savantMetrics ? calculateCombinedScore(savantMetrics as any, null, pick.statType as 'hits' | 'runs' | 'rbi').score : pick.overallScore;
        return { ...pick, savantMetrics, combinedScore: combined };
      });

      // Sort same as All Plays (by combinedScore with stat priority tiebreaker)
      const STAT_SORT_PRIORITY: Record<string, number> = { hits: 3, runs: 2, rbi: 1, slg: 0 };
      const sortedAllPicks = [...enrichedAllPicks]
        .sort((a, b) => {
          const scoreDiff = (Number(b.combinedScore) || b.overallScore) - (Number(a.combinedScore) || a.overallScore);
          if (Math.abs(scoreDiff) < 3) {
            return (STAT_SORT_PRIORITY[b.statType] || 0) - (STAT_SORT_PRIORITY[a.statType] || 0);
          }
          return scoreDiff;
        });

      // ═══════════════════════════════════════════════════════════════════
      // GAME STATUS + BOXSCORES
      // ═══════════════════════════════════════════════════════════════════
      
      // Build player -> gamePk map
      const playerGameMap = new Map<number, number>();
      for (const game of games) {
        for (const p of [...game.homeLineup, ...game.awayLineup]) {
          playerGameMap.set(p.id, game.gamePk);
        }
      }

      // Get game statuses
      const gameStatuses = await fetchGameStatuses(dateStr);
      const gameStatusMap = new Map<number, GameStatus>();
      for (const gs of gameStatuses) {
        gameStatusMap.set(gs.gamePk, gs);
      }

      // Get live stats for all players
      const allPlayerIds = [
        ...moneyPickResults.map(p => p.playerId),
        ...sortedAllPicks.map(p => p.playerId),
      ];
      const uniquePlayerIds = Array.from(new Set(allPlayerIds));
      const liveStats = await getLivePlayerStats(uniquePlayerIds, dateStr);

      // ═══════════════════════════════════════════════════════════════════
      // BUILD RESULTS
      // ═══════════════════════════════════════════════════════════════════
      const results: LiveResult[] = [];

      // Money Picks results (HRR combined)
      for (const pick of moneyPickResults) {
        const gamePk = playerGameMap.get(pick.playerId) || 0;
        const gameStatus = gameStatusMap.get(gamePk);
        const playerStats = liveStats.get(pick.playerId);

        const status: LiveResult["gameStatus"] = gameStatus
          ? (gameStatus.status === "In Progress" ? "In Progress" :
             gameStatus.status === "Final" ? "Final" :
             gameStatus.status === "Postponed" ? "Postponed" : "Scheduled")
          : "Scheduled";

        let actualValue: number | null = null;
        let hit: boolean | null = null;

        if (playerStats && (status === "Final" || status === "In Progress")) {
          // HRR combined = hits + runs + rbi
          actualValue = playerStats.hits + playerStats.runs + playerStats.rbi;
          hit = actualValue > pick.line;
        }

        results.push({
          playerId: pick.playerId,
          playerName: pick.playerName,
          team: pick.team,
          source: "money",
          stat: "hrr",
          line: pick.line,
          probability: pick.probability,
          prediction: "over",
          actualValue,
          hit,
          gameStatus: status,
          gamePk,
          inning: gameStatus?.inning,
          inningHalf: gameStatus?.inningHalf,
          pitcher: pick.pitcher,
          pitcherTeam: pick.pitcherTeam,
          expectedTotal: pick.expectedTotal,
          reasoning: pick.reasoning,
        });
      }

      // All Plays results (singular stats)
      for (const pick of sortedAllPicks) {
        const gamePk = playerGameMap.get(pick.playerId) || 0;
        const gameStatus = gameStatusMap.get(gamePk);
        const playerStats = liveStats.get(pick.playerId);

        const status: LiveResult["gameStatus"] = gameStatus
          ? (gameStatus.status === "In Progress" ? "In Progress" :
             gameStatus.status === "Final" ? "Final" :
             gameStatus.status === "Postponed" ? "Postponed" : "Scheduled")
          : "Scheduled";

        let actualValue: number | null = null;
        let hit: boolean | null = null;

        if (playerStats && (status === "Final" || status === "In Progress")) {
          const statValue = pick.statType === "hits" ? playerStats.hits :
                           pick.statType === "runs" ? playerStats.runs :
                           playerStats.rbi;
          actualValue = statValue;
          hit = statValue > pick.line;
        }

        results.push({
          playerId: pick.playerId,
          playerName: pick.playerName,
          team: pick.team,
          source: "allPlays",
          stat: pick.statType as "hits" | "runs" | "rbi",
          line: pick.line,
          probability: pick.confidence,
          prediction: "over",
          actualValue,
          hit,
          gameStatus: status,
          gamePk,
          inning: gameStatus?.inning,
          inningHalf: gameStatus?.inningHalf,
          pitcher: pick.pitcher,
          pitcherTeam: pick.pitcherTeam,
          reasoning: pick.reasoning,
        });
      }

      // Sort: Final games first, then In Progress, then Scheduled
      // Within each group, sort by source (money first), then probability
      const statusOrder = { "Final": 0, "In Progress": 1, "Scheduled": 2, "Postponed": 3 };
      results.sort((a, b) => {
        const statusDiff = statusOrder[a.gameStatus] - statusOrder[b.gameStatus];
        if (statusDiff !== 0) return statusDiff;
        // Money picks first within same status
        if (a.source !== b.source) return a.source === "money" ? -1 : 1;
        return b.probability - a.probability;
      });

      // Calculate hit rate (only for final games)
      const finalResults = results.filter(r => r.gameStatus === "Final" && r.actualValue !== null);
      const hitCount = finalResults.filter(r => r.hit === true).length;
      const hitRate = finalResults.length > 0 ? Math.round((hitCount / finalResults.length) * 100) : 0;

      // Separate hit rates by source
      const moneyFinal = finalResults.filter(r => r.source === "money");
      const allPlaysFinal = finalResults.filter(r => r.source === "allPlays");
      const moneyHitRate = moneyFinal.length > 0 ? Math.round((moneyFinal.filter(r => r.hit).length / moneyFinal.length) * 100) : 0;
      const allPlaysHitRate = allPlaysFinal.length > 0 ? Math.round((allPlaysFinal.filter(r => r.hit).length / allPlaysFinal.length) * 100) : 0;

      // Game counts
      const gamesInProgress = gameStatuses.filter(g => g.status === "In Progress").length;
      const gamesCompleted = gameStatuses.filter(g => g.status === "Final").length;
      const gamesScheduled = gameStatuses.filter(g => g.status === "Scheduled" || g.status === "Pre-Game").length;

      return {
        success: true,
        results,
        date: dateStr,
        hitRate,
        moneyHitRate,
        allPlaysHitRate,
        totalPlays: results.length,
        moneyPlays: moneyPickResults.length,
        allPlaysCount: sortedAllPicks.length,
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
        date: await getDataDate(),
        hitRate: 0,
        moneyHitRate: 0,
        allPlaysHitRate: 0,
        totalPlays: 0,
        moneyPlays: 0,
        allPlaysCount: 0,
        hasActuals: false,
        gamesInProgress: 0,
        gamesCompleted: 0,
        gamesScheduled: 0,
      };
    }
  }),

  /**
   * Get yesterday's prediction results (legacy — reads from database)
   */
  getYesterdayResults: publicProcedure.query(async () => {
    try {
      const db = await getDb();
      if (!db) {
        return { success: false, error: "Database not available", results: [], hitRate: 0, totalPlays: 0, date: "", hasActuals: false };
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split("T")[0];

      const predictions = await db
        .select()
        .from(propPredictions)
        .where(and(gte(propPredictions.gameDate, yesterday), lt(propPredictions.gameDate, today)))
        .orderBy(desc(propPredictions.createdAt));

      if (predictions.length === 0) {
        return { success: true, results: [], hitRate: 0, totalPlays: 0, date: yesterdayStr, hasActuals: false };
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
              team: "",
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

      const resultsWithActuals = results.filter(r => r.actualValue !== null);
      const hitCount = resultsWithActuals.filter(r => r.hit === true).length;
      const hitRate = resultsWithActuals.length > 0 ? Math.round((hitCount / resultsWithActuals.length) * 100) : 0;

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
      return { success: false, error: "Failed to fetch results", results: [], hitRate: 0, totalPlays: 0, date: "", hasActuals: false };
    }
  }),

  /**
   * Backfill actual results for yesterday's predictions
   */
  backfillResults: protectedProcedure.mutation(async ({ ctx }) => {
    if (!ctx.user) return { success: false, error: "Unauthorized" };

    const db = await getDb();
    if (!db) return { success: false, error: "Database not available" };

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split("T")[0];

      const scheduleUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${yesterdayStr}`;
      const schedResponse = await fetch(scheduleUrl);
      if (!schedResponse.ok) return { success: false, error: "MLB API unavailable" };

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
                actualStats.set(playerId, { hits: batting.hits || 0, runs: batting.runs || 0, rbi: batting.rbi || 0 });
              }
            }
          }
        } catch {}
      }

      if (actualStats.size === 0) return { success: false, error: "No completed game data for " + yesterdayStr, updated: 0 };

      const predictions = await db
        .select()
        .from(propPredictions)
        .where(and(gte(propPredictions.gameDate, yesterday), lt(propPredictions.gameDate, today)));

      let updated = 0;
      for (const pred of predictions) {
        const playerStats = actualStats.get(pred.playerId);
        if (!playerStats) continue;

        const updateData: any = { hitsActual: playerStats.hits, runsActual: playerStats.runs, rbiActual: playerStats.rbi };
        const parsePred = (json: string | null) => { if (!json) return null; try { return JSON.parse(json); } catch { return null; } };

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
   * Get hit rate statistics
   */
  getHitRateStats: publicProcedure.query(async () => {
    try {
      const db = await getDb();
      if (!db) {
        return { success: false, stats: { overallHitRate: 0, totalPredictions: 0, totalHits: 0, byStatType: { hits: 0, runs: 0, rbi: 0 }, last7Days: 0, last30Days: 0 } };
      }

      const allPreds = await db
        .select()
        .from(propPredictions)
        .where(sql`hits_actual IS NOT NULL OR runs_actual IS NOT NULL OR rbi_actual IS NOT NULL`);

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
      return { success: false, stats: { overallHitRate: 0, totalPredictions: 0, totalHits: 0, byStatType: { hits: 0, runs: 0, rbi: 0 }, last7Days: 0, last30Days: 0 } };
    }
  }),
});
