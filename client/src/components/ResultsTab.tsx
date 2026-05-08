/**
 * Results Tab — Premium Design
 * Shows only 80%+ probability plays with stunning visuals:
 * - Hero stats banner with animated ring meter
 * - Win/loss streak visualization
 * - Glassmorphism result cards with player context
 * - Animated progress bars and micro-interactions
 */

import { Trophy, TrendingUp, Zap, Target, CheckCircle2, XCircle, Clock, Flame, BarChart3, Award, Star } from "lucide-react";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { SaferPlayTip } from "./SaferPlayTip";

const STAT_CONFIG = {
  hits: { label: "Hits", abbr: "H", icon: TrendingUp, color: "oklch(0.82_0.17_85)", gradient: "from-[oklch(0.82_0.17_85)] to-[oklch(0.72_0.15_85)]" },
  runs: { label: "Runs", abbr: "R", icon: Zap, color: "oklch(0.68_0.22_25)", gradient: "from-[oklch(0.68_0.22_25)] to-[oklch(0.58_0.20_25)]" },
  rbi: { label: "RBI", abbr: "RBI", icon: Target, color: "oklch(0.72_0.18_165)", gradient: "from-[oklch(0.72_0.18_165)] to-[oklch(0.62_0.16_165)]" },
};

// Stat priority for display order
const STAT_PRIORITY: Record<string, number> = { hits: 1, runs: 2, rbi: 3 };

function AnimatedCounter({ value, suffix = "" }: { value: number; suffix?: string }) {
  return (
    <motion.span
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
    >
      {value}{suffix}
    </motion.span>
  );
}

