import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),

  /**
   * Phase AY: Morning data warm (7 AM ET)
   * - Warms enrichment cache (VS grades, Statcast, game totals, splits, streaks)
   * - Pre-warms lineup adapter so first getHRRPicks call gets real data
   * - Busts hrrPicksService cache so next user request triggers a fresh 3-pull board build
   * - Aligns with PRELIMINARY BOARD phase (before 1 PM ET)
   */
  scheduledAIPicks: publicProcedure
    .mutation(async () => {
      try {
        const timestamp = new Date();
        console.log(`[Scheduled] Morning warm (7 AM) started at ${timestamp.toISOString()}`);

        // 1. Warm enrichment cache (VS grades, Statcast, game totals, splits, streaks, bullpen)
        const { warmEnrichmentCacheOnStartup } = await import("../services/enrichmentCache");
        await warmEnrichmentCacheOnStartup();
        console.log(`[Scheduled] Enrichment cache warmed`);

        // 2. Pre-warm lineup adapter (fetches projected + confirmed lineups from MLB API)
        const { getAdaptedLineupData } = await import("../services/lineupAdapter");
        await getAdaptedLineupData();
        console.log(`[Scheduled] Lineup adapter pre-warmed`);

        // 3. Bust the HRR picks cache so the next getHRRPicks call rebuilds the board
        const { bustPicksCache } = await import("../services/hrrPicksService");
        bustPicksCache();
        console.log(`[Scheduled] HRR picks cache busted — board will rebuild on next request`);

        console.log(`[Scheduled] Morning warm completed at ${new Date().toISOString()}`);

        return {
          success: true,
          message: "Morning data warm completed — PRELIMINARY BOARD will rebuild on next request",
          timestamp,
          status: "completed",
        };
      } catch (error) {
        console.error("[Scheduled] Error in morning warm:", error);
        return {
          success: false,
          message: "Morning warm failed",
          error: error instanceof Error ? error.message : "Unknown error",
          timestamp: new Date(),
        };
      }
    }),

  /**
   * Phase AY: Midday data refresh (1 PM ET)
   * - Re-warms enrichment cache with confirmed lineup data
   * - Busts picks cache so next request triggers CONFIRMED BOARD build
   * - Aligns with the 1 PM official pull in the 3-pull stability system
   */
  scheduledLeaderboardRefresh: publicProcedure
    .mutation(async () => {
      try {
        const timestamp = new Date();
        console.log(`[Scheduled] Midday refresh (1 PM) started at ${timestamp.toISOString()}`);

        // 1. Re-warm enrichment cache with latest confirmed lineup data
        const { warmEnrichmentCacheOnStartup } = await import("../services/enrichmentCache");
        await warmEnrichmentCacheOnStartup();
        console.log(`[Scheduled] Enrichment cache re-warmed for midday`);

        // 2. Re-warm lineup adapter to pick up confirmed lineups
        const { getAdaptedLineupData } = await import("../services/lineupAdapter");
        const lineupData = await getAdaptedLineupData();
        const confirmedCount = lineupData?.lineupSource === 'confirmed' ? (lineupData?.games?.length ?? 0) : 0;
        console.log(`[Scheduled] Lineup adapter re-warmed — ${confirmedCount} confirmed lineups`);

        // 3. Bust picks cache so next request triggers CONFIRMED BOARD build
        const { bustPicksCache } = await import("../services/hrrPicksService");
        bustPicksCache();
        console.log(`[Scheduled] HRR picks cache busted — CONFIRMED BOARD will rebuild on next request`);

        console.log(`[Scheduled] Midday refresh completed at ${new Date().toISOString()}`);

        return {
          success: true,
          message: `Midday refresh completed — ${confirmedCount} confirmed lineups loaded, CONFIRMED BOARD will rebuild on next request`,
          timestamp,
          confirmedLineups: confirmedCount,
          status: "completed",
        };
      } catch (error) {
        console.error("[Scheduled] Error in midday refresh:", error);
        return {
          success: false,
          message: "Midday refresh failed",
          error: error instanceof Error ? error.message : "Unknown error",
          timestamp: new Date(),
        };
      }
    }),

  /**
   * Phase AY: Evening final lock (7 PM ET)
   * - Final enrichment cache warm before evening games
   * - Busts picks cache so next request triggers FINAL OFFICIAL BOARD build
   * - Aligns with the 7 PM official pull in the 3-pull stability system
   */
  scheduledEveningLock: publicProcedure
    .mutation(async () => {
      try {
        const timestamp = new Date();
        console.log(`[Scheduled] Evening lock (7 PM) started at ${timestamp.toISOString()}`);

        // 1. Final enrichment cache warm
        const { warmEnrichmentCacheOnStartup } = await import("../services/enrichmentCache");
        await warmEnrichmentCacheOnStartup();
        console.log(`[Scheduled] Enrichment cache warmed for evening lock`);

        // 2. Final lineup pre-warm
        const { getAdaptedLineupData } = await import("../services/lineupAdapter");
        const lineupData = await getAdaptedLineupData();
        const confirmedCount = lineupData?.lineupSource === 'confirmed' ? (lineupData?.games?.length ?? 0) : 0;
        console.log(`[Scheduled] Final lineup warm — ${confirmedCount} confirmed lineups`);

        // 3. Bust picks cache so next request triggers FINAL OFFICIAL BOARD build
        const { bustPicksCache } = await import("../services/hrrPicksService");
        bustPicksCache();
        console.log(`[Scheduled] HRR picks cache busted — FINAL OFFICIAL BOARD will rebuild on next request`);

        console.log(`[Scheduled] Evening lock completed at ${new Date().toISOString()}`);

        return {
          success: true,
          message: `Evening lock completed — FINAL OFFICIAL BOARD will rebuild on next request`,
          timestamp,
          confirmedLineups: confirmedCount,
          status: "completed",
        };
      } catch (error) {
        console.error("[Scheduled] Error in evening lock:", error);
        return {
          success: false,
          message: "Evening lock failed",
          error: error instanceof Error ? error.message : "Unknown error",
          timestamp: new Date(),
        };
      }
    }),

  /**
   * Phase BQ: Pre-game board lock (12:30 PM NDT / 15:00 UTC)
   * - Fetches today's first pitch time from the MLB schedule
   * - If first pitch is within 90 minutes, triggers a final board build and hard-locks it
   * - The hard lock prevents any subsequent scheduled pull from changing the board
   * - Force Refresh button in the UI can still override this lock if needed
   */
  scheduledPreGameLock: publicProcedure
    .mutation(async () => {
      try {
        const timestamp = new Date();
        console.log(`[Scheduled] Pre-game lock check started at ${timestamp.toISOString()}`);

        // 1. Fetch today's schedule to find first pitch time
        const { fetchTodaysGames } = await import("../services/mlbLineupService");
        const games = await fetchTodaysGames();
        if (!games || games.length === 0) {
          console.log('[Scheduled] Pre-game lock: no games today, skipping');
          return { success: true, message: 'No games today — lock skipped', timestamp, status: 'skipped' };
        }

        // Find the earliest game time
        const gameTimes = games
          .map((g: any) => g.gameDate ? new Date(g.gameDate).getTime() : null)
          .filter((t: number | null): t is number => t !== null)
          .sort((a: number, b: number) => a - b);

        if (gameTimes.length === 0) {
          return { success: true, message: 'No game times found — lock skipped', timestamp, status: 'skipped' };
        }

        const firstPitchMs = gameTimes[0];
        const nowMs = Date.now();
        const minsUntilFirstPitch = Math.round((firstPitchMs - nowMs) / 60000);

        console.log(`[Scheduled] Pre-game lock: first pitch in ${minsUntilFirstPitch} minutes`);

        // Only lock if first pitch is within 90 minutes (covers early afternoon games)
        if (minsUntilFirstPitch > 90) {
          return {
            success: true,
            message: `First pitch in ${minsUntilFirstPitch} min — too early to lock (threshold: 90 min)`,
            timestamp,
            minsUntilFirstPitch,
            status: 'too_early',
          };
        }

        // 2. Warm enrichment cache and lineup adapter for a clean final build
        const { warmEnrichmentCacheOnStartup } = await import("../services/enrichmentCache");
        await warmEnrichmentCacheOnStartup();
        console.log('[Scheduled] Pre-game lock: enrichment cache warmed');

        const { getAdaptedLineupData } = await import("../services/lineupAdapter");
        await getAdaptedLineupData();
        console.log('[Scheduled] Pre-game lock: lineup adapter warmed');

        // 3. Bust picks cache so the next getHRRPicks builds a fresh final board
        // The hard lock will be set automatically when getHRRPicks saves the official board
        const { bustPicksCache } = await import("../services/hrrPicksService");
        bustPicksCache();
        console.log('[Scheduled] Pre-game lock: picks cache busted — final board will build on next request');

        console.log(`[Scheduled] Pre-game lock completed at ${new Date().toISOString()} (first pitch in ${minsUntilFirstPitch} min)`);
        return {
          success: true,
          message: `Pre-game lock triggered — final board will build on next request (first pitch in ${minsUntilFirstPitch} min)`,
          timestamp,
          minsUntilFirstPitch,
          firstPitchAt: new Date(firstPitchMs).toISOString(),
          status: 'locked',
        };
      } catch (error) {
        console.error('[Scheduled] Error in pre-game lock:', error);
        return {
          success: false,
          message: 'Pre-game lock failed',
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date(),
        };
      }
    }),
});
