/**
 * Results Tab — Live Results with Real-Time Updates
 * Shows today's picks with live game outcomes:
 * - Hero stats banner with animated ring meter
 * - Game progress indicator (X of Y games complete)
 * - Live result cards grouped by game status
 * - Auto-polls every 2 minutes during game hours
 * - Fully responsive mobile-first design
 */

import { Trophy, TrendingUp, Zap, Target, CheckCircle2, XCircle, Clock, Flame, BarChart3, Award, Star, RefreshCw, Radio } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { SaferPlayTip } from "./SaferPlayTip";
import { useState, useEffect, useMemo } from "react";

const STAT_CONFIG = {
  hrr: { label: "HRR", abbr: "HRR", icon: Flame, color: "oklch(0.75_0.18_55)", gradient: "from-[oklch(0.75_0.18_55)] to-[oklch(0.65_0.16_55)]" },
  hits: { label: "Hits", abbr: "H", icon: TrendingUp, color: "oklch(0.82_0.17_85)", gradient: "from-[oklch(0.82_0.17_85)] to-[oklch(0.72_0.15_85)]" },
  runs: { label: "Runs", abbr: "R", icon: Zap, color: "oklch(0.68_0.22_25)", gradient: "from-[oklch(0.68_0.22_25)] to-[oklch(0.58_0.20_25)]" },
  rbi: { label: "RBI", abbr: "RBI", icon: Target, color: "oklch(0.72_0.18_165)", gradient: "from-[oklch(0.72_0.18_165)] to-[oklch(0.62_0.16_165)]" },
};

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

function GameStatusBadge({ status, inning, inningHalf }: { status: string; inning?: number; inningHalf?: string }) {
  if (status === "Final") {
    return (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-[oklch(0.72_0.18_165/15%)] text-[oklch(0.72_0.18_165)]">
        FINAL
      </span>
    );
  }
  if (status === "In Progress") {
    return (
      <motion.span
        className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-[oklch(0.68_0.22_25/15%)] text-[oklch(0.75_0.15_85)]"
        animate={{ opacity: [0.7, 1, 0.7] }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        {inningHalf === "Top" ? "▲" : "▼"} {inning || "LIVE"}
      </motion.span>
    );
  }
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-[oklch(0.30_0.02_255/50%)] text-[oklch(0.50_0.015_255)]">
      PENDING
    </span>
  );
}

