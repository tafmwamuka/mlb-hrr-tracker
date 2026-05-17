/**
 * Auto-Grade Results Job
 *
 * Runs server-side on a 30-minute interval between 7 PM and midnight NDT.
 * Grades today's money picks against live MLB boxscores and saves Final
 * game results to the daily_results DB table.
 *
 * This replaces the fragile client-side auto-save in ResultsTab.tsx, ensuring
 * the pipeline runs regardless of whether anyone has the site open.
 */

import { getEnrichedMoneyPicks } from "../services/hrrPicksService";
import { getDataDate } from "../services/mlbLineupService";
import { fetchGameStatuses, getLivePlayerStats } from "../services/liveResultsService";
import { getAdaptedLineupData } from "../services/lineupAdapter";
import { getDb } from "../db";
import { dailyResults } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

const JOB_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const NDT_TZ = "America/St_Johns";

/** Returns true if current NDT time is between 7 PM and 2 AM (results window) */
function isResultsWindow(): boolean {
  const nowNDT = new Date(new Date().toLocaleString("en-US", { timeZone: NDT_TZ }));
  const h = nowNDT.getHours();
  // 19:00–23:59 NDT (7 PM to midnight) or 0:00–2:00 NDT (midnight to 2 AM for late games)
  return h >= 19 || h < 2;
}

/** Grade and save today's money picks results to the DB */
export async function gradeAndSaveResults(): Promise<{ saved: number; skipped: string }> {
  const db = await getDb();
  if (!db) return { saved: 0, skipped: "no db" };

  const dateStr = await getDataDate();

  // Get today's money picks
  const hrrResult = await getEnrichedMoneyPicks();
  if (hrrResult.lineupsPending || hrrResult.moneyPicks.length === 0) {
    return { saved: 0, skipped: "no picks" };
  }

  // Build player → gamePk map using matchups array (each MatchupData has playerId + gamePk)
  const lineupData = await getAdaptedLineupData();
  const playerGameMap = new Map<number, number>();
  for (const matchup of lineupData.matchups) {
    if (matchup.gamePk) {
      playerGameMap.set(matchup.playerId, matchup.gamePk);
    }
  }

  // Get game statuses
  const gameStatuses = await fetchGameStatuses(dateStr);
  const gameStatusMap = new Map<number, { status: string; inning?: number; inningHalf?: string }>();
  for (const gs of gameStatuses) {
    gameStatusMap.set(gs.gamePk, gs);
  }

  // Only process picks whose games are Final
  const finalPicks = hrrResult.moneyPicks.filter(pick => {
    const gamePk = playerGameMap.get(pick.playerId) || 0;
    const gs = gameStatusMap.get(gamePk);
    return gs?.status === "Final";
  });

  if (finalPicks.length === 0) {
    return { saved: 0, skipped: "no final games yet" };
  }

  // Get live stats for final picks
  const playerIds = finalPicks.map(p => p.playerId);
  const liveStats = await getLivePlayerStats(playerIds, dateStr);

  // Build graded rows
  const rows = finalPicks.map(pick => {
    const playerStats = liveStats.get(pick.playerId);
    let actualValue: number | null = null;
    let result: "hit" | "miss" | "pending" = "pending";

    if (playerStats) {
      // HRR combined = hits + runs + rbi
      actualValue = playerStats.hits + playerStats.runs + playerStats.rbi;
      result = actualValue > pick.recommendedLine ? "hit" : "miss";
    }

    return {
      gameDate: dateStr,
      playerId: pick.playerId,
      playerName: pick.playerName,
      playerTeam: pick.team,
      statType: "hrr" as const,
      source: "money" as const,
      line: String(pick.recommendedLine),
      probability: pick.recommendedProb,
      actualValue,
      result,
      odds: pick.bookOdds != null ? String(pick.bookOdds) : null,
      oddsProvider: pick.bookOddsProvider != null ? String(pick.bookOddsProvider) : null,
      streakLabel: null,
      dayNightLabel: null,
      tier: pick.overallScore >= 83 ? "S" : pick.overallScore >= 74 ? "A" : pick.overallScore >= 68 ? "Lean" : null,
      edge: null,
      closingLineValue: null,
      matrixScore: pick.overallScore ?? null,
    };
  });

  // Upsert: delete existing entries for this date (money source only) then re-insert
  await db.delete(dailyResults)
    .where(eq(dailyResults.gameDate, dateStr));

  if (rows.length > 0) {
    await db.insert(dailyResults).values(rows);
  }

  console.log(`[AutoGrade] Saved ${rows.length} graded results for ${dateStr} (${rows.filter(r => r.result === "hit").length} hits, ${rows.filter(r => r.result === "miss").length} misses)`);
  return { saved: rows.length, skipped: "" };
}

/** Start the background auto-grade job */
export function startAutoGradeJob(): void {
  // Run once immediately on startup (in case server restarted mid-evening)
  setTimeout(async () => {
    if (isResultsWindow()) {
      try {
        const result = await gradeAndSaveResults();
        if (result.saved > 0) {
          console.log(`[AutoGrade] Startup run: saved ${result.saved} results`);
        }
      } catch (err) {
        console.error("[AutoGrade] Startup run failed:", err);
      }
    }
  }, 10_000); // 10s after startup

  // Then run every 30 minutes
  setInterval(async () => {
    if (!isResultsWindow()) return;
    try {
      const result = await gradeAndSaveResults();
      if (result.saved > 0) {
        console.log(`[AutoGrade] Interval run: saved ${result.saved} results`);
      }
    } catch (err) {
      console.error("[AutoGrade] Interval run failed:", err);
    }
  }, JOB_INTERVAL_MS);

  console.log("[AutoGrade] Auto-grade results job started (runs every 30 min during results window 7 PM–2 AM NDT)");
}
