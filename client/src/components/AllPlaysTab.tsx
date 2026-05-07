import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { Star, TrendingUp, Zap, Target, Crown, AlertCircle } from "lucide-react";
import { useState } from "react";

interface MatchupPlay {
  rank: number;
  batter: {
    name: string;
    id: string;
    team: string;
    handedness: string;
  };
  pitcher: {
    name: string;
    id: string;
    team: string;
  };
  matchup: {
    vs: string;
  };
  stats: {
    rc: number;
    hr: number;
    xb: number;
    oneB: number;
    bb: number;
    k: number;
  };
  confidence: number;
  line: number;
}

const RANK_COLORS: Record<number, string> = {
  1: "oklch(0.82 0.17 85)", // Gold
  2: "oklch(0.75 0.20 290)", // Purple
  3: "oklch(0.68 0.22 25)", // Red
  4: "oklch(0.72 0.18 165)", // Teal
  5: "oklch(0.70 0.15 200)", // Blue
  6: "oklch(0.65 0.12 150)", // Cyan
  7: "oklch(0.60 0.10 100)", // Green
  8: "oklch(0.55 0.08 50)", // Yellow
  9: "oklch(0.50 0.06 0)", // Gray
  10: "oklch(0.45 0.05 0)", // Dark Gray
  11: "oklch(0.40 0.04 0)", // Darker Gray
  12: "oklch(0.35 0.03 0)", // Even Darker
  13: "oklch(0.30 0.02 0)", // Very Dark
  14: "oklch(0.25 0.01 0)", // Almost Black
  15: "oklch(0.20 0.01 0)", // Nearly Black
};

const STAT_CONFIG = {
  hits: { label: "Hits", icon: TrendingUp, color: "oklch(0.82_0.17_85)", abbr: "H/O" },
  runs: { label: "Runs", icon: Zap, color: "oklch(0.68_0.22_25)", abbr: "R/O" },
  rbi: { label: "RBI", icon: Target, color: "oklch(0.72_0.18_165)", abbr: "RBI/O" },
};

function determineBestProp(rc: number, stats: any): keyof typeof STAT_CONFIG {
  if (rc > 35) return "rbi";
  if (rc > 30) return "hits";
  return "runs";
}

export function AllPlaysTab() {
  const { data: propsData, isLoading } = trpc.props.getTodayProps.useQuery();
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  // Convert props data to display format with real prediction data
  const matchups = propsData?.slice(0, 15).map((prop: any, idx: number) => {
    // Get the best prediction (highest confidence)
    const predictions = [
      { type: "hits", data: prop.hitsPrediction },
      { type: "runs", data: prop.runsPrediction },
      { type: "rbi", data: prop.rbiPrediction },
    ];
    const bestPred = predictions.reduce((a, b) =>
      (a.data?.confidence || 0) > (b.data?.confidence || 0) ? a : b
    );

    return {
      rank: idx + 1,
      batter: { name: prop.playerName, id: String(prop.playerId), team: "MLB", handedness: "R" },
      pitcher: { name: "Pitcher", id: "TBD", team: "TBD" },
      matchup: { vs: "Today" },
      stats: { rc: 30, hr: 0, xb: 0, oneB: 0, bb: 0, k: 0 },
      confidence: bestPred.data?.confidence || 0,
      line: bestPred.data?.line || 0.5,
    };
  }) || [];

  const toggleFavorite = (batterId: string, pitcherId: string) => {
    const key = `${batterId}-${pitcherId}`;
    const newFavorites = new Set(favorites);
    if (newFavorites.has(key)) {
      newFavorites.delete(key);
    } else {
      newFavorites.add(key);
    }
    setFavorites(newFavorites);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-pulse text-[oklch(0.50_0.015_255)]">Loading all plays...</div>
      </div>
    );
  }

  if (!matchups || matchups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <TrendingUp size={48} className="text-[oklch(0.40_0.015_255)] mb-3" />
        <p className="text-[oklch(0.50_0.015_255)] text-center">No plays available</p>
      </div>
    );
  }

  // Limit to 15 plays
  const topPlays = matchups.slice(0, 15);

  return (
    <div className="space-y-2 px-4 pb-4">
      {topPlays.map((play, idx) => {
        const color = RANK_COLORS[play.rank as keyof typeof RANK_COLORS] || "oklch(0.50 0.015 255)";
        const isTopPlay = play.rank <= 3;
        const bestProp = determineBestProp(play.stats.rc, play.stats);
        const bestPropConfig = STAT_CONFIG[bestProp];
        const BestIcon = bestPropConfig.icon;
        const isFavorited = favorites.has(`${play.batter.id}-${play.pitcher.id}`);

        return (
          <motion.div
            key={`${play.batter.id}-${play.pitcher.id}`}
            className={`rounded-lg p-3 border overflow-hidden transition-all ${
              isTopPlay ? "border-2" : "border"
            }`}
            style={{
              background: isTopPlay ? `${color}15` : "oklch(0.14 0.022 255)",
              borderColor: color,
            }}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.03 }}
            whileHover={{ scale: 1.02 }}
          >
            {/* Header with rank, name, and best prop */}
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2 flex-1">
                {/* Rank badge */}
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${
                    isTopPlay ? "ring-2" : ""
                  }`}
                  style={{
                    background: `${color}30`,
                    color,
                  }}
                >
                  {isTopPlay && <Crown size={14} className="absolute" />}
                  {!isTopPlay && play.rank}
                </div>

                {/* Player name and matchup */}
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-white text-sm truncate">{play.batter.name}</div>
                  <div className="text-xs text-[oklch(0.50_0.015_255)] truncate">{play.matchup.vs}</div>
                </div>
              </div>

              {/* Prop badge and favorite */}
              <div className="flex items-center gap-2 shrink-0">
                <div
                  className="px-2 py-1 rounded-md text-xs font-bold flex items-center gap-1"
                  style={{ background: `${color}30`, color }}
                >
                  <BestIcon size={12} />
                  {bestPropConfig.abbr} {play.line}
                </div>
                <button
                  onClick={() => toggleFavorite(play.batter.id, play.pitcher.id)}
                  className="hover:scale-110 transition-transform"
                >
                  <Star
                    size={18}
                    className={isFavorited ? "fill-current text-[oklch(0.82_0.17_85)]" : "text-[oklch(0.40_0.015_255)]"}
                  />
                </button>
              </div>
            </div>

            {/* Confidence bar and stats */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[oklch(0.50_0.015_255)]">AI CONFIDENCE</span>
                <span className="font-bold" style={{ color }}>
                  {Math.round(play.confidence)}%
                </span>
              </div>
              <div className="h-2 rounded-full bg-[oklch(1_0_0/8%)] overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: color }}
                  initial={{ width: 0 }}
                  animate={{ width: `${play.confidence}%` }}
                  transition={{ delay: idx * 0.03 + 0.2, duration: 0.6 }}
                />
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
