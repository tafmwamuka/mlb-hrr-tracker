/**
 * closingLinePoller.ts
 *
 * Captures the second data point CLV tracking requires: the odds at game
 * time, compared against the odds already frozen at lock (bookOdds in
 * picks_history, written by saveLockedPick).
 *
 * Without this, clvTrackingService.ts has nothing to compute — CLV is
 * (closing implied prob - locked implied prob), and only the locked side
 * currently exists.
 *
 * Runs on a schedule, not on request: polls the odds API for any pick
 * currently pending whose game starts within the next ~12 minutes, writes
 * the current odds to picks_history.closingOdds, and never overwrites a
 * value that's already been captured.
 *
 * Location: server/services/closingLinePoller.ts
 * Schema requirement: picks_history.closingOdds (int, nullable) ✓ added in migration 0015
 *                     picks_history.gameTime (datetime, nullable) ✓ added in migration 0015
 */

import { getDb } from '../db';
import { picksHistory } from '../../drizzle/schema';
import { and, eq, isNull, isNotNull, lte, gte } from 'drizzle-orm';
import {
  fetchOddsForPicks,
  americanToImpliedProbability,
  type HRRMarketData,
} from './oddsApiService';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PendingClosingLinePick {
  id: number;
  slateDate: string;
  playerId: number;
  playerName: string;
  team: string;
  opponent: string;
  gamePk: number;
  propType: string;
  line: number;
  pickType: 'hrr' | 'pitcher';
  gameTime: Date | null;
}

interface OddsLookupResult {
  bookOdds: number | null;
  found: boolean;
}

// ─── Odds lookup ──────────────────────────────────────────────────────────────

/**
 * Fetch the current odds for a specific player/prop/line combination.
 *
 * Reuses fetchOddsForPicks() from oddsApiService — the same function that
 * powers the live HRR pipeline — so rate limits and the shared cache stay
 * consistent. We pass a single-element array and look up the result by
 * playerName.
 *
 * For pitcher picks the market is strikeouts/walks, which are not in the
 * HRR market data. We return { found: false } for those — the pitcher
 * pipeline will need its own odds lookup once pitcher prop markets are
 * integrated. This is a known gap, not a bug.
 */
async function fetchCurrentOdds(pick: PendingClosingLinePick): Promise<OddsLookupResult> {
  // Pitcher prop markets (strikeouts, walks) are not in the HRR odds feed.
  // Skip gracefully — no error, just not found.
  if (pick.pickType === 'pitcher') {
    return { bookOdds: null, found: false };
  }

  try {
    const oddsMap: Map<string, HRRMarketData> = await fetchOddsForPicks(
      [{ playerName: pick.playerName, team: pick.team }]
    );

    const marketData = oddsMap.get(pick.playerName);
    if (!marketData) {
      return { bookOdds: null, found: false };
    }

    // Use featuredOverOdds as the closing line price.
    // If the featured line is unavailable, fall back to the best over odds
    // across all books for the featured line.
    const odds =
      marketData.featuredOverOdds ??
      marketData.bestOverOdds?.odds ??
      null;

    if (odds === null) {
      return { bookOdds: null, found: false };
    }

    return { bookOdds: odds, found: true };
  } catch (e) {
    console.warn(
      `[ClosingLine] Odds lookup failed for ${pick.playerName} (${pick.propType} ${pick.line}):`,
      e
    );
    return { bookOdds: null, found: false };
  }
}

// ─── Main poll cycle ──────────────────────────────────────────────────────────

/**
 * Find picks whose game starts within the next windowMinutesAhead minutes
 * and that don't have a closing line yet.
 *
 * Option A (per brief): gameTime column on picks_history — populated by
 * saveLockedPick at lock time. This avoids a runtime join against the games
 * table and mirrors how lockedAt already exists on the row.
 *
 * The window is [now - 2min, now + windowMinutesAhead] to catch picks whose
 * game started very recently (within the last 2 minutes) in case the poller
 * fired slightly late.
 */
async function getPicksNeedingClosingLine(
  windowMinutesAhead: number = 12,
): Promise<PendingClosingLinePick[]> {
  const db = await getDb();
  if (!db) {
    console.warn('[ClosingLine] Database not available');
    return [];
  }

  try {
    const now = new Date();
    const windowStart = new Date(now.getTime() - 2 * 60 * 1000);      // 2 min ago
    const windowEnd = new Date(now.getTime() + windowMinutesAhead * 60 * 1000);

    const rows = await db
      .select()
      .from(picksHistory)
      .where(
        and(
          isNull(picksHistory.closingOdds),           // not yet captured
          eq(picksHistory.result, 'pending'),          // game not yet graded
          isNotNull(picksHistory.gameTime),            // gameTime must be set
          gte(picksHistory.gameTime, windowStart),     // game starts after window start
          lte(picksHistory.gameTime, windowEnd),       // game starts before window end
        )
      );

    return rows as unknown as PendingClosingLinePick[];
  } catch (e) {
    console.error('[ClosingLine] Failed to query pending picks:', e);
    return [];
  }
}

/**
 * Run one polling cycle: find eligible picks, fetch current odds, write
 * closingOdds. Never overwrites an existing closingOdds value (idempotent).
 */
export async function pollClosingLines(): Promise<{
  checked: number;
  captured: number;
  failed: number;
}> {
  const db = await getDb();
  if (!db) {
    console.warn('[ClosingLine] Database not available — skipping cycle');
    return { checked: 0, captured: 0, failed: 0 };
  }

  const pending = await getPicksNeedingClosingLine();

  if (pending.length === 0) {
    // Normal: no games starting in the next 12 minutes
    return { checked: 0, captured: 0, failed: 0 };
  }

  let captured = 0;
  let failed = 0;

  for (const pick of pending) {
    const result = await fetchCurrentOdds(pick);

    if (!result.found || result.bookOdds === null) {
      // Not found is expected for pitcher picks and players without a market.
      // Only count as failed if it was an HRR pick (where we expect a result).
      if (pick.pickType === 'hrr') failed++;
      continue;
    }

    try {
      await db
        .update(picksHistory)
        .set({ closingOdds: result.bookOdds })
        .where(
          and(
            eq(picksHistory.id, pick.id),
            isNull(picksHistory.closingOdds), // idempotent — race-safe against re-runs
          )
        );
      captured++;
      console.log(
        `[ClosingLine] Captured ${pick.playerName} ${pick.propType} ${pick.line}` +
        ` → ${result.bookOdds > 0 ? '+' : ''}${result.bookOdds}` +
        ` (game: ${pick.gameTime?.toISOString() ?? 'N/A'})`
      );
    } catch (e) {
      console.error(`[ClosingLine] Write failed for pick ${pick.id}:`, e);
      failed++;
    }

    // Gentle on the odds API — small delay between lookups
    await new Promise(r => setTimeout(r, 150));
  }

  console.log(
    `[ClosingLine] Poll cycle: ${pending.length} checked, ${captured} captured, ${failed} failed`
  );
  return { checked: pending.length, captured, failed };
}
