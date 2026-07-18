/**
 * Performance Dashboard — Diamond Edge
 *
 * Data source: trpc.tracking.getCumulativeRecord (reads picks_history)
 * All four old queries (trpc.history.getSevenDayStats,
 * trpc.history.getPerformanceSummary, trpc.results.getHitRateStats,
 * trpc.results.getYesterdayResults) have been replaced.
 *
 * Shows:
 * - Rolling 7-day performance (hit rate, ROI, streak)
 * - Historical pick performance by period (7D / 30D / All)
 * - All-time model accuracy by tier
 * - Yesterday's result card
 * - Model transparency statement
 */

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
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

/** Returns a YYYY-MM-DD string for N days ago (ET timezone). */
function daysAgo(n: number): string {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ─── Rolling 7-Day Card ────────────────────────────────────────────────────────
function SevenDayCard() {
  const since7 = useMemo(() => daysAgo(7), []);
  const { data, isLoading } = trpc.tracking.getCumulativeRecord.useQuery(
    { sinceDate: since7 },
    { staleTime: 5 * 60 * 1000, gcTime: 30 * 60 * 1000 },
  );

  const settled = (data?.wins ?? 0) + (data?.losses ?? 0);
  const hitRate = data?.hitRate ?? 0;
  const roi = data?.roi ?? 0;

  // Trend: compare first half vs second half of last7Days
  const byDay = data?.last7Days ?? [];
  const trend: "up" | "down" | "flat" = useMemo(() => {
    if (byDay.length < 2) return "flat";
    const mid = Math.floor(byDay.length / 2);
    const firstHalf = byDay.slice(0, mid);
    const secondHalf = byDay.slice(mid);
    const avg = (arr: typeof byDay) => arr.reduce((s, d) => s + d.hitRate, 0) / arr.length;
    const diff = avg(secondHalf) - avg(firstHalf);
    return diff > 3 ? "up" : diff < -3 ? "down" : "flat";
  }, [byDay]);

  const trendColor =
    trend === "up" ? "oklch(0.72 0.18 165)" :
    trend === "down" ? "oklch(0.68 0.22 25)" : "oklch(0.55 0.015 255)";
  const TrendIcon = trend === "up" ? ArrowUp : trend === "down" ? ArrowDown : Minus;

  if (isLoading || settled === 0) {
    return (
      <div
        className="rounded-2xl border px-4 py-3 flex items-center gap-3"
        style={{ background: "oklch(0.12 0.022 255)", borderColor: "oklch(1 0 0 / 10%)" }}
      >
        <TrendingUp size={13} style={{ color: "oklch(0.72 0.18 165)" }} />
        <span className="text-xs font-bold text-white">7-Day Trend</span>
        <span className="text-[10px] text-[oklch(0.40_0.015_255)] ml-auto">
          {isLoading ? "Loading…" : "No data yet — picks are tracked as they lock"}
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
            {trend === "up" ? "Trending Up" : trend === "down" ? "Trending Down" : "Stable"}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-4 divide-x" style={{ borderColor: "oklch(1 0 0 / 8%)" }}>
        {[
          { label: "Hit Rate", value: `${hitRate}%`, sub: `${data?.wins}/${settled}`, color: hitRateColor(hitRate) },
          { label: "Wins", value: String(data?.wins ?? 0), sub: "last 7 days", color: "oklch(0.72 0.18 165)" },
          { label: "ROI", value: `${roi > 0 ? "+" : ""}${roi}%`, sub: "at book odds", color: roi >= 0 ? "oklch(0.72 0.18 165)" : "oklch(0.68 0.22 25)" },
          { label: "Streak", value: data?.currentStreak ? `${data.currentStreak.count}${data.currentStreak.type}` : "—", sub: "current", color: data?.currentStreak?.type === "W" ? "oklch(0.72 0.18 165)" : "oklch(0.68 0.22 25)" },
        ].map((stat, i) => (
          <div key={i} className="px-3 py-2.5 text-center" style={{ borderColor: "oklch(1 0 0 / 8%)" }}>
            <div className="text-[9px] text-[oklch(0.40_0.015_255)] uppercase font-semibold tracking-wider mb-1">{stat.label}</div>
            <div className="text-base font-bold font-stat" style={{ color: stat.color }}>{stat.value}</div>
            <div className="text-[8px] text-[oklch(0.35_0.015_255)] mt-0.5">{stat.sub}</div>
          </div>
        ))}
      </div>
      {byDay.length > 1 && (
        <div className="px-4 pb-3 pt-2">
          <div className="flex items-end gap-1 h-8">
            {byDay.map((d, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                <div
                  className="w-full rounded-sm"
                  style={{ height: `${Math.max(4, (d.hitRate / 100) * 28)}px`, background: hitRateColor(d.hitRate), opacity: 0.7 }}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[8px] text-[oklch(0.35_0.015_255)]">{byDay[0]?.date.slice(5)}</span>
            <span className="text-[8px] text-[oklch(0.35_0.015_255)]">{byDay[byDay.length - 1]?.date.slice(5)}</span>
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

  const since7 = useMemo(() => daysAgo(7), []);
  const since30 = useMemo(() => daysAgo(30), []);

  const { data: week, isLoading: loadingWeek } = trpc.tracking.getCumulativeRecord.useQuery(
    { sinceDate: since7 },
    { staleTime: 5 * 60 * 1000, gcTime: 30 * 60 * 1000 },
  );
  const { data: month, isLoading: loadingMonth } = trpc.tracking.getCumulativeRecord.useQuery(
    { sinceDate: since30 },
    { staleTime: 5 * 60 * 1000, gcTime: 30 * 60 * 1000 },
  );
  const { data: all, isLoading: loadingAll } = trpc.tracking.getCumulativeRecord.useQuery(
    {},
    { staleTime: 5 * 60 * 1000, gcTime: 30 * 60 * 1000 },
  );

  const isLoading = loadingWeek || loadingMonth || loadingAll;

  const active = period === "week" ? week : period === "month" ? month : all;
  const settled = (active?.wins ?? 0) + (active?.losses ?? 0);
  const hitRate = active?.hitRate ?? 0;

  // Build byDate bars from last7Days (available on all windows)
  const byDate = active?.last7Days ?? [];

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
          {!isLoading && settled > 0 && (
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: `${hitRateColor(hitRate)}20`, color: hitRateColor(hitRate) }}
            >
              {hitRate}% ({active?.wins}/{settled})
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
              ) : settled === 0 ? (
                <div className="text-center py-4">
                  <p className="text-[oklch(0.45_0.015_255)] text-xs">No verified results yet. Results are saved automatically after games finish.</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: "Hit Rate", rate: hitRate, detail: `${active?.wins}/${settled}` },
                      { label: "ROI", rate: active?.roi ?? 0, detail: "at book odds", isRoi: true },
                      { label: "Pending", rate: 0, detail: `${active?.pending ?? 0} picks`, isPending: true },
                    ].map(kpi => (
                      <div
                        key={kpi.label}
                        className="rounded-xl p-2.5 text-center border"
                        style={{ background: "oklch(0.14 0.022 255)", borderColor: "oklch(1 0 0 / 8%)" }}
                      >
                        {kpi.isRoi ? (
                          <div className="text-lg font-bold font-stat" style={{ color: (active?.roi ?? 0) >= 0 ? "oklch(0.72 0.18 165)" : "oklch(0.68 0.22 25)" }}>
                            {(active?.roi ?? 0) > 0 ? "+" : ""}{active?.roi ?? 0}%
                          </div>
                        ) : kpi.isPending ? (
                          <div className="text-lg font-bold font-stat" style={{ color: "oklch(0.55 0.015 255)" }}>
                            {active?.pending ?? 0}
                          </div>
                        ) : (
                          <div className="text-lg font-bold font-stat" style={{ color: hitRateColor(kpi.rate) }}>
                            {kpi.rate}%
                          </div>
                        )}
                        <div className="text-[8px] text-[oklch(0.40_0.015_255)] uppercase font-semibold tracking-wider">{kpi.label}</div>
                        <div className="text-[8px] text-[oklch(0.35_0.015_255)] mt-0.5">{kpi.detail}</div>
                      </div>
                    ))}
                  </div>
                  {byDate.length > 0 && (
                    <div>
                      <div className="text-[9px] text-[oklch(0.40_0.015_255)] uppercase font-semibold tracking-wider mb-2">Daily Hit Rate</div>
                      <div className="flex items-end gap-0.5 h-12">
                        {byDate.slice(-14).map((day, i) => (
                          <div key={day.date} className="flex-1 flex flex-col items-center gap-0.5">
                            <motion.div
                              className="w-full rounded-sm"
                              style={{ background: hitRateColor(day.hitRate), minHeight: 2 }}
                              initial={{ height: 0 }}
                              animate={{ height: `${Math.max(4, day.hitRate)}%` }}
                              transition={{ delay: i * 0.03, duration: 0.4, ease: "easeOut" }}
                              title={`${day.date}: ${day.hitRate}% (${day.w}/${day.w + day.l})`}
                            />
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between mt-1">
                        <span className="text-[8px] text-[oklch(0.35_0.015_255)]">{byDate.slice(-14)[0]?.date?.slice(5)}</span>
                        <span className="text-[8px] text-[oklch(0.35_0.015_255)]">{byDate.slice(-1)[0]?.date?.slice(5)}</span>
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
  // All-time record from picks_history
  const { data: allTime, isLoading: statsLoading } = trpc.tracking.getCumulativeRecord.useQuery(
    {},
    { staleTime: 10 * 60 * 1000, gcTime: 30 * 60 * 1000 },
  );

  // Yesterday's picks from picks_history
  const { data: yesterdayData } = trpc.tracking.getResultsForDate.useQuery(
    { date: "yesterday" },
    { staleTime: 30 * 60 * 1000, gcTime: 60 * 60 * 1000 },
  );

  const since7 = useMemo(() => daysAgo(7), []);
  const since30 = useMemo(() => daysAgo(30), []);
  const { data: last7 } = trpc.tracking.getCumulativeRecord.useQuery(
    { sinceDate: since7 },
    { staleTime: 5 * 60 * 1000, gcTime: 30 * 60 * 1000 },
  );
  const { data: last30 } = trpc.tracking.getCumulativeRecord.useQuery(
    { sinceDate: since30 },
    { staleTime: 5 * 60 * 1000, gcTime: 30 * 60 * 1000 },
  );

  if (statsLoading) {
    return (
      <div className="p-4 space-y-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="animate-pulse h-20 rounded-2xl" style={{ background: "oklch(0.14 0.022 255)" }} />
        ))}
      </div>
    );
  }

  const totalSettled = (allTime?.wins ?? 0) + (allTime?.losses ?? 0);
  const overallRate = allTime?.hitRate ?? 0;
  const rateColor = hitRateColor(overallRate);

  // Yesterday stats from picks_history rows
  const yesterdayRows = [...(yesterdayData?.hrr ?? []), ...(yesterdayData?.pitcher ?? [])];
  const ySettled = yesterdayRows.filter(r => r.result === "hit" || r.result === "miss");
  const yHits = ySettled.filter(r => r.result === "hit").length;
  const yHitRate = ySettled.length > 0 ? Math.round((yHits / ySettled.length) * 100) : null;

  // Tier breakdown from byTier
  const byTier = allTime?.byTier ?? {};
  const eliteData = byTier["ELITE"] ?? { w: 0, l: 0, hitRate: 0, roi: 0 };
  const strongData = byTier["STRONG"] ?? { w: 0, l: 0, hitRate: 0, roi: 0 };
  const leanData = byTier["LEAN"] ?? { w: 0, l: 0, hitRate: 0, roi: 0 };

  return (
    <div className="p-4 space-y-4 pb-32">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <BarChart3 size={16} style={{ color: "oklch(0.72 0.18 165)" }} />
        <h2 className="text-white font-bold text-base tracking-tight">Performance Dashboard</h2>
      </div>
      <p className="text-[10px] text-[oklch(0.45_0.015_255)] -mt-2">
        Live from picks_history — updated automatically after each game day
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
            {totalSettled > 0 ? `${overallRate}%` : "—"}
          </div>
          <div className="text-[10px] text-[oklch(0.45_0.015_255)]">
            {totalSettled > 0 ? `${allTime?.wins}/${totalSettled} plays hit` : "No data yet"}
          </div>
        </div>
        <div
          className="rounded-2xl p-4 flex flex-col gap-2"
          style={{ background: "oklch(0.14 0.022 255)", border: "1px solid oklch(1 0 0 / 8%)" }}
        >
          <div className="flex items-center gap-2">
            <TrendingUp size={14} style={{ color: yHitRate !== null && yHitRate >= 60 ? "oklch(0.72 0.18 165)" : "oklch(0.82 0.17 85)" }} />
            <span className="text-[10px] font-bold tracking-widest uppercase text-[oklch(0.45_0.015_255)]">Yesterday</span>
          </div>
          <div
            className="text-3xl font-bold font-stat"
            style={{ color: yHitRate !== null && yHitRate >= 60 ? "oklch(0.72 0.18 165)" : "oklch(0.82 0.17 85)" }}
          >
            {yHitRate !== null ? `${yHitRate}%` : "—"}
          </div>
          <div className="text-[10px] text-[oklch(0.45_0.015_255)]">
            {ySettled.length > 0 ? `${yHits}/${ySettled.length} plays` : "No results yet"}
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
          <span className="text-[10px] font-bold tracking-widest uppercase text-[oklch(0.45_0.015_255)]">Time Windows</span>
          <span className="text-[9px] text-[oklch(0.40_0.015_255)] ml-1">(picks_history — verified results only)</span>
        </div>
        <div className="space-y-3">
          {[
            { label: "Last 7 Days", data: last7, color: "oklch(0.72 0.18 165)" },
            { label: "Last 30 Days", data: last30, color: "oklch(0.82 0.17 85)" },
            { label: "All Time", data: allTime, color: "oklch(0.55 0.25 280)" },
          ].map(({ label, data: d, color }) => {
            const s = (d?.wins ?? 0) + (d?.losses ?? 0);
            const rate = d?.hitRate ?? 0;
            const units = d ? d.roiDollars / 100 : 0;
            return (
              <div key={label}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-semibold text-[oklch(0.55_0.015_255)]">{label}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-[oklch(0.45_0.015_255)]">
                      {s > 0 ? `${d?.wins}/${s}` : "—"}
                    </span>
                    <span className="text-[10px] font-bold" style={{ color }}>
                      {s > 0 ? `${rate}%` : "—"}
                    </span>
                    {s > 0 && (
                      <span className={`text-[10px] font-bold ${units >= 0 ? "text-[oklch(0.72_0.18_165)]" : "text-[oklch(0.68_0.22_25)]"}`}>
                        {units >= 0 ? "+" : ""}{units.toFixed(1)}u
                      </span>
                    )}
                  </div>
                </div>
                {s > 0 && <StatBar value={rate} color={color} />}
              </div>
            );
          })}
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
            { emoji: "🏆", label: "Elite Picks", desc: "Highest-confidence plays", data: eliteData, color: "oklch(0.82 0.17 85)" },
            { emoji: "🔥", label: "Strong Picks", desc: "High-confidence plays", data: strongData, color: "oklch(0.55 0.25 280)" },
            { emoji: "🛡", label: "Lean Picks", desc: "Moderate confidence", data: leanData, color: "oklch(0.55 0.14 240)" },
          ].map(({ emoji, label, desc, data: d, color }) => {
            const total = d.w + d.l;
            const units = d.roi / 100;
            return (
              <div key={label}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{emoji}</span>
                    <div>
                      <div className="text-[10px] font-bold text-white">{label}</div>
                      <div className="text-[9px] text-[oklch(0.40_0.015_255)]">{desc}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-right">
                    <span className="text-[10px] text-[oklch(0.45_0.015_255)]">
                      {total > 0 ? `${d.w}/${total}` : "—"}
                    </span>
                    <span className="text-[10px] font-bold" style={{ color }}>
                      {total > 0 ? `${d.hitRate}%` : "—"}
                    </span>
                    {total > 0 && (
                      <span className={`text-[10px] font-bold ${units >= 0 ? "text-[oklch(0.72_0.18_165)]" : "text-[oklch(0.68_0.22_25)]"}`}>
                        {units >= 0 ? "+" : ""}{units.toFixed(1)}u
                      </span>
                    )}
                  </div>
                </div>
                {total > 0 && <StatBar value={d.hitRate} color={color} />}
              </div>
            );
          })}
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
              Results are tracked automatically from MLB boxscores via picks_history — only picks locked before game
              time are counted. All picks are pre-game projections. Always bet responsibly.
            </p>
          </div>
        </div>
      </div>

      {/* No data state */}
      {totalSettled === 0 && (
        <div className="text-center py-8">
          <BarChart3 size={32} className="mx-auto mb-3" style={{ color: "oklch(0.35 0.015 255)" }} />
          <p className="text-[oklch(0.45_0.015_255)] text-sm font-semibold">No verified results yet</p>
          <p className="text-[oklch(0.35_0.015_255)] text-xs mt-1">Results appear here after picks are locked and games complete</p>
        </div>
      )}
    </div>
  );
}
