/**
 * PlayerModal — full-screen slide-up sheet showing all H/R/RBI stats for a player
 * Design: Sports Analytics Dashboard — dark navy, stat-category accent colors
 */

import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { getHeadshotUrl, type PlayerStat, type StatCategory } from "@/hooks/useMLBStats";

const STAT_CONFIG = {
  hits: { label: "Hits", abbr: "H", color: "oklch(0.82 0.17 85)" },
  runs: { label: "Runs", abbr: "R", color: "oklch(0.68 0.22 25)" },
  rbi:  { label: "RBI",  abbr: "RBI", color: "oklch(0.72 0.18 165)" },
  slg:  { label: "Slugging %", abbr: "SLG", color: "oklch(0.75 0.20 290)" },
} as const;

interface Props {
  player: PlayerStat | null;
  activeStat: StatCategory;
  onClose: () => void;
}

export function PlayerModal({ player, activeStat, onClose }: Props) {
  if (!player) return null;

  const cfg = STAT_CONFIG[activeStat];

  const stats = [
    { key: "hits" as StatCategory,  label: "Hits",         value: player.hits,        abbr: "H" },
    { key: "runs" as StatCategory,  label: "Runs Scored",  value: player.runs,        abbr: "R" },
    { key: "rbi" as StatCategory,   label: "RBI",          value: player.rbi,         abbr: "RBI" },
    { key: "slg" as StatCategory,   label: "Slugging %",   value: player.slg,         abbr: "SLG" },
    { key: null,                    label: "Home Runs",    value: player.homeRuns,    abbr: "HR" },
    { key: null,                    label: "Batting Avg",  value: player.avg,         abbr: "AVG" },
    { key: null,                    label: "At Bats",      value: player.atBats,      abbr: "AB" },
    { key: null,                    label: "Games Played", value: player.gamesPlayed, abbr: "G" },
  ];

  return (
    <AnimatePresence>
      {player && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-40"
            style={{ background: "oklch(0 0 0 / 0.7)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            className="fixed bottom-0 left-0 right-0 z-50 max-w-[480px] mx-auto rounded-t-3xl overflow-hidden"
            style={{
              background: "linear-gradient(180deg, oklch(0.16 0.028 255) 0%, oklch(0.12 0.022 255) 100%)",
              border: `1px solid ${cfg.color}30`,
              borderBottom: "none",
            }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 400, damping: 35 }}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-[oklch(1_0_0/20%)]" />
            </div>

            {/* Header */}
            <div className="flex items-center gap-4 px-5 pt-3 pb-4">
              {/* Headshot */}
              <div
                className="rounded-full overflow-hidden shrink-0"
                style={{
                  width: 72,
                  height: 72,
                  background: "oklch(0.20 0.025 255)",
                  boxShadow: `0 0 20px ${cfg.color}40`,
                  border: `2px solid ${cfg.color}50`,
                }}
              >
                <img
                  src={getHeadshotUrl(player.playerId)}
                  alt={player.fullName}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src =
                      `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_180,q_auto:best/v1/people/0/headshot/67/current`;
                  }}
                />
              </div>

              {/* Name + meta */}
              <div className="flex-1 min-w-0">
                <div className="text-white font-bold text-lg leading-tight truncate">
                  {player.fullName}
                </div>
                <div className="text-[oklch(0.60_0.015_255)] text-sm mt-0.5 truncate">
                  {player.teamName}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className="text-xs font-semibold px-2 py-0.5 rounded-full"
                    style={{
                      background: `${cfg.color}20`,
                      color: cfg.color,
                      border: `1px solid ${cfg.color}40`,
                    }}
                  >
                    #{player.rank} {cfg.label}
                  </span>
                  <span className="text-[oklch(0.45_0.015_255)] text-xs">
                    {player.position} · {player.league}
                  </span>
                </div>
              </div>

              {/* Close */}
              <button
                onClick={onClose}
                className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[oklch(0.55_0.015_255)] hover:text-white transition-colors"
                style={{ background: "oklch(0.22 0.02 255)" }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Stats grid */}
            <div className="px-5 pb-8" style={{ paddingBottom: "calc(2rem + env(safe-area-inset-bottom, 0px))" }}>
              <div className="grid grid-cols-3 gap-2">
                {stats.map((s, i) => {
                  const statCfg = s.key ? STAT_CONFIG[s.key] : null;
                  const isActive = s.key === activeStat;
                  return (
                    <motion.div
                      key={s.abbr}
                      className="rounded-2xl p-3 flex flex-col items-center"
                      style={{
                        background: isActive ? `${cfg.color}15` : "oklch(0.18 0.022 255)",
                        border: `1px solid ${isActive ? cfg.color + "40" : "oklch(1 0 0 / 8%)"}`,
                      }}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: i * 0.05, duration: 0.3 }}
                    >
                      <div
                        className="font-stat text-2xl font-bold leading-none"
                        style={{ color: statCfg ? statCfg.color : isActive ? cfg.color : "white" }}
                      >
                        {s.value}
                      </div>
                      <div className="text-[oklch(0.50_0.015_255)] text-[10px] font-semibold tracking-wide uppercase mt-1">
                        {s.abbr}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
