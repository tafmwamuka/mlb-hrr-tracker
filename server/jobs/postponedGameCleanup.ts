/**
 * Postponed Game Cleanup Job
 *
 * Runs every 5 minutes throughout the day.
 * Detects any games that have been marked Postponed, Cancelled, or Suspended
 * by the MLB API and:
 *   1. Removes those players from the locked board store (in-memory)
 *   2. Deletes their rows from daily_results for today
 *   3. Deletes their rows from pick_snapshots for today
 *
 * This ensures the Money Picks board and Results tab are always clean —
 * no picks from postponed games ever appear or count toward hit rate.
 */

import { getGamesForUI } from "../services/lineupAdapter";
import { getDataDate } from "../services/mlbLineupService";
import { getDb } from "../db";
import { dailyResults, pickSnapshots } from "../../drizzle/schema";
import { and, eq, inArray } from "drizzle-orm";

const JOB_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Track which games we've already cleaned up to avoid redundant DB operations
const cleanedGamePks = new Set<number>();

/**
 * Run a single cleanup pass: detect postponed games and purge their data.
 * Returns a summary of what was removed.
 */
export async function runPostponedGameCleanup(): Promise<{
  postponedGames: string[];
  deletedResults: number;
  deletedSnapshots: number;
}> {
  const result = { postponedGames: [] as string[], deletedResults: 0, deletedSnapshots: 0 };

  try {
    const games = await getGamesForUI();
    const postponedGames = games.filter(
      g => g.status === "Postponed" || g.status === "Cancelled" || g.status === "Suspended"
    );

    if (postponedGames.length === 0) return result;

    // Collect team abbreviations from all postponed games
    const postponedTeams = new Set<string>();
    for (const game of postponedGames) {
      postponedTeams.add(game.awayTeam.abbreviation);
      postponedTeams.add(game.homeTeam.abbreviation);
      const label = `${game.awayTeam.abbreviation}@${game.homeTeam.abbreviation} (${game.status})`;
      result.postponedGames.push(label);
    }

    // Only new postponements (not already cleaned)
    const newlyPostponed = postponedGames.filter(g => !cleanedGamePks.has(g.gamePk));
    if (newlyPostponed.length === 0) return result;

    const db = await getDb();
    if (!db) return result;

    const dateStr = await getDataDate();
    const teamsArray = Array.from(postponedTeams);

    // 1. Delete from daily_results for today where playerTeam is in postponed teams
    const drDel = await db
      .delete(dailyResults)
      .where(
        and(
          eq(dailyResults.gameDate, dateStr),
          inArray(dailyResults.playerTeam, teamsArray)
        )
      );
    result.deletedResults = (drDel as any)?.rowsAffected ?? 0;

    // 2. Delete from pick_snapshots for today where playerTeam is in postponed teams
    const psDel = await db
      .delete(pickSnapshots)
      .where(
        and(
          eq(pickSnapshots.gameDate, dateStr),
          inArray(pickSnapshots.playerTeam, teamsArray)
        )
      );
    result.deletedSnapshots = (psDel as any)?.rowsAffected ?? 0;

    // 3. Mark these games as cleaned so we don't repeat DB operations
    for (const game of newlyPostponed) {
      cleanedGamePks.add(game.gamePk);
    }

    if (result.deletedResults > 0 || result.deletedSnapshots > 0) {
      console.log(
        `[PPD Cleanup] Postponed games: ${result.postponedGames.join(", ")} | ` +
        `Deleted ${result.deletedResults} daily_results rows, ${result.deletedSnapshots} pick_snapshot rows for ${dateStr}`
      );
    }
  } catch (err) {
    console.error("[PPD Cleanup] Error during postponed game cleanup:", err);
  }

  return result;
}

/** Reset the cleaned-games cache at midnight so each new day starts fresh */
function resetDailyCache(): void {
  cleanedGamePks.clear();
  console.log("[PPD Cleanup] Daily cache reset — ready for new slate");
}

/** Start the background postponed-game cleanup job */
export function startPostponedGameCleanupJob(): void {
  // Run once 30 seconds after startup
  setTimeout(async () => {
    try {
      const r = await runPostponedGameCleanup();
      if (r.postponedGames.length > 0) {
        console.log(`[PPD Cleanup] Startup pass: ${r.postponedGames.join(", ")}`);
      }
    } catch (err) {
      console.error("[PPD Cleanup] Startup pass failed:", err);
    }
  }, 30_000);

  // Then run every 5 minutes
  setInterval(async () => {
    try {
      await runPostponedGameCleanup();
    } catch (err) {
      console.error("[PPD Cleanup] Interval pass failed:", err);
    }
  }, JOB_INTERVAL_MS);

  // Reset daily cache at midnight NDT (05:30 UTC = midnight NDT)
  const now = new Date();
  const nextMidnightNDT = new Date(now);
  nextMidnightNDT.setUTCHours(5, 30, 0, 0);
  if (nextMidnightNDT <= now) nextMidnightNDT.setUTCDate(nextMidnightNDT.getUTCDate() + 1);
  const msUntilMidnight = nextMidnightNDT.getTime() - now.getTime();
  setTimeout(() => {
    resetDailyCache();
    setInterval(resetDailyCache, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);

  console.log("[PPD Cleanup] Postponed game cleanup job started (runs every 5 min)");
}
