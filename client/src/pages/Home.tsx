/**
 * MLB Hit · Run · RBI Tracker — Home Page (Redesigned)
 * Design: Sports Analytics Dashboard with 5 tabs
 * - Top Plays: AI picks based on comprehensive matchup data
 * - Leaderboard: H/R/RBI/Slg % stats with podium + ranked list
 * - Games: Today's MLB games schedule
 * - Results: Past games and final stats
 * - AI Props: Link to full prop predictions page
 */

import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  useMLBStats,
  getHeadshotUrl,
  getStatMax,
  type StatCategory,
  type PlayerStat,
} from "@/hooks/useMLBStats";
import { PlayerModal } from "@/components/PlayerModal";
import { TopPlaysTab } from "@/components/TopPlaysTab";
import { GamesTab } from "@/components/GamesTab";
import { ResultsTab } from "@/components/ResultsTab";
import { RefreshCw, TrendingUp, Zap, Target, Sparkles, Flame, Calendar, Trophy, Zap as ZapIcon } from "lucide-react";
import { useLocation } from "wouter";

type TabType = "topPlays" | "leaderboard" | "games" | "results";

// ─── Stat category config ─────────────────────────────────────────────────────
const STAT_CONFIG = {
  hits: {
    label: "Hits",
    abbr: "H",
    color: "oklch(0.82 0.17 85)",
    icon: TrendingUp,
    description: "Season Hits Leaders",
  },
  runs: {
    label: "Runs",
    abbr: "R",
    color: "oklch(0.68 0.22 25)",
    icon: Zap,
    description: "Season Runs Leaders",
  },
  rbi: {
    label: "RBI",
    abbr: "RBI",
    color: "oklch(0.72 0.18 165)",
    icon: Target,
    description: "Season RBI Leaders",
  },
  slg: {
    label: "Slugging %",
    abbr: "SLG",
    color: "oklch(0.75 0.20 290)",
    icon: Sparkles,
    description: "Season Slugging % Leaders",
  },
} as const;

const TAB_CONFIG = {
  topPlays: {
    label: "Top Plays",
    icon: Flame,
    color: "oklch(0.68 0.22 25)",
  },
  leaderboard: {
    label: "Leaderboard",
    icon: TrendingUp,
    color: "oklch(0.82 0.17 85)",
  },
  games: {
    label: "Games",
    icon: Calendar,
    color: "oklch(0.75 0.20 290)",
  },
  results: {
    label: "Results",
    icon: Trophy,
    color: "oklch(0.72 0.18 165)",
  },
};

