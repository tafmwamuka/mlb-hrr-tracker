/**
 * Game Cards Component
 * Shows today's real MLB games with lineups and probable pitchers.
 * Displayed as a horizontal scrollable row at the top of the page.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { Clock, MapPin, ChevronDown, ChevronUp, Users } from "lucide-react";

interface LineupPlayer {
  id: number;
  fullName: string;
  position: string;
  battingOrder: number;
}

interface Team {
  id: number;
  name: string;
  abbreviation: string;
  record: string;
  probablePitcher: { id: number; fullName: string } | null;
}

interface Game {
  gamePk: number;
  gameTime: string;
  status: string;
  venue: string;
  awayTeam: Team;
  homeTeam: Team;
  awayLineup: LineupPlayer[];
  homeLineup: LineupPlayer[];
}

function GameCard({ game }: { game: Game }) {
  const [expanded, setExpanded] = useState(false);
  const hasLineups = game.awayLineup.length > 0 || game.homeLineup.length > 0;

  return (
    <motion.div
      className="shrink-0 w-[280px] rounded-xl border border-[oklch(1_0_0/10%)] bg-[oklch(0.14_0.02_255)] overflow-hidden"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Game header */}
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 text-[oklch(0.55_0.015_255)] text-xs">
            <Clock size={11} />
            <span>{game.gameTime} ET</span>
          </div>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
            game.status === "Live" 
              ? "bg-green-500/20 text-green-400" 
              : game.status === "Final"
              ? "bg-gray-500/20 text-gray-400"
              : "bg-blue-500/20 text-blue-300"
          }`}>
            {game.status === "Preview" ? "Scheduled" : game.status}
          </span>
        </div>

        {/* Teams */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-white font-semibold text-sm">{game.awayTeam.abbreviation}</span>
            <span className="text-[oklch(0.45_0.015_255)] text-xs">{game.awayTeam.record}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-white font-semibold text-sm">{game.homeTeam.abbreviation}</span>
            <span className="text-[oklch(0.45_0.015_255)] text-xs">{game.homeTeam.record}</span>
          </div>
        </div>

        {/* Probable Pitchers */}
        <div className="mt-2 pt-2 border-t border-[oklch(1_0_0/6%)]">
          <div className="flex items-center gap-1 text-[oklch(0.50_0.015_255)] text-[10px] uppercase tracking-wider mb-1">
            Probable Pitchers
          </div>
          <div className="space-y-0.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[oklch(0.55_0.015_255)]">{game.awayTeam.abbreviation}:</span>
              <span className="text-white">{game.awayTeam.probablePitcher?.fullName || "TBD"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[oklch(0.55_0.015_255)]">{game.homeTeam.abbreviation}:</span>
              <span className="text-white">{game.homeTeam.probablePitcher?.fullName || "TBD"}</span>
            </div>
          </div>
        </div>

        {/* Venue */}
        <div className="mt-2 flex items-center gap-1 text-[oklch(0.40_0.015_255)] text-[10px]">
          <MapPin size={9} />
          <span className="truncate">{game.venue}</span>
        </div>
      </div>

      {/* Expand lineups */}
      {hasLineups && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full px-3 py-1.5 flex items-center justify-center gap-1 text-[oklch(0.60_0.10_255)] text-xs font-medium hover:bg-[oklch(1_0_0/4%)] transition-colors border-t border-[oklch(1_0_0/6%)]"
          >
            <Users size={11} />
            <span>{expanded ? "Hide" : "View"} Lineups</span>
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>

          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-3 pb-3 grid grid-cols-2 gap-2 border-t border-[oklch(1_0_0/6%)] pt-2">
                  {/* Away lineup */}
                  <div>
                    <div className="text-[10px] text-[oklch(0.50_0.015_255)] uppercase tracking-wider mb-1">
                      {game.awayTeam.abbreviation}
                    </div>
                    {game.awayLineup.slice(0, 9).map((p) => (
                      <div key={p.id} className="text-[10px] text-[oklch(0.65_0.015_255)] leading-relaxed truncate">
                        <span className="text-[oklch(0.40_0.015_255)]">{p.battingOrder}.</span> {p.fullName.split(" ").pop()}
                      </div>
                    ))}
                  </div>
                  {/* Home lineup */}
                  <div>
                    <div className="text-[10px] text-[oklch(0.50_0.015_255)] uppercase tracking-wider mb-1">
                      {game.homeTeam.abbreviation}
                    </div>
                    {game.homeLineup.slice(0, 9).map((p) => (
                      <div key={p.id} className="text-[10px] text-[oklch(0.65_0.015_255)] leading-relaxed truncate">
                        <span className="text-[oklch(0.40_0.015_255)]">{p.battingOrder}.</span> {p.fullName.split(" ").pop()}
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </motion.div>
  );
}

export function GameCards() {
  const { data, isLoading } = trpc.aiPicks.getTodaysGames.useQuery();

  if (isLoading) {
    return (
      <div className="px-4 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="h-4 w-28 rounded bg-[oklch(0.22_0.02_255)] animate-pulse" />
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="shrink-0 w-[280px] h-[160px] rounded-xl bg-[oklch(0.14_0.02_255)] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!data?.success || !data.games.length) {
    return null; // Don't show section if no games
  }

  const todayDate = (() => {
    const dateStr = data?.dataDate;
    if (dateStr) {
      const d = new Date(dateStr + 'T12:00:00');
      return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    }
    return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  })();

  return (
    <div className="px-4 mb-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-white text-sm font-semibold">
          Today's Games ({data.games.length})
        </h3>
        {data.lineupAvailable && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 font-medium">
            Lineups Posted
          </span>
        )}
      </div>
      <p className="text-[oklch(0.45_0.015_255)] text-[10px] mb-2">{todayDate}</p>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
        {data.games.map((game: Game) => (
          <GameCard key={game.gamePk} game={game} />
        ))}
      </div>
    </div>
  );
}
