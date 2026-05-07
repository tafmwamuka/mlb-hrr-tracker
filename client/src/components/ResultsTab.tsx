/**
 * Results Tab - Shows only 75%+ probability plays we suggested
 * More attractive design with visual stats, animated progress, and clear outcomes
 */

import { Trophy, TrendingUp, Zap, Target, CheckCircle2, XCircle, Clock, Flame, DollarSign, BarChart3 } from "lucide-react";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";

const STAT_CONFIG = {
  hits: { label: "Hits", abbr: "H", icon: TrendingUp, color: "oklch(0.82_0.17_85)" },
  runs: { label: "Runs", abbr: "R", icon: Zap, color: "oklch(0.68_0.22_25)" },
  rbi: { label: "RBI", abbr: "RBI", icon: Target, color: "oklch(0.72_0.18_165)" },
};

export function ResultsTab() {
  const { data: resultsData, isLoading } = trpc.results.getYesterdayResults.useQuery();
  const { data: statsData } = trpc.results.getHitRateStats.useQuery();

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <motion.div
            className="w-16 h-16 rounded-full border-3 border-transparent mx-auto mb-4"
            style={{ borderTopColor: "oklch(0.72 0.18 165)", borderRightColor: "oklch(0.82 0.17 85)" }}
            animate={{ rotate: 360 }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
          />
          <div className="text-[oklch(0.50_0.015_255)] text-sm">Loading results...</div>
        </div>
      </div>
    );
  }

  const allResults = resultsData?.results || [];
  const hasActuals = resultsData?.hasActuals || false;
  const dateStr = resultsData?.date || "";

  // FILTER: Only show plays that were 75%+ confidence (our "Money Picks")
  const results = allResults.filter((r: any) => r.confidence >= 75);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "Yesterday";
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  };

  if (!resultsData?.success || results.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-16 px-6">
        <div className="w-20 h-20 rounded-full flex items-center justify-center mb-4" style={{ background: "oklch(0.18 0.03 165)" }}>
          <Trophy size={36} style={{ color: "oklch(0.72 0.18 165)" }} />
        </div>
        <h3 className="text-white font-bold text-lg mb-2">No Results Yet</h3>
        <p className="text-[oklch(0.50_0.015_255)] text-center text-sm max-w-[300px]">
          Results for 75%+ Money Picks will appear here after games are completed. Updates happen after the last game each night.
        </p>
      </div>
    );
  }

  // Separate into resolved and pending
  const resolved = results.filter((r: any) => r.actualValue !== null);
  const pending = results.filter((r: any) => r.actualValue === null);
  const hits = resolved.filter((r: any) => r.hit === true);
  const misses = resolved.filter((r: any) => r.hit === false);
  const hitRate = resolved.length > 0 ? Math.round((hits.length / resolved.length) * 100) : 0;

  return (
    <div className="flex-1 overflow-y-auto pb-20">
      {/* Hero Stats Banner */}
      <div
        className="px-4 pt-5 pb-6"
        style={{ background: "linear-gradient(180deg, oklch(0.16 0.03 165 / 40%) 0%, transparent 100%)" }}
      >
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 size={18} style={{ color: "oklch(0.72 0.18 165)" }} />
          <h2 className="text-white font-bold text-lg">Results</h2>
          <span className="text-[oklch(0.50_0.015_255)] text-xs ml-auto">{formatDate(dateStr)}</span>
        </div>

        {/* Big hit rate display */}
        <div className="rounded-2xl p-5 border border-[oklch(1_0_0/8%)]" style={{ background: "oklch(0.13 0.022 255)" }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[oklch(0.45_0.015_255)] text-xs font-semibold uppercase tracking-wider mb-1">
                Money Picks Hit Rate
              </div>
              {hasActuals && resolved.length > 0 ? (
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold" style={{ color: hitRate >= 70 ? "oklch(0.72 0.18 165)" : hitRate >= 50 ? "oklch(0.82 0.17 85)" : "oklch(0.68 0.22 25)" }}>
                    {hitRate}%
                  </span>
                  <span className="text-sm text-[oklch(0.50_0.015_255)]">
                    ({hits.length}/{resolved.length})
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Clock size={18} className="text-[oklch(0.60_0.10_85)]" />
                  <span className="text-lg font-bold text-[oklch(0.60_0.10_85)]">Awaiting Results</span>
                </div>
              )}
            </div>

            {/* Circular progress */}
            {hasActuals && resolved.length > 0 && (
              <div className="relative w-16 h-16">
                <svg className="w-16 h-16 -rotate-90" viewBox="0 0 36 36">
                  <path
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke="oklch(0.20 0.02 255)"
                    strokeWidth="3"
                  />
                  <motion.path
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke={hitRate >= 70 ? "oklch(0.72 0.18 165)" : hitRate >= 50 ? "oklch(0.82 0.17 85)" : "oklch(0.68 0.22 25)"}
                    strokeWidth="3"
                    strokeLinecap="round"
                    initial={{ strokeDasharray: "0, 100" }}
                    animate={{ strokeDasharray: `${hitRate}, 100` }}
                    transition={{ delay: 0.3, duration: 1, ease: "easeOut" }}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xs font-bold text-white">{hits.length}✓</span>
                </div>
              </div>
            )}
          </div>

          {/* Progress bar */}
          {hasActuals && resolved.length > 0 && (
            <div className="flex gap-1 h-2 rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ background: "oklch(0.72 0.18 165)" }}
                initial={{ flex: 0 }}
                animate={{ flex: hits.length }}
                transition={{ delay: 0.2, duration: 0.6 }}
              />
              <motion.div
                className="h-full rounded-full"
                style={{ background: "oklch(0.68 0.22 25)" }}
                initial={{ flex: 0 }}
                animate={{ flex: misses.length }}
                transition={{ delay: 0.4, duration: 0.6 }}
              />
              {pending.length > 0 && (
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: "oklch(0.35 0.02 255)" }}
                  initial={{ flex: 0 }}
                  animate={{ flex: pending.length }}
                  transition={{ delay: 0.6, duration: 0.6 }}
                />
              )}
            </div>
          )}

          {/* Legend */}
          <div className="flex items-center gap-4 mt-3 text-[10px]">
            {hits.length > 0 && (
              <div className="flex items-center gap-1">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: "oklch(0.72 0.18 165)" }} />
                <span className="text-[oklch(0.55_0.015_255)]">{hits.length} Hit</span>
              </div>
            )}
            {misses.length > 0 && (
              <div className="flex items-center gap-1">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: "oklch(0.68 0.22 25)" }} />
                <span className="text-[oklch(0.55_0.015_255)]">{misses.length} Miss</span>
              </div>
            )}
            {pending.length > 0 && (
              <div className="flex items-center gap-1">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: "oklch(0.35 0.02 255)" }} />
                <span className="text-[oklch(0.55_0.015_255)]">{pending.length} Pending</span>
              </div>
            )}
          </div>
        </div>

        {/* All-time stats */}
        {statsData?.success && statsData.stats.totalPredictions > 0 && (
          <div className="grid grid-cols-3 gap-2 mt-3">
            <div className="rounded-xl p-3 text-center border border-[oklch(1_0_0/6%)]" style={{ background: "oklch(0.13 0.022 255)" }}>
              <div className="text-lg font-bold text-white">{statsData.stats.overallHitRate}%</div>
              <div className="text-[9px] text-[oklch(0.40_0.015_255)] uppercase font-semibold">All-Time</div>
            </div>
            <div className="rounded-xl p-3 text-center border border-[oklch(1_0_0/6%)]" style={{ background: "oklch(0.13 0.022 255)" }}>
              <div className="text-lg font-bold text-white">{statsData.stats.totalPredictions}</div>
              <div className="text-[9px] text-[oklch(0.40_0.015_255)] uppercase font-semibold">Total Picks</div>
            </div>
            <div className="rounded-xl p-3 text-center border border-[oklch(1_0_0/6%)]" style={{ background: "oklch(0.13 0.022 255)" }}>
              <div className="text-lg font-bold text-white">{statsData.stats.last7Days}%</div>
              <div className="text-[9px] text-[oklch(0.40_0.015_255)] uppercase font-semibold">7-Day</div>
            </div>
          </div>
        )}
      </div>

      {/* Results List */}
      <div className="px-4 space-y-2">
        {/* Section header */}
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <DollarSign size={14} style={{ color: "oklch(0.72 0.18 165)" }} />
            75%+ Money Picks
          </h3>
          <span className="text-[10px] text-[oklch(0.45_0.015_255)]">
            Only showing plays ≥75% confidence
          </span>
        </div>

        {/* Result cards */}
        {results.map((play: any, idx: number) => {
          const statConfig = STAT_CONFIG[play.stat as keyof typeof STAT_CONFIG] || STAT_CONFIG.hits;
          const Icon = statConfig.icon;
          const isPending = play.actualValue === null;
          const isHit = play.hit === true;

          return (
            <motion.div
              key={`${play.id}-${play.stat}-${idx}`}
              className="rounded-xl p-3.5 border overflow-hidden relative"
              style={{
                background: isPending
                  ? "oklch(0.14 0.022 255)"
                  : isHit
                  ? "oklch(0.14 0.025 165)"
                  : "oklch(0.14 0.020 25)",
                borderColor: isPending
                  ? "oklch(1 0 0 / 8%)"
                  : isHit
                  ? "oklch(0.72 0.18 165 / 25%)"
                  : "oklch(0.68 0.22 25 / 25%)",
              }}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.04, duration: 0.3 }}
            >
              {/* Left accent */}
              <div
                className="absolute left-0 top-0 bottom-0 w-[3px]"
                style={{
                  background: isPending
                    ? "oklch(0.50 0.10 85)"
                    : isHit
                    ? "oklch(0.72 0.18 165)"
                    : "oklch(0.68 0.22 25)",
                }}
              />

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 pl-2">
                  {/* Stat icon */}
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ background: `${statConfig.color.replace(")", " / 15%)")}` }}
                  >
                    <Icon size={16} style={{ color: statConfig.color }} />
                  </div>

                  {/* Player + prop info */}
                  <div>
                    <div className="text-white font-bold text-sm">{play.playerName}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] font-semibold" style={{ color: statConfig.color }}>
                        {play.stat.toUpperCase()} O {play.line}
                      </span>
                      <span className="text-[10px] text-[oklch(0.45_0.015_255)]">
                        {play.confidence}% conf
                      </span>
                    </div>
                  </div>
                </div>

                {/* Result badge */}
                <div className="flex flex-col items-end gap-1">
                  {isPending ? (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg" style={{ background: "oklch(0.50 0.10 85 / 12%)" }}>
                      <Clock size={12} className="text-[oklch(0.60_0.10_85)]" />
                      <span className="text-[11px] font-bold text-[oklch(0.60_0.10_85)]">PENDING</span>
                    </div>
                  ) : isHit ? (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg" style={{ background: "oklch(0.72 0.18 165 / 15%)" }}>
                      <CheckCircle2 size={12} className="text-[oklch(0.72_0.18_165)]" />
                      <span className="text-[11px] font-bold text-[oklch(0.72_0.18_165)]">HIT</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg" style={{ background: "oklch(0.68 0.22 25 / 15%)" }}>
                      <XCircle size={12} className="text-[oklch(0.68_0.22_25)]" />
                      <span className="text-[11px] font-bold text-[oklch(0.68_0.22_25)]">MISS</span>
                    </div>
                  )}

                  {/* Actual value */}
                  {!isPending && (
                    <span className="text-[10px] text-[oklch(0.50_0.015_255)]">
                      Actual: <strong className="text-white">{play.actualValue}</strong>
                    </span>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="text-center py-6 px-4">
        <p className="text-[10px] text-[oklch(0.32_0.015_255)] leading-relaxed">
          Results update after the last game each night. Only 75%+ confidence picks are tracked here.
        </p>
      </div>
    </div>
  );
}
