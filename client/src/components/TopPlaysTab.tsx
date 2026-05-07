/**
 * Top Plays Tab
 * Shows AI picks using comprehensive data: RC, player stats, park factors, HR Targets, pitcher matchup, batting position
 * Displays reasoning and factor breakdown for each pick
 */

import { trpc } from "@/lib/trpc";
import { Star, TrendingUp, Zap, Target, AlertCircle, ChevronDown } from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

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
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[oklch(0.68_0.22_25)] mx-auto mb-4"></div>
          <p className="text-[oklch(0.50_0.015_255)] text-sm">Loading AI picks...</p>
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

          // Rank badge colors
          const rankColors: Record<number, string> = {
            1: "bg-[oklch(0.82_0.17_85)] text-[oklch(0.11_0.025_255)]", // Gold
            2: "bg-[oklch(0.75_0.20_290)] text-[oklch(0.11_0.025_255)]", // Purple
            3: "bg-[oklch(0.68_0.22_25)] text-white", // Red
          };

          const rankColor =
            pick.rank <= 3
              ? rankColors[pick.rank]
              : "bg-[oklch(0.25_0.03_255)] text-[oklch(0.65_0.015_255)]";

          return (
            <motion.div
              key={pick.rank}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="rounded-xl overflow-hidden border border-[oklch(1_0_0/8%)]"
              style={{ background: "oklch(0.14 0.022 255)" }}
            >
              {/* Header */}
              <button
                onClick={() => setExpandedPick(isExpanded ? null : pick.rank)}
                className="w-full px-4 py-3 flex items-center gap-3 hover:bg-[oklch(1_0_0/4%)] transition-colors active:scale-95"
              >
                {/* Rank Badge */}
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm shrink-0 ${rankColor}`}>
                  #{pick.rank}
                </div>

                {/* Player Info */}
                <div className="flex-1 min-w-0 text-left">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-semibold truncate">{pick.playerName}</span>
                    <span className="text-[oklch(0.50_0.015_255)] text-xs px-2 py-1 rounded bg-[oklch(1_0_0/4%)]">
                      {pick.position}
                    </span>
                    <span className="text-[oklch(0.40_0.015_255)] text-xs">Batting #{pick.battingPosition}</span>
                  </div>
                  <div className="text-xs text-[oklch(0.50_0.015_255)] mt-0.5">
                    vs {pick.pitcher} • {pick.team}
                  </div>
                </div>

                {/* Confidence & Favorite */}
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <div className="text-lg font-bold text-[oklch(0.82_0.17_85)]">{pick.confidence}%</div>
                    <div className="text-[10px] text-[oklch(0.40_0.015_255)]">Confidence</div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(pick.playerId);
                    }}
                    className="p-2 hover:bg-[oklch(1_0_0/8%)] rounded-lg transition-colors active:scale-90"
                  >
                    <Star
                      size={18}
                      className={isFavorited ? "fill-[oklch(0.82_0.17_85)] text-[oklch(0.82_0.17_85)]" : "text-[oklch(0.40_0.015_255)]"}
                    />
                  </button>
                </div>

                {/* Expand Icon */}
                <ChevronDown
                  size={16}
                  className={`text-[oklch(0.50_0.015_255)] transition-transform ${isExpanded ? "rotate-180" : ""}`}
                />
              </button>

              {/* Expanded Details */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="border-t border-[oklch(1_0_0/8%)] px-4 py-3 space-y-3"
                  >
                    {/* Reasoning */}
                    <div>
                      <div className="text-xs font-semibold text-[oklch(0.50_0.015_255)] uppercase mb-1">Why This Pick</div>
                      <p className="text-sm text-white leading-relaxed">{pick.reasoning}</p>
                    </div>

                    {/* Factor Breakdown */}
                    <div>
                      <div className="text-xs font-semibold text-[oklch(0.50_0.015_255)] uppercase mb-2">Factor Breakdown</div>
                      <div className="grid grid-cols-2 gap-2">
                        {/* RC Score */}
                        <div className="bg-[oklch(1_0_0/4%)] rounded-lg p-2">
                          <div className="flex items-center gap-1 mb-1">
                            <TrendingUp size={12} className="text-[oklch(0.82_0.17_85)]" />
                            <span className="text-[10px] font-semibold text-[oklch(0.50_0.015_255)]">RC</span>
                          </div>
                          <div className="text-sm font-bold text-white">{pick.factorBreakdown.rc}%</div>
                          <div className="w-full bg-[oklch(1_0_0/8%)] rounded-full h-1 mt-1">
                            <div
                              className="bg-[oklch(0.82_0.17_85)] h-full rounded-full"
                              style={{ width: `${pick.factorBreakdown.rc}%` }}
                            />
                          </div>
                        </div>

                        {/* Player Stats */}
                        <div className="bg-[oklch(1_0_0/4%)] rounded-lg p-2">
                          <div className="flex items-center gap-1 mb-1">
                            <Target size={12} className="text-[oklch(0.68_0.22_25)]" />
                            <span className="text-[10px] font-semibold text-[oklch(0.50_0.015_255)]">Stats</span>
                          </div>
                          <div className="text-sm font-bold text-white">{pick.factorBreakdown.playerStats}%</div>
                          <div className="w-full bg-[oklch(1_0_0/8%)] rounded-full h-1 mt-1">
                            <div
                              className="bg-[oklch(0.68_0.22_25)] h-full rounded-full"
                              style={{ width: `${pick.factorBreakdown.playerStats}%` }}
                            />
                          </div>
                        </div>

                        {/* Park Factors */}
                        <div className="bg-[oklch(1_0_0/4%)] rounded-lg p-2">
                          <div className="flex items-center gap-1 mb-1">
                            <Zap size={12} className="text-[oklch(0.72_0.18_165)]" />
                            <span className="text-[10px] font-semibold text-[oklch(0.50_0.015_255)]">Park</span>
                          </div>
                          <div className="text-sm font-bold text-white">{pick.factorBreakdown.parkFactors}%</div>
                          <div className="w-full bg-[oklch(1_0_0/8%)] rounded-full h-1 mt-1">
                            <div
                              className="bg-[oklch(0.72_0.18_165)] h-full rounded-full"
                              style={{ width: `${pick.factorBreakdown.parkFactors}%` }}
                            />
                          </div>
                        </div>

                        {/* HR Targets */}
                        <div className="bg-[oklch(1_0_0/4%)] rounded-lg p-2">
                          <div className="flex items-center gap-1 mb-1">
                            <TrendingUp size={12} className="text-[oklch(0.75_0.20_290)]" />
                            <span className="text-[10px] font-semibold text-[oklch(0.50_0.015_255)]">HR Targets</span>
                          </div>
                          <div className="text-sm font-bold text-white">{pick.factorBreakdown.hrTargets}%</div>
                          <div className="w-full bg-[oklch(1_0_0/8%)] rounded-full h-1 mt-1">
                            <div
                              className="bg-[oklch(0.75_0.20_290)] h-full rounded-full"
                              style={{ width: `${pick.factorBreakdown.hrTargets}%` }}
                            />
                          </div>
                        </div>

                        {/* Pitcher Matchup */}
                        <div className="bg-[oklch(1_0_0/4%)] rounded-lg p-2">
                          <div className="flex items-center gap-1 mb-1">
                            <Zap size={12} className="text-[oklch(0.68_0.22_25)]" />
                            <span className="text-[10px] font-semibold text-[oklch(0.50_0.015_255)]">Matchup</span>
                          </div>
                          <div className="text-sm font-bold text-white">{pick.factorBreakdown.pitcherMatchup}%</div>
                          <div className="w-full bg-[oklch(1_0_0/8%)] rounded-full h-1 mt-1">
                            <div
                              className="bg-[oklch(0.68_0.22_25)] h-full rounded-full"
                              style={{ width: `${pick.factorBreakdown.pitcherMatchup}%` }}
                            />
                          </div>
                        </div>

                        {/* Batting Position */}
                        <div className="bg-[oklch(1_0_0/4%)] rounded-lg p-2">
                          <div className="flex items-center gap-1 mb-1">
                            <Target size={12} className="text-[oklch(0.82_0.17_85)]" />
                            <span className="text-[10px] font-semibold text-[oklch(0.50_0.015_255)]">Position</span>
                          </div>
                          <div className="text-sm font-bold text-white">{pick.factorBreakdown.battingPosition}%</div>
                          <div className="w-full bg-[oklch(1_0_0/8%)] rounded-full h-1 mt-1">
                            <div
                              className="bg-[oklch(0.82_0.17_85)] h-full rounded-full"
                              style={{ width: `${pick.factorBreakdown.battingPosition}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Overall Score */}
                    <div className="bg-gradient-to-r from-[oklch(0.82_0.17_85/20%)] to-[oklch(0.75_0.20_290/20%)] rounded-lg p-3 border border-[oklch(0.82_0.17_85/30%)]">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-white">Overall Score</span>
                        <div className="text-2xl font-bold text-[oklch(0.82_0.17_85)]">{pick.overallScore}%</div>
                      </div>
                      <div className="w-full bg-[oklch(1_0_0/8%)] rounded-full h-2 mt-2">
                        <div
                          className="bg-gradient-to-r from-[oklch(0.82_0.17_85)] to-[oklch(0.75_0.20_290)] h-full rounded-full"
                          style={{ width: `${pick.overallScore}%` }}
                        />
                      </div>
                    </div>

                    {/* Prediction */}
                    <div className="bg-[oklch(1_0_0/4%)] rounded-lg p-3 border border-[oklch(0.82_0.17_85/30%)]">
                      <div className="text-xs font-semibold text-[oklch(0.50_0.015_255)] uppercase mb-1">Prediction</div>
                      <div className="flex items-center justify-between">
                        <span className="text-lg font-bold text-[oklch(0.82_0.17_85)]">{pick.prediction.toUpperCase()}</span>
                        <span className="text-sm text-[oklch(0.50_0.015_255)]">Line: {pick.line}</span>
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
