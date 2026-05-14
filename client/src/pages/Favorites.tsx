import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { Star, TrendingUp, Zap, Target, Trash2, CheckCircle, XCircle, Clock } from "lucide-react";
import { useLocation } from "wouter";

const STAT_COLORS = {
  hits: "oklch(0.82 0.17 85)",
  runs: "oklch(0.68 0.22 25)",
  rbi: "oklch(0.72 0.18 165)",
} as const;

const STAT_ICONS = {
  hits: TrendingUp,
  runs: Zap,
  rbi: Target,
} as const;

export default function Favorites() {
  const [, navigate] = useLocation();
  const [selectedTab, setSelectedTab] = useState<"top3" | "history">("top3");

  // Fetch data
  const topThreeQuery = trpc.favorites.getTopThreePlays.useQuery();
  const historyQuery = trpc.favorites.getFavoritesHistory.useQuery();
  const hitRateQuery = trpc.favorites.getUserHitRate.useQuery();

  // Mutations
  const removeFavoriteMutation = trpc.favorites.removeFavorite.useMutation({
    onSuccess: () => {
      topThreeQuery.refetch();
      historyQuery.refetch();
    },
  });

  const updateResultMutation = trpc.favorites.updateFavoriteResult.useMutation({
    onSuccess: () => {
      topThreeQuery.refetch();
      historyQuery.refetch();
      hitRateQuery.refetch();
    },
  });

  const topThreePlays = topThreeQuery.data || [];
  const allHistory = historyQuery.data || [];
  const hitRate = hitRateQuery.data || { total: 0, hits: 0, misses: 0, hitRate: 0 };

  const handleRemove = (id: number) => {
    removeFavoriteMutation.mutate({ favoriteId: id });
  };

  const handleMarkResult = (id: number, result: "hit" | "miss") => {
    updateResultMutation.mutate({ favoriteId: id, result });
  };

  const renderPlayCard = (play: any, index: number) => {
    const color = STAT_COLORS[play.statType as keyof typeof STAT_COLORS];
    const Icon = STAT_ICONS[play.statType as keyof typeof STAT_ICONS];
    const resultIcon =
      play.result === "hit"
        ? CheckCircle
        : play.result === "miss"
          ? XCircle
          : Clock;
    const ResultIcon = resultIcon;

    const resultColor =
      play.result === "hit"
        ? "oklch(0.65 0.20 140)"
        : play.result === "miss"
          ? "oklch(0.65 0.20 25)"
          : "oklch(0.50 0.015 255)";

    return (
      <motion.div
        key={play.id}
        className="rounded-2xl p-4 border"
        style={{
          background: `linear-gradient(135deg, ${color}15, ${color}05)`,
          border: `1px solid ${color}40`,
        }}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.1 }}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <Icon size={18} style={{ color }} />
            <div>
              <div className="font-semibold text-white text-sm">
                {play.playerName}
              </div>
              <div className="text-xs text-[oklch(0.50_0.015_255)]">
                {play.playerTeam}
              </div>
            </div>
          </div>
          <button
            onClick={() => handleRemove(play.id)}
            className="text-[oklch(0.50_0.015_255)] hover:text-white transition-colors p-1"
          >
            <Trash2 size={16} />
          </button>
        </div>

        {/* Prediction */}
        <div className="mb-3 p-2 rounded-lg" style={{ background: `${color}20` }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-[oklch(0.40_0.015_255)]">
              {play.statType.toUpperCase()}
            </span>
            <span
              className="text-xs font-bold px-2 py-1 rounded"
              style={{ color: "white", background: color }}
            >
              {play.prediction.toUpperCase()} {play.line}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[oklch(0.50_0.015_255)]">
              {play.reasoning}
            </span>
            <span
              className="text-xs font-bold"
              style={{ color }}
            >
              {play.confidence}%
            </span>
          </div>
        </div>

        {/* Result */}
        <div className="flex items-center gap-2">
          {play.result === "pending" ? (
            <>
              <button
                onClick={() => handleMarkResult(play.id, "hit")}
                className="flex-1 py-2 px-3 rounded-lg text-xs font-semibold text-white bg-[oklch(0.65_0.20_140)] hover:opacity-90 transition-opacity"
              >
                ✓ Hit
              </button>
              <button
                onClick={() => handleMarkResult(play.id, "miss")}
                className="flex-1 py-2 px-3 rounded-lg text-xs font-semibold text-white bg-[oklch(0.65_0.20_25)] hover:opacity-90 transition-opacity"
              >
                ✗ Miss
              </button>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg" style={{ background: `${resultColor}20` }}>
              <ResultIcon size={16} style={{ color: resultColor }} />
              <span className="text-xs font-semibold" style={{ color: resultColor }}>
                {play.result === "hit" ? "HIT" : play.result === "miss" ? "MISS" : "PENDING"}
              </span>
            </div>
          )}
        </div>

        {/* Game date */}
        <div className="text-[10px] text-[oklch(0.40_0.015_255)] mt-2">
          {new Date(play.gameDate).toLocaleDateString()}
        </div>
      </motion.div>
    );
  };

  return (
    <div
      className="flex flex-col h-screen max-w-[480px] mx-auto overflow-hidden"
      style={{ background: "linear-gradient(180deg, oklch(0.11 0.025 255) 0%, oklch(0.09 0.020 255) 100%)" }}
    >
      {/* Header */}
      <header className="shrink-0 px-4 pt-12 pb-4 border-b border-[oklch(1_0_0/8%)]">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => navigate("/")}
            className="text-[oklch(0.50_0.015_255)] hover:text-white transition-colors"
          >
            ← Back
          </button>
          <h1 className="font-stat text-2xl font-extrabold text-white">
            My Plays
          </h1>
          <div className="w-10" /> {/* Spacer */}
        </div>

        {/* Hit Rate Stats */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg p-2" style={{ background: "oklch(0.18 0.02 255)" }}>
            <div className="text-[10px] text-[oklch(0.40_0.015_255)] font-semibold">
              TOTAL
            </div>
            <div className="text-xl font-bold text-white">
              {hitRate.total}
            </div>
          </div>
          <div className="rounded-lg p-2" style={{ background: "oklch(0.65 0.20 140 / 15%)" }}>
            <div className="text-[10px] text-[oklch(0.65_0.20_140)] font-semibold">
              HITS
            </div>
            <div className="text-xl font-bold" style={{ color: "oklch(0.65 0.20 140)" }}>
              {hitRate.hits}
            </div>
          </div>
          <div className="rounded-lg p-2" style={{ background: "oklch(0.50 0.015 255 / 20%)" }}>
            <div className="text-[10px] text-[oklch(0.50_0.015_255)] font-semibold">
              HIT RATE
            </div>
            <div className="text-xl font-bold text-white">
              {hitRate.hitRate}%
            </div>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="shrink-0 flex gap-2 px-4 py-3 border-b border-[oklch(1_0_0/8%)]">
        <button
          onClick={() => setSelectedTab("top3")}
          className={`flex-1 py-2 px-3 rounded-lg font-semibold text-sm transition-all ${
            selectedTab === "top3"
              ? "bg-[oklch(0.82_0.17_85)] text-white"
              : "bg-[oklch(0.18_0.02_255)] text-[oklch(0.50_0.015_255)]"
          }`}
        >
          <Star size={14} className="inline mr-1" />
          Top 3 Today
        </button>
        <button
          onClick={() => setSelectedTab("history")}
          className={`flex-1 py-2 px-3 rounded-lg font-semibold text-sm transition-all ${
            selectedTab === "history"
              ? "bg-[oklch(0.72_0.18_165)] text-white"
              : "bg-[oklch(0.18_0.02_255)] text-[oklch(0.50_0.015_255)]"
          }`}
        >
          History
        </button>
      </div>

      {/* Content */}
      <main className="flex-1 overflow-y-auto scrollbar-hide">
        <div className="p-4 space-y-3">
          <AnimatePresence mode="wait">
            {selectedTab === "top3" ? (
              <motion.div
                key="top3"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {topThreePlays.length === 0 ? (
                  <div className="text-center py-12">
                    <Star size={32} className="mx-auto mb-3 text-[oklch(0.40_0.015_255)]" />
                    <p className="text-[oklch(0.50_0.015_255)] text-sm">
                      No plays marked yet
                    </p>
                    <p className="text-[oklch(0.40_0.015_255)] text-xs mt-1">
                      Go to Money Picks and add your favorite predictions
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {topThreePlays.map((play, i) => renderPlayCard(play, i))}
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="history"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {allHistory.length === 0 ? (
                  <div className="text-center py-12">
                    <Clock size={32} className="mx-auto mb-3 text-[oklch(0.40_0.015_255)]" />
                    <p className="text-[oklch(0.50_0.015_255)] text-sm">
                      No history yet
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {allHistory.map((play, i) => renderPlayCard(play, i))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
