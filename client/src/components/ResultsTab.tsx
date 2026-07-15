/**
 * ResultsTab_v2_tracking.tsx — REBUILT against progressive tracking (picks_history)
 *
 * Deploy this AS ResultsTab.tsx, replacing the earlier version entirely. The
 * old file called trpc.results.getYesterdayResults, trpc.history.getSevenDayStats,
 * and trpc.discipline.getEdgeHistory — none of which reflect the tracking
 * pipeline now in place. This version reads exclusively from picks_history via
 * the tracking router, the single source of truth for both HRR and pitcher
 * picks (both deduped upstream in their own pipelines before saving).
 *
 * Two sections:
 *   1. Yesterday's individual picks — HRR and Pitcher, split into sub-tabs,
 *      each showing predicted vs actual with a hit/miss/void badge.
 *   2. Cumulative record strip — running W/L/ROI, tier splits, 7-day trend,
 *      current streak, from trpc.tracking.getCumulativeRecord.
 *
 * REQUIRED NEW ROUTER PROCEDURE (add to the tracking router if not present):
 *
 *   getResultsForDate: publicProcedure
 *     .input(z.object({ date: z.string() }))  // 'YYYY-MM-DD' or 'yesterday'
 *     .query(async ({ input }) => {
 *       const dateStr = input.date === 'yesterday'
 *         ? (() => { const d = new Date(new Date().toLocaleString('en-US',
 *             { timeZone: 'America/New_York' })); d.setDate(d.getDate() - 1);
 *             return d.toISOString().slice(0, 10); })()
 *         : input.date;
 *       const rows = await db.select().from(picksHistory)
 *         .where(eq(picksHistory.slateDate, dateStr));
 *       return {
 *         slateDate: dateStr,
 *         hrr: rows.filter(r => r.pickType === 'hrr'),
 *         pitcher: rows.filter(r => r.pickType === 'pitcher'),
 *       };
 *     }),
 *
 * This mirrors the date-handling shape picksSummaryRoute already uses.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";

// ─── Types (mirror picks_history rows) ────────────────────────────────────────

interface HistoryRow {
  id: number;
  slateDate: string;
  pickType: 'hrr' | 'pitcher';
  playerId: number;
  playerName: string;
  team: string;
  opponent: string;
  propType: string;           // 'hrr' | 'strikeouts' | 'walks' etc.
  line: number;
  bookOdds: number | null;
  modelProb: number;
  edge: number | null;
  tier: 'ELITE' | 'STRONG';
  overallScore: number;
  factorBreakdown: Record<string, unknown> | null;
  lockedAt: string;
  actual: number | null;
  result: 'hit' | 'miss' | 'void' | 'pending';
  verifiedAt: string | null;
  voidReason: string | null;
}

interface CumulativeRecord {
  since: string;
  totalPicks: number;
  wins: number;
  losses: number;
  voids: number;
  pending: number;
  hitRate: number;
  roi: number;
  roiDollars: number;
  byTier: Record<string, { w: number; l: number; hitRate: number; roi: number }>;
  byType: Record<string, { w: number; l: number; hitRate: number }>;
  last7Days: Array<{ date: string; w: number; l: number; hitRate: number }>;
  currentStreak: { type: 'W' | 'L'; count: number } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hitRateColor(rate: number) {
  if (rate >= 65) return 'text-emerald-400';
  if (rate >= 50) return 'text-yellow-400';
  return 'text-red-400';
}

function hitRateBg(rate: number) {
  if (rate >= 65) return 'bg-emerald-500/10 border-emerald-500/20';
  if (rate >= 50) return 'bg-yellow-500/10 border-yellow-500/20';
  return 'bg-red-500/10 border-red-500/20';
}

function outcomeIcon(result: HistoryRow['result']) {
  if (result === 'pending') return { icon: '⏳', color: 'text-zinc-500' };
  if (result === 'hit') return { icon: '✓', color: 'text-emerald-400' };
  if (result === 'void') return { icon: '—', color: 'text-zinc-500' };
  return { icon: '✗', color: 'text-red-400' };
}

function propLabel(propType: string) {
  const labels: Record<string, string> = {
    hrr: 'H+R+RBI', hits: 'Hits', runs: 'Runs', rbi: 'RBI',
    strikeouts: 'Strikeouts', walks: 'Walks',
  };
  return labels[propType] ?? propType.toUpperCase();
}

function formatDate(dateStr: string) {
  try {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return dateStr; }
}

function formatOdds(odds: number | null) {
  if (odds === null) return '—';
  return odds > 0 ? `+${odds}` : `${odds}`;
}

// ─── Rolling 7-day strip ───────────────────────────────────────────────────────

function SevenDayStrip({ record }: { record: CumulativeRecord | null }) {
  if (!record || record.totalPicks === 0) return null;

  return (
    <div className={`rounded-2xl border p-4 ${hitRateBg(record.hitRate)}`}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Cumulative Record</p>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className={`text-3xl font-bold ${hitRateColor(record.hitRate)}`}>
              {record.hitRate.toFixed(0)}%
            </span>
            <span className="text-zinc-500 text-xs">
              {record.wins}-{record.losses}
              {record.voids > 0 && <span className="text-zinc-600"> ({record.voids} void)</span>}
            </span>
          </div>
          <p className="text-[10px] text-zinc-600 mt-0.5">Since {formatDate(record.since)}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest">ROI</p>
          <p className={`text-xl font-bold ${record.roi >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {record.roi >= 0 ? '+' : ''}{record.roi.toFixed(1)}%
          </p>
          {record.currentStreak && (
            <p className={`text-[10px] mt-0.5 ${record.currentStreak.type === 'W' ? 'text-emerald-400' : 'text-red-400'}`}>
              {record.currentStreak.count}{record.currentStreak.type} streak
            </p>
          )}
        </div>
      </div>

      {record.last7Days.length > 0 && (
        <div className="flex gap-1 items-end h-8">
          {record.last7Days.map((day, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
              <div
                className={`w-full rounded-sm ${
                  day.hitRate >= 65 ? 'bg-emerald-500' :
                  day.hitRate >= 50 ? 'bg-yellow-500' :
                  day.w + day.l === 0 ? 'bg-zinc-800' : 'bg-red-500/70'
                }`}
                style={{ height: `${Math.max(4, (day.hitRate / 100) * 28)}px` }}
                title={`${formatDate(day.date)}: ${day.w}-${day.l} (${day.hitRate.toFixed(0)}%)`}
              />
              <span className="text-[8px] text-zinc-700">{formatDate(day.date).split(' ')[1]}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-3 mt-3 pt-3 border-t border-white/8">
        {Object.entries(record.byTier).map(([tier, stats]) => (
          <div key={tier} className="flex-1 text-center">
            <p className="text-[9px] text-zinc-600 uppercase">{tier}</p>
            <p className={`text-sm font-bold ${hitRateColor(stats.hitRate)}`}>{stats.hitRate.toFixed(0)}%</p>
            <p className="text-[9px] text-zinc-600">{stats.w}-{stats.l}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Individual pick card ──────────────────────────────────────────────────────

function PickResultCard({ row }: { row: HistoryRow }) {
  const outcome = outcomeIcon(row.result);
  const isPitcher = row.pickType === 'pitcher';

  return (
    <div className={`rounded-xl border p-3 ${
      row.result === 'hit' ? 'border-emerald-500/20 bg-emerald-500/5' :
      row.result === 'miss' ? 'border-red-500/15 bg-red-500/5' :
      row.result === 'void' ? 'border-zinc-600/20 bg-zinc-500/5' :
      'border-white/8 bg-white/3'
    }`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-base font-bold ${outcome.color}`}>{outcome.icon}</span>
            <div>
              <div className="flex items-center gap-1.5">
                <p className="text-white text-sm font-semibold leading-tight">{row.playerName}</p>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                  row.tier === 'ELITE' ? 'text-yellow-400 bg-yellow-500/10' : 'text-purple-400 bg-purple-500/10'
                }`}>
                  {row.tier}
                </span>
              </div>
              <p className="text-zinc-500 text-[10px]">
                {row.team} vs {row.opponent} · {formatDate(row.slateDate)}
              </p>
            </div>
          </div>
        </div>

        <div className="text-right shrink-0">
          <div className="flex items-center gap-1.5 justify-end">
            <span className="text-zinc-500 text-xs">O{row.line}</span>
            <span className="text-zinc-600 text-xs">{propLabel(row.propType)}</span>
          </div>
          {row.actual !== null ? (
            <p className={`text-sm font-bold mt-0.5 ${
              row.result === 'hit' ? 'text-emerald-400' : row.result === 'miss' ? 'text-red-400' : 'text-zinc-500'
            }`}>
              Actual: {row.actual}
            </p>
          ) : row.result === 'void' ? (
            <p className="text-xs text-zinc-500 mt-0.5">{row.voidReason ?? 'Voided'}</p>
          ) : (
            <p className="text-xs text-zinc-600 mt-0.5">Pending</p>
          )}
          {row.bookOdds !== null && (
            <p className="text-[10px] text-zinc-600 mt-0.5">{formatOdds(row.bookOdds)}</p>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <span className="text-[9px] text-zinc-700 w-14">{isPitcher ? 'Model' : 'Score'}</span>
        <div className="flex-1 h-1 bg-white/8 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${
              row.modelProb >= 75 ? 'bg-emerald-500' :
              row.modelProb >= 60 ? 'bg-blue-400' : 'bg-zinc-500'
            }`}
            style={{ width: `${Math.min(100, row.modelProb)}%` }}
          />
        </div>
        <span className="text-[9px] text-zinc-600 w-10 text-right">{row.modelProb.toFixed(0)}%</span>
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ type }: { type: 'hrr' | 'pitcher' }) {
  return (
    <div className="rounded-xl border border-white/6 bg-white/2 p-6 text-center">
      <p className="text-zinc-500 text-sm font-medium mb-1">
        No {type === 'hrr' ? 'HRR' : 'Pitcher'} Picks Locked
      </p>
      <p className="text-zinc-700 text-xs leading-relaxed max-w-[220px] mx-auto">
        {type === 'hrr'
          ? 'No HRR picks reached ELITE or STRONG tier on this slate.'
          : 'No pitcher picks reached ELITE or STRONG tier on this slate.'}
      </p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type SubTab = 'hrr' | 'pitcher';

export default function ResultsTab() {
  const [activeTab, setActiveTab] = useState<SubTab>('hrr');

  const { data: dayData, isLoading: dayLoading, refetch } =
    trpc.tracking.getResultsForDate.useQuery(
      { date: 'yesterday' },
      { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false }
    );

  const { data: record } = trpc.tracking.getCumulativeRecord.useQuery({}, {
    staleTime: 10 * 60 * 1000,
  });

  // Drizzle returns pickType as string; cast via unknown to narrow to 'hrr' | 'pitcher'
  const hrrRows = (dayData?.hrr ?? []) as unknown as HistoryRow[];
  const pitcherRows = (dayData?.pitcher ?? []) as unknown as HistoryRow[];

  const hrrSettled = hrrRows.filter(r => r.result === 'hit' || r.result === 'miss');
  const hrrHits = hrrSettled.filter(r => r.result === 'hit').length;
  const hrrHitRate = hrrSettled.length ? (hrrHits / hrrSettled.length) * 100 : null;

  const pitcherSettled = pitcherRows.filter(r => r.result === 'hit' || r.result === 'miss');
  const pitcherHits = pitcherSettled.filter(r => r.result === 'hit').length;
  const pitcherHitRate = pitcherSettled.length ? (pitcherHits / pitcherSettled.length) * 100 : null;

  const activeRows = activeTab === 'hrr' ? hrrRows : pitcherRows;
  const orderedRows = [
    ...activeRows.filter(r => r.result === 'hit'),
    ...activeRows.filter(r => r.result === 'miss'),
    ...activeRows.filter(r => r.result === 'void'),
    ...activeRows.filter(r => r.result === 'pending'),
  ];

  return (
    <div className="flex flex-col h-full overflow-y-auto pb-28">

      <div className="px-4 pt-4 pb-3 flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-white font-bold text-base">Results</h2>
          <p className="text-zinc-600 text-[10px] mt-0.5">
            {dayData?.slateDate ? formatDate(dayData.slateDate) : 'Yesterday'} · Verified against real box scores
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="text-[10px] text-zinc-500 bg-white/4 px-3 py-1.5 rounded-xl border border-white/8"
        >
          ↻ Refresh
        </button>
      </div>

      <div className="px-4 mb-4">
        <SevenDayStrip record={record ?? null} />
      </div>

      <div className="px-4 mb-4 shrink-0">
        <div className="grid grid-cols-2 gap-2 bg-white/4 rounded-xl p-1">
          <button
            onClick={() => setActiveTab('hrr')}
            className={`py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'hrr' ? 'bg-[oklch(0.55_0.25_280)] text-white' : 'text-zinc-500'
            }`}
          >
            💰 HRR
            {hrrHitRate !== null && (
              <span className={`ml-1.5 font-bold ${hitRateColor(hrrHitRate)}`}>{hrrHitRate.toFixed(0)}%</span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('pitcher')}
            className={`py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'pitcher' ? 'bg-[oklch(0.40_0.20_280)] text-white' : 'text-zinc-500'
            }`}
          >
            ⚾ Pitcher
            {pitcherHitRate !== null && (
              <span className={`ml-1.5 font-bold ${hitRateColor(pitcherHitRate)}`}>{pitcherHitRate.toFixed(0)}%</span>
            )}
          </button>
        </div>
      </div>

      <div className="px-4 space-y-3 flex-1">
        {dayLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <div key={i} className="h-20 bg-white/4 rounded-xl animate-pulse" />)}
          </div>
        ) : orderedRows.length === 0 ? (
          <EmptyState type={activeTab} />
        ) : (
          <div className="space-y-2">
            {orderedRows.map(row => <PickResultCard key={row.id} row={row} />)}
          </div>
        )}

        <div className="rounded-xl border border-white/6 bg-white/2 p-3">
          <p className="text-[10px] text-zinc-600 leading-relaxed">
            Only ELITE and STRONG tier picks are tracked. Voided picks (player scratched
            after lock) do not count as misses. Results verify against real MLB box scores
            each morning at 6 AM ET.
          </p>
        </div>
      </div>

      <p className="text-center text-[10px] text-zinc-700 px-4 py-4">
        Diamond Edge is for informational purposes only. Please gamble responsibly.
      </p>
    </div>
  );
}
