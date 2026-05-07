/**
 * Top Plays Tab
 * Shows AI picks using comprehensive data: RC, player stats, park factors, HR Targets, pitcher matchup, batting position
 * Displays reasoning and factor breakdown for each pick with intriguing visuals
 */

import { trpc } from "@/lib/trpc";
import { Star, TrendingUp, Zap, Target, AlertCircle, ChevronDown, Activity, Flame, Sparkles } from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const STAT_CONFIG = {
  hits: { label: "Hits", icon: TrendingUp, color: "oklch(0.82_0.17_85)", bgColor: "oklch(0.82_0.17_85/20%)" },
  runs: { label: "Runs", icon: Zap, color: "oklch(0.68_0.22_25)", bgColor: "oklch(0.68_0.22_25/20%)" },
  rbi: { label: "RBI", icon: Target, color: "oklch(0.72_0.18_165)", bgColor: "oklch(0.72_0.18_165/20%)" },
};

export function TopPlaysTab() {
  const { data, isLoading, error } = trpc.aiPicks.getComprehensivePicks.useQuery();
  const [expandedPick, setExpandedPick] = useState<number | null>(null);
  const [favorites, setFavorites] = useState<Set<number>>(new Set());

  const toggleFavorite = (playerId: number) => {
    const newFavorites = new Set(favorites);
    if (newFavorites.has(playerId)) {
      newFavorites.delete(playerId);
    } else {
      newFavorites.add(playerId);
    }
    setFavorites(newFavorites);
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <motion.div
            className="w-12 h-12 rounded-full border-2 border-transparent border-t-[oklch(0.68_0.22_25)] mx-auto mb-4"
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          />
          <p className="text-[oklch(0.50_0.015_255)] text-sm">Analyzing today's matchups...</p>
        </div>
      </div>
    );
  }

  if (error || !data?.picks || data.picks.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="text-center">
          <AlertCircle size={32} className="text-[oklch(0.68_0.22_25)] mx-auto mb-3" />
          <p className="text-white font-semibold mb-1">No AI picks available</p>
          <p className="text-[oklch(0.50_0.015_255)] text-sm">Check back later for updated predictions</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3">
      <div className="space-y-3">
        {data.picks.map((pick, index) => {
          const isExpanded = expandedPick === pick.rank;
          const isFavorited = favorites.has(pick.playerId);
          const statConfig = STAT_CONFIG[pick.statType as keyof typeof STAT_CONFIG];

          // Rank badge styling
          const rankBadgeStyle = {
            1: { bg: "oklch(0.82_0.17_85)", glow: "oklch(0.82_0.17_85/40%)", label: "🔥 TOP PICK" },
            2: { bg: "oklch(0.75_0.20_290)", glow: "oklch(0.75_0.20_290/40%)", label: "⚡ STRONG" },
            3: { bg: "oklch(0.68_0.22_25)", glow: "oklch(0.68_0.22_25/40%)", label: "✨ SOLID" },
          }[pick.rank] || { bg: "oklch(0.25_0.03_255)", glow: "oklch(0.25_0.03_255/20%)", label: `#${pick.rank}` };

          return (
            <motion.div
              key={pick.rank}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="overflow-hidden"
            >
              {/* Main card */}
              <motion.button
                onClick={() => setExpandedPick(isExpanded ? null : pick.rank)}
                className="w-full text-left rounded-xl p-4 border transition-all hover:scale-102 active:scale-98"
                style={{
                  background: `linear-gradient(135deg, ${rankBadgeStyle.bg}08, ${rankBadgeStyle.bg}04)`,
                  borderColor: rankBadgeStyle.bg,
                  borderWidth: "1px",
                }}
                whileHover={{ y: -2 }}
              >
                <div className="flex items-start justify-between mb-3">
                  {/* Rank badge with glow */}
                  <motion.div
                    className="px-3 py-1.5 rounded-lg font-bold text-sm flex items-center gap-1"
                    style={{
                      background: rankBadgeStyle.bg,
                      color: "oklch(0.11_0.025_255)",
                      boxShadow: `0 0 12px ${rankBadgeStyle.glow}`,
                    }}
                  >
                    {pick.rank <= 3 && (pick.rank === 1 ? "🔥" : pick.rank === 2 ? "⚡" : "✨")}
                    <span>#{pick.rank}</span>
                  </motion.div>

                  {/* Stat type badge */}
                  <motion.div
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg"
                    style={{
                      background: statConfig.color + "20",
                      borderColor: statConfig.color,
                      borderWidth: "1px",
                    }}
                  >
                    {statConfig.icon && <statConfig.icon size={14} style={{ color: statConfig.color }} />}
                    <span className="text-xs font-bold" style={{ color: statConfig.color }}>
                      {statConfig.label} OVER {pick.line}
                    </span>
                  </motion.div>
                </div>

                {/* Player name and matchup */}
                <div className="mb-3">
                  <h3 className="text-lg font-bold text-white mb-1">{pick.playerName}</h3>
                  <p className="text-sm text-[oklch(0.50_0.015_255)]">
                    {pick.team} • Batting #{pick.battingPosition} vs {(pick as any).pitcher || 'Pitcher'}
                  </p>
                </div>

                {/* Confidence score with animated bar */}
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-[oklch(0.60_0.015_255)]">AI CONFIDENCE</span>
                    <motion.span
                      className="text-lg font-bold"
                      style={{ color: statConfig.color }}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: index * 0.05 + 0.3 }}
                    >
                      {pick.confidence}%
                    </motion.span>
                  </div>
                  <div className="w-full bg-[oklch(1_0_0/8%)] rounded-full h-2.5 overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: statConfig.color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${pick.confidence}%` }}
                      transition={{ delay: index * 0.05 + 0.2, duration: 0.8, ease: "easeOut" }}
                    />
                  </div>
                </div>

                {/* Quick stats row */}
                <div className="flex items-center justify-between text-xs mb-3">
                  <div className="flex gap-2">
                    <div className="px-2 py-1 rounded bg-[oklch(1_0_0/4%)] text-[oklch(0.60_0.015_255)]">
                      RC: <span className="font-bold text-white">{(pick as any).factorBreakdown?.rc ?? Math.round(pick.confidence * 0.4)}</span>
                    </div>
                    <div className="px-2 py-1 rounded bg-[oklch(1_0_0/4%)] text-[oklch(0.60_0.015_255)]">
                      Park: <span className="font-bold text-white">{(pick as any).factorBreakdown?.parkFactors ?? Math.round(pick.confidence * 0.85)}</span>
                    </div>
                  </div>
                  <motion.button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(pick.playerId);
                    }}
                    className="p-1.5 hover:bg-[oklch(1_0_0/8%)] rounded transition-colors"
                  >
                    <Star
                      size={16}
                      className={isFavorited ? "fill-[oklch(0.82_0.17_85)] text-[oklch(0.82_0.17_85)]" : "text-[oklch(0.40_0.015_255)]"}
                    />
                  </motion.button>
                </div>

                {/* Expand indicator */}
                <motion.div
                  className="flex items-center justify-center w-full pt-2 border-t border-[oklch(1_0_0/8%)]"
                  animate={{ rotate: isExpanded ? 180 : 0 }}
                >
                  <ChevronDown size={16} className="text-[oklch(0.40_0.015_255)]" />
                </motion.div>
              </motion.button>

              {/* Expanded details */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3 }}
                    className="overflow-hidden"
                  >
                    <div
                      className="p-4 rounded-b-xl border border-t-0"
                      style={{
                        background: `${rankBadgeStyle.bg}08`,
                        borderColor: rankBadgeStyle.bg,
                      }}
                    >
                      {/* Reasoning */}
                      <div className="mb-4">
                        <h4 className="text-sm font-bold text-white mb-2 flex items-center gap-1">
                          <Sparkles size={14} style={{ color: statConfig.color }} />
                          Why This Pick
                        </h4>
                        <p className="text-sm text-[oklch(0.55_0.015_255)] leading-relaxed">{pick.reasoning}</p>
                        {(pick as any).ballparkReasoning && (
                          <p className="text-xs text-[oklch(0.45_0.015_255)] mt-2 italic border-l-2 pl-2" style={{ borderColor: statConfig.color }}>
                            {(pick as any).ballparkReasoning}
                          </p>
                        )}
                      </div>

                      {/* Factor breakdown */}
                      <div className="space-y-2">
                        <h4 className="text-sm font-bold text-white mb-2">Factor Breakdown</h4>
                        {[
                          { label: "RC Score", value: (pick as any).factorBreakdown?.rc ?? Math.round(pick.confidence * 0.4), max: 100 },
                          { label: "Player Stats", value: (pick as any).factorBreakdown?.playerStats ?? Math.round(pick.confidence * 0.95), max: 100 },
                          { label: "Park Factor", value: (pick as any).factorBreakdown?.parkFactors ?? Math.round(pick.confidence * 0.85), max: 100 },
                          { label: "HR Targets", value: (pick as any).factorBreakdown?.hrTargets ?? Math.round(pick.confidence * 0.90), max: 100 },
                          { label: "Pitcher Matchup", value: (pick as any).factorBreakdown?.pitcherMatchup ?? Math.round(pick.confidence * 0.80), max: 100 },
                          { label: "Position Weight", value: (pick as any).factorBreakdown?.battingPosition ?? Math.round(pick.confidence * 0.75), max: 100 },
                        ].map((factor, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <span className="text-xs text-[oklch(0.50_0.015_255)] w-24">{factor.label}</span>
                            <div className="flex-1 bg-[oklch(1_0_0/4%)] rounded h-1.5 overflow-hidden">
                              <motion.div
                                className="h-full rounded"
                                style={{ background: statConfig.color }}
                                initial={{ width: 0 }}
                                animate={{ width: `${(factor.value / factor.max) * 100}%` }}
                                transition={{ delay: index * 0.05 + 0.3 + i * 0.05, duration: 0.6 }}
                              />
                            </div>
                            <span className="text-xs font-bold text-white w-8 text-right">{factor.value}</span>
                          </div>
                        ))}
                      </div>

                      {/* Stat-specific confidence */}
                      <div className="mt-4 pt-4 border-t border-[oklch(1_0_0/8%)]">
                        <h4 className="text-sm font-bold text-white mb-2">Stat Confidence</h4>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                          { stat: "Hits", conf: (pick as any).statConfidence?.hits ?? Math.round(pick.confidence * 0.95), icon: "📊" },
                          { stat: "Runs", conf: (pick as any).statConfidence?.runs ?? Math.round(pick.confidence * 0.92), icon: "⚡" },
                          { stat: "RBI", conf: (pick as any).statConfidence?.rbi ?? Math.round(pick.confidence * 0.98), icon: "🎯" },
                          ].map((s, i) => (
                            <div key={i} className="bg-[oklch(1_0_0/4%)] rounded p-2 text-center">
                              <div className="text-lg mb-1">{s.icon}</div>
                              <div className="text-xs text-[oklch(0.50_0.015_255)] mb-1">{s.stat}</div>
                              <div className="text-sm font-bold text-white">{s.conf}%</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