function ResultCard({ play, idx }: { play: any; idx: number }) {
  const statConfig = STAT_CONFIG[play.stat as keyof typeof STAT_CONFIG] || STAT_CONFIG.hits;
  const Icon = statConfig.icon;
  const isPending = play.actualValue === null;
  const isHit = play.hit === true;

  return (
    <motion.div
      className="relative rounded-2xl overflow-hidden"
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: idx * 0.05, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Glass card */}
      <div
        className="relative p-4 border backdrop-blur-sm"
        style={{
          background: isPending
            ? "linear-gradient(135deg, oklch(0.14 0.022 255 / 90%), oklch(0.12 0.020 255 / 80%))"
            : isHit
            ? "linear-gradient(135deg, oklch(0.14 0.030 165 / 90%), oklch(0.12 0.025 165 / 80%))"
            : "linear-gradient(135deg, oklch(0.14 0.025 25 / 90%), oklch(0.12 0.020 25 / 80%))",
          borderColor: isPending
            ? "oklch(1 0 0 / 10%)"
            : isHit
            ? "oklch(0.72 0.18 165 / 30%)"
            : "oklch(0.68 0.22 25 / 30%)",
          borderRadius: "16px",
        }}
      >
        {/* Top row: Player + Result badge */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            {/* Stat icon with glow */}
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center relative"
              style={{
                background: `linear-gradient(135deg, ${statConfig.color.replace(")", " / 20%)")}, ${statConfig.color.replace(")", " / 8%)")})`,
                boxShadow: isHit ? `0 0 16px ${statConfig.color.replace(")", " / 30%)")}` : "none",
              }}
            >
              <Icon size={18} style={{ color: statConfig.color }} />
            </div>

            {/* Player info */}
            <div>
              <div className="text-white font-bold text-[15px] leading-tight">{play.playerName}</div>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className="text-xs font-bold px-2 py-0.5 rounded-md"
                  style={{
                    background: `${statConfig.color.replace(")", " / 15%)")}`,
                    color: statConfig.color,
                  }}
                >
                  {play.stat.toUpperCase()} O {play.line}
                </span>
                <span className="text-[11px] text-[oklch(0.55_0.015_255)] font-medium">
                  {play.confidence}% conf
                </span>
              </div>
            </div>
          </div>

          {/* Result badge */}
          <div className="flex flex-col items-end gap-1.5">
            {isPending ? (
              <motion.div
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl"
                style={{ background: "oklch(0.50 0.10 85 / 12%)", border: "1px solid oklch(0.50 0.10 85 / 20%)" }}
                animate={{ opacity: [0.7, 1, 0.7] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <Clock size={13} className="text-[oklch(0.65_0.10_85)]" />
                <span className="text-[11px] font-bold text-[oklch(0.65_0.10_85)]">PENDING</span>
              </motion.div>
            ) : isHit ? (
              <motion.div
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl"
                style={{ background: "oklch(0.72 0.18 165 / 15%)", border: "1px solid oklch(0.72 0.18 165 / 30%)" }}
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
              >
                <CheckCircle2 size={13} className="text-[oklch(0.72_0.18_165)]" />
                <span className="text-[11px] font-bold text-[oklch(0.72_0.18_165)]">HIT</span>
              </motion.div>
            ) : (
              <motion.div
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl"
                style={{ background: "oklch(0.68 0.22 25 / 15%)", border: "1px solid oklch(0.68 0.22 25 / 30%)" }}
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
              >
                <XCircle size={13} className="text-[oklch(0.68_0.22_25)]" />
                <span className="text-[11px] font-bold text-[oklch(0.68_0.22_25)]">MISS</span>
              </motion.div>
            )}

            {/* Actual value */}
            {!isPending && (
              <span className="text-[10px] text-[oklch(0.55_0.015_255)]">
                Actual: <strong className="text-white">{play.actualValue}</strong>
              </span>
            )}
          </div>
        </div>

        {/* Bottom: confidence bar */}
        <div className="mt-3 pt-3 border-t border-[oklch(1_0_0/6%)]">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-[oklch(0.45_0.015_255)] uppercase font-semibold tracking-wider">Model Confidence</span>
            <span className="text-[11px] font-bold" style={{ color: statConfig.color }}>{play.confidence}%</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "oklch(0.20 0.02 255)" }}>
            <motion.div
              className="h-full rounded-full"
              style={{ background: `linear-gradient(90deg, ${statConfig.color}, ${statConfig.color.replace(")", " / 60%)")})` }}
              initial={{ width: 0 }}
              animate={{ width: `${play.confidence}%` }}
              transition={{ delay: idx * 0.05 + 0.3, duration: 0.8, ease: "easeOut" }}
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function ResultsTab() {
  const { data: resultsData, isLoading } = trpc.results.getYesterdayResults.useQuery();
  const { data: statsData } = trpc.results.getHitRateStats.useQuery();

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <motion.div
            className="w-20 h-20 rounded-full border-[3px] border-transparent mx-auto mb-4"
            style={{ borderTopColor: "oklch(0.72 0.18 165)", borderRightColor: "oklch(0.82 0.17 85)" }}
            animate={{ rotate: 360 }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
          />
          <div className="text-[oklch(0.55_0.015_255)] text-sm font-medium">Loading results...</div>
        </div>
      </div>
    );
  }

  const allResults = resultsData?.results || [];
  const hasActuals = resultsData?.hasActuals || false;
  const dateStr = resultsData?.date || "";

  // FILTER: Only show plays that were 80%+ confidence
  const results = allResults
    .filter((r: any) => r.confidence >= 80)
    .sort((a: any, b: any) => (STAT_PRIORITY[a.stat] || 99) - (STAT_PRIORITY[b.stat] || 99));

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "Yesterday";
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  };

  if (!resultsData?.success || results.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-16 px-6">
        <motion.div
          className="w-24 h-24 rounded-full flex items-center justify-center mb-5"
          style={{ background: "linear-gradient(135deg, oklch(0.18 0.03 165), oklch(0.14 0.02 165))" }}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 200 }}
        >
          <Trophy size={40} style={{ color: "oklch(0.72 0.18 165)" }} />
        </motion.div>
        <h3 className="text-white font-bold text-xl mb-2">No Results Yet</h3>
        <p className="text-[oklch(0.50_0.015_255)] text-center text-sm max-w-[300px] leading-relaxed">
          Results for 80%+ picks will appear here after games complete. Updates happen after the last game each night.
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

  // Calculate streak
  const streak = (() => {
    let count = 0;
    let type: "win" | "loss" | null = null;
    for (const r of resolved) {
      if (type === null) {
        type = r.hit ? "win" : "loss";
        count = 1;
      } else if ((type === "win" && r.hit) || (type === "loss" && !r.hit)) {
        count++;
      } else {
        break;
      }
    }
    return { count, type };
  })();

  return (
    <div className="flex-1 overflow-y-auto pb-20">
      {/* Hero Stats Banner */}
      <div className="px-4 pt-5 pb-6 relative overflow-hidden">
        {/* Background glow */}
        <div
          className="absolute inset-0 opacity-30"
          style={{
            background: hitRate >= 70
              ? "radial-gradient(ellipse at 50% 0%, oklch(0.72 0.18 165 / 30%), transparent 70%)"
              : hitRate >= 50
              ? "radial-gradient(ellipse at 50% 0%, oklch(0.82 0.17 85 / 30%), transparent 70%)"
              : "radial-gradient(ellipse at 50% 0%, oklch(0.68 0.22 25 / 30%), transparent 70%)",
          }}
        />

        <div className="relative">
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "oklch(0.72 0.18 165 / 15%)" }}>
                <BarChart3 size={16} style={{ color: "oklch(0.72 0.18 165)" }} />
              </div>
              <div>
                <h2 className="text-white font-bold text-lg leading-tight">Results</h2>
                <span className="text-[oklch(0.50_0.015_255)] text-[11px]">{formatDate(dateStr)}</span>
              </div>
            </div>
            {streak.count >= 2 && streak.type && (
              <motion.div
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl"
                style={{
                  background: streak.type === "win" ? "oklch(0.72 0.18 165 / 12%)" : "oklch(0.68 0.22 25 / 12%)",
                  border: `1px solid ${streak.type === "win" ? "oklch(0.72 0.18 165 / 25%)" : "oklch(0.68 0.22 25 / 25%)"}`,
                }}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 300, delay: 0.5 }}
              >
                <Flame size={13} style={{ color: streak.type === "win" ? "oklch(0.72 0.18 165)" : "oklch(0.68 0.22 25)" }} />
                <span className="text-[11px] font-bold" style={{ color: streak.type === "win" ? "oklch(0.72 0.18 165)" : "oklch(0.68 0.22 25)" }}>
                  {streak.count} {streak.type === "win" ? "W" : "L"} Streak
                </span>
              </motion.div>
            )}
          </div>

          {/* Main stats card */}
          <div
            className="rounded-2xl p-5 border relative overflow-hidden"
            style={{
              background: "linear-gradient(135deg, oklch(0.14 0.025 255 / 95%), oklch(0.12 0.020 255 / 90%))",
              borderColor: "oklch(1 0 0 / 10%)",
              backdropFilter: "blur(8px)",
            }}
          >
            {/* Subtle pattern overlay */}
            <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: "radial-gradient(oklch(1 0 0) 1px, transparent 1px)", backgroundSize: "20px 20px" }} />

            <div className="relative flex items-center justify-between">
              {/* Left: Hit rate text */}
              <div>
                <div className="text-[oklch(0.45_0.015_255)] text-[10px] font-bold uppercase tracking-[0.15em] mb-2">
                  80%+ Picks Hit Rate
                </div>
                {hasActuals && resolved.length > 0 ? (
                  <div className="flex items-baseline gap-3">
                    <span
                      className="text-5xl font-bold font-stat tracking-tight"
                      style={{ color: hitRate >= 70 ? "oklch(0.72 0.18 165)" : hitRate >= 50 ? "oklch(0.82 0.17 85)" : "oklch(0.68 0.22 25)" }}
                    >
                      <AnimatedCounter value={hitRate} suffix="%" />
                    </span>
                    <span className="text-sm text-[oklch(0.50_0.015_255)] font-medium">
                      {hits.length}/{resolved.length}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5">
                    <motion.div
                      animate={{ opacity: [0.5, 1, 0.5] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    >
                      <Clock size={20} className="text-[oklch(0.65_0.10_85)]" />
                    </motion.div>
                    <span className="text-xl font-bold text-[oklch(0.65_0.10_85)]">Awaiting Results</span>
                  </div>
                )}
              </div>

              {/* Right: Animated ring meter */}
              {hasActuals && resolved.length > 0 && (
                <div className="relative w-20 h-20">
                  <svg className="w-20 h-20 -rotate-90" viewBox="0 0 36 36">
                    <path
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke="oklch(0.20 0.02 255)"
                      strokeWidth="2.5"
                    />
                    <motion.path
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke={hitRate >= 70 ? "oklch(0.72 0.18 165)" : hitRate >= 50 ? "oklch(0.82 0.17 85)" : "oklch(0.68 0.22 25)"}
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      initial={{ strokeDasharray: "0, 100" }}
                      animate={{ strokeDasharray: `${hitRate}, 100` }}
                      transition={{ delay: 0.4, duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <Award size={14} style={{ color: hitRate >= 70 ? "oklch(0.72 0.18 165)" : "oklch(0.82 0.17 85)" }} />
                    <span className="text-[10px] font-bold text-white mt-0.5">{hits.length} Hits</span>
                  </div>
                </div>
              )}
            </div>

            {/* Animated progress bar */}
            {(hasActuals && resolved.length > 0) || pending.length > 0 ? (
              <div className="mt-4">
                <div className="flex gap-0.5 h-2.5 rounded-full overflow-hidden" style={{ background: "oklch(0.18 0.02 255)" }}>
                  {hits.length > 0 && (
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: "linear-gradient(90deg, oklch(0.72 0.18 165), oklch(0.65 0.16 165))" }}
                      initial={{ flex: 0 }}
                      animate={{ flex: hits.length }}
                      transition={{ delay: 0.3, duration: 0.8, ease: "easeOut" }}
                    />
                  )}
                  {misses.length > 0 && (
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: "linear-gradient(90deg, oklch(0.68 0.22 25), oklch(0.58 0.20 25))" }}
                      initial={{ flex: 0 }}
                      animate={{ flex: misses.length }}
                      transition={{ delay: 0.5, duration: 0.8, ease: "easeOut" }}
                    />
                  )}
                  {pending.length > 0 && (
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: "oklch(0.30 0.02 255)" }}
                      initial={{ flex: 0 }}
                      animate={{ flex: pending.length }}
                      transition={{ delay: 0.7, duration: 0.8, ease: "easeOut" }}
                    />
                  )}
                </div>

                {/* Legend */}
                <div className="flex items-center gap-4 mt-2.5">
                  {hits.length > 0 && (
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: "oklch(0.72 0.18 165)" }} />
                      <span className="text-[10px] text-[oklch(0.55_0.015_255)] font-medium">{hits.length} Hit</span>
                    </div>
                  )}
                  {misses.length > 0 && (
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: "oklch(0.68 0.22 25)" }} />
                      <span className="text-[10px] text-[oklch(0.55_0.015_255)] font-medium">{misses.length} Miss</span>
                    </div>
                  )}
                  {pending.length > 0 && (
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: "oklch(0.30 0.02 255)" }} />
                      <span className="text-[10px] text-[oklch(0.55_0.015_255)] font-medium">{pending.length} Pending</span>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          {/* All-time stats row */}
          {statsData?.success && statsData.stats.totalPredictions > 0 && (
            <div className="grid grid-cols-3 gap-2 mt-3">
              {[
                { value: `${statsData.stats.overallHitRate}%`, label: "All-Time", icon: Star },
                { value: statsData.stats.totalPredictions, label: "Total Picks", icon: Target },
                { value: `${statsData.stats.last7Days}%`, label: "7-Day", icon: TrendingUp },
              ].map((stat, i) => (
                <motion.div
                  key={stat.label}
                  className="rounded-xl p-3 text-center border"
                  style={{ background: "oklch(0.13 0.022 255)", borderColor: "oklch(1 0 0 / 8%)" }}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 + i * 0.1, duration: 0.4 }}
                >
                  <stat.icon size={12} className="mx-auto mb-1" style={{ color: "oklch(0.50 0.015 255)" }} />
                  <div className="text-lg font-bold text-white font-stat">{stat.value}</div>
                  <div className="text-[9px] text-[oklch(0.40_0.015_255)] uppercase font-semibold tracking-wider">{stat.label}</div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Safer play tip */}
      <div className="px-4 mb-4">
        <SaferPlayTip />
      </div>

      {/* Results List */}
      <div className="px-4 space-y-3">
        {/* Section header */}
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Trophy size={14} style={{ color: "oklch(0.72 0.18 165)" }} />
            80%+ Picks Tracked
          </h3>
          <span className="text-[10px] text-[oklch(0.45_0.015_255)] font-medium px-2 py-1 rounded-lg" style={{ background: "oklch(0.18 0.02 255)" }}>
            {results.length} plays
          </span>
        </div>

        {/* Result cards */}
        {results.map((play: any, idx: number) => (
          <ResultCard key={`${play.id}-${play.stat}-${idx}`} play={play} idx={idx} />
        ))}
      </div>

      {/* Footer */}
      <div className="text-center py-8 px-4">
        <p className="text-[11px] text-[oklch(0.35_0.015_255)] leading-relaxed">
          Results update after the last game each night. Only 80%+ confidence picks are tracked here.
        </p>
      </div>
    </div>
  );
}
