/**
 * tracking.ts — tRPC router for progressive results tracking.
 *
 * Exposes:
 *   tracking.getCumulativeRecord  — overall W/L/ROI since a given date
 *   tracking.getPicksHistory      — paginated list of locked picks
 *   tracking.verifyResults        — admin: trigger verification for a specific date
 *   tracking.verifyYesterday      — admin: trigger yesterday's verification
 */

import { z } from 'zod';
import { publicProcedure, protectedProcedure, router } from '../_core/trpc';
import {
  getCumulativeRecord,
  verifyResultsForDate,
  verifyYesterdayResults,
} from '../services/progressiveTrackingService';
import { getDb } from '../db';
import { picksHistory } from '../../drizzle/schema';
import { desc, eq, and, gte, lte } from 'drizzle-orm';

export const trackingRouter = router({
  /**
   * Get the cumulative W/L/ROI record.
   * Optional sinceDate (YYYY-MM-DD) to restrict the window.
   */
  getCumulativeRecord: publicProcedure
    .input(z.object({ sinceDate: z.string().optional() }))
    .query(async ({ input }) => {
      return getCumulativeRecord(input.sinceDate);
    }),

  /**
   * Get a paginated list of locked picks, optionally filtered by date range or tier.
   */
  getPicksHistory: publicProcedure
    .input(z.object({
      sinceDate: z.string().optional(),
      untilDate: z.string().optional(),
      tier: z.enum(['ELITE', 'STRONG', 'LEAN']).optional(),
      pickType: z.enum(['hrr', 'pitcher']).optional(),
      limit: z.number().min(1).max(200).default(50),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { picks: [] };

      // Build conditions array
      const conditions = [];
      if (input.sinceDate) conditions.push(gte(picksHistory.slateDate, input.sinceDate));
      if (input.untilDate) conditions.push(lte(picksHistory.slateDate, input.untilDate));
      if (input.tier) conditions.push(eq(picksHistory.tier, input.tier));
      if (input.pickType) conditions.push(eq(picksHistory.pickType, input.pickType));

      const picks = conditions.length > 0
        ? await db.select().from(picksHistory)
            .where(and(...conditions))
            .orderBy(desc(picksHistory.slateDate), desc(picksHistory.lockedAt))
            .limit(input.limit)
        : await db.select().from(picksHistory)
            .orderBy(desc(picksHistory.slateDate), desc(picksHistory.lockedAt))
            .limit(input.limit);

      return { picks };
    }),

  /**
   * Get all picks_history rows for a given slate date, split by pickType.
   * Accepts 'YYYY-MM-DD' or the special value 'yesterday' (ET timezone).
   * Returns factorBreakdown and voidReason on every row.
   */
  getResultsForDate: publicProcedure
    .input(z.object({ date: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { slateDate: input.date, hrr: [], pitcher: [] };

      // Resolve 'yesterday' to an actual YYYY-MM-DD in ET timezone
      const dateStr = input.date === 'yesterday'
        ? (() => {
            const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
            d.setDate(d.getDate() - 1);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          })()
        : input.date;

      // Select all columns — factorBreakdown and voidReason are included in the
      // full row returned by drizzle's db.select().from(picksHistory)
      const rows = await db.select().from(picksHistory)
        .where(eq(picksHistory.slateDate, dateStr))
        .orderBy(desc(picksHistory.overallScore));

      return {
        slateDate: dateStr,
        hrr: rows.filter(r => r.pickType === 'hrr'),
        pitcher: rows.filter(r => r.pickType === 'pitcher'),
      };
    }),

  /**
   * Trigger verification for a specific date (admin only).
   * Useful for backfilling or re-running after a data issue.
   */
  verifyResults: protectedProcedure
    .input(z.object({ slateDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .mutation(async ({ input }) => {
      const result = await verifyResultsForDate(input.slateDate);
      return result;
    }),

  /**
   * Trigger yesterday's verification (admin only).
   * Same as the scheduled 6 AM ET job.
   */
  verifyYesterday: protectedProcedure
    .mutation(async () => {
      const result = await verifyYesterdayResults();
      return result;
    }),
});
