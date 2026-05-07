import { Calendar, Trophy, TrendingUp, Zap, Target, CheckCircle, XCircle, Clock } from "lucide-react";
import { motion } from "framer-motion";
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";

interface Game {
  id: string;
  date: string;
  status: string;
  awayTeam: {
    name: string;
    teamId: number;
    score?: number;
  };
  homeTeam: {
    name: string;
    teamId: number;
    score?: number;
  };
  venue: string;
  gameTime: string;
}

const STAT_CONFIG = {
  hits: { label: "Hits", icon: TrendingUp, color: "oklch(0.82_0.17_85)" },
  runs: { label: "Runs", icon: Zap, color: "oklch(0.68_0.22_25)" },
  rbi: { label: "RBI", icon: Target, color: "oklch(0.72_0.18_165)" },
};

export function ResultsTab() {
  const { data: resultsData, isLoading } = trpc.results.getYesterdayResults.useQuery();
  const { data: statsData } = trpc.results.getHitRateStats.useQuery();
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const yesterdayPlays = resultsData?.results || [
    {
      id: 1,
      playerName: "Aaron Judge",
      stat: "rbi" as const,
      line: 4.5,
      prediction: "over",
      confidence: 94,
      actualValue: 5,
      hit: true,
      game: "NYY vs HOU",
    },
    {
      id: 2,
      playerName: "Juan Soto",
      stat: "hits" as const,
      line: 3.5,
      prediction: "over",
      confidence: 88,
      actualValue: 3,
      hit: false,
      game: "NYM vs TOR",
    },
    {
      id: 3,
      playerName: "B. Buxton",
      stat: "runs" as const,
      line: 2.5,
      prediction: "over",
      confidence: 82,
      actualValue: 3,
      hit: true,
      game: "MIN vs TB",
    },
    {
      id: 4,
      playerName: "S. Ohtani",
      stat: "rbi" as const,
      line: 3.5,
      prediction: "over",
      confidence: 85,
      actualValue: 4,
      hit: true,
      game: "LAD vs SD",
    },
  ];

  const hitCount = resultsData?.results?.filter((p) => p.hit).length || 0;
  const hitRate = resultsData?.hitRate || 0;

  // Format last updated time
  const formatLastUpdated = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
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
          <div className="animate-pulse text-[oklch(0.50_0.015_255)]">Loading yesterday's results...</div>
        </div>
      </div>
    );
  }

  if (!resultsData?.success || !yesterdayPlays || yesterdayPlays.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <Trophy size={48} className="text-[oklch(0.40_0.015_255)] mb-3" />
        <p className="text-[oklch(0.50_0.015_255)] text-center">No results available yet</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 pb-6">
      {/* Yesterday's Plays Summary */}
      <motion.div
        className="mb-6 rounded-xl p-4 border"
        style={{
          background: "linear-gradient(135deg, oklch(0.82_0.17_85/10%), oklch(0.72_0.18_165/10%))",
          borderColor: "oklch(0.82_0.17_85/30%)",
        }}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-lg font-bold text-white mb-1">Yesterday's Picks</h3>
            <p className="text-sm text-[oklch(0.50_0.015_255)]">May 5, 2026 Results</p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-[oklch(0.82_0.17_85)]">{hitRate}%</div>
            <div className="text-xs text-[oklch(0.50_0.015_255)]">Hit Rate</div>
          </div>
        </div>

        {/* Hit rate bar */}
        <div className="w-full bg-[oklch(1_0_0/8%)] rounded-full h-3 overflow-hidden mb-3">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-[oklch(0.82_0.17_85)] to-[oklch(0.72_0.18_165)]"
            initial={{ width: 0 }}
            animate={{ width: `${hitRate}%` }}
            transition={{ delay: 0.2, duration: 0.8 }}
          />
        </div>

        <div className="text-xs text-[oklch(0.50_0.015_255)]">
          {hitCount} of {yesterdayPlays.length} plays hit
        </div>

        {/* Last updated */}
        <div className="flex items-center gap-1 mt-3 pt-3 border-t border-[oklch(1_0_0/8%)] text-xs text-[oklch(0.40_0.015_255)]">
          <Clock size={12} />
          Last updated: {formatLastUpdated(lastUpdated)}
        </div>
      </motion.div>

      {/* Individual Plays Results */}
      <div className="space-y-2 mb-6">
        <h4 className="text-sm font-bold text-white px-2 mb-2">Play Results</h4>
        {yesterdayPlays.map((play, idx) => {
          const statConfig = STAT_CONFIG[play.stat];
          const Icon = statConfig.icon;

          return (
            <motion.div
              key={play.id}
              className={`rounded-lg p-3 border`}
              style={{
                background: play.hit ? "oklch(0.72_0.18_165/10%)" : "oklch(0.68_0.22_25/10%)",
                borderColor: play.hit ? "oklch(0.72_0.18_165/30%)" : "oklch(0.68_0.22_25/30%)",
              }}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.05 }}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon size={14} style={{ color: statConfig.color }} />
                    <span className="font-bold text-white">{play.playerName}</span>
                    <span className="text-xs text-[oklch(0.50_0.015_255)]">{play.game}</span>
                  </div>
                  <div className="text-xs text-[oklch(0.50_0.015_255)]">
                    Predicted {play.stat.toUpperCase()} OVER {play.line}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {play.hit ? (
                    <CheckCircle size={18} className="text-[oklch(0.72_0.18_165)]" />
                  ) : (
                    <XCircle size={18} className="text-[oklch(0.68_0.22_25)]" />
                  )}
                </div>
              </div>

              {/* Result details */}
              <div className="flex items-center justify-between text-xs">
                <div className="flex gap-3">
                  <div className="bg-[oklch(1_0_0/4%)] rounded px-2 py-1">
                    <span className="text-[oklch(0.50_0.015_255)]">Line:</span>
                    <span className="font-bold text-white ml-1">{play.line}</span>
                  </div>
                  <div className="bg-[oklch(1_0_0/4%)] rounded px-2 py-1">
                    <span className="text-[oklch(0.50_0.015_255)]">Actual:</span>
                    <span className="font-bold text-white ml-1">{play.actualValue}</span>
                  </div>
                  <div className="bg-[oklch(1_0_0/4%)] rounded px-2 py-1">
                    <span className="text-[oklch(0.50_0.015_255)]">Confidence:</span>
                    <span className="font-bold text-white ml-1">{play.confidence}%</span>
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Games Results */}
      {games && games.length > 0 && (
        <div>
          <h4 className="text-sm font-bold text-white px-2 mb-2">Games Results</h4>
          <div className="space-y-2">
            {games.slice(0, 5).map((game, idx) => {
              const awayWon = (game.awayTeam.score || 0) > (game.homeTeam.score || 0);

              return (
                <motion.div
                  key={game.id}
                  className="rounded-lg p-3 border border-[oklch(1_0_0/8%)] bg-[oklch(0.14_0.022_255)]"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + idx * 0.05 }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="text-xs text-[oklch(0.40_0.015_255)] mb-1">{game.date}</div>
                      <div className="flex items-center gap-2">
                        <div className={`flex-1 ${awayWon ? "font-bold text-white" : "text-[oklch(0.50_0.015_255)]"}`}>
                          {game.awayTeam.name}
                        </div>
                        <div className="font-bold text-white w-8 text-right">{game.awayTeam.score}</div>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <div className={`flex-1 ${!awayWon ? "font-bold text-white" : "text-[oklch(0.50_0.015_255)]"}`}>
                          {game.homeTeam.name}
                        </div>
                        <div className="font-bold text-white w-8 text-right">{game.homeTeam.score}</div>
                      </div>
                    </div>
                    <div className="ml-3">
                      <Trophy size={18} className="text-[oklch(0.82_0.17_85)]" />
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
