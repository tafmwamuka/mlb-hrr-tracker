import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { Star, TrendingUp } from "lucide-react";

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

const RANK_COLORS = {
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
};

export function AllPlaysTab() {
  const { data: matchups, isLoading } = trpc.ballpark.getTodayMatchups.useQuery();

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

  return (
    <div className="space-y-2 px-4 pb-4">
      {matchups.map((play, idx) => {
        const color = RANK_COLORS[play.rank as keyof typeof RANK_COLORS] || "oklch(0.50 0.015 255)";
        const isTopPlay = play.rank <= 3;

        return (
          <motion.div
            key={`${play.batter.id}-${play.pitcher.id}`}
            className="rounded-lg p-3 border-l-4 overflow-hidden"
            style={{
              background: "oklch(0.14 0.022 255)",
              borderColor: color,
              borderLeftWidth: "4px",
            }}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.03 }}
          >
            {/* Rank badge and header */}
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                {/* Rank badge */}
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm"
                  style={{ background: `${color}30`, color }}
                >
                  {play.rank}
                </div>

                {/* Batter info */}
                <div>
                  <div className="text-sm font-bold text-white">{play.batter.name}</div>
                  <div className="text-xs text-[oklch(0.50_0.015_255)]">
                    {play.batter.team} vs {play.pitcher.name} ({play.matchup.vs})
                  </div>
                </div>
              </div>

              {/* Favorite button */}
              <button className="transition-transform active:scale-90">
                <Star
                  size={18}
                  style={{
                    color: "oklch(0.40 0.015 255)",
                  }}
                />
              </button>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-6 gap-1 mb-2">
              <StatBox label="RC" value={play.stats.rc} color={color} />
              <StatBox label="HR" value={play.stats.hr.toFixed(1)} color={color} />
              <StatBox label="XB" value={play.stats.xb.toFixed(1)} color={color} />
              <StatBox label="1B" value={play.stats.oneB} color={color} />
              <StatBox label="BB" value={play.stats.bb.toFixed(1)} color={color} />
              <StatBox label="K" value={play.stats.k} color={color} />
            </div>

            {/* Confidence bar */}
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-[oklch(1_0_0/8%)] overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: color }}
                  initial={{ width: 0 }}
                  animate={{ width: `${play.confidence}%` }}
                  transition={{ delay: idx * 0.03 + 0.2, duration: 0.5 }}
                />
              </div>
              <span className="text-xs font-bold" style={{ color }}>
                {play.confidence}%
              </span>
            </div>

            {/* Top play badge */}
            {isTopPlay && (
              <div className="mt-2 pt-2 border-t border-[oklch(1_0_0/8%)]">
                <span
                  className="inline-block text-[10px] font-bold px-2 py-1 rounded"
                  style={{ background: `${color}30`, color }}
                >
                  ⭐ Top Play
                </span>
              </div>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div
      className="rounded p-1.5 text-center"
      style={{ background: `${color}15` }}
    >
      <div className="text-[9px] font-semibold text-[oklch(0.50_0.015_255)]">{label}</div>
      <div className="text-xs font-bold" style={{ color }}>
        {value}
      </div>
    </div>
  );
}
