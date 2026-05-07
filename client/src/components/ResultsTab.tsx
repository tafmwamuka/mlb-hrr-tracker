import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { Calendar, Trophy } from "lucide-react";

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

export function ResultsTab() {
  const { data: games, isLoading } = trpc.games.getRecentGames.useQuery();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-pulse text-[oklch(0.50_0.015_255)]">Loading results...</div>
      </div>
    );
  }

  if (!games || games.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <Trophy size={48} className="text-[oklch(0.40_0.015_255)] mb-3" />
        <p className="text-[oklch(0.50_0.015_255)] text-center">No recent results</p>
      </div>
    );
  }

  // Filter for completed games only
  const completedGames = games.filter(g => g.status === "Final" || g.status === "Completed Early");

  return (
    <div className="space-y-3 px-4 pb-4">
      {completedGames.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 px-4">
          <Trophy size={48} className="text-[oklch(0.40_0.015_255)] mb-3" />
          <p className="text-[oklch(0.50_0.015_255)] text-center">No completed games</p>
        </div>
      ) : (
        completedGames.map((game, idx) => {
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
        })
      )}
    </div>
  );
}
