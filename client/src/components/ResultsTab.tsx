/**
 * ResultsTab.tsx — IMPROVED (Phase CN)
 *
 * Two sections:
 *   1. HRR Money Picks results (existing, improved UI)
 *   2. Pitcher Edge Picks results (NEW — tracks K/BB prop outcomes)
 *
 * Key improvements:
 *   - Separate pitcher results section with OVER/UNDER outcome
 *   - Hit rate shown separately for batter picks vs pitcher picks
 *   - Real outcome display: predicted vs actual
 *   - Rolling 7-day performance strip at top
 *   - Empty states that explain WHY there are no results yet
 *
 * Field name mapping (API → UI):
 *   getSevenDayStats: totalPlays → totalPicks, byDay → dailyBreakdown, byDay[].plays → picks
 *   getEdgeHistory: result ('hit'|'miss'|'pending') → hit (boolean|null), pitcherTeam → team,
 *                   opponentTeam → opponent, gameDate → date, projection → modelProbability,
 *                   no tier field (derive from tms), no edge field (derive from projection vs line)
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";

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

function outcomeIcon(hit: boolean | null) {
  if (hit === null) return { icon: '⏳', color: 'text-zinc-500' };
  if (hit) return { icon: '✓', color: 'text-emerald-400' };
  return { icon: '✗', color: 'text-red-400' };
}

function statLabel(stat: string) {
  const labels: Record<string, string> = {
    hits: 'Hits', runs: 'Runs', rbi: 'RBI', hrr: 'H+R+RBI',
    strikeouts: 'Strikeouts', walks: 'Walks',
  };
  return labels[stat] ?? stat.toUpperCase();
}

function formatDate(dateStr: string) {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return dateStr; }
}

/** Derive a tier label from TMS score (no tier field in DB schema) */
function tmsToTier(tms: number | null | undefined): string {
  if (tms == null) return 'LEAN';
  if (tms >= 75) return 'ELITE';
  if (tms >= 60) return 'OFFICIAL';
  return 'LEAN';
}

/** Derive edge from projection vs line */
function calcEdge(projection: number | null | undefined, line: number | null | undefined): number {
  if (projection == null || line == null) return 0;
  return Math.max(0, projection - line);
}

// ─── Rolling 7-day strip ─────────────────────────────────────────────────────

interface SevenDayData {
  totalPlays: number;
  hits: number;
  hitRate: number;
  roi: number;
  trend: 'up' | 'down' | 'neutral';
  byDay: Array<{ date: string; hitRate: number; plays: number }>;
}

