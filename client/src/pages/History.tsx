/**
 * History Page — Past Performance Tracking
 * Shows stored daily pick results from the history DB:
 * - Overall hit rate summary (week / month / all-time)
 * - Bar chart of daily hit rates
 * - Date selector to drill into specific day's results
 * - Money Picks vs All Plays breakdown
 */

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { Trophy, TrendingUp, Zap, Target, Flame, CheckCircle2, XCircle, Clock, BarChart3, Calendar } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

// ─── Stat icon map ─────────────────────────────────────────────────────────────
const STAT_ICONS: Record<string, React.ElementType> = {
  hrr: Flame,
  hits: TrendingUp,
  runs: Zap,
  rbi: Target,
};

const STAT_COLORS: Record<string, string> = {
  hrr: "oklch(0.75 0.18 55)",
  hits: "oklch(0.82 0.17 85)",
  runs: "oklch(0.68 0.22 25)",
  rbi: "oklch(0.72 0.18 165)",
};

// ─── Mini bar chart for daily hit rates ───────────────────────────────────────
function DailyHitRateChart({ byDate }: { byDate: { date: string; hits: number; total: number; hitRate: number }[] }) {
  if (byDate.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-[oklch(0.40_0.015_255)] text-xs">
        No data yet
      </div>
    );
  }

  const maxRate = 100;
  const last14 = byDate.slice(-14); // Show last 14 days

  return (
    <div className="flex items-end gap-1 h-20 px-1">
      {last14.map((d, i) => {
        const barH = Math.max(4, (d.hitRate / maxRate) * 72);
        const color = d.hitRate >= 70 ? "oklch(0.72 0.18 165)" : d.hitRate >= 55 ? "oklch(0.82 0.17 85)" : "oklch(0.68 0.22 25)";
        const label = d.date.slice(5); // MM-DD
        return (
          <div key={d.date} className="flex flex-col items-center gap-0.5 flex-1 min-w-0">
            <span className="text-[8px] font-bold" style={{ color }}>{d.hitRate}%</span>
            <motion.div
              className="w-full rounded-t-sm"
              style={{ height: barH, background: color, opacity: 0.85 }}
              initial={{ height: 0 }}
              animate={{ height: barH }}
              transition={{ delay: i * 0.04, duration: 0.4, ease: "easeOut" }}
            />
            <span className="text-[7px] text-[oklch(0.35_0.015_255)] truncate w-full text-center">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Summary stat card ─────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div
      className="flex-1 rounded-xl p-3 text-center"
      style={{ background: `${color}10`, border: `1px solid ${color}25` }}
    >
      <div className="text-2xl font-bold font-stat leading-none mb-0.5" style={{ color }}>{value}</div>
      <div className="text-[10px] text-[oklch(0.50_0.015_255)] font-medium uppercase tracking-wide">{label}</div>
      {sub && <div className="text-[9px] text-[oklch(0.40_0.015_255)] mt-0.5">{sub}</div>}
    </div>
  );
}

// ─── Single result row ─────────────────────────────────────────────────────────
function ResultRow({ play, idx }: { play: any; idx: number }) {
  const Icon = STAT_ICONS[play.statType] || TrendingUp;
  const color = STAT_COLORS[play.statType] || STAT_COLORS.hits;
  const isHit = play.result === "hit";
  const isMiss = play.result === "miss";
  const isPending = play.result === "pending";

  return (
    <motion.div
      className="flex items-center gap-3 py-2.5 border-b border-[oklch(1_0_0/6%)] last:border-0"
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: idx * 0.025, duration: 0.3 }}
    >
      {/* Result icon */}
      <div className="shrink-0">
        {isHit ? (
          <CheckCircle2 size={18} style={{ color: "oklch(0.72 0.18 165)" }} />
        ) : isMiss ? (
          <XCircle size={18} style={{ color: "oklch(0.68 0.22 25)" }} />
        ) : (
          <Clock size={18} style={{ color: "oklch(0.50 0.015 255)" }} />
        )}
      </div>

      {/* Player name + team */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-white truncate">{play.playerName}</div>
        <div className="text-[10px] text-[oklch(0.45_0.015_255)]">
          {play.playerTeam} · {play.source === "money" ? "💰 Money Pick" : "📊 All Plays"}
        </div>
      </div>

      {/* Stat + line */}
      <div className="flex flex-col items-end shrink-0">
        <div className="flex items-center gap-1">
          <Icon size={10} style={{ color }} />
          <span className="text-xs font-bold" style={{ color }}>
            {play.statType.toUpperCase()} O {play.line}
          </span>
        </div>
        <div className="text-[10px] text-[oklch(0.45_0.015_255)]">
          {play.probability}% · {play.actualValue !== null ? `Got ${play.actualValue}` : "Pending"}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Date picker ───────────────────────────────────────────────────────────────
function DatePicker({ dates, selected, onSelect }: { dates: string[]; selected: string; onSelect: (d: string) => void }) {
  if (dates.length === 0) {
    return <p className="text-xs text-[oklch(0.40_0.015_255)] text-center py-4">No stored dates yet</p>;
  }

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
      {dates.slice().reverse().map(d => {
        const label = new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const isSelected = d === selected;
        return (
          <button
            key={d}
            onClick={() => onSelect(d)}
            className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{
              background: isSelected ? "oklch(0.82 0.17 85 / 20%)" : "oklch(0.18 0.025 255)",
              color: isSelected ? "oklch(0.82 0.17 85)" : "oklch(0.55 0.015 255)",
              border: isSelected ? "1px solid oklch(0.82 0.17 85 / 40%)" : "1px solid oklch(1 0 0 / 8%)",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Main History Page ─────────────────────────────────────────────────────────
export default function History() {
  const [period, setPeriod] = useState<"week" | "month" | "all">("week");
  const [selectedDate, setSelectedDate] = useState<string>("");

  const { data: summary, isLoading: summaryLoading } = trpc.history.getPerformanceSummary.useQuery({ period });
  const { data: dates, isLoading: datesLoading } = trpc.history.getResultDates.useQuery();

  // Auto-select the most recent date when dates load
  const resolvedDate = useMemo(() => {
    if (selectedDate) return selectedDate;
    if (dates && dates.length > 0) return dates[dates.length - 1];
    return "";
  }, [selectedDate, dates]);

  const { data: dayDetail, isLoading: dayLoading } = trpc.history.getResultsByDate.useQuery(
    { date: resolvedDate },
    { enabled: !!resolvedDate }
  );

  return (
    <div
      className="flex flex-col min-h-screen pb-24"
      style={{ background: "linear-gradient(180deg, oklch(0.11 0.025 255) 0%, oklch(0.09 0.020 255) 100%)" }}
    >
      {/* Header */}
      <header className="px-4 pt-12 pb-4">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "oklch(0.72 0.18 165 / 15%)" }}>
            <Trophy size={18} style={{ color: "oklch(0.72 0.18 165)" }} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Performance History</h1>
            <p className="text-[11px] text-[oklch(0.45_0.015_255)]">Track your pick accuracy over time</p>
          </div>
        </div>
      </header>

      <div className="px-4 space-y-4">
        {/* Period tabs */}
        <Tabs value={period} onValueChange={(v) => setPeriod(v as "week" | "month" | "all")}>
          <TabsList className="w-full">
            <TabsTrigger value="week" className="flex-1">Last 7 Days</TabsTrigger>
            <TabsTrigger value="month" className="flex-1">Last 30 Days</TabsTrigger>
            <TabsTrigger value="all" className="flex-1">All Time</TabsTrigger>
          </TabsList>

          <TabsContent value={period} className="mt-3 space-y-4">
            {summaryLoading ? (
              <div className="flex items-center justify-center py-12">
                <motion.div
                  className="w-10 h-10 rounded-full border-2 border-transparent"
                  style={{ borderTopColor: "oklch(0.82 0.17 85)", borderRightColor: "oklch(0.72 0.18 165)" }}
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                />
              </div>
            ) : summary?.totalPlays === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <BarChart3 size={36} style={{ color: "oklch(0.35 0.015 255)" }} className="mb-3" />
                <p className="text-white font-semibold mb-1">No History Yet</p>
                <p className="text-sm text-[oklch(0.45_0.015_255)] max-w-xs">
                  Results are automatically saved when games go Final. Check back after today's games complete.
                </p>
              </div>
            ) : (
              <>
                {/* Summary stat cards */}
                <div className="flex gap-2">
                  <StatCard
                    label="Hit Rate"
                    value={`${summary?.hitRate ?? 0}%`}
                    sub={`${summary?.hits ?? 0}/${summary?.totalPlays ?? 0} plays`}
                    color="oklch(0.72 0.18 165)"
                  />
                  <StatCard
                    label="💰 Money"
                    value={`${summary?.moneyHitRate ?? 0}%`}
                    color="oklch(0.82 0.17 85)"
                  />
                  <StatCard
                    label="📊 All Plays"
                    value={`${summary?.allPlaysHitRate ?? 0}%`}
                    color="oklch(0.68 0.22 25)"
                  />
                </div>

                {/* Daily hit rate chart */}
                <div
                  className="rounded-2xl p-4"
                  style={{ background: "oklch(0.14 0.022 255)", border: "1px solid oklch(1 0 0 / 8%)" }}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <BarChart3 size={13} style={{ color: "oklch(0.82 0.17 85)" }} />
                    <span className="text-xs font-bold text-white uppercase tracking-wide">Daily Hit Rate</span>
                  </div>
                  <DailyHitRateChart byDate={summary?.byDate ?? []} />
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>

        {/* Date drill-down */}
        <div
          className="rounded-2xl p-4"
          style={{ background: "oklch(0.14 0.022 255)", border: "1px solid oklch(1 0 0 / 8%)" }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Calendar size={13} style={{ color: "oklch(0.72 0.18 165)" }} />
            <span className="text-xs font-bold text-white uppercase tracking-wide">Browse by Date</span>
          </div>

          {datesLoading ? (
            <div className="h-8 flex items-center justify-center">
              <div className="w-4 h-4 rounded-full border border-[oklch(0.82_0.17_85)] border-t-transparent animate-spin" />
            </div>
          ) : (
            <DatePicker
              dates={dates ?? []}
              selected={resolvedDate}
              onSelect={setSelectedDate}
            />
          )}

          {/* Day detail */}
          {resolvedDate && (
            <div className="mt-4">
              {dayLoading ? (
                <div className="flex items-center justify-center py-6">
                  <div className="w-6 h-6 rounded-full border border-[oklch(0.82_0.17_85)] border-t-transparent animate-spin" />
                </div>
              ) : dayDetail && dayDetail.total > 0 ? (
                <>
                  {/* Day summary */}
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-[oklch(0.55_0.015_255)]">
                      {new Date(resolvedDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[oklch(0.72_0.18_165)] font-bold">
                        {dayDetail.hits}/{dayDetail.total - dayDetail.pending} ({dayDetail.hitRate}%)
                      </span>
                      {dayDetail.pending > 0 && (
                        <span className="text-[10px] text-[oklch(0.50_0.015_255)]">{dayDetail.pending} pending</span>
                      )}
                    </div>
                  </div>

                  {/* Results list */}
                  <div>
                    {dayDetail.plays.map((play: any, idx: number) => (
                      <ResultRow key={`${play.playerName}-${play.statType}`} play={play} idx={idx} />
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-xs text-[oklch(0.40_0.015_255)] text-center py-4">No results stored for this date</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
