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
import { getDb, getPickSnapshotsByDate, gradePickSnapshot } from "../db";
import { propPredictions, dailyResults, pickSnapshots } from "../../drizzle/schema";
import { eq, and, gte, lt, desc, sql, isNotNull, or, ne } from "drizzle-orm";
import { getAdaptedLineupData } from "../services/lineupAdapter";
// aiRankingService no longer used in results.ts (All Plays removed)
// savantService no longer used in results.ts (All Plays removed)
import { fetchGameStatuses, getLivePlayerStats, type GameStatus, type PlayerBoxStats } from "../services/liveResultsService";
import { getDataDate } from "../services/mlbLineupService";
import { getEnrichedMoneyPicks } from "../services/hrrPicksService";

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
      const db = await getDb();

      // ═══════════════════════════════════════════════════════════════════
      // Phase BS: Use pick_snapshots as the primary source of truth.
      // pick_snapshots uses INSERT IGNORE so confirmed picks are never overwritten.
      // Falls back to live Money Picks board if no snapshots exist yet (early morning).
      // ═══════════════════════════════════════════════════════════════════

      // Step 1: Try to get locked pick snapshots from DB
      const snapshots = db ? await getPickSnapshotsByDate(dateStr) : [];

      let moneyPickResults: Array<{
        playerId: number;
        playerName: string;
        team: string;
        line: number;
        probability: number;
        pitcher?: string;
        pitcherTeam?: string;
        expectedTotal?: number;
        reasoning?: string;
        odds: string | null;
        confirmedOdds?: number | null;
        currentOdds?: number | null;
        edge?: number | null;
        matrixScore?: number | null;
        tier?: string | null;
        boardPhase?: string | null;
        pickStatus?: string | null;
      }>;

      if (snapshots.length > 0) {
        // Phase BS: Use locked snapshots as the authoritative pick list
        moneyPickResults = snapshots.map(s => ({
          playerId: s.playerId,
          playerName: s.playerName,
          team: s.playerTeam,
          line: parseFloat(s.recommendedLine.replace(/^O/i, '')),
          probability: s.probability ?? 0,
          odds: s.confirmedOdds != null ? String(s.confirmedOdds) : null,
          confirmedOdds: s.confirmedOdds,
          currentOdds: s.currentOdds,
          edge: s.edge,
          matrixScore: s.matrixScore,
          tier: s.tier,
          boardPhase: s.boardPhase,
          pickStatus: s.pickStatus,
        }));
      } else {
        // Fallback: no snapshots yet — use live board (early morning before first official pull)
        const hrrResult = await getEnrichedMoneyPicks();
        if (hrrResult.lineupsPending) {
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
        moneyPickResults = hrrResult.moneyPicks.map(p => ({
          playerId: p.playerId,
          playerName: p.playerName,
          team: p.team,
          line: p.recommendedLine,
          probability: p.recommendedProb,
          pitcher: p.pitcher,
          pitcherTeam: p.pitcherTeam,
          expectedTotal: p.expectedTotal,
          reasoning: p.reasoning,
          odds: p.bookOdds != null ? String(p.bookOdds) : null,
          confirmedOdds: typeof p.bookOdds === 'number' ? p.bookOdds : null,
          currentOdds: typeof p.bookOdds === 'number' ? p.bookOdds : null,
        }));
      }

      // Step 2: Load any already-graded actuals from DB (for picks already graded by autoGrade job)
      const gradedMap = new Map<string, { actualValue: number | null; result: string }>();
      if (db && moneyPickResults.length > 0) {
        const dbRows = await db
          .select()
          .from(dailyResults)
          .where(and(
            eq(dailyResults.gameDate, dateStr),
            eq(dailyResults.source, "money"),
          ));
        for (const row of dbRows) {
          gradedMap.set(row.playerName.toLowerCase(), {
            actualValue: row.actualValue,
            result: row.result,
          });
        }
      }

      // ═══════════════════════════════════════════════════════════════════
      // GAME STATUS + BOXSCORES
      // ═══════════════════════════════════════════════════════════════════

      // Build player -> gamePk map from lineup data
      // Use BOTH player id AND player name as keys for robustness
      const lineupData2 = await getAdaptedLineupData();
      const playerGameMap = new Map<number, number>();
      const playerNameGameMap = new Map<string, number>(); // fallback by name
      for (const game of lineupData2.games) {
        for (const p of [...game.homeLineup, ...game.awayLineup]) {
          playerGameMap.set(p.id, game.gamePk);
          const pName = (p as any).name ?? (p as any).fullName ?? "";
          playerNameGameMap.set(pName.toLowerCase(), game.gamePk);
        }
      }

      // Get game statuses
      const gameStatuses = await fetchGameStatuses(dateStr);
      const gameStatusMap = new Map<number, GameStatus>();
      for (const gs of gameStatuses) {
        gameStatusMap.set(gs.gamePk, gs);
      }

      // Get live stats for money pick players only
      // Phase BN: also pass player names for fallback grading when IDs don't match boxscore
      const uniquePlayerIds = Array.from(new Set(moneyPickResults.map(p => p.playerId)));
      const uniquePlayerNames = moneyPickResults.map(p => p.playerName);
      const liveStats = await getLivePlayerStats(uniquePlayerIds, dateStr, uniquePlayerNames);

      // ═══════════════════════════════════════════════════════════════════
      // BUILD RESULTS
      // ═══════════════════════════════════════════════════════════════════
      const results: LiveResult[] = [];

      // Money Picks results (HRR combined)
      for (const pick of moneyPickResults) {
        // Try ID lookup first, then name fallback
        let gamePk = playerGameMap.get(pick.playerId) || 0;
        if (!gamePk) {
          gamePk = playerNameGameMap.get(pick.playerName?.toLowerCase() ?? "") || 0;
        }
        const gameStatus = gameStatusMap.get(gamePk);
        const playerStats = liveStats.get(pick.playerId);

        const status: LiveResult["gameStatus"] = gameStatus
          ? (gameStatus.status === "In Progress" ? "In Progress" :
             gameStatus.status === "Final" ? "Final" :
             gameStatus.status === "Postponed" ? "Postponed" : "Scheduled")
          : "Scheduled";

        let actualValue: number | null = null;
        let hit: boolean | null = null;

        if (status === "Postponed") {
          // Postponed game: no grading, no actual value — will show PPD badge
          actualValue = null;
          hit = null;
        } else if (playerStats && (status === "Final" || status === "In Progress")) {
          // HRR combined = hits + runs + rbi (live boxscore)
          actualValue = playerStats.hits + playerStats.runs + playerStats.rbi;
          // Grading: O1.5/O2.5/O3.5 lines use strict > (half-point, no push possible)
          // O1/O2/O3 whole-number lines use >= (hitting exactly the line is a HIT)
          const isHalfLine = (pick.line * 2) % 2 !== 0;
          hit = isHalfLine ? actualValue > pick.line : actualValue >= pick.line;
        } else {
          // Fallback: use DB-graded actuals if the autoGrade job already ran
          const graded = gradedMap.get(pick.playerName.toLowerCase());
          if (graded && graded.actualValue !== null && graded.result !== 'ppd') {
            actualValue = graded.actualValue;
            hit = graded.result === "hit";
          }
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

      // Grade postponed picks in DB as 'ppd' and remove them from the results list
      if (db) {
        const postponedPicks = results.filter(r => r.gameStatus === "Postponed");
        for (const ppd of postponedPicks) {
          try {
            await db.execute(
              sql`UPDATE pick_snapshots SET result = 'ppd', gradedAt = NOW() WHERE gameDate = ${dateStr} AND playerName = ${ppd.playerName} AND result = 'pending'`
            ).catch(() => {});
            await db.execute(
              sql`UPDATE daily_results SET result = 'ppd' WHERE gameDate = ${dateStr} AND playerName = ${ppd.playerName} AND source = 'money' AND result IN ('pending','miss')`
            ).catch(() => {});
          } catch {}
        }
      }

      // Remove postponed picks from results — they should not appear in the Results tab at all
      const visibleResults = results.filter(r => r.gameStatus !== "Postponed");

      // Sort: Final games first, then In Progress, then Scheduled
      const statusOrder = { "Final": 0, "In Progress": 1, "Scheduled": 2, "Postponed": 3 };
      visibleResults.sort((a, b) => {
        const statusDiff = statusOrder[a.gameStatus] - statusOrder[b.gameStatus];
        if (statusDiff !== 0) return statusDiff;
        return b.probability - a.probability;
      });

      // Calculate hit rate (only for final games)
      const finalResults = visibleResults.filter(r => r.gameStatus === "Final" && r.actualValue !== null);
      const hitCount = finalResults.filter(r => r.hit === true).length;
      const hitRate = finalResults.length > 0 ? Math.round((hitCount / finalResults.length) * 100) : 0;

      // Game counts
      const gamesInProgress = gameStatuses.filter(g => g.status === "In Progress").length;
      const gamesCompleted = gameStatuses.filter(g => g.status === "Final").length;
      const gamesScheduled = gameStatuses.filter(g => g.status === "Scheduled" || g.status === "Pre-Game").length;

      return {
        success: true,
        results: visibleResults,
        date: dateStr,
        hitRate,
        moneyHitRate: hitRate,
        allPlaysHitRate: 0,
        totalPlays: visibleResults.length,
        moneyPlays: visibleResults.length,
        allPlaysCount: 0,
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

      // Compute yesterday's date string in NDT (America/St_Johns)
      const nowNDT = new Date(new Date().toLocaleString("en-US", { timeZone: "America/St_Johns" }));
      const yesterdayNDT = new Date(nowNDT);
      yesterdayNDT.setDate(nowNDT.getDate() - 1);
      const yesterdayStr = yesterdayNDT.toISOString().split("T")[0];

      // Read from dailyResults — money picks only
      const rows = await db
        .select()
        .from(dailyResults)
        .where(and(
          eq(dailyResults.gameDate, yesterdayStr),
          eq(dailyResults.source, "money"),
        ))
        .orderBy(desc(dailyResults.probability));

      if (rows.length === 0) {
        return { success: true, results: [], hitRate: 0, totalPlays: 0, date: yesterdayStr, hasActuals: false };
      }

      // Exclude postponed (ppd) rows — they should not appear in results at all
      const visibleRows = rows.filter(row => row.result !== 'ppd');

      const results = visibleRows.map(row => ({
        id: row.id,
        playerId: row.playerId,
        playerName: row.playerName,
        team: row.playerTeam,
        stat: row.statType,
        line: row.line,
        prediction: "over",
        confidence: row.probability,
        actualValue: row.actualValue,
        hit: row.result === "hit" ? true : row.result === "miss" ? false : null,
        reasoning: "",
        gameId: null,
        tier: row.tier,
        matrixScore: row.matrixScore,
        odds: row.odds,
        streakLabel: row.streakLabel,
      }));

      const settled = results.filter(r => r.hit !== null);
      const hitCount = settled.filter(r => r.hit === true).length;
      const hitRate = settled.length > 0 ? Math.round((hitCount / settled.length) * 100) : 0;

      return {
        success: true,
        results,
        hitRate,
        totalPlays: results.length,
        totalWithActuals: settled.length,
        totalHits: hitCount,
        date: yesterdayStr,
        hasActuals: settled.length > 0,
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
    // ── Helper: compute stats for a row set ──────────────────────────────────
    const computeStats = (rows: { result: string; odds: string | null; matrixScore: number | null; tier: string | null; isOfficialPlay: number | null; gameDate: string; category: string | null }[]) => {
      const total = rows.length;
      const hits = rows.filter(r => r.result === "hit").length;
      const misses = rows.filter(r => r.result === "miss").length;
      const hitRate = total > 0 ? Math.round((hits / total) * 100) : 0;
      let units = 0;
      for (const r of rows) {
        const odds = r.odds ? parseInt(r.odds) : -110;
        if (r.result === "hit") {
          units += odds < 0 ? 100 / Math.abs(odds) : odds / 100;
        } else if (r.result === "miss") {
          units -= 1;
        }
      }
      const roi = total > 0 ? Math.round((units / total) * 100) / 100 : 0;
      return { total, hits, misses, hitRate, units: Math.round(units * 100) / 100, roi };
    };

    try {
      const db = await getDb();
      if (!db) {
        return { success: false, stats: null };
      }

      // Read all graded rows — money picks only, exclude pending AND ppd
      const allRows = await db
        .select()
        .from(dailyResults)
        .where(and(
          eq(dailyResults.source, "money"),
          ne(dailyResults.result, "pending"),
          ne(dailyResults.result, "ppd")
        ));

      // ── Official plays only (Elite + Official tier, isOfficialPlay=1) ──────────
      // For historical rows without the new tier field, use matrixScore >= 68 as proxy
      const officialRows = allRows.filter(r =>
        r.isOfficialPlay === 1 ||
        (r.isOfficialPlay === null && (r.matrixScore ?? 0) >= 68 && r.tier !== 'Projection')
      );
      const eliteRows = allRows.filter(r =>
        r.tier === 'Elite' ||
        (r.tier === null && (r.matrixScore ?? 0) >= 83)
      );
      const officialOnlyRows = allRows.filter(r =>
        r.tier === 'Official' ||
        (r.tier === null && (r.matrixScore ?? 0) >= 74 && (r.matrixScore ?? 0) < 83)
      );
      const leanRows = allRows.filter(r =>
        r.tier === 'Lean' ||
        (r.tier === null && (r.matrixScore ?? 0) >= 68 && (r.matrixScore ?? 0) < 74)
      );
      const projectionRows = allRows.filter(r =>
        r.tier === 'Projection' ||
        (r.tier === null && (r.matrixScore ?? 0) < 68)
      );

      // ── Time windows ────────────────────────────────────────────────────────
      const now = new Date();
      const sevenDaysAgo = new Date(now); sevenDaysAgo.setDate(now.getDate() - 7);
      const thirtyDaysAgo = new Date(now); thirtyDaysAgo.setDate(now.getDate() - 30);
      const sevenDayStr = sevenDaysAgo.toISOString().split("T")[0];
      const thirtyDayStr = thirtyDaysAgo.toISOString().split("T")[0];

      const last7Official = officialRows.filter(r => r.gameDate >= sevenDayStr);
      const last30Official = officialRows.filter(r => r.gameDate >= thirtyDayStr);

      // ── All-time totals ──────────────────────────────────────────────────────
      const allStats = computeStats(allRows);
      const officialStats = computeStats(officialRows);
      const eliteStats = computeStats(eliteRows);
      const officialOnlyStats = computeStats(officialOnlyRows);
      const leanStats = computeStats(leanRows);
      const projectionStats = computeStats(projectionRows);
      const last7Stats = computeStats(last7Official);
      const last30Stats = computeStats(last30Official);

      return {
        success: true,
        stats: {
          // Legacy fields (kept for backward compat)
          overallHitRate: officialStats.hitRate,
          totalPredictions: officialStats.total,
          totalHits: officialStats.hits,
          last7Days: last7Stats.hitRate,
          last30Days: last30Stats.hitRate,
          byStatType: { hits: officialStats.hitRate, runs: 0, rbi: 0 },
          byTier: {
            s: { hitRate: eliteStats.hitRate, total: eliteStats.total, hits: eliteStats.hits },
            a: { hitRate: officialOnlyStats.hitRate, total: officialOnlyStats.total, hits: officialOnlyStats.hits },
            lean: { hitRate: leanStats.hitRate, total: leanStats.total, hits: leanStats.hits },
          },
          // New structured breakdown
          official: {
            all: officialStats,
            elite: eliteStats,
            officialTier: officialOnlyStats,
            lean: leanStats,
            projection: projectionStats,
          },
          timeWindows: {
            last7: last7Stats,
            last30: last30Stats,
          },
          // Category breakdown (populated once category field is populated for new picks)
          byCategory: {
            moneyPick: computeStats(allRows.filter(r => r.category === 'MoneyPick' || r.category === null)),
          },
        },
      };
    } catch (error) {
      console.error("Error fetching hit rate stats:", error);
      return { success: false, stats: null };
    }
  }),
});