function SevenDayStrip({ stats }: { stats: SevenDayData | null | undefined }) {
  if (!stats || stats.totalPlays === 0) return null;

  const hitRate = stats.hitRate;

  return (
    <div className={`rounded-2xl border p-4 ${hitRateBg(hitRate)}`}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest">7-Day Performance</p>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className={`text-3xl font-bold ${hitRateColor(hitRate)}`}>
              {hitRate.toFixed(0)}%
            </span>
            <span className="text-zinc-500 text-xs">
              {stats.hits}/{stats.totalPlays} picks hit
            </span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest">ROI</p>
          <p className={`text-xl font-bold ${stats.roi >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {stats.roi >= 0 ? '+' : ''}{stats.roi.toFixed(1)}%
          </p>
        </div>
      </div>

      {stats.byDay.length > 0 && (
        <div className="flex gap-1 items-end h-8">
          {stats.byDay.slice(-7).map((day, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
              <div
                className={`w-full rounded-sm transition-all ${
                  day.hitRate >= 65 ? 'bg-emerald-500' :
                  day.hitRate >= 50 ? 'bg-yellow-500' :
                  day.plays === 0 ? 'bg-zinc-800' : 'bg-red-500/70'
                }`}
                style={{ height: `${Math.max(4, (day.hitRate / 100) * 28)}px` }}
                title={`${formatDate(day.date)}: ${day.plays} picks (${day.hitRate.toFixed(0)}%)`}
              />
              <span className="text-[8px] text-zinc-700">{formatDate(day.date).split(' ')[1]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Batter result card ───────────────────────────────────────────────────────

interface PickResult {
  id: number;
  playerName: string;
  team: string;
  stat: 'hits' | 'runs' | 'rbi' | 'hrr';
  line: string;
  actualValue: number | null;
  hit: boolean | null;
  confidence: number;
  matrixScore: number | null;
  tier: string | null;
  odds: string | null;
  streakLabel: string | null;
}

function BatterResultCard({ result }: { result: PickResult }) {
  const outcome = outcomeIcon(result.hit);
  const score = result.matrixScore ?? 0;

  return (
    <div className={`rounded-xl border p-3 ${
      result.hit === true ? 'border-emerald-500/20 bg-emerald-500/5' :
      result.hit === false ? 'border-red-500/15 bg-red-500/5' :
      'border-white/8 bg-white/3'
    }`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-base font-bold ${outcome.color}`}>{outcome.icon}</span>
            <div>
              <p className="text-white text-sm font-semibold leading-tight">{result.playerName}</p>
              <p className="text-zinc-500 text-[10px]">
                {result.team} · {statLabel(result.stat)}
              </p>
            </div>
          </div>
        </div>

        <div className="text-right shrink-0">
          <div className="flex items-center gap-1.5 justify-end">
            <span className="text-zinc-500 text-xs">O{result.line}</span>
            <span className="text-zinc-600 text-xs">{statLabel(result.stat)}</span>
          </div>
          <div className="flex items-center gap-1.5 justify-end mt-0.5">
            {result.actualValue !== null ? (
              <span className={`text-sm font-bold ${result.hit ? 'text-emerald-400' : 'text-red-400'}`}>
                Actual: {result.actualValue}
              </span>
            ) : (
              <span className="text-zinc-600 text-xs">Pending</span>
            )}
          </div>
          {result.odds && (
            <p className="text-[10px] text-zinc-600 mt-0.5">{result.odds}</p>
          )}
        </div>
      </div>

      {score > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[9px] text-zinc-700 w-12">Score</span>
          <div className="flex-1 h-1 bg-white/8 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${
                score >= 85 ? 'bg-emerald-500' :
                score >= 78 ? 'bg-blue-400' : 'bg-zinc-500'
              }`}
              style={{ width: `${score}%` }}
            />
          </div>
          <span className="text-[9px] text-zinc-600 w-6 text-right">{score}</span>
        </div>
      )}
    </div>
  );
}

// ─── Pitcher result card ──────────────────────────────────────────────────────

interface PitcherEdgeRow {
  id: number;
  gameDate: string;
  pitcherName: string;
  pitcherTeam: string;
  opponentTeam: string;
  propType: string;
  line: number | null;
  projection: number | null;
  result: string;
  actualValue: number | null;
  tms: number | null;
  disciplineGrade: string | null;
}

function PitcherResultCard({ row }: { row: PitcherEdgeRow }) {
  const hit: boolean | null =
    row.result === 'hit' ? true :
    row.result === 'miss' ? false : null;
  const outcome = outcomeIcon(hit);
  const tier = tmsToTier(row.tms);
  const edge = calcEdge(row.projection, row.line);

  const tierColor =
    tier === 'ELITE' ? 'text-yellow-400 bg-yellow-500/10 border-yellow-500/25' :
    tier === 'OFFICIAL' ? 'text-purple-400 bg-purple-500/10 border-purple-500/20' :
    'text-blue-300 bg-blue-500/8 border-blue-500/15';

  return (
    <div className={`rounded-xl border p-3 ${
      hit === true ? 'border-emerald-500/20 bg-emerald-500/5' :
      hit === false ? 'border-red-500/15 bg-red-500/5' :
      'border-white/8 bg-white/3'
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`text-base font-bold ${outcome.color}`}>{outcome.icon}</span>
            <span className="text-white text-sm font-semibold">{row.pitcherName}</span>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${tierColor}`}>
              {tier}
            </span>
          </div>
          <p className="text-zinc-500 text-[10px] ml-6">
            {row.pitcherTeam} vs {row.opponentTeam} · {formatDate(row.gameDate)}
          </p>

          <div className="ml-6 mt-1.5 flex items-center gap-3">
            {row.line != null && (
              <span className="text-zinc-400 text-xs">
                O{row.line} {statLabel(row.propType)}
              </span>
            )}
            {row.projection != null && (
              <span className="text-zinc-600 text-[10px]">
                Model: {row.projection.toFixed(1)}
              </span>
            )}
            {edge > 0 && (
              <span className="text-emerald-400 text-[10px]">+{edge.toFixed(1)} edge</span>
            )}
          </div>
        </div>

        <div className="text-right shrink-0">
          {row.actualValue != null ? (
            <div>
              <p className={`text-sm font-bold ${hit ? 'text-emerald-400' : 'text-red-400'}`}>
                {row.actualValue} {row.propType === 'strikeouts' ? 'K' : 'BB'}
              </p>
              <p className="text-[10px] text-zinc-600">
                {hit ? 'Hit ✓' : 'Miss ✗'}
              </p>
            </div>
          ) : (
            <p className="text-zinc-600 text-xs">Pending</p>
          )}
          {row.disciplineGrade && (
            <p className={`text-[10px] font-bold mt-1 ${
              row.disciplineGrade.startsWith('A') ? 'text-emerald-400' :
              row.disciplineGrade === 'B' ? 'text-blue-300' : 'text-zinc-400'
            }`}>
              Grade: {row.disciplineGrade}
            </p>
          )}
        </div>
      </div>

      {row.tms != null && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[9px] text-zinc-700 w-8">TMS</span>
          <div className="flex-1 h-1 bg-white/8 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${
                row.tms >= 75 ? 'bg-emerald-500' :
                row.tms >= 60 ? 'bg-blue-400' : 'bg-zinc-500'
              }`}
              style={{ width: `${row.tms}%` }}
            />
          </div>
          <span className="text-[9px] text-zinc-600 w-6 text-right">{row.tms}</span>
        </div>
      )}
    </div>
  );
}

