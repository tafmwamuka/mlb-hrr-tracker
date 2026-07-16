/**
 * progressiveTrackingService.ts — PHASE 1
 *
 * Progressive results tracking: cumulative record, tier splits,
 * HRR vs Pitcher splits, ROI, and automated verification against
 * real MLB box scores.
 *
 * Location: server/services/progressiveTrackingService.ts
 *
 * Requires a picks_history table (added to drizzle/schema.ts — Option B).
 * Scheduled job: call verifyYesterdayResults() every morning at 6 AM ET.
 */

import { getDb } from '../db';
import { picksHistory } from '../../drizzle/schema';
import { eq, and, gte } from 'drizzle-orm';

const MLB_API = 'https://statsapi.mlb.com/api/v1';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LockedPickRecord {
  id?: number;
  slateDate: string;            // YYYY-MM-DD
  pickType: 'hrr' | 'pitcher';
  playerId: number;
  playerName: string;
  team: string;
  opponent: string;
  gamePk: number;
  propType: 'hits' | 'runs' | 'rbi' | 'hrr' | 'strikeouts' | 'walks';
  line: number;
  bookOdds: number | null;      // frozen at lock
  modelProb: number;            // frozen at lock (0-100)
  edge: number | null;          // frozen at lock
  tier: 'ELITE' | 'STRONG' | 'LEAN';
  overallScore: number;
  lockedAt: string;             // ISO
  gameTime?: string | null;      // ISO — first pitch time; used by closingLinePoller
  // Result fields (filled by verification job)
  actual: number | null;
  result: 'hit' | 'miss' | 'void' | 'pending';
  verifiedAt: string | null;
  voidReason: string | null;
  // 7-factor breakdown persisted for weight-validation analysis
  factorBreakdown?: Record<string, unknown>;
}

export interface CumulativeRecord {
  since: string;
  totalPicks: number;
  wins: number;
  losses: number;
  voids: number;
  pending: number;
  hitRate: number;              // wins / (wins+losses), voids excluded
  roi: number;                  // flat $100 per pick
  roiDollars: number;
  byTier: Record<string, { w: number; l: number; hitRate: number; roi: number }>;
  byType: Record<string, { w: number; l: number; hitRate: number }>;
  byProp: Record<string, { w: number; l: number; hitRate: number }>;
  last7Days: Array<{ date: string; w: number; l: number; hitRate: number }>;
  currentStreak: { type: 'W' | 'L'; count: number } | null;
}

// ─── Save locked picks (call when lock stage → LOCKED) ───────────────────────

export async function saveLockedPick(pick: LockedPickRecord): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn('[Tracking] saveLockedPick: database not available');
    return;
  }
  try {
    await db.insert(picksHistory).values({
      slateDate: pick.slateDate,
      pickType: pick.pickType,
      playerId: pick.playerId,
      playerName: pick.playerName,
      team: pick.team,
      opponent: pick.opponent,
      gamePk: pick.gamePk,
      propType: pick.propType,
      line: pick.line,
      bookOdds: pick.bookOdds,
      modelProb: pick.modelProb,
      edge: pick.edge,
      tier: pick.tier,
      overallScore: pick.overallScore,
      lockedAt: new Date(pick.lockedAt),
      gameTime: pick.gameTime ? new Date(pick.gameTime) : null,
      actual: null,
      result: 'pending',
      verifiedAt: null,
      voidReason: null,
      factorBreakdown: pick.factorBreakdown ? JSON.stringify(pick.factorBreakdown) : null,
    }).onDuplicateKeyUpdate({
      set: {
        lockedAt: new Date(pick.lockedAt),
        factorBreakdown: pick.factorBreakdown ? JSON.stringify(pick.factorBreakdown) : null,
      },
    });
  } catch (e) {
    console.error('[Tracking] saveLockedPick failed:', e);
  }
}

// ─── Verification against real box scores ────────────────────────────────────

async function fetchBoxscoreStat(
  gamePk: number,
  playerId: number,
): Promise<{ hits: number; runs: number; rbi: number; strikeouts: number; walks: number } | null> {
  try {
    const res = await fetch(`${MLB_API}/game/${gamePk}/boxscore`);
    if (!res.ok) return null;
    const box = await res.json();

    for (const side of ['home', 'away']) {
      const players = box?.teams?.[side]?.players ?? {};
      const key = `ID${playerId}`;
      const p = players[key];
      if (!p) continue;

      const bat = p.stats?.batting ?? {};
      const pit = p.stats?.pitching ?? {};
      return {
        hits: bat.hits ?? 0,
        runs: bat.runs ?? 0,
        rbi: bat.rbi ?? 0,
        strikeouts: pit.strikeOuts ?? 0,   // pitcher K's
        walks: pit.baseOnBalls ?? 0,        // pitcher BB's induced
      };
    }
    return null;
  } catch {
    return null;
  }
}

function actualForProp(
  stats: { hits: number; runs: number; rbi: number; strikeouts: number; walks: number },
  propType: LockedPickRecord['propType'],
): number {
  switch (propType) {
    case 'hits': return stats.hits;
    case 'runs': return stats.runs;
    case 'rbi': return stats.rbi;
    case 'hrr': return stats.hits + stats.runs + stats.rbi;
    case 'strikeouts': return stats.strikeouts;
    case 'walks': return stats.walks;
  }
}

