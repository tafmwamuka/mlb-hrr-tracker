/**
 * History Router
 * Stores and retrieves daily pick results for historical performance tracking.
 * All queries are scoped to source='money' (Money Picks) only.
 */

import { router, publicProcedure } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db";
import { dailyResults } from "../../drizzle/schema";
import { eq, gte, lte, desc, and, sql } from "drizzle-orm";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDateStr(date: Date): string {
  return date.toISOString().split("T")[0];
}

function subtractDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return getDateStr(d);
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const historyRouter = router({
  /**
   * Store today's money picks results (called after games go Final).
   * Only accepts source='money' — allplays entries are rejected.
   */
  storeDailyResults: publicProcedure
    .input(z.object({
      gameDate: z.string(), // YYYY-MM-DD
      plays: z.array(z.object({
        playerId: z.number(),
        playerName: z.string(),
        playerTeam: z.string(),
        statType: z.enum(["hits", "runs", "rbi", "hrr"]),
        source: z.enum(["money", "allplays"]),
        line: z.string(),
        probability: z.number(),
        actualValue: z.number().nullable(),
        result: z.enum(["pending", "hit", "miss"]),
        odds: z.string().nullable().optional(),
        oddsProvider: z.string().nullable().optional(),
        streakLabel: z.string().nullable().optional(),
        dayNightLabel: z.string().nullable().optional(),
        tier: z.string().nullable().optional(),
        edge: z.number().nullable().optional(),
        closingLineValue: z.number().nullable().optional(),
        matrixScore: z.number().nullable().optional(),
      })),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Only store money picks — filter out any allplays entries
      const moneyPlays = input.plays.filter(p => p.source === "money");

      // Delete existing money entries for this date to avoid duplicates
      await db.delete(dailyResults)
        .where(and(
          eq(dailyResults.gameDate, input.gameDate),
          eq(dailyResults.source, "money"),
        ));

      if (moneyPlays.length === 0) return { stored: 0 };

      await db.insert(dailyResults).values(
        moneyPlays.map(play => ({
          gameDate: input.gameDate,
          playerId: play.playerId,
          playerName: play.playerName,
          playerTeam: play.playerTeam,
          statType: play.statType,
          source: "money" as const,
          line: play.line,
          probability: play.probability,
          actualValue: play.actualValue ?? null,
          result: play.result,
          odds: play.odds ?? null,
          oddsProvider: play.oddsProvider ?? null,
          streakLabel: play.streakLabel ?? null,
          dayNightLabel: play.dayNightLabel ?? null,
          tier: play.tier ?? null,
          edge: play.edge ?? null,
          closingLineValue: play.closingLineValue ?? null,
          matrixScore: play.matrixScore ?? null,
        }))
      );

      return { stored: moneyPlays.length };
    }),

  /**
   * Get performance summary for a date range (past week / past month / all time).
   * Scoped to money picks only.
   */
  getPerformanceSummary: publicProcedure
    .input(z.object({
      period: z.enum(["week", "month", "all"]).default("week"),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      const empty = { period: input.period, totalPlays: 0, hits: 0, misses: 0, hitRate: 0, moneyHitRate: 0, allPlaysHitRate: 0, byDate: [] };
      if (!db) return empty;

      const startDate = input.period === "week"
        ? subtractDays(7)
        : input.period === "month"
        ? subtractDays(30)
        : "2020-01-01";

      // Only fetch money picks (exclude pending and ppd/postponed)
      const rows = await db.select()
        .from(dailyResults)
        .where(
          and(
            gte(dailyResults.gameDate, startDate),
            eq(dailyResults.source, "money"),
            sql`${dailyResults.result} != 'pending'`,
            sql`${dailyResults.result} != 'ppd'`
          )
        )
        .orderBy(desc(dailyResults.gameDate));

      if (rows.length === 0) return empty;

      const hits = rows.filter(r => r.result === "hit").length;
      const misses = rows.filter(r => r.result === "miss").length;
      const total = hits + misses;
      const hitRate = total > 0 ? Math.round((hits / total) * 100) : 0;

      // Group by date for the chart
      const byDateMap = new Map<string, { date: string; hits: number; total: number; hitRate: number }>();
      for (const row of rows) {
        const existing = byDateMap.get(row.gameDate) ?? { date: row.gameDate, hits: 0, total: 0, hitRate: 0 };
        existing.total += 1;
        if (row.result === "hit") existing.hits += 1;
        existing.hitRate = Math.round((existing.hits / existing.total) * 100);
        byDateMap.set(row.gameDate, existing);
      }

      const byDate = Array.from(byDateMap.values())
        .sort((a, b) => a.date.localeCompare(b.date));

      return {
        period: input.period,
        totalPlays: total,
        hits,
        misses,
        hitRate,
        moneyHitRate: hitRate, // same — all rows are money picks
        allPlaysHitRate: 0,    // not tracked here
        byDate,
      };
    }),

  /**
   * Get detailed results for a specific date (money picks only).
   */
  getResultsByDate: publicProcedure
    .input(z.object({
      date: z.string(), // YYYY-MM-DD
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { date: input.date, plays: [], hits: 0, misses: 0, pending: 0, total: 0, hitRate: 0 };

      const rows = await db.select()
        .from(dailyResults)
        .where(
          and(
            eq(dailyResults.gameDate, input.date),
            eq(dailyResults.source, "money"),
            sql`${dailyResults.result} != 'ppd'`  // exclude postponed
          )
        )
        .orderBy(desc(dailyResults.probability));

      const settled = rows.filter(r => r.result !== 'pending');
      return {
        date: input.date,
        plays: rows,
        hits: rows.filter(r => r.result === "hit").length,
        misses: rows.filter(r => r.result === "miss").length,
        pending: rows.filter(r => r.result === "pending").length,
        total: rows.length,
        hitRate: settled.length > 0
          ? Math.round((rows.filter(r => r.result === "hit").length / settled.length) * 100)
          : 0,
      };
    }),

  /**
   * Rolling 7-day performance stats with ROI tracking.
   * Scoped to money picks only.
   */
  getSevenDayStats: publicProcedure.query(async () => {
    const db = await getDb();
    const empty = {
      totalPlays: 0, hits: 0, misses: 0, hitRate: 0,
      moneyHitRate: 0, roi: 0, unitsWon: 0, trend: 'neutral' as 'up' | 'down' | 'neutral',
      byDay: [] as Array<{ date: string; hitRate: number; plays: number }>,
    };
    if (!db) return empty;

    const sevenDaysAgo = subtractDays(7);
    const fourteenDaysAgo = subtractDays(14);

    // Both queries scoped to money picks only (exclude pending and ppd/postponed)
    const [recentRows, prevRows] = await Promise.all([
      db.select().from(dailyResults)
        .where(and(
          gte(dailyResults.gameDate, sevenDaysAgo),
          eq(dailyResults.source, "money"),
          sql`${dailyResults.result} != 'pending'`,
          sql`${dailyResults.result} != 'ppd'`
        ))
        .orderBy(desc(dailyResults.gameDate)),
      db.select().from(dailyResults)
        .where(and(
          gte(dailyResults.gameDate, fourteenDaysAgo),
          lte(dailyResults.gameDate, sevenDaysAgo),
          eq(dailyResults.source, "money"),
          sql`${dailyResults.result} != 'pending'`,
          sql`${dailyResults.result} != 'ppd'`
        ))
        .orderBy(desc(dailyResults.gameDate)),
    ]);

    if (recentRows.length === 0) return empty;

    const hits = recentRows.filter(r => r.result === 'hit').length;
    const misses = recentRows.filter(r => r.result === 'miss').length;
    const total = hits + misses;
    const hitRate = total > 0 ? Math.round((hits / total) * 100) : 0;
    const moneyHitRate = hitRate; // all rows are money picks

    // ROI: assume -110 odds (1 unit risk = 0.909 units profit on win, -1 on loss)
    const WIN_PAYOUT = 0.909;
    const unitsWon = (hits * WIN_PAYOUT) - misses;
    const roi = total > 0 ? Math.round((unitsWon / total) * 100) : 0;

    // Trend: compare 7-day hit rate to previous 7-day hit rate
    const prevHits = prevRows.filter(r => r.result === 'hit').length;
    const prevTotal = prevRows.filter(r => r.result !== 'pending').length;
    const prevHitRate = prevTotal > 0 ? (prevHits / prevTotal) * 100 : 0;
    const trend: 'up' | 'down' | 'neutral' =
      total < 5 ? 'neutral' :
      hitRate > prevHitRate + 5 ? 'up' :
      hitRate < prevHitRate - 5 ? 'down' : 'neutral';

    // Group by day for sparkline
    const byDayMap = new Map<string, { hits: number; plays: number }>();
    for (const row of recentRows) {
      const d = byDayMap.get(row.gameDate) ?? { hits: 0, plays: 0 };
      d.plays += 1;
      if (row.result === 'hit') d.hits += 1;
      byDayMap.set(row.gameDate, d);
    }
    const byDay = Array.from(byDayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({
        date,
        hitRate: d.plays > 0 ? Math.round((d.hits / d.plays) * 100) : 0,
        plays: d.plays,
      }));

    return { totalPlays: total, hits, misses, hitRate, moneyHitRate, roi, unitsWon: Math.round(unitsWon * 100) / 100, trend, byDay };
  }),

  /**
   * Get list of dates that have stored money pick results (for calendar view).
   */
  getResultDates: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];

    const rows = await db
      .select({ gameDate: dailyResults.gameDate })
      .from(dailyResults)
      .where(eq(dailyResults.source, "money"))
      .groupBy(dailyResults.gameDate)
      .orderBy(desc(dailyResults.gameDate))
      .limit(60);

    return rows.map((r: { gameDate: string }) => r.gameDate);
  }),
});