// ─── Section header with hit rate ────────────────────────────────────────────

function SectionHeader({
  title, subtitle, hitRate, picks, hits,
}: {
  title: string; subtitle: string; hitRate: number | null; picks: number; hits: number;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h3 className="text-white font-bold text-sm">{title}</h3>
        <p className="text-zinc-600 text-[10px]">{subtitle}</p>
      </div>
      {hitRate !== null && picks > 0 && (
        <div className={`px-3 py-1.5 rounded-xl border text-center ${hitRateBg(hitRate)}`}>
          <p className={`text-base font-bold ${hitRateColor(hitRate)}`}>{hitRate.toFixed(0)}%</p>
          <p className="text-[9px] text-zinc-600">{hits}/{picks}</p>
        </div>
      )}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ type }: { type: 'batter' | 'pitcher' }) {
  return (
    <div className="rounded-xl border border-white/6 bg-white/2 p-6 text-center">
      <p className="text-zinc-500 text-sm font-medium mb-1">
        {type === 'batter' ? 'No HRR Pick Results Yet' : 'No Pitcher Pick Results Yet'}
      </p>
      <p className="text-zinc-700 text-xs leading-relaxed max-w-[220px] mx-auto">
        {type === 'batter'
          ? "Results appear here after today's games finish. Official picks are tracked from the Money Picks tab."
          : 'Pitcher K/BB prop results appear here after games finish. Only Official and Elite tier pitcher picks are tracked.'}
      </p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type TabKey = 'hrr' | 'pitchers';

export function ResultsTab() {
  const [activeTab, setActiveTab] = useState<TabKey>('hrr');

  const { data: resultsData, isLoading: resultsLoading, refetch } =
    trpc.results.getYesterdayResults.useQuery(undefined, {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    });

  const { data: sevenDayData } =
    trpc.history.getSevenDayStats.useQuery(undefined, {
      staleTime: 10 * 60 * 1000,
    });

  const { data: pitcherResultsData, isLoading: pitcherLoading } =
    trpc.discipline.getEdgeHistory.useQuery(undefined, {
      staleTime: 5 * 60 * 1000,
    });

  const batterResults: PickResult[] = (resultsData?.results ?? []) as PickResult[];
  const pitcherRows: PitcherEdgeRow[] = (pitcherResultsData ?? []).filter(
    (r: PitcherEdgeRow) => r.result !== 'pending'
  );

  const batterHits = batterResults.filter(r => r.hit === true).length;
  const batterMisses = batterResults.filter(r => r.hit === false).length;
  const batterTotal = batterHits + batterMisses;
  const batterHitRate = batterTotal > 0 ? (batterHits / batterTotal) * 100 : null;

  const pitcherHits = pitcherRows.filter(r => r.result === 'hit').length;
  const pitcherMisses = pitcherRows.filter(r => r.result === 'miss').length;
  const pitcherTotal = pitcherHits + pitcherMisses;
  const pitcherHitRate = pitcherTotal > 0 ? (pitcherHits / pitcherTotal) * 100 : null;

  const isLoading = activeTab === 'hrr' ? resultsLoading : pitcherLoading;

  return (
    <div className="flex flex-col h-full overflow-y-auto pb-28">

      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-white font-bold text-base">Results</h2>
          <p className="text-zinc-600 text-[10px] mt-0.5">
            Yesterday's picks · Verified against real game data
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="text-[10px] text-zinc-500 bg-white/4 px-3 py-1.5 rounded-xl border border-white/8"
        >
          ↻ Refresh
        </button>
      </div>

      {/* 7-day performance strip */}
      <div className="px-4 mb-4">
        <SevenDayStrip stats={sevenDayData} />
      </div>

      {/* Tab switcher */}
      <div className="px-4 mb-4 shrink-0">
        <div className="grid grid-cols-2 gap-2 bg-white/4 rounded-xl p-1">
          <button
            onClick={() => setActiveTab('hrr')}
            className={`py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'hrr'
                ? 'bg-[oklch(0.55_0.25_280)] text-white'
                : 'text-zinc-500'
            }`}
          >
            💰 HRR Picks
            {batterHitRate !== null && (
              <span className={`ml-1.5 font-bold ${hitRateColor(batterHitRate)}`}>
                {batterHitRate.toFixed(0)}%
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('pitchers')}
            className={`py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'pitchers'
                ? 'bg-[oklch(0.40_0.20_280)] text-white'
                : 'text-zinc-500'
            }`}
          >
            ⚾ Pitcher Picks
            {pitcherHitRate !== null && (
              <span className={`ml-1.5 font-bold ${hitRateColor(pitcherHitRate)}`}>
                {pitcherHitRate.toFixed(0)}%
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 space-y-3 flex-1">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 bg-white/4 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : activeTab === 'hrr' ? (
          <>
            <SectionHeader
              title="HRR Money Picks"
              subtitle="H+R+RBI combined props · Yesterday's official picks"
              hitRate={batterHitRate}
              picks={batterTotal}
              hits={batterHits}
            />
            {batterResults.length === 0 ? (
              <EmptyState type="batter" />
            ) : (
              <div className="space-y-2">
                {batterResults.filter(r => r.hit === true).map(r => (
                  <BatterResultCard key={r.id} result={r} />
                ))}
                {batterResults.filter(r => r.hit === false).map(r => (
                  <BatterResultCard key={r.id} result={r} />
                ))}
                {batterResults.filter(r => r.hit === null).map(r => (
                  <BatterResultCard key={r.id} result={r} />
                ))}
              </div>
            )}
            {batterTotal > 0 && (
              <div className="rounded-xl border border-white/6 bg-white/2 p-3 mt-2">
                <p className="text-[10px] text-zinc-600 leading-relaxed">
                  Official tracking began May 15, 2026. Results compare predicted OVER outcomes
                  against real MLB game stats. Only picks with overall score ≥78 are tracked.
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            <SectionHeader
              title="Pitcher Edge Picks"
              subtitle="K & BB props · Official + Elite tier only"
              hitRate={pitcherHitRate}
              picks={pitcherTotal}
              hits={pitcherHits}
            />
            {pitcherRows.length === 0 ? (
              <EmptyState type="pitcher" />
            ) : (
              <div className="space-y-2">
                {pitcherRows.filter(r => r.result === 'hit').map(r => (
                  <PitcherResultCard key={r.id} row={r} />
                ))}
                {pitcherRows.filter(r => r.result === 'miss').map(r => (
                  <PitcherResultCard key={r.id} row={r} />
                ))}
              </div>
            )}
            <div className="rounded-xl border border-white/6 bg-white/2 p-3">
              <p className="text-[10px] text-zinc-600 leading-relaxed">
                Only OFFICIAL and ELITE tier pitcher picks from the Pitchers tab are tracked here.
                Pitcher K/BB props are independent of HRR batter picks.
              </p>
            </div>
          </>
        )}
      </div>

      <p className="text-center text-[10px] text-zinc-700 px-4 py-4">
        Diamond Edge is for informational purposes only. Please gamble responsibly.
      </p>
    </div>
  );
}