/** Verify all pending picks for a given date. Run daily at 6 AM ET for yesterday. */
export async function verifyResultsForDate(slateDate: string): Promise<{ verified: number; hits: number; misses: number; voids: number }> {
  const db = await getDb();
  if (!db) {
    console.warn('[Tracking] verifyResultsForDate: database not available');
    return { verified: 0, hits: 0, misses: 0, voids: 0 };
  }

  const pending = await db.select().from(picksHistory).where(
    and(eq(picksHistory.slateDate, slateDate), eq(picksHistory.result, 'pending'))
  );

  let hits = 0, misses = 0, voids = 0;

  for (const pick of pending as any[]) {
    const stats = await fetchBoxscoreStat(pick.gamePk, pick.playerId);

    if (!stats) {
      // Player not in boxscore → scratched/DNP → VOID (never a miss)
      await db.update(picksHistory)
        .set({ result: 'void', voidReason: 'Player did not appear in game', verifiedAt: new Date() })
        .where(eq(picksHistory.id, pick.id));
      voids++;
      continue;
    }

    const actual = actualForProp(stats, pick.propType);
    const hit = actual > pick.line; // OVER props: strictly greater than the .5 line

    await db.update(picksHistory)
      .set({ actual, result: hit ? 'hit' : 'miss', verifiedAt: new Date() })
      .where(eq(picksHistory.id, pick.id));

    hit ? hits++ : misses++;
    await new Promise(r => setTimeout(r, 60)); // gentle on MLB API
  }

  console.log(`[Tracking] Verified ${slateDate}: ${hits}W ${misses}L ${voids}V`);
  return { verified: pending.length, hits, misses, voids };
}

export async function verifyYesterdayResults() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  d.setDate(d.getDate() - 1);
  const y = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return verifyResultsForDate(y);
}

// ─── ROI helper ───────────────────────────────────────────────────────────────

function profitOn100(odds: number | null, won: boolean): number {
  if (!won) return -100;
  if (odds === null) return 90; // assume ~-110 when no odds recorded
  return odds > 0 ? odds : (100 / Math.abs(odds)) * 100;
}

// ─── Cumulative record ────────────────────────────────────────────────────────

export async function getCumulativeRecord(sinceDate?: string): Promise<CumulativeRecord> {
  const db = await getDb();
  if (!db) {
    // Return empty record when DB unavailable
    return {
      since: sinceDate ?? '',
      totalPicks: 0, wins: 0, losses: 0, voids: 0, pending: 0,
      hitRate: 0, roi: 0, roiDollars: 0,
      byTier: {}, byType: {}, byProp: {},
      last7Days: [], currentStreak: null,
    };
  }

  const rows: any[] = sinceDate
    ? await db.select().from(picksHistory).where(gte(picksHistory.slateDate, sinceDate))
    : await db.select().from(picksHistory);

  const settled = rows.filter(r => r.result === 'hit' || r.result === 'miss');
  const wins = settled.filter(r => r.result === 'hit').length;
  const losses = settled.length - wins;
  const voids = rows.filter(r => r.result === 'void').length;
  const pending = rows.filter(r => r.result === 'pending').length;

  const roiDollars = settled.reduce((sum, r) => sum + profitOn100(r.bookOdds, r.result === 'hit'), 0);
  const staked = settled.length * 100;

  const bucket = (keyFn: (r: any) => string) => {
    const out: Record<string, { w: number; l: number; hitRate: number; roi: number }> = {};
    for (const r of settled) {
      const k = keyFn(r);
      out[k] ??= { w: 0, l: 0, hitRate: 0, roi: 0 };
      r.result === 'hit' ? out[k].w++ : out[k].l++;
      out[k].roi += profitOn100(r.bookOdds, r.result === 'hit');
    }
    for (const k of Object.keys(out)) {
      const t = out[k].w + out[k].l;
      out[k].hitRate = t ? Math.round((out[k].w / t) * 1000) / 10 : 0;
      out[k].roi = Math.round(out[k].roi);
    }
    return out;
  };

  // Last 7 days
  const byDate = new Map<string, { w: number; l: number }>();
  for (const r of settled) {
    const e = byDate.get(r.slateDate) ?? { w: 0, l: 0 };
    r.result === 'hit' ? e.w++ : e.l++;
    byDate.set(r.slateDate, e);
  }
  const last7Days = Array.from(byDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-7)
    .map(([date, v]) => ({ date, w: v.w, l: v.l, hitRate: v.w + v.l ? Math.round((v.w / (v.w + v.l)) * 1000) / 10 : 0 }));

  // Current streak (by settlement order)
  const ordered = [...settled].sort((a, b) => String(b.verifiedAt).localeCompare(String(a.verifiedAt)));
  let currentStreak: CumulativeRecord['currentStreak'] = null;
  if (ordered.length) {
    const type = ordered[0].result === 'hit' ? 'W' : 'L';
    let count = 0;
    for (const r of ordered) {
      if ((r.result === 'hit' ? 'W' : 'L') === type) count++;
      else break;
    }
    currentStreak = { type: type as 'W' | 'L', count };
  }

  return {
    since: sinceDate ?? (rows.length ? rows.reduce((m, r) => r.slateDate < m ? r.slateDate : m, rows[0].slateDate) : ''),
    totalPicks: rows.length,
    wins, losses, voids, pending,
    hitRate: settled.length ? Math.round((wins / settled.length) * 1000) / 10 : 0,
    roi: staked ? Math.round((roiDollars / staked) * 1000) / 10 : 0,
    roiDollars: Math.round(roiDollars),
    byTier: bucket(r => r.tier),
    byType: bucket(r => r.pickType) as any,
    byProp: bucket(r => r.propType) as any,
    last7Days,
    currentStreak,
  };
}
