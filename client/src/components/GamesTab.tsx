import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { Calendar, Clock, MapPin } from "lucide-react";

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

export function GamesTab() {
  const { data: games, isLoading } = trpc.games.getTodayGames.useQuery();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-pulse text-[oklch(0.50_0.015_255)]">Loading games...</div>
      </div>
    );
  }

  if (!games || games.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <Calendar size={48} className="text-[oklch(0.40_0.015_255)] mb-3" />
        <p className="text-[oklch(0.50_0.015_255)] text-center">No games scheduled for today</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 px-4 pb-4">
      {games.map((game, idx) => (
        <motion.div
          key={game.id}
          className="rounded-xl p-4 border border-[oklch(1_0_0/8%)]"
          style={{ background: "oklch(0.14 0.022 255)" }}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: idx * 0.05 }}
        >
          {/* Game time and status */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Clock size={14} className="text-[oklch(0.50_0.015_255)]" />
              <span className="text-xs font-semibold text-[oklch(0.60_0.015_255)]">
                {game.gameTime}
              </span>
            </div>
            <span className="text-[10px] font-semibold px-2 py-1 rounded-full" 
              style={{ 
                background: game.status === "Live" ? "oklch(0.68 0.22 25 / 0.2)" : "oklch(0.50 0.015 255 / 0.1)",
                color: game.status === "Live" ? "oklch(0.85 0.05 25)" : "oklch(0.50 0.015 255)"
              }}>
              {game.status}
            </span>
          </div>

          {/* Teams matchup */}
          <div className="space-y-2 mb-3">
            {/* Away team */}
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white">{game.awayTeam.name}</span>
              {game.awayTeam.score !== undefined && (
                <span className="text-lg font-bold" style={{ color: "oklch(0.82 0.17 85)" }}>
                  {game.awayTeam.score}
                </span>
              )}
            </div>

            {/* Home team */}
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white">{game.homeTeam.name}</span>
              {game.homeTeam.score !== undefined && (
                <span className="text-lg font-bold" style={{ color: "oklch(0.82 0.17 85)" }}>
                  {game.homeTeam.score}
                </span>
              )}
            </div>
          </div>

          {/* Venue */}
          <div className="flex items-center gap-2 text-[10px] text-[oklch(0.40_0.015_255)]">
            <MapPin size={12} />
            <span>{game.venue}</span>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