function ResultCard({ play, idx }: { play: any; idx: number }) {
  const statConfig = STAT_CONFIG[play.stat as keyof typeof STAT_CONFIG] || STAT_CONFIG.hits;
  const Icon = statConfig.icon;
  const isFinal = play.gameStatus === "Final";
  const isLive = play.gameStatus === "In Progress";
  const isPending = play.gameStatus === "Scheduled";
  const isHit = play.hit === true;
  const isMoney = play.source === "money";

  return (
    <motion.div
      className="relative rounded-2xl overflow-hidden w-full"
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: idx * 0.03, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      <div
        className="relative p-3 sm:p-4 border backdrop-blur-sm"
        style={{
          background: isPending
            ? "linear-gradient(135deg, oklch(0.14 0.022 255 / 90%), oklch(0.12 0.020 255 / 80%))"
            : isLive
            ? "linear-gradient(135deg, oklch(0.14 0.028 85 / 90%), oklch(0.12 0.022 85 / 80%))"
            : isHit
            ? "linear-gradient(135deg, oklch(0.14 0.030 165 / 90%), oklch(0.12 0.025 165 / 80%))"
            : "linear-gradient(135deg, oklch(0.14 0.025 25 / 90%), oklch(0.12 0.020 25 / 80%))",
          borderColor: isPending
            ? "oklch(1 0 0 / 10%)"
            : isLive
            ? "oklch(0.82 0.17 85 / 25%)"
            : isHit
            ? "oklch(0.72 0.18 165 / 30%)"
            : "oklch(0.68 0.22 25 / 30%)",
          borderRadius: "16px",
        }}
      >
        {/* Top row: Player + Result badge */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            {/* Stat icon with glow */}
            <div
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center shrink-0 relative"
              style={{
                background: `linear-gradient(135deg, ${statConfig.color.replace(")", " / 20%)")}, ${statConfig.color.replace(")", " / 8%)")})`,
                boxShadow: isHit ? `0 0 16px ${statConfig.color.replace(")", " / 30%)")}` : "none",
              }}
            >
              <Icon size={16} style={{ color: statConfig.color }} />
            </div>

            {/* Player info */}
            <div className="min-w-0 flex-1">
              <div className="text-white font-bold text-sm sm:text-[15px] leading-tight truncate">{play.playerName}</div>
              <div className="flex items-center gap-1.5 sm:gap-2 mt-0.5 flex-wrap">
                <span className="text-[10px] sm:text-[11px] text-[oklch(0.50_0.015_255)] font-medium">{play.team}</span>
                {isMoney && (
                  <span className="text-[9px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-[oklch(0.75_0.18_55/15%)] text-[oklch(0.75_0.18_55)]">
                    💰 MONEY
                  </span>
                )}
                <span
                  className="text-[10px] sm:text-xs font-bold px-1.5 sm:px-2 py-0.5 rounded-md"
                  style={{
                    background: `${statConfig.color.replace(")", " / 15%)")}`  ,
                    color: statConfig.color,
                  }}
                >
                  {play.stat === "hrr" ? "HRR" : play.stat.toUpperCase()} O{play.line}
                </span>
                <GameStatusBadge status={play.gameStatus} inning={play.inning} inningHalf={play.inningHalf} />
              </div>
            </div>
          </div>

          {/* Result badge */}
          <div className="flex flex-col items-end gap-1 shrink-0">
            {isPending ? (
              <motion.div
                className="flex items-center gap-1 px-2 sm:px-3 py-1 sm:py-1.5 rounded-xl"
                style={{ background: "oklch(0.50 0.10 85 / 12%)", border: "1px solid oklch(0.50 0.10 85 / 20%)" }}
                animate={{ opacity: [0.7, 1, 0.7] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <Clock size={12} className="text-[oklch(0.65_0.10_85)]" />
                <span className="text-[10px] sm:text-[11px] font-bold text-[oklch(0.65_0.10_85)]">WAITING</span>
              </motion.div>
            ) : isLive ? (
              <motion.div
                className="flex items-center gap-1 px-2 sm:px-3 py-1 sm:py-1.5 rounded-xl"
                style={{ background: "oklch(0.82 0.17 85 / 12%)", border: "1px solid oklch(0.82 0.17 85 / 25%)" }}
                animate={{ scale: [1, 1.02, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              >
                <Radio size={12} className="text-[oklch(0.82_0.17_85)]" />
                <span className="text-[10px] sm:text-[11px] font-bold text-[oklch(0.82_0.17_85)]">
                  {play.actualValue !== null ? play.actualValue : "—"}
                </span>
              </motion.div>
            ) : isHit ? (
              <motion.div
                className="flex items-center gap-1 px-2 sm:px-3 py-1 sm:py-1.5 rounded-xl"
                style={{ background: "oklch(0.72 0.18 165 / 15%)", border: "1px solid oklch(0.72 0.18 165 / 30%)" }}
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
              >
                <CheckCircle2 size={12} className="text-[oklch(0.72_0.18_165)]" />
                <span className="text-[10px] sm:text-[11px] font-bold text-[oklch(0.72_0.18_165)]">HIT</span>
              </motion.div>
            ) : (
              <motion.div
                className="flex items-center gap-1 px-2 sm:px-3 py-1 sm:py-1.5 rounded-xl"
                style={{ background: "oklch(0.68 0.22 25 / 15%)", border: "1px solid oklch(0.68 0.22 25 / 30%)" }}
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
              >
                <XCircle size={12} className="text-[oklch(0.68_0.22_25)]" />
                <span className="text-[10px] sm:text-[11px] font-bold text-[oklch(0.68_0.22_25)]">MISS</span>
              </motion.div>
            )}

            {/* Actual value for final games */}
            {isFinal && play.actualValue !== null && (
              <span className="text-[10px] text-[oklch(0.55_0.015_255)]">
                Actual: <strong className="text-white">{play.actualValue}</strong>
              </span>
            )}
          </div>
        </div>

        {/* Bottom: confidence bar */}
        <div className="mt-2.5 sm:mt-3 pt-2.5 sm:pt-3 border-t border-[oklch(1_0_0/6%)]">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] sm:text-[10px] text-[oklch(0.45_0.015_255)] uppercase font-semibold tracking-wider">Model Confidence</span>
            <span className="text-[10px] sm:text-[11px] font-bold" style={{ color: statConfig.color }}>{play.probability}%</span>
          </div>
          <div className="h-1 sm:h-1.5 rounded-full overflow-hidden" style={{ background: "oklch(0.20 0.02 255)" }}>
            <motion.div
              className="h-full rounded-full"
              style={{ background: `linear-gradient(90deg, ${statConfig.color}, ${statConfig.color.replace(")", " / 60%)")})` }}
              initial={{ width: 0 }}
              animate={{ width: `${play.probability}%` }}
              transition={{ delay: idx * 0.03 + 0.3, duration: 0.8, ease: "easeOut" }}
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function ResultsTab() {
  // Use the new getTodayResults endpoint with polling
  const { data: resultsData, isLoading, refetch } = trpc.results.getTodayResults.useQuery(undefined, {
    refetchInterval: 2 * 60 * 1000, // Poll every 2 minutes
    staleTime: 60 * 1000, // Consider data stale after 1 minute
  });
  const { data: statsData } = trpc.results.getHitRateStats.useQuery();

  const [lastRefresh, setLastRefresh] = useState(new Date());

  useEffect(() => {
    if (resultsData) {
      setLastRefresh(new Date());
    }
  }, [resultsData]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <motion.div
            className="w-16 h-16 sm:w-20 sm:h-20 rounded-full border-[3px] border-transparent mx-auto mb-4"
            style={{ borderTopColor: "oklch(0.72 0.18 165)", borderRightColor: "oklch(0.82 0.17 85)" }}
            animate={{ rotate: 360 }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
          />
          <div className="text-[oklch(0.55_0.015_255)] text-sm font-medium">Loading live results...</div>
        </div>
      </div>
    );
  }

  // Handle lineups pending state
  if (resultsData?.lineupsPending) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-16 px-6">
        <motion.div
          className="w-20 h-20 sm:w-24 sm:h-24 rounded-full flex items-center justify-center mb-5"
          style={{ background: "linear-gradient(135deg, oklch(0.18 0.03 85), oklch(0.14 0.02 85))" }}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 200 }}
        >
          <Clock size={36} style={{ color: "oklch(0.82 0.17 85)" }} />
        </motion.div>
        <h3 className="text-white font-bold text-lg sm:text-xl mb-2">Lineups Posting Soon</h3>
        <p className="text-[oklch(0.50_0.015_255)] text-center text-xs sm:text-sm max-w-[300px] leading-relaxed">
          Results will appear once today's lineups are posted and games begin. Check back closer to game time.
        </p>
      </div>
    );
  }

  const allResults = resultsData?.results || [];
  const dateStr = resultsData?.date || "";
  const gamesInProgress = resultsData?.gamesInProgress || 0;
  const gamesCompleted = resultsData?.gamesCompleted || 0;
  const gamesScheduled = resultsData?.gamesScheduled || 0;
  const totalGames = resultsData?.totalGames || 0;

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "Today";
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  };

  if (!resultsData?.success || allResults.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-16 px-6">
        <motion.div
          className="w-20 h-20 sm:w-24 sm:h-24 rounded-full flex items-center justify-center mb-5"
          style={{ background: "linear-gradient(135deg, oklch(0.18 0.03 165), oklch(0.14 0.02 165))" }}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 200 }}
        >
          <Trophy size={36} style={{ color: "oklch(0.72 0.18 165)" }} />
        </motion.div>
        <h3 className="text-white font-bold text-lg sm:text-xl mb-2">No Results Yet</h3>
        <p className="text-[oklch(0.50_0.015_255)] text-center text-xs sm:text-sm max-w-[300px] leading-relaxed">
          Results will appear here as games start and finish. Auto-refreshes every 2 minutes.
        </p>
      </div>
    );
  }

  // Separate by status
  const finalResults = allResults.filter((r: any) => r.gameStatus === "Final");
  const liveResults = allResults.filter((r: any) => r.gameStatus === "In Progress");
  const pendingResults = allResults.filter((r: any) => r.gameStatus === "Scheduled");

  const hits = finalResults.filter((r: any) => r.hit === true);
  const misses = finalResults.filter((r: any) => r.hit === false);
  const hitRate = finalResults.length > 0 ? Math.round((hits.length / finalResults.length) * 100) : 0;
  const hasActuals = finalResults.length > 0;

  // Source-based breakdown
  const moneyFinal = finalResults.filter((r: any) => r.source === "money");
  const allPlaysFinal = finalResults.filter((r: any) => r.source === "allPlays");
  const moneyHits = moneyFinal.filter((r: any) => r.hit === true);
  const allPlaysHits = allPlaysFinal.filter((r: any) => r.hit === true);
  const moneyHitRate = moneyFinal.length > 0 ? Math.round((moneyHits.length / moneyFinal.length) * 100) : 0;
  const allPlaysHitRate = allPlaysFinal.length > 0 ? Math.round((allPlaysHits.length / allPlaysFinal.length) * 100) : 0;

  return (
    <div className="flex-1 overflow-y-auto pb-20">
      {/* Hero Stats Banner */}
      <div className="px-3 sm:px-4 pt-4 sm:pt-5 pb-4 sm:pb-6 relative overflow-hidden">
        {/* Background glow */}
        <div
          className="absolute inset-0 opacity-30"
          style={{
            background: hitRate >= 70
              ? "radial-gradient(ellipse at 50% 0%, oklch(0.72 0.18 165 / 30%), transparent 70%)"
              : hitRate >= 50
              ? "radial-gradient(ellipse at 50% 0%, oklch(0.82 0.17 85 / 30%), transparent 70%)"
              : gamesInProgress > 0
              ? "radial-gradient(ellipse at 50% 0%, oklch(0.82 0.17 85 / 20%), transparent 70%)"
              : "radial-gradient(ellipse at 50% 0%, oklch(0.68 0.22 25 / 30%), transparent 70%)",
          }}
        />

        <div className="relative">
          {/* Header with date and refresh */}
          <div className="flex items-center justify-between mb-4 sm:mb-5">
            <div className="flex items-center gap-2 sm:gap-2.5">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center" style={{ background: "oklch(0.72 0.18 165 / 15%)" }}>
                <BarChart3 size={14} style={{ color: "oklch(0.72 0.18 165)" }} />
              </div>
              <div>
                <h2 className="text-white font-bold text-base sm:text-lg leading-tight">Live Results</h2>
                <span className="text-[oklch(0.50_0.015_255)] text-[10px] sm:text-[11px]">{formatDate(dateStr)}</span>
              </div>
            </div>

            {/* Game progress + refresh */}
            <div className="flex items-center gap-2">
              {gamesInProgress > 0 && (
                <motion.div
                  className="flex items-center gap-1 px-2 py-1 rounded-lg"
                  style={{ background: "oklch(0.82 0.17 85 / 10%)", border: "1px solid oklch(0.82 0.17 85 / 20%)" }}
                  animate={{ opacity: [0.7, 1, 0.7] }}
                  transition={{ duration: 2, repeat: Infinity }}
                >
                  <Radio size={10} className="text-[oklch(0.82_0.17_85)]" />
                  <span className="text-[10px] font-bold text-[oklch(0.82_0.17_85)]">{gamesInProgress} Live</span>
                </motion.div>
              )}
              <button
                onClick={() => refetch()}
                className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center active:scale-90 transition-transform"
                style={{ background: "oklch(0.18 0.02 255)" }}
              >
                <RefreshCw size={13} className="text-[oklch(0.50_0.015_255)]" />
              </button>
            </div>
          </div>

          {/* Game progress bar */}
          {totalGames > 0 && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[9px] sm:text-[10px] text-[oklch(0.45_0.015_255)] uppercase font-semibold tracking-wider">
                  Games Progress
                </span>
                <span className="text-[10px] sm:text-[11px] text-[oklch(0.55_0.015_255)] font-medium">
                  {gamesCompleted}/{totalGames} complete
                </span>
              </div>
              <div className="flex gap-0.5 h-2 rounded-full overflow-hidden" style={{ background: "oklch(0.18 0.02 255)" }}>
                {gamesCompleted > 0 && (
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: "oklch(0.72 0.18 165)" }}
                    initial={{ flex: 0 }}
                    animate={{ flex: gamesCompleted }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                  />
                )}
                {gamesInProgress > 0 && (
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: "oklch(0.82 0.17 85)" }}
                    initial={{ flex: 0 }}
                    animate={{ flex: gamesInProgress }}
                    transition={{ delay: 0.2, duration: 0.8, ease: "easeOut" }}
                  />
                )}
                {gamesScheduled > 0 && (
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: "oklch(0.25 0.02 255)" }}
                    initial={{ flex: 0 }}
                    animate={{ flex: gamesScheduled }}
                    transition={{ delay: 0.4, duration: 0.8, ease: "easeOut" }}
                  />
                )}
              </div>
            </div>
          )}

          {/* Main stats card */}
          <div
            className="rounded-2xl p-4 sm:p-5 border relative overflow-hidden"
            style={{
              background: "linear-gradient(135deg, oklch(0.14 0.025 255 / 95%), oklch(0.12 0.020 255 / 90%))",
              borderColor: "oklch(1 0 0 / 10%)",
              backdropFilter: "blur(8px)",
            }}
          >
            <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: "radial-gradient(oklch(1 0 0) 1px, transparent 1px)", backgroundSize: "20px 20px" }} />

            <div className="relative flex items-center justify-between gap-3">
              {/* Left: Hit rate text */}
              <div className="min-w-0 flex-1">
                <div className="text-[oklch(0.45_0.015_255)] text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.15em] mb-2">
                  Today's Hit Rate
                </div>
                {hasActuals ? (
                  <div className="flex items-baseline gap-2 sm:gap-3 flex-wrap">
                    <span
                      className="text-4xl sm:text-5xl font-bold font-stat tracking-tight"
                      style={{ color: hitRate >= 70 ? "oklch(0.72 0.18 165)" : hitRate >= 50 ? "oklch(0.82 0.17 85)" : "oklch(0.68 0.22 25)" }}
                    >
                      <AnimatedCounter value={hitRate} suffix="%" />
                    </span>
                    <span className="text-xs sm:text-sm text-[oklch(0.50_0.015_255)] font-medium">
                      {hits.length}/{finalResults.length}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <motion.div
                      animate={{ opacity: [0.5, 1, 0.5] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    >
                      <Clock size={18} className="text-[oklch(0.65_0.10_85)]" />
                    </motion.div>
                    <span className="text-lg sm:text-xl font-bold text-[oklch(0.65_0.10_85)]">Awaiting Finals</span>
                  </div>
                )}
              </div>

              {/* Right: Animated ring meter */}
              {hasActuals && (
                <div className="relative w-16 h-16 sm:w-20 sm:h-20 shrink-0">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
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
                    <Award size={12} style={{ color: hitRate >= 70 ? "oklch(0.72 0.18 165)" : "oklch(0.82 0.17 85)" }} />
                    <span className="text-[9px] sm:text-[10px] font-bold text-white mt-0.5">{hits.length} Hits</span>
                  </div>
                </div>
              )}
            </div>

            {/* Progress bar: hits vs misses vs pending */}
            {(hasActuals || liveResults.length > 0 || pendingResults.length > 0) && (
              <div className="mt-3 sm:mt-4">
                <div className="flex gap-0.5 h-2 sm:h-2.5 rounded-full overflow-hidden" style={{ background: "oklch(0.18 0.02 255)" }}>
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
                  {liveResults.length > 0 && (
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: "oklch(0.82 0.17 85)" }}
                      initial={{ flex: 0 }}
                      animate={{ flex: liveResults.length }}
                      transition={{ delay: 0.6, duration: 0.8, ease: "easeOut" }}
                    />
                  )}
                  {pendingResults.length > 0 && (
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: "oklch(0.30 0.02 255)" }}
                      initial={{ flex: 0 }}
                      animate={{ flex: pendingResults.length }}
                      transition={{ delay: 0.7, duration: 0.8, ease: "easeOut" }}
                    />
                  )}
                </div>

                {/* Legend */}
                <div className="flex items-center gap-3 sm:gap-4 mt-2 flex-wrap">
                  {hits.length > 0 && (
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full" style={{ background: "oklch(0.72 0.18 165)" }} />
                      <span className="text-[9px] sm:text-[10px] text-[oklch(0.55_0.015_255)] font-medium">{hits.length} Hit</span>
                    </div>
                  )}
                  {misses.length > 0 && (
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full" style={{ background: "oklch(0.68 0.22 25)" }} />
                      <span className="text-[9px] sm:text-[10px] text-[oklch(0.55_0.015_255)] font-medium">{misses.length} Miss</span>
                    </div>
                  )}
                  {liveResults.length > 0 && (
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full" style={{ background: "oklch(0.82 0.17 85)" }} />
                      <span className="text-[9px] sm:text-[10px] text-[oklch(0.55_0.015_255)] font-medium">{liveResults.length} Live</span>
                    </div>
                  )}
                  {pendingResults.length > 0 && (
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full" style={{ background: "oklch(0.30 0.02 255)" }} />
                      <span className="text-[9px] sm:text-[10px] text-[oklch(0.55_0.015_255)] font-medium">{pendingResults.length} Pending</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Source-based hit rate breakdown */}
          {hasActuals && (
            <div className="grid grid-cols-3 gap-1.5 sm:gap-2 mt-3">
              {[
                { value: `${moneyHitRate}%`, label: "Money Picks", sublabel: `${moneyHits.length}/${moneyFinal.length}`, icon: Flame, color: "oklch(0.75 0.18 55)" },
                { value: `${allPlaysHitRate}%`, label: "All Plays", sublabel: `${allPlaysHits.length}/${allPlaysFinal.length}`, icon: TrendingUp, color: "oklch(0.82 0.17 85)" },
                { value: `${resultsData?.totalPlays || 0}`, label: "Total Plays", sublabel: `${resultsData?.moneyPlays || 0} + ${resultsData?.allPlaysCount || 0}`, icon: Target, color: "oklch(0.72 0.18 165)" },
              ].map((stat, i) => (
                <motion.div
                  key={stat.label}
                  className="rounded-xl p-2.5 sm:p-3 text-center border"
                  style={{ background: "oklch(0.13 0.022 255)", borderColor: "oklch(1 0 0 / 8%)" }}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 + i * 0.1, duration: 0.4 }}
                >
                  <stat.icon size={11} className="mx-auto mb-1" style={{ color: stat.color }} />
                  <div className="text-base sm:text-lg font-bold text-white font-stat">{stat.value}</div>
                  <div className="text-[8px] sm:text-[9px] text-[oklch(0.40_0.015_255)] uppercase font-semibold tracking-wider">{stat.label}</div>
                  <div className="text-[8px] text-[oklch(0.35_0.015_255)] mt-0.5">{stat.sublabel}</div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Safer play tip */}
      <div className="px-3 sm:px-4 mb-3 sm:mb-4">
        <SaferPlayTip />
      </div>

      {/* Results List */}
      <div className="px-3 sm:px-4 space-y-2.5 sm:space-y-3">
        {/* Live games section */}
        {liveResults.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xs sm:text-sm font-bold text-white flex items-center gap-1.5 sm:gap-2">
                <Radio size={13} style={{ color: "oklch(0.82 0.17 85)" }} />
                In Progress
              </h3>
              <span className="text-[9px] sm:text-[10px] text-[oklch(0.45_0.015_255)] font-medium px-2 py-0.5 rounded-lg" style={{ background: "oklch(0.18 0.02 255)" }}>
                {liveResults.length} plays
              </span>
            </div>
            {liveResults.map((play: any, idx: number) => (
              <ResultCard key={`live-${play.playerId}-${play.stat}-${idx}`} play={play} idx={idx} />
            ))}
          </>
        )}

        {/* Final games section */}
        {finalResults.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-1 mt-4">
              <h3 className="text-xs sm:text-sm font-bold text-white flex items-center gap-1.5 sm:gap-2">
                <Trophy size={13} style={{ color: "oklch(0.72 0.18 165)" }} />
                Final
              </h3>
              <span className="text-[9px] sm:text-[10px] text-[oklch(0.45_0.015_255)] font-medium px-2 py-0.5 rounded-lg" style={{ background: "oklch(0.18 0.02 255)" }}>
                {finalResults.length} plays
              </span>
            </div>
            {finalResults.map((play: any, idx: number) => (
              <ResultCard key={`final-${play.playerId}-${play.stat}-${idx}`} play={play} idx={idx} />
            ))}
          </>
        )}

        {/* Pending games section */}
        {pendingResults.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-1 mt-4">
              <h3 className="text-xs sm:text-sm font-bold text-white flex items-center gap-1.5 sm:gap-2">
                <Clock size={13} style={{ color: "oklch(0.50 0.015 255)" }} />
                Upcoming
              </h3>
              <span className="text-[9px] sm:text-[10px] text-[oklch(0.45_0.015_255)] font-medium px-2 py-0.5 rounded-lg" style={{ background: "oklch(0.18 0.02 255)" }}>
                {pendingResults.length} plays
              </span>
            </div>
            {pendingResults.map((play: any, idx: number) => (
              <ResultCard key={`pending-${play.playerId}-${play.stat}-${idx}`} play={play} idx={idx} />
            ))}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="text-center py-6 sm:py-8 px-4">
        <p className="text-[10px] sm:text-[11px] text-[oklch(0.35_0.015_255)] leading-relaxed">
          Auto-refreshes every 2 minutes during games. Last updated: {lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}