// ─── Headshot component with fallback ────────────────────────────────────────
function Headshot({ playerId, name, size }: { playerId: number; name: string; size: number }) {
  const [failed, setFailed] = useState(false);
  const initials = name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();

  if (failed) {
    return (
      <div
        className="rounded-full flex items-center justify-center bg-[oklch(0.25_0.03_255)] text-[oklch(0.65_0.015_255)] font-stat font-bold"
        style={{ width: size, height: size, fontSize: size * 0.32 }}
      >
        {initials}
      </div>
    );
  }

  return (
    <div className="rounded-full overflow-hidden bg-[oklch(0.20_0.025_255)]" style={{ width: size, height: size }}>
      <img
        src={getHeadshotUrl(playerId)}
        alt={name}
        className="w-full h-full object-cover"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

// ─── Podium Card (Top 3) ──────────────────────────────────────────────────────
function PodiumCard({
  player,
  stat,
  rank,
  maxVal,
  delay,
  onClick,
}: {
  player: PlayerStat;
  stat: StatCategory;
  rank: 1 | 2 | 3;
  maxVal: number;
  delay: number;
  onClick: () => void;
}) {
  const cfg = STAT_CONFIG[stat];
  const value = typeof player[stat] === 'string' ? parseFloat(player[stat]) : player[stat];
  const pct = Math.round((value / maxVal) * 100);

  const rankStyles = {
    1: { order: "order-2", height: 144, scale: 1.05, headSize: 72 },
    2: { order: "order-1", height: 112, scale: 1.00, headSize: 60 },
    3: { order: "order-3", height: 112, scale: 1.00, headSize: 60 },
  }[rank];

  const medalColors = { 1: "#FFD700", 2: "#C0C0C0", 3: "#CD7F32" };

  return (
    <motion.button
      className={`flex flex-col items-center ${rankStyles.order} active:scale-95 transition-transform`}
      onClick={onClick}
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Rank */}
      <div
        className="font-stat text-3xl font-extrabold mb-1"
        style={{ color: medalColors[rank], transform: `scale(${rankStyles.scale})` }}
      >
        #{rank}
      </div>

      {/* Headshot with glow border */}
      <div
        className="rounded-full p-[2px] mb-2"
        style={{
          background: `linear-gradient(135deg, ${cfg.color}90, transparent 60%)`,
          boxShadow: rank === 1 ? `0 0 24px ${cfg.color}50` : "none",
          transform: `scale(${rankStyles.scale})`,
        }}
      >
        <Headshot playerId={player.playerId} name={player.fullName} size={rankStyles.headSize} />
      </div>

      {/* Stat value */}
      <div
        className="font-stat text-3xl font-bold leading-none mb-0.5"
        style={{ color: cfg.color }}
      >
        {value}
      </div>

      {/* Player name */}
      <div className="text-white text-xs font-semibold text-center leading-tight px-1 max-w-[80px]">
        {player.firstName[0]}. {player.lastName}
      </div>

      {/* Team */}
      <div className="text-[oklch(0.50_0.015_255)] text-[10px] text-center mt-0.5 max-w-[80px] leading-tight">
        {player.teamName.split(" ").slice(-1)[0]}
      </div>

      {/* Podium base */}
      <div
        className="w-full mt-2 rounded-t-sm flex items-end justify-center pb-1"
        style={{
          background: `linear-gradient(to top, ${cfg.color}30, ${cfg.color}10)`,
          borderTop: `2px solid ${cfg.color}50`,
          minWidth: rank === 1 ? 80 : 68,
          height: rankStyles.height,
        }}
      >
        <span className="text-[10px] font-stat font-bold opacity-60" style={{ color: cfg.color }}>
          {pct}%
        </span>
      </div>
    </motion.button>
  );
}

// ─── Player Row (Rank 4+) ─────────────────────────────────────────────────────
function PlayerRow({
  player,
  stat,
  maxVal,
  index,
  onClick,
}: {
  player: PlayerStat;
  stat: StatCategory;
  maxVal: number;
  index: number;
  onClick: () => void;
}) {
  const cfg = STAT_CONFIG[stat];
  const value = typeof player[stat] === 'string' ? parseFloat(player[stat]) : player[stat];
  const pct = (value / maxVal) * 100;

  return (
    <motion.button
      className="w-full flex items-center gap-3 px-4 py-3 border-b border-[oklch(1_0_0/6%)] text-left active:bg-[oklch(1_0_0/4%)] transition-colors"
      onClick={onClick}
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.04 * Math.min(index, 12), duration: 0.35, ease: "easeOut" }}
    >
      {/* Rank */}
      <div className="font-stat text-xl font-bold text-[oklch(0.40_0.015_255)] w-7 text-right shrink-0">
        {player.rank}
      </div>

      {/* Headshot */}
      <div className="shrink-0">
        <Headshot playerId={player.playerId} name={player.fullName} size={44} />
      </div>

      {/* Name + team + bar */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-1">
          <span className="text-white font-semibold text-sm truncate leading-tight">
            {player.fullName}
          </span>
          <span
            className="font-stat text-xl font-bold shrink-0"
            style={{ color: cfg.color }}
          >
            {value}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[oklch(0.50_0.015_255)] text-xs truncate">
            {player.teamName}
          </span>
          <span className="text-[oklch(0.38_0.015_255)] text-xs shrink-0">
            {player.position}
          </span>
        </div>
        {/* Relative stat bar */}
        <div className="mt-1.5 h-[3px] rounded-full bg-[oklch(1_0_0/8%)] overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ backgroundColor: cfg.color }}
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ delay: 0.04 * Math.min(index, 12) + 0.2, duration: 0.6, ease: "easeOut" }}
          />
        </div>
      </div>

      {/* Secondary stats */}
      <div className="flex flex-col items-end shrink-0 gap-0.5 min-w-[52px]">
        {stat !== "hits" && (
          <span className="text-[oklch(0.55_0.015_255)] text-xs">
            <span className="text-[oklch(0.38_0.015_255)]">H </span>
            {player.hits}
          </span>
        )}
        {stat !== "runs" && (
          <span className="text-[oklch(0.55_0.015_255)] text-xs">
            <span className="text-[oklch(0.38_0.015_255)]">R </span>
            {player.runs}
          </span>
        )}
        {stat !== "rbi" && (
          <span className="text-[oklch(0.55_0.015_255)] text-xs">
            <span className="text-[oklch(0.38_0.015_255)]">RBI </span>
            {player.rbi}
          </span>
        )}
        {stat !== "slg" && (
          <span className="text-[oklch(0.55_0.015_255)] text-xs">
            <span className="text-[oklch(0.38_0.015_255)]">SLG </span>
            {player.slg}
          </span>
        )}
        <span className="text-[oklch(0.40_0.015_255)] text-[10px]">
          {player.avg}
        </span>
      </div>
    </motion.button>
  );
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────
function Skeleton() {
  return (
    <div className="animate-pulse">
      <div className="mx-4 mb-4 rounded-2xl overflow-hidden bg-[oklch(0.15_0.025_255)] border border-[oklch(1_0_0/8%)]">
        <div className="px-4 pt-4 pb-0">
          <div className="h-3 w-24 rounded bg-[oklch(0.22_0.02_255)] mb-4" />
          <div className="flex items-end justify-center gap-3 pb-0">
            {[{ s: 68, h: 112 }, { s: 80, h: 144 }, { s: 68, h: 112 }].map((d, i) => (
              <div key={i} className={`flex flex-col items-center gap-2 ${i === 1 ? "order-2" : i === 0 ? "order-1" : "order-3"}`}>
                <div className="rounded-full bg-[oklch(0.25_0.02_255)]" style={{ width: d.s, height: d.s }} />
                <div className="h-3 w-14 rounded bg-[oklch(0.25_0.02_255)]" />
                <div className="rounded-t-sm bg-[oklch(0.20_0.02_255)]" style={{ minWidth: d.s, height: d.h }} />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mx-4 rounded-2xl overflow-hidden bg-[oklch(0.14_0.022_255)] border border-[oklch(1_0_0/8%)]">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-[oklch(1_0_0/6%)]">
            <div className="w-7 h-5 rounded bg-[oklch(0.25_0.02_255)]" />
            <div className="w-11 h-11 rounded-full bg-[oklch(0.25_0.02_255)]" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 rounded bg-[oklch(0.25_0.02_255)]" />
              <div className="h-3 w-1/2 rounded bg-[oklch(0.22_0.02_255)]" />
              <div className="h-[3px] w-full rounded bg-[oklch(0.22_0.02_255)]" />
            </div>
            <div className="space-y-1">
              <div className="h-3 w-10 rounded bg-[oklch(0.25_0.02_255)]" />
              <div className="h-3 w-10 rounded bg-[oklch(0.22_0.02_255)]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Leaderboard Tab Component ─────────────────────────────────────────────────
function LeaderboardTabContent() {
  const [activeStat, setActiveStat] = useState<StatCategory>("hits");
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerStat | null>(null);
  const { data, loading, error, lastUpdated, refresh } = useMLBStats(activeStat);
  const scrollRef = useRef<HTMLDivElement>(null);

  const maxVal = getStatMax(data, activeStat);
  const top3 = data.slice(0, 3);
  const rest = data.slice(3);
  const cfg = STAT_CONFIG[activeStat];
  const Icon = cfg.icon;

  const handleTabChange = useCallback((stat: StatCategory) => {
    setActiveStat(stat);
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  return (
    <>
      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-hide">
        {/* Refresh bar */}
        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-1.5">
            <Icon size={13} style={{ color: cfg.color }} />
            <span className="text-xs font-semibold" style={{ color: cfg.color }}>
              {cfg.label} Leaderboard
            </span>
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="flex items-center gap-1 text-[oklch(0.50_0.015_255)] text-xs py-1 px-2 rounded-lg transition-colors hover:text-white active:scale-95"
            style={{ background: "oklch(0.18 0.02 255)" }}
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
            {lastUpdated
              ? lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              : "Refresh"}
          </button>
        </div>

        {/* Error state */}
        {error && (
          <div className="mx-4 my-2 p-3 rounded-xl bg-[oklch(0.68_0.22_25/15%)] border border-[oklch(0.68_0.22_25/30%)] text-sm text-[oklch(0.85_0.05_25)]">
            {error}.{" "}
            <button onClick={refresh} className="underline">
              Retry
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && <Skeleton />}

        {/* Content */}
        {!loading && data.length > 0 && (
          <AnimatePresence mode="wait">
            <motion.div
              key={activeStat}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              {/* Podium — Top 3 */}
              <div
                className="mx-4 mb-4 rounded-2xl overflow-hidden"
                style={{
                  background: "linear-gradient(135deg, oklch(0.15 0.025 255), oklch(0.13 0.020 255))",
                  border: `1px solid ${cfg.color}20`,
                }}
              >
                <div className="px-4 pt-4 pb-0">
                  <div className="text-[10px] font-semibold tracking-widest uppercase text-[oklch(0.40_0.015_255)] mb-3">
                    Top Performers · Tap for full stats
                  </div>
                  <div className="flex items-end justify-center gap-2 pb-0">
                    {top3.map((player, i) => (
                      <PodiumCard
                        key={player.playerId}
                        player={player}
                        stat={activeStat}
                        rank={(i + 1) as 1 | 2 | 3}
                        maxVal={maxVal}
                        delay={i * 0.1}
                        onClick={() => setSelectedPlayer(player)}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Leaderboard rows */}
              <div
                className="mx-4 rounded-2xl overflow-hidden mb-4"
                style={{
                  background: "oklch(0.14 0.022 255)",
                  border: "1px solid oklch(1 0 0 / 8%)",
                }}
              >
                {/* Column header */}
                <div className="px-4 py-2.5 border-b border-[oklch(1_0_0/6%)]">
                  <div className="flex items-center text-[10px] font-semibold tracking-widest uppercase text-[oklch(0.38_0.015_255)]">
                    <span className="w-7 mr-3 text-right shrink-0">#</span>
                    <span className="w-11 mr-3 shrink-0" />
                    <span className="flex-1">Player</span>
                    <div className="flex gap-4 pr-1">
                      {(["H", "R", "RBI", "SLG"] as const).map((s) => {
                        const statKey = s === "H" ? "hits" : s === "R" ? "runs" : s === "RBI" ? "rbi" : "slg";
                        const isActive = statKey === activeStat;
                        const sc = STAT_CONFIG[statKey];
                        return (
                          <span
                            key={s}
                            className="transition-colors w-8 text-right"
                            style={{ color: isActive ? sc.color : undefined }}
                          >
                            {s}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Rows */}
                {rest.map((player, i) => (
                  <PlayerRow
                    key={player.playerId}
                    player={player}
                    stat={activeStat}
                    maxVal={maxVal}
                    index={i}
                    onClick={() => setSelectedPlayer(player)}
                  />
                ))}
              </div>

              {/* Footer note */}
              <div className="text-center text-[oklch(0.32_0.015_255)] text-[10px] pb-4 px-4">
                Data via MLB Stats API · 2026 Regular Season · Tap any player for full stats
              </div>
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {/* Stat tabs */}
      <div className="shrink-0 flex gap-2 px-4 pb-4 overflow-x-auto">
        {(Object.entries(STAT_CONFIG) as [StatCategory, typeof STAT_CONFIG[StatCategory]][]).map(
          ([key, sc]) => {
            const isActive = key === activeStat;
            return (
              <button
                key={key}
                onClick={() => handleTabChange(key)}
                className="flex-shrink-0 rounded-xl py-2 px-3 text-center transition-all duration-200 active:scale-95"
                style={{
                  background: isActive ? `${sc.color}20` : "oklch(0.18 0.02 255)",
                  border: `1px solid ${isActive ? sc.color + "55" : "oklch(1 0 0 / 8%)"}`,
                }}
              >
                <div className="font-stat text-lg font-bold" style={{ color: isActive ? sc.color : "oklch(0.50 0.015 255)" }}>
                  {sc.abbr}
                </div>
              </button>
            );
          }
        )}
      </div>

      {/* Player modal */}
      <PlayerModal
        player={selectedPlayer}
        activeStat={activeStat}
        onClose={() => setSelectedPlayer(null)}
      />
    </>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function Home() {
  const [activeTab, setActiveTab] = useState<TabType>("topPlays");
  const [, navigate] = useLocation();

  return (
    <div
      className="flex flex-col h-screen max-w-[480px] mx-auto overflow-hidden"
      style={{ background: "linear-gradient(180deg, oklch(0.11 0.025 255) 0%, oklch(0.09 0.020 255) 100%)" }}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="shrink-0 px-4 pt-4 pb-3">
        <h1 className="text-2xl font-bold text-white mb-3">MLB HRR Tracker</h1>
        
        {/* Tab Navigation */}
        <div className="flex gap-2 overflow-x-auto pb-2">
          {(Object.entries(TAB_CONFIG) as [TabType, typeof TAB_CONFIG[TabType]][]).map(
            ([key, config]) => {
              const TabIcon = config.icon;
              const isActive = key === activeTab;
              return (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className="flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-200 active:scale-95"
                  style={{
                    background: isActive ? `${config.color}20` : "oklch(0.18 0.02 255)",
                    border: `1px solid ${isActive ? config.color + "55" : "oklch(1 0 0 / 8%)"}`,
                  }}
                >
                  <TabIcon size={16} style={{ color: isActive ? config.color : "oklch(0.50 0.015 255)" }} />
                  <span
                    className="text-xs font-semibold whitespace-nowrap"
                    style={{ color: isActive ? config.color : "oklch(0.50 0.015 255)" }}
                  >
                    {config.label}
                  </span>
                </button>
              );
            }
          )}
        </div>
      </header>

      {/* ── Content Area ─────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-hidden flex flex-col">
        <AnimatePresence mode="wait">
          {activeTab === "topPlays" && (
            <motion.div
              key="topPlays"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex-1 overflow-y-auto flex flex-col"
            >
              <TopPlaysTab />
            </motion.div>
          )}

          {activeTab === "leaderboard" && (
            <motion.div
              key="leaderboard"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex-1 overflow-hidden flex flex-col"
            >
              <LeaderboardTabContent />
            </motion.div>
          )}

          {activeTab === "games" && (
            <motion.div
              key="games"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex-1 overflow-y-auto"
            >
              <GamesTab />
            </motion.div>
          )}

          {activeTab === "results" && (
            <motion.div
              key="results"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex-1 overflow-y-auto"
            >
              <ResultsTab />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ── AI Props CTA Button ────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 py-3 border-t border-[oklch(1_0_0/8%)]" style={{ background: "oklch(0.10 0.022 255)" }}>
        <motion.button
          onClick={() => navigate("/props")}
          className="w-full flex items-center justify-center gap-2 rounded-xl py-3 px-4 font-semibold text-sm transition-all duration-200 active:scale-95"
          style={{
            background: "linear-gradient(135deg, oklch(0.68_0.22_25), oklch(0.68_0.22_25_/0.7))",
            border: "1px solid oklch(0.68 0.22 25 / 0.6)",
          }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <Sparkles size={18} style={{ color: "white" }} />
          <span>View AI Prop Predictions</span>
          <span className="ml-auto text-xs opacity-75">→</span>
        </motion.button>
      </div>
    </div>
  );
}
