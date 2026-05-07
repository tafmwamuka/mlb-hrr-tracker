import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { Star, TrendingUp, Zap, Target } from "lucide-react";
import { useState } from "react";

interface Prediction {
  id: string;
  playerName: string;
  gameDate: string;
  hitsPrediction?: { prediction: string; confidence: number; line: number };
  runsPrediction?: { prediction: string; confidence: number; line: number };
  rbiPrediction?: { prediction: string; confidence: number; line: number };
  avgConfidence?: number;
}

const STAT_COLORS = {
  hits: "oklch(0.82 0.17 85)",
  runs: "oklch(0.68 0.22 25)",
  rbi: "oklch(0.72 0.18 165)",
};

const STAT_ICONS = {
  hits: TrendingUp,
  runs: Zap,
  rbi: Target,
};

export function TopPlaysTab() {
  const { data: predictions, isLoading } = trpc.props.getHighConfidenceProps.useQuery();
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-pulse text-[oklch(0.50_0.015_255)]">Loading top plays...</div>
      </div>
    );
  }

  if (!predictions || predictions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <TrendingUp size={48} className="text-[oklch(0.40_0.015_255)] mb-3" />
        <p className="text-[oklch(0.50_0.015_255)] text-center">No high-confidence picks available</p>
      </div>
    );
  }

  // Get top 5 picks by average confidence
  const topPicks = predictions
    .slice(0, 5)
    .map((p: any) => ({
      id: p.id,
      playerName: p.playerName,
      gameDate: p.gameDate,
      hitsPrediction: p.hitsPrediction,
      runsPrediction: p.runsPrediction,
      rbiPrediction: p.rbiPrediction,
      avgConfidence: p.avgConfidence || 0,
    }));

  const toggleFavorite = (id: string) => {
    const newFavorites = new Set(favorites);
    if (newFavorites.has(id)) {
      newFavorites.delete(id);
    } else {
      newFavorites.add(id);
    }
    setFavorites(newFavorites);
  };

  return (
    <div className="space-y-3 px-4 pb-4">
      {topPicks.map((pick, idx) => (
        <motion.div
          key={pick.id}
          className="rounded-xl p-4 border border-[oklch(1_0_0/8%)]"
          style={{ background: "oklch(0.14 0.022 255)" }}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: idx * 0.05 }}
        >
          {/* Header with player name and favorite */}
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-bold text-white">{pick.playerName}</h3>
              <p className="text-[10px] text-[oklch(0.40_0.015_255)]">
                {new Date(pick.gameDate).toLocaleDateString()}
              </p>
            </div>
            <button
              onClick={() => toggleFavorite(pick.id)}
              className="transition-transform active:scale-90"
            >
              <Star
                size={20}
                className={favorites.has(pick.id) ? "fill-current" : ""}
                style={{
                  color: favorites.has(pick.id) ? "oklch(0.82 0.17 85)" : "oklch(0.40 0.015 255)",
                }}
              />
            </button>
          </div>

          {/* Predictions */}
          <div className="space-y-2">
            {pick.hitsPrediction && (
              <PredictionRow
                stat="hits"
                prediction={pick.hitsPrediction}
                color={STAT_COLORS.hits}
                icon={STAT_ICONS.hits}
              />
            )}
            {pick.runsPrediction && (
              <PredictionRow
                stat="runs"
                prediction={pick.runsPrediction}
                color={STAT_COLORS.runs}
                icon={STAT_ICONS.runs}
              />
            )}
            {pick.rbiPrediction && (
              <PredictionRow
                stat="rbi"
                prediction={pick.rbiPrediction}
                color={STAT_COLORS.rbi}
                icon={STAT_ICONS.rbi}
              />
            )}
          </div>

          {/* Overall confidence */}
          <div className="mt-3 pt-3 border-t border-[oklch(1_0_0/8%)] flex items-center justify-between">
            <span className="text-xs text-[oklch(0.50_0.015_255)]">Avg Confidence</span>
            <div className="flex items-center gap-2">
              <div className="w-20 h-2 rounded-full bg-[oklch(1_0_0/8%)] overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: "oklch(0.82 0.17 85)" }}
                  initial={{ width: 0 }}
                  animate={{ width: `${pick.avgConfidence}%` }}
                  transition={{ delay: idx * 0.05 + 0.2, duration: 0.6 }}
                />
              </div>
              <span className="text-sm font-bold" style={{ color: "oklch(0.82 0.17 85)" }}>
                {Math.round(pick.avgConfidence)}%
              </span>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function PredictionRow({
  stat,
  prediction,
  color,
  icon: Icon,
}: {
  stat: string;
  prediction: { prediction: string; confidence: number; line: number };
  color: string;
  icon: any;
}) {
  return (
    <div className="flex items-center justify-between p-2 rounded-lg" style={{ background: `${color}15` }}>
      <div className="flex items-center gap-2">
        <Icon size={14} style={{ color }} />
        <div>
          <span className="text-xs font-semibold text-white capitalize">{stat}</span>
          <span className="text-[10px] text-[oklch(0.50_0.015_255)] ml-1">
            {prediction.prediction} {prediction.line}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <div className="w-12 h-1.5 rounded-full bg-[oklch(1_0_0/8%)] overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ background: color }}
            initial={{ width: 0 }}
            animate={{ width: `${prediction.confidence}%` }}
            transition={{ delay: 0.1, duration: 0.5 }}
          />
        </div>
        <span className="text-xs font-bold" style={{ color }}>
          {Math.round(prediction.confidence)}%
        </span>
      </div>
    </div>
  );
}
