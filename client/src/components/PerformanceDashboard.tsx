/**
 * Performance Dashboard — Diamond Edge
 * Phase BD: Consolidated stats page — shows:
 * - Rolling 7-day performance (hit rate, money %, ROI, units)
 * - Historical pick performance by period (7D / 30D / All)
 * - All-time model accuracy by stat type
 * - Tier system guide
 * - Model transparency statement
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";
import {
  TrendingUp, Target, BarChart3, Shield, Award, Zap,
  ArrowUp, ArrowDown, Minus,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const hitRateColor = (r: number) =>
  r >= 65 ? "oklch(0.72 0.18 165)" : r >= 50 ? "oklch(0.82 0.17 85)" : "oklch(0.68 0.22 25)";

function StatBar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="h-2 rounded-full overflow-hidden" style={{ background: "oklch(0.20 0.02 255)" }}>
      <motion.div
        className="h-full rounded-full"
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        style={{ background: color }}
      />
    </div>
  );
}

// ─── Rolling 7-Day Card ────────────────────────────────────────────────────────
function SevenDayCard() {
  const { data, isLoading } = trpc.history.getSevenDayStats.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const trendColor =
    data?.trend === "up" ? "oklch(0.72 0.18 165)" :
    data?.trend === "down" ? "oklch(0.68 0.22 25)" : "oklch(0.55 0.015 255)";
  const TrendIcon = data?.trend === "up" ? ArrowUp : data?.trend === "down" ? ArrowDown : Minus;

  if (isLoading || !data || data.totalPlays === 0) {
    return (
      <div
        className="rounded-2xl border px-4 py-3 flex items-center gap-3"
        style={{ background: "oklch(0.12 0.022 255)", borderColor: "oklch(1 0 0 / 10%)" }}
      >
        <TrendingUp size={13} style={{ color: "oklch(0.72 0.18 165)" }} />
        <span className="text-xs font-bold text-white">7-Day Trend</span>
        <span className="text-[10px] text-[oklch(0.40_0.015_255)] ml-auto">
          {isLoading ? "Loading..." : "No data yet — tracking started May 15"}
        </span>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{ background: "oklch(0.12 0.022 255)", borderColor: "oklch(1 0 0 / 10%)" }}
    >
      <div className="px-4 py-2.5 flex items-center justify-between border-b" style={{ borderColor: "oklch(1 0 0 / 8%)" }}>
        <div className="flex items-center gap-2">
          <TrendingUp size={13} style={{ color: "oklch(0.72 0.18 165)" }} />
          <span className="text-xs font-bold text-white">Rolling 7-Day Performance</span>
        </div>
        <div className="flex items-center gap-1" style={{ color: trendColor }}>
          <TrendIcon size={11} />
          <span className="text-[10px] font-bold">
            {data.trend === "up" ? "Trending Up" : data.trend === "down" ? "Trending Down" : "Stable"}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-4 divide-x" style={{ borderColor: "oklch(1 0 0 / 8%)" }}>
        {[
          { label: "Hit Rate", value: `${data.hitRate}%`, sub: `${data.hits}/${data.totalPlays}`, color: hitRateColor(data.hitRate) },
          { label: "Money %", value: `${data.moneyHitRate}%`, sub: "money picks", color: hitRateColor(data.moneyHitRate) },
          { label: "ROI", value: `${data.roi > 0 ? "+" : ""}${data.roi}%`, sub: "at -110", color: data.roi >= 0 ? "oklch(0.72 0.18 165)" : "oklch(0.68 0.22 25)" },
          { label: "Units", value: `${data.unitsWon > 0 ? "+" : ""}${data.unitsWon}u`, sub: "7 days", color: data.unitsWon >= 0 ? "oklch(0.72 0.18 165)" : "oklch(0.68 0.22 25)" },
        ].map((stat, i) => (
          <div key={i} className="px-3 py-2.5 text-center" style={{ borderColor: "oklch(1 0 0 / 8%)" }}>
            <div className="text-[9px] text-[oklch(0.40_0.015_255)] uppercase font-semibold tracking-wider mb-1">{stat.label}</div>
            <div className="text-base font-bold font-stat" style={{ color: stat.color }}>{stat.value}</div>
            <div className="text-[8px] text-[oklch(0.35_0.015_255)] mt-0.5">{stat.sub}</div>
          </div>
        ))}
      </div>
      {data.byDay.length > 1 && (
        <div className="px-4 pb-3 pt-2">
          <div className="flex items-end gap-1 h-8">
            {data.byDay.map((d, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                <div
                  className="w-full rounded-sm"
                  style={{ height: `${Math.max(4, (d.hitRate / 100) * 28)}px`, background: hitRateColor(d.hitRate), opacity: 0.7 }}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[8px] text-[oklch(0.35_0.015_255)]">{data.byDay[0]?.date.slice(5)}</span>
            <span className="text-[8px] text-[oklch(0.35_0.015_255)]">{data.byDay[data.byDay.length - 1]?.date.slice(5)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Historical Performance Panel ─────────────────────────────────────────────
function HistoricalPanel() {
  const [period, setPeriod] = useState<"week" | "month" | "all">("week");
  const [expanded, setExpanded] = useState(true);
  const { data: summary, isLoading } = trpc.history.getPerformanceSummary.useQuery({ period });

  const PERIODS = [
    { key: "week" as const, label: "7D" },
    { key: "month" as const, label: "30D" },
    { key: "all" as const, label: "All" },
  ];

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{ background: "oklch(0.12 0.022 255)", borderColor: "oklch(1 0 0 / 10%)" }}
    >
      <div
        role="button"
        tabIndex={0}
        className="w-full flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-[oklch(1_0_0/3%)] transition-colors"
        onClick={() => setExpanded(!expanded)}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") setExpanded(!expanded); }}
      >
        <div className="flex items-center gap-2">
          <BarChart3 size={13} style={{ color: "oklch(0.72 0.18 165)" }} />
          <span className="text-xs font-bold text-white">Pick History</span>
          {!isLoading && summary && summary.totalPlays > 0 && (
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: `${hitRateColor(summary.hitRate)}20`, color: hitRateColor(summary.hitRate) }}
            >
              {summary.hitRate}% ({summary.hits}/{summary.totalPlays})
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {PERIODS.map(p => (
              <button
                key={p.key}
                onClick={e => { e.stopPropagation(); setPeriod(p.key); if (!expanded) setExpanded(true); }}
                className="text-[9px] font-bold px-2 py-0.5 rounded-full transition-all"
                style={{
                  background: period === p.key ? "oklch(0.72 0.18 165 / 20%)" : "oklch(1 0 0 / 5%)",
                  color: period === p.key ? "oklch(0.72 0.18 165)" : "oklch(0.45 0.015 255)",
                  border: period === p.key ? "1px solid oklch(0.72 0.18 165 / 30%)" : "1px solid transparent",
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1 space-y-3 border-t border-[oklch(1_0_0/6%)]">
              {isLoading ? (
                <div className="flex items-center justify-center py-4">
                  <motion.div
                    className="w-6 h-6 rounded-full border-2 border-transparent"
                    style={{ borderTopColor: "oklch(0.72 0.18 165)" }}
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  />
                </div>
              ) : !summary || summary.totalPlays === 0 ? (
                <div className="text-center py-4">
                  <p className="text-[oklch(0.45_0.015_255)] text-xs">No historical data yet. Results are saved automatically after games finish.</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: "Overall", rate: summary.hitRate, detail: `${summary.hits}/${summary.totalPlays}` },
                      { label: "Money Picks", rate: summary.moneyHitRate, detail: "money" },
                      { label: "All Plays", rate: summary.allPlaysHitRate, detail: "all plays" },
                    ].map(kpi => (
                      <div
                        key={kpi.label}
                        className="rounded-xl p-2.5 text-center border"
                        style={{ background: "oklch(0.14 0.022 255)", borderColor: "oklch(1 0 0 / 8%)" }}
                      >
                        <div className="text-lg font-bold font-stat" style={{ color: hitRateColor(kpi.rate) }}>
                          {kpi.rate}%
                        </div>
                        <div className="text-[8px] text-[oklch(0.40_0.015_255)] uppercase font-semibold tracking-wider">{kpi.label}</div>
                      </div>
                    ))}
                  </div>
                  {summary.byDate.length > 0 && (
                    <div>
                      <div className="text-[9px] text-[oklch(0.40_0.015_255)] uppercase font-semibold tracking-wider mb-2">Daily Hit Rate</div>
                      <div className="flex items-end gap-0.5 h-12">
                        {summary.byDate.slice(-14).map((day, i) => (
                          <div key={day.date} className="flex-1 flex flex-col items-center gap-0.5">
                            <motion.div
                              className="w-full rounded-sm"
                              style={{ background: hitRateColor(day.hitRate), minHeight: 2 }}
                              initial={{ height: 0 }}
                              animate={{ height: `${Math.max(4, day.hitRate)}%` }}
                              transition={{ delay: i * 0.03, duration: 0.4, ease: "easeOut" }}
                              title={`${day.date}: ${day.hitRate}% (${day.hits}/${day.total})`}
                            />
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between mt-1">
                        <span className="text-[8px] text-[oklch(0.35_0.015_255)]">{summary.byDate.slice(-14)[0]?.date?.slice(5)}</span>
                        <span className="text-[8px] text-[oklch(0.35_0.015_255)]">{summary.byDate.slice(-1)[0]?.date?.slice(5)}</span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main Dashboard ────────────────────────────────────────────────────────────
export function PerformanceDashboard() {
  const { data: stats, isLoading: statsLoading } = trpc.results.getHitRateStats.useQuery(undefined, {
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const { data: yesterday } = trpc.results.getYesterdayResults.useQuery(undefined, {
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });

  if (statsLoading) {
    return (
      <div className="p-4 space-y-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="animate-pulse h-20 rounded-2xl" style={{ background: "oklch(0.14 0.022 255)" }} />
        ))}
      </div>
    );
  }

  const s = stats?.stats;
  // Official-only metrics (Elite + Official tier — what drives the public results page)
  const official = (s as any)?.official ?? {};
  const officialAll = official.all ?? { hitRate: 0, total: 0, hits: 0, units: 0, roi: 0 };
  const eliteData = official.elite ?? { hitRate: 0, total: 0, hits: 0, units: 0, roi: 0 };
  const officialTierData = official.officialTier ?? { hitRate: 0, total: 0, hits: 0, units: 0, roi: 0 };
  const leanData = official.lean ?? { hitRate: 0, total: 0, hits: 0, units: 0, roi: 0 };
  const projData = official.projection ?? { hitRate: 0, total: 0, hits: 0, units: 0, roi: 0 };
  const timeWindows = (s as any)?.timeWindows ?? {};
  const last7 = timeWindows.last7 ?? { hitRate: 0, total: 0, hits: 0, units: 0, roi: 0 };
  const last30 = timeWindows.last30 ?? { hitRate: 0, total: 0, hits: 0, units: 0, roi: 0 };
  const overallRate = officialAll.hitRate;
  const totalPredictions = officialAll.total;
  const totalHits = officialAll.hits;
  const rateColor = overallRate >= 65 ? "oklch(0.72 0.18 165)" : overallRate >= 50 ? "oklch(0.82 0.17 85)" : "oklch(0.68 0.22 25)";

  return (
    <div className="p-4 space-y-4 pb-32">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <BarChart3 size={16} style={{ color: "oklch(0.72 0.18 165)" }} />
        <h2 className="text-white font-bold text-base tracking-tight">Performance Dashboard</h2>
      </div>
      <p className="text-[10px] text-[oklch(0.45_0.015_255)] -mt-2">
        Model accuracy — updated automatically after each game day
      </p>

      {/* Rolling 7-day stats */}
      <SevenDayCard />

      {/* Historical performance panel */}
      <HistoricalPanel />

      {/* All-time key metrics */}
      <div className="grid grid-cols-2 gap-3">
        <div
          className="rounded-2xl p-4 flex flex-col gap-2"
          style={{ background: "oklch(0.14 0.022 255)", border: "1px solid oklch(1 0 0 / 8%)" }}
        >
          <div className="flex items-center gap-2">
            <Target size={14} style={{ color: rateColor }} />
            <span className="text-[10px] font-bold tracking-widest uppercase text-[oklch(0.45_0.015_255)]">All-Time Hit Rate</span>
          </div>
          <div className="text-3xl font-bold font-stat" style={{ color: rateColor }}>
            {totalPredictions > 0 ? `${overallRate}%` : "—"}
          </div>
          <div className="text-[10px] text-[oklch(0.45_0.015_255)]">
            {totalPredictions > 0 ? `${totalHits}/${totalPredictions} plays hit` : "No data yet"}
          </div>
        </div>
        <div
          className="rounded-2xl p-4 flex flex-col gap-2"
          style={{ background: "oklch(0.14 0.022 255)", border: "1px solid oklch(1 0 0 / 8%)" }}
        >
          <div className="flex items-center gap-2">
            <TrendingUp size={14} style={{ color: yesterday?.hasActuals && (yesterday.hitRate ?? 0) >= 60 ? "oklch(0.72 0.18 165)" : "oklch(0.82 0.17 85)" }} />
            <span className="text-[10px] font-bold tracking-widest uppercase text-[oklch(0.45_0.015_255)]">Yesterday</span>
          </div>
          <div
            className="text-3xl font-bold font-stat"
            style={{ color: yesterday?.hasActuals && (yesterday.hitRate ?? 0) >= 60 ? "oklch(0.72 0.18 165)" : "oklch(0.82 0.17 85)" }}
          >
            {yesterday?.hasActuals ? `${yesterday.hitRate}%` : "—"}
          </div>
          <div className="text-[10px] text-[oklch(0.45_0.015_255)]">
            {yesterday?.hasActuals ? `${yesterday.totalHits}/${yesterday.totalWithActuals ?? yesterday.totalPlays} plays` : "No results yet"}
          </div>
        </div>
      </div>

      {/* Time window performance */}
      <div
        className="rounded-2xl p-4"
        style={{ background: "oklch(0.14 0.022 255)", border: "1px solid oklch(1 0 0 / 8%)" }}
      >
        <div className="flex items-center gap-2 mb-3">
          <Zap size={13} style={{ color: "oklch(0.82 0.17 85)" }} />
          <span className="text-[10px] font-bold tracking-widest uppercase text-[oklch(0.45_0.015_255)]">Official Plays — Time Windows</span>
          <span className="text-[9px] text-[oklch(0.40_0.015_255)] ml-1">(Elite + Official tier only)</span>
        </div>
        <div className="space-y-3">
          {[
            { label: "Last 7 Days", rate: last7.hitRate, total: last7.total, hits: last7.hits, units: last7.units, color: "oklch(0.72 0.18 165)" },
            { label: "Last 30 Days", rate: last30.hitRate, total: last30.total, hits: last30.hits, units: last30.units, color: "oklch(0.82 0.17 85)" },
            { label: "All Time", rate: officialAll.hitRate, total: officialAll.total, hits: officialAll.hits, units: officialAll.units, color: "oklch(0.55 0.25 280)" },
          ].map(({ label, rate, total, hits, units, color }) => (
            <div key={label}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-semibold text-[oklch(0.55_0.015_255)]">{label}</span>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-[oklch(0.45_0.015_255)]">
                    {total > 0 ? `${hits}/${total}` : "—"}
                  </span>
                  <span className="text-[10px] font-bold" style={{ color }}>
                    {total > 0 ? `${rate}%` : "—"}
                  </span>
                  {total > 0 && (
                    <span className={`text-[10px] font-bold ${units >= 0 ? "text-[oklch(0.72_0.18_165)]" : "text-[oklch(0.68_0.22_25)]"}`}>
                      {units >= 0 ? "+" : ""}{units.toFixed(1)}u
                    </span>
                  )}
                </div>
              </div>
              {total > 0 && <StatBar value={rate} color={color} />}
            </div>
          ))}
        </div>
      </div>

      {/* Tier performance breakdown */}
      <div
        className="rounded-2xl p-4"
        style={{ background: "oklch(0.14 0.022 255)", border: "1px solid oklch(1 0 0 / 8%)" }}
      >
        <div className="flex items-center gap-2 mb-3">
          <Award size={13} style={{ color: "oklch(0.82 0.17 85)" }} />
          <span className="text-[10px] font-bold tracking-widest uppercase text-[oklch(0.45_0.015_255)]">Performance by Tier</span>
        </div>
        <div className="space-y-3">
          {[
            { emoji: "🏆", label: "Elite Plays", desc: "75%+ prob, 5+ factors", rate: eliteData.hitRate, total: eliteData.total, hits: eliteData.hits, units: eliteData.units, color: "oklch(0.82 0.17 85)", tracked: true },
            { emoji: "🔥", label: "Official Plays", desc: "70%+ prob, 4+ factors", rate: officialTierData.hitRate, total: officialTierData.total, hits: officialTierData.hits, units: officialTierData.units, color: "oklch(0.55 0.25 280)", tracked: true },
            { emoji: "🛡", label: "Qualified Leans", desc: "65–69% — not in official results", rate: leanData.hitRate, total: leanData.total, hits: leanData.hits, units: leanData.units, color: "oklch(0.55 0.14 240)", tracked: false },
            { emoji: "🧪", label: "Projection Only", desc: "Below 65% — research use only", rate: projData.hitRate, total: projData.total, hits: projData.hits, units: projData.units, color: "oklch(0.40 0.04 255)", tracked: false },
          ].map(({ emoji, label, desc, rate, total, hits, units, color, tracked }) => (
            <div key={label}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{emoji}</span>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold text-white">{label}</span>
                      {!tracked && (
                        <span className="text-[8px] px-1 py-0.5 rounded" style={{ background: "oklch(0.20 0.02 255)", color: "oklch(0.45 0.015 255)" }}>not tracked</span>
                      )}
                    </div>
                    <div className="text-[9px] text-[oklch(0.40_0.015_255)]">{desc}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-right">
                  <span className="text-[10px] text-[oklch(0.45_0.015_255)]">
                    {total > 0 ? `${hits}/${total}` : "—"}
                  </span>
                  <span className="text-[10px] font-bold" style={{ color }}>
                    {total > 0 ? `${rate}%` : "—"}
                  </span>
                  {total > 0 && (
                    <span className={`text-[10px] font-bold ${units >= 0 ? "text-[oklch(0.72_0.18_165)]" : "text-[oklch(0.68_0.22_25)]"}`}>
                      {units >= 0 ? "+" : ""}{units.toFixed(1)}u
                    </span>
                  )}
                </div>
              </div>
              {total > 0 && <StatBar value={rate} color={color} />}
            </div>
          ))}
        </div>
      </div>

      {/* Transparency */}
      <div
        className="rounded-2xl p-4"
        style={{ background: "oklch(0.13 0.022 255)", border: "1px solid oklch(1 0 0 / 6%)" }}
      >
        <div className="flex items-start gap-2">
          <Shield size={13} className="mt-0.5 shrink-0" style={{ color: "oklch(0.72 0.18 165)" }} />
          <div>
            <div className="text-[10px] font-bold text-white mb-1">Model Transparency</div>
            <p className="text-[9px] text-[oklch(0.45_0.015_255)] leading-relaxed">
              Diamond Edge uses a 10-factor Poisson model combining Statcast xwOBA, rolling contact metrics,
              projected plate appearances, pitcher matchup, park factors, weather, bullpen fatigue, and betting edge.
              Results are tracked automatically from MLB boxscores. All picks are pre-game projections — actual outcomes
              depend on game conditions. Always bet responsibly.
            </p>
          </div>
        </div>
      </div>

      {/* No data state */}
      {totalPredictions === 0 && (
        <div className="text-center py-8">
          <BarChart3 size={32} className="mx-auto mb-3" style={{ color: "oklch(0.35 0.015 255)" }} />
          <p className="text-[oklch(0.45_0.015_255)] text-sm font-semibold">No historical data yet</p>
          <p className="text-[oklch(0.35_0.015_255)] text-xs mt-1">Results will appear here after game days complete</p>
        </div>
      )}
    </div>
  );
}
