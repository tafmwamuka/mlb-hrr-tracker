import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { Calendar, Trophy, TrendingUp, Zap, Target, CheckCircle, XCircle } from "lucide-react";

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
  const { data: games, isLoading } = trpc.games.getRecentGames.useQuery();

  // Mock yesterday's suggested plays with results
  const yesterdayPlays = [
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

  const hitCount = yesterdayPlays.filter((p) => p.hit).length;
  const hitRate = Math.round((hitCount / yesterdayPlays.length) * 100);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-pulse text-[oklch(0.50_0.015_255)]">Loading results...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4 px-4 pb-4">
      {/* Hit Rate Summary */}
      <motion.div
        className="rounded-xl p-4 border border-[oklch(1_0_0/8%)]"
        style={{ background: "oklch(0.14 0.022 255)" }}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-[oklch(0.50_0.015_255)] mb-1">Yesterday's Hit Rate</p>
            <p className="text-3xl font-bold text-white">{hitRate}%</p>
            <p className="text-xs text-[oklch(0.40_0.015_255)] mt-1">
              {hitCount} of {yesterdayPlays.length} plays hit
            </p>
          </div>
          <Trophy size={40} className="text-[oklch(0.82_0.17_85)]" />
        </div>
      </motion.div>

      {/* Yesterday's Plays */}
      <div>
        <h3 className="text-sm font-semibold text-white px-2 mb-3">Suggested Plays Results</h3>
        <div className="space-y-3">
          {yesterdayPlays.map((play, idx) => {
            const config = STAT_CONFIG[play.stat];
            const Icon = config.icon;
            const hitStatus = play.hit ? "HIT ✓" : "MISS ✗";
            const hitColor = play.hit ? "text-emerald-400" : "text-red-400";

            return (
              <motion.div
                key={play.id}
                className="rounded-xl p-3 border border-[oklch(1_0_0/8%)]"
                style={{ background: "oklch(0.14 0.022 255)" }}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-white font-semibold text-sm">{play.playerName}</span>
                      <span className="text-xs px-2 py-1 rounded flex items-center gap-1" style={{ background: config.color + "20", color: config.color }}>
                        <Icon size={12} />
                        {config.label}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 mb-2">
                      {play.game} • Confidence: {play.confidence}%
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <div>
                        <p className="text-slate-500">Prediction</p>
                        <p className="text-white font-semibold">{play.stat.toUpperCase()} {play.prediction.toUpperCase()} {play.line}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Actual</p>
                        <p className="text-white font-semibold">{play.actualValue}</p>
                      </div>
                    </div>
                  </div>
                  <div className={`text-right ${hitColor}`}>
                    {play.hit ? (
                      <CheckCircle size={20} className="mb-2" />
                    ) : (
                      <XCircle size={20} className="mb-2" />
                    )}
                    <p className="text-xs font-bold">{hitStatus}</p>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Games Results */}
      {games && games.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-white px-2 mb-3">Yesterday's Games</h3>
          <div className="space-y-3">
            {(games as any).slice(0, 5).map((game: Game, idx: number) => {
              const awayWon = (game.awayTeam.score || 0) > (game.homeTeam.score || 0);
              
              return (
                <motion.div
                  key={game.id}
                  className="rounded-xl p-4 border border-[oklch(1_0_0/8%)]"
                  style={{ background: "oklch(0.14 0.022 255)" }}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                >
                  {/* Date */}
                  <div className="flex items-center gap-2 mb-3">
                    <Calendar size={14} className="text-[oklch(0.50_0.015_255)]" />
                    <span className="text-xs font-semibold text-[oklch(0.60_0.015_255)]">
                      {new Date(game.date).toLocaleDateString([], { month: "short", day: "numeric" })}
                    </span>
                  </div>

                  {/* Teams matchup with winner highlight */}
                  <div className="space-y-2">
                    {/* Away team */}
                    <div className={`flex items-center justify-between p-2 rounded-lg transition-colors ${
                      awayWon ? "bg-[oklch(0.82_0.17_85/0.15)]" : ""
                    }`}>
                      <span className={`text-sm font-semibold ${awayWon ? "text-white" : "text-[oklch(0.70_0.015_255)]"}`}>
                        {game.awayTeam.name}
                      </span>
                      <div className="flex items-center gap-2">
                        {awayWon && <Trophy size={14} style={{ color: "oklch(0.82 0.17 85)" }} />}
                        <span className={`text-lg font-bold ${awayWon ? "text-white" : "text-[oklch(0.50_0.015_255)]"}`}>
                          {game.awayTeam.score}
                        </span>
                      </div>
                    </div>

                    {/* Home team */}
                    <div className={`flex items-center justify-between p-2 rounded-lg transition-colors ${
                      !awayWon ? "bg-[oklch(0.82_0.17_85/0.15)]" : ""
                    }`}>
                      <span className={`text-sm font-semibold ${!awayWon ? "text-white" : "text-[oklch(0.70_0.015_255)]"}`}>
                        {game.homeTeam.name}
                      </span>
                      <div className="flex items-center gap-2">
                        {!awayWon && <Trophy size={14} style={{ color: "oklch(0.82 0.17 85)" }} />}
                        <span className={`text-lg font-bold ${!awayWon ? "text-white" : "text-[oklch(0.50_0.015_255)]"}`}>
                          {game.homeTeam.score}
                        </span>
                      </div>
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
