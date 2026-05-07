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

// Mock function to determine best prop based on RC and stats
function determineBestProp(rc: number, stats: any): keyof typeof STAT_CONFIG {
  if (rc > 35) return "rbi";
  if (rc > 30) return "hits";
  return "runs";
}

export function AllPlaysTab() {
  const { data: matchups, isLoading } = trpc.ballpark.getTodayMatchups.useQuery();
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

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

                {/* Batter info */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-white truncate">{play.batter.name}</div>
                  <div className="text-xs text-[oklch(0.50_0.015_255)]">
                    {play.batter.team} vs {play.pitcher.name}
                  </div>
                </div>
              </div>

              {/* Best Prop Badge */}
              <div
                className="flex items-center gap-1 px-2 py-1 rounded-lg ml-2 shrink-0"
                style={{ background: bestPropConfig.color + "20", borderColor: bestPropConfig.color, borderWidth: "1px" }}
              >
                <BestIcon size={12} style={{ color: bestPropConfig.color }} />
                <span className="text-xs font-bold" style={{ color: bestPropConfig.color }}>
                  {bestPropConfig.abbr}
                </span>
              </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-6 gap-1 mb-2 text-xs">
              <div className="bg-[oklch(1_0_0/4%)] rounded p-1.5 text-center">
                <div className="text-[oklch(0.50_0.015_255)] text-[10px]">RC</div>
                <div className="font-bold text-white">{play.stats.rc}</div>
              </div>
              <div className="bg-[oklch(1_0_0/4%)] rounded p-1.5 text-center">
                <div className="text-[oklch(0.50_0.015_255)] text-[10px]">HR</div>
                <div className="font-bold text-white">{play.stats.hr}</div>
              </div>
              <div className="bg-[oklch(1_0_0/4%)] rounded p-1.5 text-center">
                <div className="text-[oklch(0.50_0.015_255)] text-[10px]">XB</div>
                <div className="font-bold text-white">{play.stats.xb}</div>
              </div>
              <div className="bg-[oklch(1_0_0/4%)] rounded p-1.5 text-center">
                <div className="text-[oklch(0.50_0.015_255)] text-[10px]">1B</div>
                <div className="font-bold text-white">{play.stats.oneB}</div>
              </div>
              <div className="bg-[oklch(1_0_0/4%)] rounded p-1.5 text-center">
                <div className="text-[oklch(0.50_0.015_255)] text-[10px]">BB</div>
                <div className="font-bold text-white">{play.stats.bb}</div>
              </div>
              <div className="bg-[oklch(1_0_0/4%)] rounded p-1.5 text-center">
                <div className="text-[oklch(0.50_0.015_255)] text-[10px]">K</div>
                <div className="font-bold text-white">{play.stats.k}</div>
              </div>
            </div>

            {/* Confidence and favorite */}
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="w-full bg-[oklch(1_0_0/8%)] rounded-full h-2 overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: color }}
                    initial={{ width: 0 }}
                    animate={{ width: `${play.confidence}%` }}
                    transition={{ delay: idx * 0.03 + 0.2, duration: 0.6 }}
                  />
                </div>
                <div className="text-xs text-[oklch(0.40_0.015_255)] mt-1">{play.confidence}% confidence</div>
              </div>
              <button
                onClick={() => toggleFavorite(play.batter.id, play.pitcher.id)}
                className="ml-2 p-1.5 hover:bg-[oklch(1_0_0/8%)] rounded transition-colors"
              >
                <Star
                  size={16}
                  className={isFavorited ? "fill-[oklch(0.82_0.17_85)] text-[oklch(0.82_0.17_85)]" : "text-[oklch(0.40_0.015_255)]"}
                />
              </button>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
