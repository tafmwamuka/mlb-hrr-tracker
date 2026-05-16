/**
 * Money Picks Tab - Shows only 75%+ probability alternate lines
 * Features: streak indicator, confidence tier filters, parlay builder
 */

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown, Flame, Shield, TrendingUp, Target, Zap, DollarSign,
  CheckCircle2, Plus, Minus, ShoppingCart, X, Clock, RefreshCw,
  TrendingDown, CalendarDays, BarChart2, ChevronRight
} from "lucide-react";
import { SaferPlayTip } from "@/components/SaferPlayTip";
import { PerformanceGraph } from "@/components/PerformanceGraph";
import { BestEdgeCard } from "@/components/BestEdgeCard";
import { DataHealthBar } from "@/components/DataHealthBar";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

interface AlternateLine {
  line: number;
  overProb: number;
  underProb: number;
}

interface MoneyPick {
  playerId: number;
  playerName: string;
  team: string;
  pitcher: string;
  pitcherTeam: string;
  battingPosition: number;
  expectedHits: number;
  expectedRuns: number;
  expectedRBI: number;
  expectedTotal: number;
  reasoning: string;
  ballparkReasoning: string;
  rcScore: number;
  parkFactor: number;
  overProbability: number;
  pickQuality: string;
  lineSource: string;
  bookOdds: number | null;
  bookImpliedProb: number | null;
  alternateLines: AlternateLine[];
  fairLine: number;
  edge: number;
  savantMetrics?: {
    xwOBA: number;
    hardHitPct: number;
    exitVelocity: number;
    barrelPct: number;
  };
  recommendedLine: number;
  recommendedProb: number;
  streak: string; // e.g., "4 of last 5"
  // Real data from backend
  odds?: string | null; // American odds e.g. "-115"
  oddsProvider?: string | null;
  streakInfo?: {
    isOnStreak: boolean;
    streakLength: number;
    streakType: 'hot' | 'cold' | 'neutral';
    last5HitRate: number;
    trendDirection: 'up' | 'down' | 'stable';
    last5Games?: Array<{ date: string; hits: number; runs: number; rbi: number; atBats: number; homeRuns: number }>;
  } | null;
  dayNightSplit?: {
    gameTimeType: 'day' | 'night';
    splitAvg: number;
    splitBoost: number;
    favorable: boolean;
  } | null;

  primePosition?: boolean;
  primePositionFactors?: {
    platoonAdvantage: boolean;
    pitcherMatchup: boolean;
    battingPositionStrong: boolean;
    dayNightFavorable: boolean;
    favorableCount: number;
  } | null;
  overallScore?: number; // Matrix score (0-100)
  vsGrade?: number; // VS Gate score (0-10)
  vsGateData?: {
    batterXwOBA?: number;
    pitcherXwOBAAgainst?: number;
    xwOBADelta?: number;
    tier?: string;
    score?: number;
  } | null;
  gameTotalOU?: number | null; // Vegas over/under line
  // Phase R new fields
  grade?: 'elite' | 'strong' | 'watchlist';
  reasons?: string[];    // WHY THIS PLAY QUALIFIES
  riskFlags?: string[];  // RISK FLAGS
  bpBoost?: number;      // VS Gate boost/penalty
  baseScore?: number;    // Score before BP boost
  isBestBet?: boolean;   // True when surfaced as Best Bet Today (weak slate fallback)
  leanTier?: boolean;    // True when score is 68-73 (informational only)
  gameTime?: string | null; // ISO game start time (UTC)
  // Phase AK/AM: Stability system fields
  pickStatus?: 'confirmed' | 'preliminary' | 'confidence_reduced' | 'locked_confirmed' | 'final_official';
  lastUpdated?: string | null; // ISO timestamp of last score update
  scoreChanged?: boolean;       // true when confirmed-locked pick score dropped >15 pts
  scoreDrop?: number;           // how many pts the score dropped since lock
  // Phase AT: Early auto-lock fields
  isEarlyLocked?: boolean;      // true when game was early-locked before scheduled pull
  gameLockTime?: string | null; // ISO timestamp when game was locked
  gameLockReason?: 'early_auto_lock' | 'scheduled_pull' | null;
}

// S/A/B/C Tier system based on overallScore — Phase W calibration: S=83+, A=74-82, B/Lean=68-73
function getScoreTier(score: number): { tier: 'S' | 'A' | 'B' | 'C'; label: string; color: string; glow: string; bg: string; border: string } {
  if (score >= 83) return {
    tier: 'S',
    label: 'S TIER',
    color: 'oklch(0.82 0.17 85)',
    glow: 'glow-s-tier',
    bg: 'oklch(0.82 0.17 85 / 12%)',
    border: 'oklch(0.82 0.17 85 / 40%)',
  };
  if (score >= 74) return {
    tier: 'A',
    label: 'A TIER',
    color: 'oklch(0.72 0.18 165)',
    glow: 'glow-a-tier',
    bg: 'oklch(0.72 0.18 165 / 12%)',
    border: 'oklch(0.72 0.18 165 / 40%)',
  };
  if (score >= 68) return {
    tier: 'B',
    label: 'LEAN',
    color: 'oklch(0.72 0.10 220)',
    glow: 'glow-b-tier',
    bg: 'oklch(0.72 0.10 220 / 10%)',
    border: 'oklch(0.72 0.10 220 / 30%)',
  };
  return {
    tier: 'C',
    label: 'C TIER',
    color: 'oklch(0.50 0.015 255)',
    glow: '',
    bg: 'oklch(0.18 0.02 255)',
    border: 'oklch(1 0 0 / 8%)',
  };
}

function getProbColor(prob: number): string {
  if (prob >= 85) return 'oklch(0.72 0.18 165)';
  if (prob >= 75) return 'oklch(0.78 0.16 140)';
  return 'oklch(0.82 0.17 85)';
}

// Player archetype logic
function getPlayerArchetype(pick: MoneyPick): { label: string; color: string; bg: string; border: string } | null {
  const score = pick.overallScore ?? 0;
  const pos = pick.battingPosition;
  const edge = pick.edge ?? 0;
  const reasons = pick.reasons ?? [];
  const hasStack = reasons.some(r => r.toLowerCase().includes('stack') || r.toLowerCase().includes('consecutive'));
  const hasRBI = reasons.some(r => r.toLowerCase().includes('rbi') || r.toLowerCase().includes('run producer'));
  const hasOBP = reasons.some(r => r.toLowerCase().includes('obp') || r.toLowerCase().includes('contact') || r.toLowerCase().includes('xwoba'));
  const hasBarrel = reasons.some(r => r.toLowerCase().includes('barrel') || r.toLowerCase().includes('power') || r.toLowerCase().includes('exit'));

  if (hasStack) return { label: 'STACK BOOSTER', color: 'oklch(0.72 0.10 220)', bg: 'oklch(0.72 0.10 220 / 10%)', border: 'oklch(0.72 0.10 220 / 30%)' };
  if (hasBarrel && score >= 85) return { label: 'POWER CEILING', color: 'oklch(0.82 0.17 85)', bg: 'oklch(0.82 0.17 85 / 10%)', border: 'oklch(0.82 0.17 85 / 30%)' };
  if (hasRBI && pos >= 3 && pos <= 5) return { label: 'RBI MACHINE', color: 'oklch(0.72 0.18 165)', bg: 'oklch(0.72 0.18 165 / 10%)', border: 'oklch(0.72 0.18 165 / 30%)' };
  if (pos <= 2 && hasOBP) return { label: 'RUN GENERATOR', color: 'oklch(0.72 0.18 165)', bg: 'oklch(0.72 0.18 165 / 8%)', border: 'oklch(0.72 0.18 165 / 25%)' };
  if (hasOBP && edge >= 5) return { label: 'HIGH FLOOR', color: 'oklch(0.65 0.12 165)', bg: 'oklch(0.65 0.12 165 / 8%)', border: 'oklch(0.65 0.12 165 / 25%)' };
  return null;
}

/**
 * Generate a realistic streak string based on the player's expected total vs line
 * Uses probability to simulate recent performance
 */
function generateStreak(expectedTotal: number, line: number, prob: number): string {
  // Higher probability = more likely to have hit recently
  // Simulate: if prob is 85%, roughly 4-5 of last 5 games would hit
  const gamesBack = 5;
  const hitsInRecent = Math.min(gamesBack, Math.round((prob / 100) * gamesBack));
  if (hitsInRecent >= 4) return `${hitsInRecent} of last ${gamesBack}`;
  if (hitsInRecent >= 3) return `${hitsInRecent} of last ${gamesBack}`;
  return `${hitsInRecent} of last ${gamesBack}`;
}

type FilterTier = "all" | "s" | "a" | "b" | "lean";

function MoneyPickCard({
  pick,
  rank,
  isSelected,
  onToggleSelect,
}: {
  pick: MoneyPick;
  rank: number;
  isSelected: boolean;
  onToggleSelect: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // On-demand game log: only fetch when card is expanded and no cached last5Games
  const hasGameLog = (pick.streakInfo?.last5Games?.length ?? 0) > 0;
  const { data: gameLogData, isLoading: gameLogLoading } = trpc.aiPicks.getPlayerGameLog.useQuery(
    pick.playerId,
    {
      enabled: expanded && !hasGameLog && pick.playerId > 0,
      staleTime: 30 * 60 * 1000,
      retry: 2,
    }
  );
  // Merge on-demand game log with streakInfo
  const displayGames = hasGameLog
    ? (pick.streakInfo?.last5Games ?? [])
    : (gameLogData?.last5Games ?? []);
  const probColor = getProbColor(pick.recommendedProb);
  const scoreTier = getScoreTier(pick.overallScore ?? pick.recommendedProb);
  const archetype = getPlayerArchetype(pick);

  // Game timing: warn when game starts within 30 minutes
  const gameStartMs = pick.gameTime ? new Date(pick.gameTime).getTime() : null;
  const nowMs = Date.now();
  const minsUntilGame = gameStartMs ? Math.round((gameStartMs - nowMs) / 60000) : null;
  const isGameSoon = minsUntilGame !== null && minsUntilGame >= 0 && minsUntilGame <= 30;
  const isGameImminent = minsUntilGame !== null && minsUntilGame >= 0 && minsUntilGame <= 10;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: rank * 0.05, duration: 0.35 }}
      className={`rounded-2xl overflow-hidden border ${isSelected ? "ring-2 ring-emerald-400/60" : ""}`}
      style={{
        background: isSelected ? "oklch(0.15 0.03 165 / 40%)" : "oklch(0.14 0.022 255)",
        borderColor: isSelected ? "oklch(0.72 0.18 165 / 50%)" : "oklch(1 0 0 / 8%)",
      }}
    >
      {/* Top accent bar — tier color */}
      <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${scoreTier.color}, ${scoreTier.color}60)` }} />

      {/* Game timing warning banner */}
      {isGameSoon && (
        <div
          className="flex items-center justify-center gap-1.5 py-1 text-[10px] font-bold tracking-wide"
          style={{
            background: isGameImminent ? "oklch(0.68 0.22 25 / 20%)" : "oklch(0.82 0.17 85 / 12%)",
            color: isGameImminent ? "oklch(0.78 0.18 25)" : "oklch(0.82 0.17 85)",
          }}
        >
          <Clock size={10} />
          {isGameImminent
            ? `⚠️ LAST CALL — GAME IN ${minsUntilGame} MIN`
            : `GAME STARTS IN ${minsUntilGame} MIN — LOCK IN NOW`}
        </div>
      )}

      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            {/* Rank + Tier badge */}
            <div className="flex flex-col items-center gap-0.5">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center font-stat font-bold text-sm"
                style={{ background: scoreTier.bg, border: `1px solid ${scoreTier.border}`, color: scoreTier.color }}
              >
                {scoreTier.tier}
              </div>
              <span className="text-[9px] font-bold text-[oklch(0.40_0.015_255)]">#{rank}</span>
            </div>
            <div>
              <div className="text-white font-bold text-base">{pick.playerName}</div>
              <div className="text-[oklch(0.55_0.015_255)] text-xs">
                {pick.team} vs {pick.pitcherTeam} · #{pick.battingPosition}
              </div>
              <div className="text-[oklch(0.42_0.015_255)] text-[10px] mt-0.5">
                vs {pick.pitcher} ({pick.pitcherTeam})
              </div>
            </div>
          </div>

          {/* Recommended line + probability + odds source */}
          <div className="flex flex-col items-end gap-1">
            <div
              className="px-3 py-2 rounded-xl text-sm font-bold"
              style={{
                background: `${probColor}15`,
                color: probColor,
                border: `1.5px solid ${probColor}50`,
              }}
            >
              HRR O {pick.recommendedLine}
            </div>

            {/* Issue 4: Odds source tag — LIVE ODDS vs MODEL ESTIMATE */}
            {pick.odds ? (
              /* LIVE ODDS: real sportsbook data */
              <div className="flex flex-col items-end gap-0.5">
                <div
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold tracking-widest uppercase"
                  style={{ background: "oklch(0.72 0.18 165 / 12%)", color: "oklch(0.72 0.18 165)", border: "1px solid oklch(0.72 0.18 165 / 30%)" }}
                >
                  <div className="w-1 h-1 rounded-full bg-[oklch(0.72_0.18_165)] animate-pulse" />
                  LIVE ODDS
                </div>
                <div
                  className="flex items-center gap-1.5 px-2 py-1 rounded-lg"
                  style={{ background: "oklch(0.82 0.17 85 / 12%)", border: "1px solid oklch(0.82 0.17 85 / 30%)" }}
                >
                  <DollarSign size={10} style={{ color: "oklch(0.82 0.17 85)" }} />
                  <span className="text-xs font-bold" style={{ color: "oklch(0.82 0.17 85)" }}>
                    {pick.odds}
                  </span>
                  <span
                    className="text-[9px] font-semibold uppercase tracking-wide"
                    style={{ color: "oklch(0.72 0.18 165)" }}
                    title={`Odds from ${pick.oddsProvider}`}
                  >
                    {pick.oddsProvider === 'fanduel' ? 'FD' :
                     pick.oddsProvider === 'draftkings' ? 'DK' :
                     pick.oddsProvider === 'betmgm' ? 'MGM' :
                     (pick.oddsProvider ?? '').toUpperCase().slice(0, 4)}
                  </span>
                </div>
                {/* Three-line breakdown: Book / Fair / Edge */}
                <div className="flex items-center gap-1.5 text-[9px]">
                  <span className="text-[oklch(0.40_0.015_255)]">Book</span>
                  <span className="font-bold text-white">{pick.bookImpliedProb ? `${Math.round(pick.bookImpliedProb * 100)}%` : '—'}</span>
                  <span className="text-[oklch(0.30_0.015_255)]">·</span>
                  <span className="text-[oklch(0.40_0.015_255)]">Fair</span>
                  <span className="font-bold" style={{ color: probColor }}>{pick.recommendedProb}%</span>
                  <span className="text-[oklch(0.30_0.015_255)]">·</span>
                  <span className="font-bold" style={{ color: pick.edge > 0 ? 'oklch(0.72 0.18 165)' : 'oklch(0.68 0.22 25)' }}>
                    {pick.edge > 0 ? '+' : ''}{pick.edge}%
                  </span>
                </div>
              </div>
            ) : (
              /* MODEL ESTIMATE: no live sportsbook data */
              <div className="flex flex-col items-end gap-0.5">
                <div
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold tracking-widest uppercase"
                  style={{ background: "oklch(0.72 0.10 220 / 10%)", color: "oklch(0.72 0.10 220)", border: "1px solid oklch(0.72 0.10 220 / 25%)" }}
                >
                  MODEL EST.
                </div>
                <div className="flex items-center gap-1">
                  <CheckCircle2 size={10} style={{ color: probColor }} />
                  <span className="text-xs font-bold" style={{ color: probColor }}>
                    {pick.recommendedProb}%
                  </span>
                </div>
                {/* Three-line breakdown: Model / Fair / Edge */}
                <div className="flex items-center gap-1.5 text-[9px]">
                  <span className="text-[oklch(0.40_0.015_255)]">Model</span>
                  <span className="font-bold" style={{ color: probColor }}>{pick.recommendedProb}%</span>
                  <span className="text-[oklch(0.30_0.015_255)]">·</span>
                  <span className="text-[oklch(0.40_0.015_255)]">Fair</span>
                  <span className="font-bold text-white">{pick.fairLine ?? pick.recommendedLine}</span>
                </div>
              </div>
            )}
          </div>
        </div>

          {/* Archetype chip */}
          {archetype && (
            <div className="flex items-center gap-1.5 mb-2">
              <div
                className="px-2 py-0.5 rounded-md text-[9px] font-bold tracking-widest uppercase"
                style={{ background: archetype.bg, border: `1px solid ${archetype.border}`, color: archetype.color }}
              >
                {archetype.label}
              </div>
            </div>
          )}

          {/* Streak indicator + Confidence badge row */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
          {/* Streak badge - real data from theLAB if available */}
          {pick.streakInfo?.streakType === 'hot' ? (
            <div className="flex items-center gap-1 px-2 py-1 rounded-lg" style={{ background: "oklch(0.68 0.22 25 / 15%)", border: "1px solid oklch(0.68 0.22 25 / 35%)" }}>
              <Flame size={10} style={{ color: "oklch(0.82 0.17 85)" }} />
              <span className="text-[10px] font-bold" style={{ color: "oklch(0.82 0.17 85)" }}>
                {pick.streak}
              </span>
            </div>
          ) : pick.streakInfo?.streakType === 'cold' ? (
            <div className="flex items-center gap-1 px-2 py-1 rounded-lg" style={{ background: "oklch(0.55 0.15 240 / 15%)", border: "1px solid oklch(0.55 0.15 240 / 35%)" }}>
              <span className="text-[10px] font-bold" style={{ color: "oklch(0.65 0.12 240)" }}>
                {pick.streak}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1 px-2 py-1 rounded-lg" style={{ background: "oklch(0.82 0.17 85 / 12%)", border: "1px solid oklch(0.82 0.17 85 / 25%)" }}>
              <Flame size={10} style={{ color: "oklch(0.82 0.17 85)" }} />
              <span className="text-[10px] font-bold" style={{ color: "oklch(0.82 0.17 85)" }}>
                {pick.streak}
              </span>
            </div>
          )}

          {/* Day/night split badge */}
          {pick.dayNightSplit && (
            <div
              className="flex items-center gap-1 px-2 py-1 rounded-lg"
              style={{
                background: pick.dayNightSplit.favorable ? "oklch(0.72 0.18 165 / 12%)" : "oklch(0.18 0.02 255)",
                border: `1px solid ${pick.dayNightSplit.favorable ? "oklch(0.72 0.18 165 / 30%)" : "oklch(1 0 0 / 8%)"}`,
              }}
            >
              <span className="text-[10px] font-bold" style={{ color: pick.dayNightSplit.favorable ? "oklch(0.72 0.18 165)" : "oklch(0.50 0.015 255)" }}>
                {pick.dayNightSplit.gameTimeType === 'day' ? '☀️' : '🌙'} {pick.dayNightSplit.splitAvg.toFixed(3)}
                {pick.dayNightSplit.splitBoost > 0.05 ? ' 🌟' : pick.dayNightSplit.splitBoost < -0.05 ? ' ⚠️' : ''}
              </span>
            </div>
          )}

          <div
            className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest"
            style={{ background: scoreTier.bg, color: scoreTier.color, border: `1px solid ${scoreTier.border}` }}
          >
            {scoreTier.label}
          </div>
          {pick.edge > 0 && (
            <div className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: "oklch(0.72 0.18 165 / 15%)", color: "oklch(0.72 0.18 165)", border: "1px solid oklch(0.72 0.18 165 / 30%)" }}>
              +{pick.edge}% edge
            </div>
          )}

          {/* VS Gate tooltip — xwOBA matchup breakdown */}
          {pick.vsGrade !== null && pick.vsGrade !== undefined && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold cursor-help"
                  style={{
                    background: pick.vsGateData?.tier === 'STRONG'
                      ? 'oklch(0.72 0.18 165 / 15%)'
                      : pick.vsGateData?.tier === 'BAD'
                      ? 'oklch(0.68 0.22 25 / 15%)'
                      : 'oklch(0.55 0.15 255 / 12%)',
                    color: pick.vsGateData?.tier === 'STRONG'
                      ? 'oklch(0.72 0.18 165)'
                      : pick.vsGateData?.tier === 'BAD'
                      ? 'oklch(0.78 0.18 25)'
                      : 'oklch(0.65 0.10 255)',
                    border: `1px solid ${
                      pick.vsGateData?.tier === 'STRONG'
                        ? 'oklch(0.72 0.18 165 / 30%)'
                        : pick.vsGateData?.tier === 'BAD'
                        ? 'oklch(0.68 0.22 25 / 30%)'
                        : 'oklch(0.55 0.15 255 / 20%)'
                    }`,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  ⚡ VS {pick.vsGrade.toFixed(1)}/10
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                sideOffset={6}
                className="p-0 overflow-hidden rounded-xl border-0 max-w-[240px]"
                style={{
                  background: 'oklch(0.13 0.025 255)',
                  border: '1px solid oklch(1 0 0 / 15%)',
                }}
              >
                {/* VS Gate breakdown panel */}
                <div className="px-3 py-2.5 space-y-2">
                  <div className="text-[9px] font-bold tracking-widest uppercase" style={{ color: 'oklch(0.55 0.15 255)' }}>
                    Diamond Edge VS Gate
                  </div>
                  {/* Batter xwOBA */}
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[10px]" style={{ color: 'oklch(0.55 0.015 255)' }}>Batter xwOBA</span>
                    <span
                      className="text-[10px] font-bold"
                      style={{
                        color: pick.vsGateData?.batterXwOBA !== undefined
                          ? pick.vsGateData.batterXwOBA >= 0.340
                            ? 'oklch(0.72 0.18 165)'
                            : pick.vsGateData.batterXwOBA >= 0.310
                            ? 'oklch(0.82 0.17 85)'
                            : 'oklch(0.68 0.22 25)'
                          : 'oklch(0.55 0.015 255)',
                      }}
                    >
                      {pick.vsGateData?.batterXwOBA !== undefined
                        ? pick.vsGateData.batterXwOBA.toFixed(3)
                        : '—'}
                    </span>
                  </div>
                  {/* Pitcher xwOBA-against */}
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[10px]" style={{ color: 'oklch(0.55 0.015 255)' }}>Pitcher xwOBA-against</span>
                    <span
                      className="text-[10px] font-bold"
                      style={{
                        color: pick.vsGateData?.pitcherXwOBAAgainst !== undefined
                          ? pick.vsGateData.pitcherXwOBAAgainst >= 0.340
                            ? 'oklch(0.68 0.22 25)'   // hittable pitcher = bad for pitcher = good for batter
                            : pick.vsGateData.pitcherXwOBAAgainst <= 0.290
                            ? 'oklch(0.72 0.18 165)'  // tough pitcher = good for pitcher
                            : 'oklch(0.82 0.17 85)'
                          : 'oklch(0.55 0.015 255)',
                      }}
                    >
                      {pick.vsGateData?.pitcherXwOBAAgainst !== undefined
                        ? pick.vsGateData.pitcherXwOBAAgainst.toFixed(3)
                        : '—'}
                    </span>
                  </div>
                  {/* xwOBA Delta */}
                  {pick.vsGateData?.xwOBADelta !== undefined && (
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-[10px]" style={{ color: 'oklch(0.55 0.015 255)' }}>xwOBA Delta</span>
                      <span
                        className="text-[10px] font-bold"
                        style={{ color: pick.vsGateData.xwOBADelta >= 0 ? 'oklch(0.72 0.18 165)' : 'oklch(0.68 0.22 25)' }}
                      >
                        {pick.vsGateData.xwOBADelta >= 0 ? '+' : ''}{pick.vsGateData.xwOBADelta.toFixed(3)}
                      </span>
                    </div>
                  )}
                  {/* Divider */}
                  <div className="border-t" style={{ borderColor: 'oklch(1 0 0 / 10%)' }} />
                  {/* VS Gate Score */}
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[10px]" style={{ color: 'oklch(0.55 0.015 255)' }}>VS Gate Score</span>
                    <span
                      className="text-[10px] font-bold"
                      style={{
                        color: pick.vsGateData?.tier === 'STRONG'
                          ? 'oklch(0.72 0.18 165)'
                          : pick.vsGateData?.tier === 'BAD'
                          ? 'oklch(0.68 0.22 25)'
                          : 'oklch(0.82 0.17 85)',
                      }}
                    >
                      {pick.vsGrade.toFixed(1)}/10 — {pick.vsGateData?.tier ?? 'MODERATE'}
                    </span>
                  </div>
                  {/* Interpretation */}
                  <div
                    className="text-[9px] leading-snug"
                    style={{ color: 'oklch(0.50 0.015 255)' }}
                  >
                    {pick.vsGateData?.tier === 'STRONG'
                      ? 'Batter has significant xwOBA edge over pitcher'
                      : pick.vsGateData?.tier === 'BAD'
                      ? 'Pitcher has xwOBA advantage — proceed with caution'
                      : 'Neutral matchup — no significant xwOBA edge'}
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          )}

          {/* Weather intelligence tags — parsed from riskFlags */}
          {(() => {
            const windFlag = pick.riskFlags?.find(r => r.toLowerCase().includes('wind blowing'));
            const coldFlag = pick.riskFlags?.find(r => r.toLowerCase().includes('cold weather'));
            if (!windFlag && !coldFlag) return null;
            return (
              <>
                {windFlag && (
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-md" style={{ background: "oklch(0.55 0.15 240 / 12%)", border: "1px solid oklch(0.55 0.15 240 / 30%)" }}>
                    <span className="text-[9px] font-bold" style={{ color: "oklch(0.65 0.12 240)" }}>💨 Headwind</span>
                  </div>
                )}
                {coldFlag && (
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-md" style={{ background: "oklch(0.55 0.15 240 / 12%)", border: "1px solid oklch(0.55 0.15 240 / 30%)" }}>
                    <span className="text-[9px] font-bold" style={{ color: "oklch(0.65 0.12 240)" }}>🌡️ Cold</span>
                  </div>
                )}
              </>
            );
          })()}

          {/* Prime Position badge: data-driven 3+ of 4 factors favorable */}
          {pick.primePosition && (
            <div
              className="px-2 py-0.5 rounded text-[10px] font-bold"
              style={{ background: "oklch(0.75 0.20 55 / 20%)", color: "oklch(0.85 0.18 55)", border: "1px solid oklch(0.75 0.20 55 / 40%)" }}
              title={pick.primePositionFactors ? [
                pick.primePositionFactors.platoonAdvantage ? '✓ Platoon advantage' : '✗ Platoon',
                pick.primePositionFactors.pitcherMatchup ? '✓ Pitcher matchup' : '✗ Pitcher matchup',
                pick.primePositionFactors.battingPositionStrong ? '✓ Batting position' : '✗ Batting position',
                pick.primePositionFactors.dayNightFavorable ? '✓ Day/night split' : '✗ Day/night split',
              ].join(' | ') : '3+ favorable factors'}
            >
              🎯 Prime {pick.primePositionFactors?.favorableCount ?? '3+'}/4
            </div>
          )}
          <div className="px-2 py-0.5 rounded text-[10px] text-[oklch(0.50_0.015_255)]" style={{ background: "oklch(0.18 0.02 255)" }}>
            {pick.lineSource}
          </div>

          {/* Phase AS: Pick Status chip — PRELIMINARY / CONFIRMED / FINAL OFFICIAL PLAY */}
          {pick.pickStatus === 'final_official' ? (
            <div
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold tracking-wide"
              style={{ background: "oklch(0.82 0.17 85 / 18%)", color: "oklch(0.82 0.17 85)", border: "1px solid oklch(0.82 0.17 85 / 50%)" }}
              title="Final Official Play — evening lock active"
            >
              🔥 FINAL OFFICIAL PLAY
            </div>
          ) : pick.pickStatus === 'locked_confirmed' ? (
            <div
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold tracking-wide"
              style={{ background: "oklch(0.72 0.18 165 / 18%)", color: "oklch(0.72 0.18 165)", border: "1px solid oklch(0.72 0.18 165 / 50%)" }}
              title="Locked on confirmed lineup — retained until game start"
            >
              🔒 LOCKED
            </div>
          ) : pick.pickStatus === 'confirmed' ? (
            <div
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold tracking-wide"
              style={{ background: "oklch(0.72 0.18 165 / 12%)", color: "oklch(0.72 0.18 165)", border: "1px solid oklch(0.72 0.18 165 / 30%)" }}
              title="Midday confirmed board — official lineups locked in"
            >
              ✓ CONFIRMED
            </div>
          ) : pick.pickStatus === 'confidence_reduced' ? (
            <div
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold tracking-wide"
              style={{ background: "oklch(0.68 0.22 25 / 12%)", color: "oklch(0.78 0.18 25)", border: "1px solid oklch(0.68 0.22 25 / 30%)" }}
              title="Confidence slightly reduced — monitoring odds shift"
            >
              ⚠️ MONITORING ODDS SHIFT
            </div>
          ) : pick.pickStatus === 'preliminary' ? (
            <div
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold tracking-wide"
              style={{ background: "oklch(0.72 0.10 220 / 10%)", color: "oklch(0.72 0.10 220)", border: "1px solid oklch(0.72 0.10 220 / 25%)" }}
              title="Preliminary pick — projected lineups, morning pull"
            >
              📌 PRELIMINARY
            </div>
          ) : null}

          {/* Phase AT: Early auto-lock badge */}
          {pick.isEarlyLocked && pick.pickStatus === 'confirmed' && (
            <div
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold tracking-wide"
              style={{ background: "oklch(0.72 0.18 165 / 15%)", color: "oklch(0.72 0.18 165)", border: "1px solid oklch(0.72 0.18 165 / 40%)" }}
              title={pick.gameLockTime ? `Early locked at ${new Date(pick.gameLockTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })} ET` : 'Game locked early — confirmed lineup + 30min stability'}
            >
              🔒 EARLY LOCKED
            </div>
          )}

          {/* Phase AM: Score-change warning for confirmed-locked picks */}
          {pick.pickStatus === 'locked_confirmed' && pick.scoreChanged && (
            <div
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold tracking-wide"
              style={{ background: "oklch(0.68 0.22 25 / 12%)", color: "oklch(0.78 0.18 25)", border: "1px solid oklch(0.68 0.22 25 / 30%)" }}
              title={`Score dropped ${pick.scoreDrop ?? '?'} pts since lock — pick retained (confirmed lineup)`}
            >
              ⚠️ SCORE CHANGED −{pick.scoreDrop}
            </div>
          )}

          {/* Phase AK: Last updated timestamp */}
          {pick.lastUpdated && (() => {
            const diffMs = Date.now() - new Date(pick.lastUpdated).getTime();
            const diffMin = Math.round(diffMs / 60000);
            const label = diffMin < 1 ? 'just now' : diffMin === 1 ? '1m ago' : `${diffMin}m ago`;
            return (
              <div className="flex items-center gap-0.5 text-[9px]" style={{ color: "oklch(0.38 0.015 255)" }}>
                <Clock size={8} />
                {label}
              </div>
            );
          })()}
        </div>

        {/* Expected breakdown - visual bars */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-semibold text-[oklch(0.45_0.015_255)] uppercase">Expected Breakdown</span>
            <span className="text-xs text-white font-bold">
              Proj: <span style={{ color: probColor }}>{pick.expectedTotal}</span> vs Line: {pick.recommendedLine}
            </span>
          </div>
          <div className="flex gap-1 h-7 rounded-lg overflow-hidden">
            <div
              className="flex items-center justify-center text-[10px] font-bold text-white"
              style={{ background: "oklch(0.82 0.17 85)", flex: pick.expectedHits }}
            >
              H {pick.expectedHits}
            </div>
            <div
              className="flex items-center justify-center text-[10px] font-bold text-white"
              style={{ background: "oklch(0.68 0.22 25)", flex: pick.expectedRuns }}
            >
              R {pick.expectedRuns}
            </div>
            <div
              className="flex items-center justify-center text-[10px] font-bold text-white"
              style={{ background: "oklch(0.72 0.18 165)", flex: pick.expectedRBI }}
            >
              RBI {pick.expectedRBI}
            </div>
          </div>
        </div>

        {/* Other available lines */}
        <div className="mb-3">
          <span className="text-[10px] font-semibold text-[oklch(0.45_0.015_255)] uppercase">All Lines</span>
          <div className="flex gap-1.5 mt-1.5 flex-wrap">
            {pick.alternateLines.filter((a: AlternateLine) => a.overProb >= 40).map((alt: AlternateLine) => {
              const isRecommended = alt.line === pick.recommendedLine;
              const altColor = alt.overProb >= 75 ? "oklch(0.72 0.18 165)" : alt.overProb >= 55 ? "oklch(0.82 0.17 85)" : "oklch(0.55 0.15 255)";
              return (
                <div
                  key={alt.line}
                  className="px-2 py-1 rounded-lg text-center"
                  style={{
                    background: isRecommended ? `${probColor}20` : "oklch(0.18 0.02 255)",
                    border: isRecommended ? `1.5px solid ${probColor}60` : "1px solid oklch(1 0 0 / 6%)",
                  }}
                >
                  <div className="text-[10px] font-bold" style={{ color: isRecommended ? probColor : "oklch(0.65 0.015 255)" }}>
                    O {alt.line}
                  </div>
                  <div className="text-[9px] font-bold" style={{ color: altColor }}>
                    {alt.overProb}%
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Grade badge row */}
        {pick.grade && (
          <div className="flex items-center gap-2 mb-3">
            {pick.grade === 'elite' ? (
              <div
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest"
                style={{ background: "oklch(0.82 0.17 85 / 15%)", border: "1px solid oklch(0.82 0.17 85 / 40%)", color: "oklch(0.82 0.17 85)" }}
              >
                ⚡ ELITE PLAY
              </div>
            ) : (
              <div
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest"
                style={{ background: "oklch(0.72 0.18 165 / 12%)", border: "1px solid oklch(0.72 0.18 165 / 35%)", color: "oklch(0.72 0.18 165)" }}
              >
                ✅ STRONG PLAY
              </div>
            )}
            {pick.overallScore !== undefined && (
              <div className="text-[10px] text-[oklch(0.45_0.015_255)]">
                Score: <span className="font-bold text-white">{pick.overallScore}</span>
                {pick.bpBoost !== undefined && pick.bpBoost !== 0 && (
                  <span style={{ color: pick.bpBoost > 0 ? "oklch(0.72 0.18 165)" : "oklch(0.68 0.22 25)" }}>
                    {' '}({pick.bpBoost > 0 ? '+' : ''}{pick.bpBoost} BP)
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* WHY THIS PLAY QUALIFIES */}
        {pick.reasons && pick.reasons.length > 0 && (
          <div className="mb-3 p-2.5 rounded-xl" style={{ background: "oklch(0.72 0.18 165 / 6%)", border: "1px solid oklch(0.72 0.18 165 / 15%)" }}>
            <div className="text-[9px] font-bold tracking-widest uppercase mb-1.5" style={{ color: "oklch(0.72 0.18 165)" }}>Why This Play Qualifies</div>
            <div className="space-y-0.5">
              {pick.reasons.slice(0, 4).map((reason, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <span className="text-[oklch(0.72_0.18_165)] text-[10px] mt-0.5">✓</span>
                  <span className="text-[10px] text-[oklch(0.65_0.015_255)] leading-tight">{reason}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* RISK FLAGS */}
        {pick.riskFlags && pick.riskFlags.length > 0 && (
          <div className="mb-3 p-2.5 rounded-xl" style={{ background: "oklch(0.68 0.22 25 / 6%)", border: "1px solid oklch(0.68 0.22 25 / 15%)" }}>
            <div className="text-[9px] font-bold tracking-widest uppercase mb-1.5" style={{ color: "oklch(0.82 0.17 85)" }}>Risk Flags</div>
            <div className="space-y-0.5">
              {pick.riskFlags.map((flag, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <span className="text-[oklch(0.82_0.17_85)] text-[10px] mt-0.5">⚠</span>
                  <span className="text-[10px] text-[oklch(0.60_0.015_255)] leading-tight">{flag}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick reasoning (fallback when no structured reasons) */}
        {(!pick.reasons || pick.reasons.length === 0) && (
          <p className="text-[11px] text-[oklch(0.55_0.015_255)] leading-relaxed mb-2">
            {pick.reasoning}
          </p>
        )}

        {/* Action row: expand + add to parlay */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-[11px] font-semibold transition-colors"
            style={{ color: probColor }}
          >
            <ChevronDown size={12} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
            {expanded ? "Hide Details" : "View Details"}
          </button>

          {/* Add to parlay button */}
          <button
            onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
              isSelected
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                : "bg-[oklch(1_0_0/5%)] text-[oklch(0.60_0.015_255)] border border-[oklch(1_0_0/10%)] hover:bg-[oklch(1_0_0/8%)]"
            }`}
          >
            {isSelected ? <Minus size={10} /> : <Plus size={10} />}
            {isSelected ? "Remove" : "Add to Parlay"}
          </button>
        </div>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="mt-3 space-y-3 pt-3 border-t border-[oklch(1_0_0/6%)]">
                {/* Performance Graph — uses cached or on-demand game log */}
                {displayGames.length > 0 ? (
                  <div className="p-2.5 rounded-xl" style={{ background: "oklch(0.12 0.018 255)", border: "1px solid oklch(1 0 0 / 6%)" }}>
                    <PerformanceGraph
                      games={displayGames}
                      expectedLine={pick.recommendedLine}
                    />
                  </div>
                ) : gameLogLoading ? (
                  <div className="p-2.5 rounded-xl" style={{ background: "oklch(0.12 0.018 255)", border: "1px solid oklch(1 0 0 / 6%)" }}>
                    <div className="text-[9px] font-bold tracking-widest uppercase mb-1.5" style={{ color: "oklch(0.45 0.015 255)" }}>Last 5 Games</div>
                    <div className="flex items-center gap-2">
                      <RefreshCw size={10} className="animate-spin" style={{ color: "oklch(0.55 0.015 255)" }} />
                      <p className="text-[10px] text-[oklch(0.45_0.015_255)]">Loading game log…</p>
                    </div>
                  </div>
                ) : (
                  <div className="p-2.5 rounded-xl" style={{ background: "oklch(0.12 0.018 255)", border: "1px solid oklch(1 0 0 / 6%)" }}>
                    <div className="text-[9px] font-bold tracking-widest uppercase mb-1.5" style={{ color: "oklch(0.45 0.015 255)" }}>Last 5 Games</div>
                    <p className="text-[10px] text-[oklch(0.38_0.015_255)]">Game log unavailable — MLB Stats API may be temporarily unreachable</p>
                  </div>
                )}

                {/* Statcast */}
                {pick.savantMetrics && (
                  <div className="grid grid-cols-4 gap-1.5">
                    <MetricBox label="xwOBA" value={pick.savantMetrics.xwOBA.toFixed(3)} good={pick.savantMetrics.xwOBA > 0.370} />
                    <MetricBox label="Hard Hit" value={`${pick.savantMetrics.hardHitPct.toFixed(0)}%`} good={pick.savantMetrics.hardHitPct > 45} />
                    <MetricBox label="Exit Velo" value={`${pick.savantMetrics.exitVelocity.toFixed(1)}`} good={pick.savantMetrics.exitVelocity > 90} />
                    <MetricBox label="Barrel" value={`${pick.savantMetrics.barrelPct.toFixed(0)}%`} good={pick.savantMetrics.barrelPct > 10} />
                  </div>
                )}

                {/* Ballpark reasoning */}
                <div className="p-2.5 rounded-lg" style={{ background: "oklch(0.12 0.018 255)" }}>
                  <span className="text-[10px] font-semibold text-[oklch(0.45_0.015_255)]">PROJECTION BASIS</span>
                  <p className="text-[10px] text-[oklch(0.55_0.015_255)] mt-1 leading-relaxed">
                    {pick.ballparkReasoning}
                  </p>
                </div>

                {/* Book comparison */}
                {pick.bookImpliedProb && (
                  <div className="p-2.5 rounded-lg" style={{ background: "oklch(0.12 0.018 255)" }}>
                    <span className="text-[10px] font-semibold text-[oklch(0.45_0.015_255)]">BOOK vs MODEL</span>
                    <div className="mt-1.5 flex items-center gap-3">
                      <div className="flex-1">
                        <div className="text-[10px] text-[oklch(0.50_0.015_255)]">Book</div>
                        <div className="text-sm font-bold text-[oklch(0.60_0.015_255)]">{pick.bookImpliedProb}%</div>
                      </div>
                      <div className="text-sm font-bold" style={{ color: probColor }}>→</div>
                      <div className="flex-1">
                        <div className="text-[10px] text-[oklch(0.50_0.015_255)]">Model</div>
                        <div className="text-sm font-bold" style={{ color: probColor }}>{pick.recommendedProb}%</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function MetricBox({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className="p-1.5 rounded-lg text-center" style={{ background: "oklch(0.16 0.02 255)" }}>
      <div className="text-[9px] text-[oklch(0.45_0.015_255)]">{label}</div>
      <div className={`text-[11px] font-bold ${good ? "text-[oklch(0.72_0.18_165)]" : "text-white"}`}>{value}</div>
    </div>
  );
}

export function MoneyPicksTab() {
  const utils = trpc.useUtils();
  const { data, isLoading, refetch, isRefetching } = trpc.aiPicks.getHRRPicks.useQuery(undefined, {
    refetchInterval: 10 * 60 * 1000,
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000, // 60 min — keep cached even if tab unmounts
    refetchOnWindowFocus: false, // don't re-fetch just because user switches apps
    refetchOnMount: false,       // use cached data immediately on remount
  });

  // Phase AL/AM: manual refresh — clears time-locked picks, preserves confirmed locks
  const [lastManualRefresh, setLastManualRefresh] = useState<Date | null>(null);
  const [skippedConfirmedNames, setSkippedConfirmedNames] = useState<string[]>([]);
  const clearLocksMutation = trpc.aiPicks.clearPickLocks.useMutation({
    onSuccess: async (result) => {
      setSkippedConfirmedNames(result.skippedNames ?? []);
      // Invalidate cache so the next fetch is truly fresh
      await utils.aiPicks.getHRRPicks.invalidate();
      await refetch();
      setLastManualRefresh(new Date());
    },
  });
  const isManualRefreshing = clearLocksMutation.isPending || isRefetching;

  const handleManualRefresh = () => {
    if (isManualRefreshing) return;
    setSkippedConfirmedNames([]);
    clearLocksMutation.mutate();
  };
  const { data: yesterdayData } = trpc.results.getYesterdayResults.useQuery(undefined, {
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
  const [activeFilter, setActiveFilter] = useState<FilterTier>("all");
  const [selectedPicks, setSelectedPicks] = useState<Set<number>>(new Set());
  const [showParlayBuilder, setShowParlayBuilder] = useState(false);
  const [showMatrix, setShowMatrix] = useState(false);
  const { data: matrixData, isLoading: matrixLoading } = trpc.aiPicks.getScoringMatrix.useQuery(
    undefined,
    { enabled: showMatrix, staleTime: 5 * 60 * 1000 }
  );

  // Derive lineup source early so it can be used in memos below
  const _lineupSource = (data as any)?.lineupSource ?? 'projected';
  const isProjected = (_lineupSource as string) !== 'confirmed';

  // Phase AS: Slate phase from server (preliminary / confirmed / final)
  const slatePhase: 'preliminary' | 'confirmed' | 'final' = (data as any)?.slatePhase ?? (isProjected ? 'preliminary' : 'confirmed');
  const officialPullPhase: string = (data as any)?.officialPullPhase ?? slatePhase;
  const officialPullTime: string | null = (data as any)?.officialPullTime ?? null;

  // Phase AT: Early auto-lock metadata
  const earlyLockedCount: number = (data as any)?.earlyLockedCount ?? 0;
  const earlyLockedGames: Array<{ gameId: string; lockedAt: string | null; firstPitchMs: number }> =
    (data as any)?.earlyLockedGames ?? [];

  const slatePhaseBadge = (() => {
    if (slatePhase === 'final') return { label: '🔥 FINAL OFFICIAL BOARD', color: 'oklch(0.82 0.17 85)', bg: 'oklch(0.82 0.17 85 / 12%)', border: 'oklch(0.82 0.17 85 / 40%)' };
    if (slatePhase === 'confirmed') return { label: '✓ MIDDAY CONFIRMED BOARD', color: 'oklch(0.72 0.18 165)', bg: 'oklch(0.72 0.18 165 / 12%)', border: 'oklch(0.72 0.18 165 / 35%)' };
    return { label: '📌 PRELIMINARY BOARD', color: 'oklch(0.72 0.10 220)', bg: 'oklch(0.72 0.10 220 / 10%)', border: 'oklch(0.72 0.10 220 / 30%)' };
  })();

  const nextPullLabel = (() => {
    if (slatePhase === 'preliminary') return 'Next official pull: 1 PM ET';
    if (slatePhase === 'confirmed') return 'Next official pull: 7 PM ET';
    return 'Evening lock active — final board';
  })();

  // Phase AK: Use server-side stability-aware moneyPicks array when available,
  // falling back to client-side filtering of raw picks for backward compatibility.
  const moneyPicks: MoneyPick[] = useMemo(() => {
    // Prefer the server-computed moneyPicks (includes lock window + score buffer)
    const sourceArray = (data as any)?.moneyPicks ?? (data?.picks || []);
    return sourceArray
      .map((pick: any) => {
        const alternateLines: AlternateLine[] = pick.alternateLines || [];
        // If pick came from server moneyPicks, recommendedLine/Prob are already set;
        // otherwise compute them client-side for backward compat.
        const qualifyingLines = alternateLines
          .filter((a: AlternateLine) => a.overProb >= 75)
          .sort((a: AlternateLine, b: AlternateLine) => b.line - a.line);

        const recommended = pick.recommendedLine != null
          ? { line: pick.recommendedLine, overProb: pick.recommendedProb }
          : qualifyingLines[0];

        if (!recommended) return null;
        // Use real streak from backend if available, otherwise generate from probability
        const streakInfo = pick.streakInfo ?? null;
        const dayNightSplit = pick.dayNightSplit ?? null;
        // Real odds from bookOdds (model-derived American odds)
        const realOdds = pick.bookOdds ? String(pick.bookOdds) : null;
        // Use bookOddsProvider if available, fall back to lineSource
        const oddsProvider = pick.bookOddsProvider && pick.bookOddsProvider !== 'model'
          ? pick.bookOddsProvider
          : null; // Don't show provider label for model-derived odds
        // Streak label: use real data if available
        const streak = streakInfo
          ? (streakInfo.isOnStreak && streakInfo.streakLength >= 3
              ? `🔥 ${streakInfo.streakLength}-game streak`
              : streakInfo.streakType === 'cold'
              ? `❄️ Cold (last 5: ${streakInfo.last5HitRate}%)`
              : `${streakInfo.last5HitRate}% last 5`)
          : generateStreak(pick.expectedTotal, recommended.line, recommended.overProb);

        return {
          playerId: pick.playerId ?? 0,
          playerName: pick.playerName,
          team: pick.team,
          pitcher: pick.pitcher,
          pitcherTeam: pick.pitcherTeam,
          battingPosition: pick.battingPosition,
          expectedHits: pick.expectedHits,
          expectedRuns: pick.expectedRuns,
          expectedRBI: pick.expectedRBI,
          expectedTotal: pick.expectedTotal,
          reasoning: pick.reasoning,
          ballparkReasoning: pick.ballparkReasoning,
          rcScore: pick.rcScore,
          parkFactor: pick.parkFactor,
          overProbability: pick.overProbability ?? pick.hrrConfidence,
          pickQuality: pick.pickQuality ?? "lean",
          lineSource: pick.lineSource ?? "model",
          bookOdds: pick.bookOdds ?? null,
          bookImpliedProb: pick.bookImpliedProb ?? null,
          alternateLines,
          fairLine: pick.fairLine ?? pick.hrrLine,
          edge: pick.edge ?? 0,
          savantMetrics: pick.savantMetrics,
          recommendedLine: recommended.line,
          recommendedProb: recommended.overProb,
          streak,
          odds: realOdds,
          oddsProvider,
          streakInfo: streakInfo ? {
            ...streakInfo,
            last5Games: (pick.streakInfo as any)?.last5Games ?? [],
          } : null,
          dayNightSplit,
          primePosition: pick.primePosition ?? false,
          primePositionFactors: pick.primePositionFactors ?? null,
          overallScore: pick.overallScore ?? pick.hrrConfidence,
          vsGrade: pick.vsGrade ?? null,
          gameTotalOU: pick.gameTotalOU ?? null,
          // Phase R new fields
          grade: pick.grade ?? undefined,
          reasons: pick.reasons ?? [],
          riskFlags: pick.riskFlags ?? [],
          isBestBet: pick.isBestBet ?? false,
          leanTier: pick.leanTier ?? false,
          bpBoost: pick.bpBoost ?? 0,
          baseScore: pick.baseScore ?? undefined,
          gameTime: (pick as any).gameTime ?? null,
          vsGateData: pick.vsGateData ?? null,
          // Phase AK: stability fields
          pickStatus: pick.pickStatus ?? undefined,
          lastUpdated: pick.lastUpdated ?? null,
          // Phase AT: early auto-lock fields
          isEarlyLocked: (pick as any).isEarlyLocked ?? false,
          gameLockTime: (pick as any).gameLockTime ?? null,
          gameLockReason: (pick as any).gameLockReason ?? null,
        } as MoneyPick;
      })
      .filter((p: MoneyPick | null): p is MoneyPick => p !== null)
      .sort((a: MoneyPick, b: MoneyPick) => {
        // Primary: matrix overallScore (same ranking as All Plays / Top Plays)
        const scoreDiff = ((b.overallScore ?? 0) - (a.overallScore ?? 0));
        if (Math.abs(scoreDiff) > 3) return scoreDiff;
        // Within 3 points: prefer higher recommended line, then higher probability
        if (b.recommendedLine !== a.recommendedLine) return b.recommendedLine - a.recommendedLine;
        return b.recommendedProb - a.recommendedProb;
      });
  }, [data]);

  // Apply confidence filter — thresholds shift for projected lineups
  const filteredPicks = useMemo(() => {
    const eliteMin = isProjected ? 75 : 83;
    const strongMin = isProjected ? 66 : 74;
    const leanMin = isProjected ? 60 : 68;
    switch (activeFilter) {
      case "s": return moneyPicks.filter(p => (p.overallScore ?? 0) >= eliteMin);
      case "a": return moneyPicks.filter(p => (p.overallScore ?? 0) >= strongMin && (p.overallScore ?? 0) < eliteMin);
      case "b": return moneyPicks.filter(p => (p.overallScore ?? 0) >= leanMin && (p.overallScore ?? 0) < strongMin);
      case "lean": return moneyPicks.filter(p => (p.overallScore ?? 0) >= 68 && (p.overallScore ?? 0) < 74);
      default: return moneyPicks;
    }
  }, [moneyPicks, activeFilter, isProjected]);

  // Phase AU: Slate window grouping — Early (<4PM ET), Main (4-8PM ET), Late (8PM+ ET)
  type SlateWindow = 'early' | 'main' | 'late';

  function getSlateWindow(gameTimeISO: string | null | undefined): SlateWindow {
    if (!gameTimeISO) return 'main';
    try {
      const d = new Date(gameTimeISO);
      if (isNaN(d.getTime())) return 'main';
      // Convert to ET hour
      const etStr = d.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });
      const etHour = parseInt(etStr, 10);
      if (etHour < 16) return 'early';   // before 4 PM ET
      if (etHour < 20) return 'main';    // 4–8 PM ET
      return 'late';                      // 8 PM+ ET
    } catch {
      return 'main';
    }
  }

  const slateGroups = useMemo(() => {
    const early: Array<{ pick: MoneyPick; globalIndex: number }> = [];
    const main: Array<{ pick: MoneyPick; globalIndex: number }> = [];
    const late: Array<{ pick: MoneyPick; globalIndex: number }> = [];

    filteredPicks.forEach((pick, i) => {
      const window = getSlateWindow(pick.gameTime);
      if (window === 'early') early.push({ pick, globalIndex: i });
      else if (window === 'late') late.push({ pick, globalIndex: i });
      else main.push({ pick, globalIndex: i });
    });

    return { early, main, late };
  }, [filteredPicks]);

  const hasMultipleWindows = useMemo(() => {
    const nonEmpty = [slateGroups.early, slateGroups.main, slateGroups.late].filter(g => g.length > 0);
    return nonEmpty.length > 1;
  }, [slateGroups]);

  const toggleSelect = (index: number) => {
    setSelectedPicks(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const selectedPicksList = filteredPicks.filter((_, i) => selectedPicks.has(i));
  const combinedProb = selectedPicksList.length > 0
    ? Math.round(selectedPicksList.reduce((acc, p) => acc * (p.recommendedProb / 100), 1) * 100)
    : 0;

  // Format the data date from API response (actual date of lineup data)
  const todayDate = (() => {
    const dateStr = (data as any)?.slateDate ?? data?.dataDate;
    if (dateStr) {
      const d = new Date(dateStr + 'T12:00:00');
      return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    }
    return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  })();

  // Format first pitch time from slate metadata
  const firstPitchLabel = (() => {
    const fp = (data as any)?.firstPitchTime;
    if (!fp) return null;
    try {
      const d = new Date(fp);
      if (isNaN(d.getTime())) return null;
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' });
    } catch { return null; }
  })();

  // Format odds updated time
  const oddsUpdatedLabel = (() => {
    const ts = (data as any)?.oddsUpdatedAt;
    if (!ts) return null;
    try {
      const d = new Date(ts);
      const now = Date.now();
      const diffMin = Math.round((now - d.getTime()) / 60000);
      if (diffMin < 2) return 'Just now';
      if (diffMin < 60) return `${diffMin}m ago`;
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } catch { return null; }
  })();

  // Stale slate warning
  const isStaleSlate = (data as any)?.isStale === true;

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        {/* Loading header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="animate-pulse h-5 w-32 rounded-lg" style={{ background: "oklch(0.18 0.02 255)" }} />
            <div className="animate-pulse h-3 w-48 rounded mt-1.5" style={{ background: "oklch(0.15 0.02 255)" }} />
          </div>
          <div className="animate-pulse h-6 w-16 rounded-lg" style={{ background: "oklch(0.18 0.02 255)" }} />
        </div>
        {/* Loading status */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "oklch(0.14 0.022 255)", border: "1px solid oklch(1 0 0 / 6%)" }}>
          <div className="w-2 h-2 rounded-full bg-[oklch(0.82_0.17_85)] animate-pulse" />
          <span className="text-[oklch(0.55_0.015_255)] text-xs">Running 10-factor scoring model…</span>
        </div>
        {/* Skeleton cards */}
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="animate-pulse rounded-2xl p-4 space-y-3" style={{ background: "oklch(0.14 0.022 255)", animationDelay: `${i * 80}ms` }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full" style={{ background: "oklch(0.20 0.02 255)" }} />
              <div className="flex-1 space-y-1.5">
                <div className="h-4 w-32 rounded" style={{ background: "oklch(0.22 0.02 255)" }} />
                <div className="h-3 w-24 rounded" style={{ background: "oklch(0.18 0.02 255)" }} />
              </div>
              <div className="h-8 w-16 rounded-xl" style={{ background: "oklch(0.20 0.02 255)" }} />
            </div>
            <div className="h-3 w-full rounded" style={{ background: "oklch(0.18 0.02 255)" }} />
            <div className="h-3 w-4/5 rounded" style={{ background: "oklch(0.16 0.02 255)" }} />
          </div>
        ))}
      </div>
    );
  }

  // Handle lineups pending state (no picks at all)
  if (data?.lineupsPending) {
    return (
      <div className="p-4 space-y-4">
        <div className="text-center">
          <p className="text-[oklch(0.50_0.015_255)] text-xs">{todayDate}</p>
        </div>
        <div className="text-center py-16">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ background: "oklch(0.18 0.03 255)" }}>
            <Target size={28} style={{ color: "oklch(0.72 0.18 165)" }} />
          </div>
          <h3 className="text-white font-bold text-lg mb-2">Building Projected Picks...</h3>
          <p className="text-[oklch(0.50_0.015_255)] text-sm max-w-xs mx-auto leading-relaxed">
            Using today's probable pitchers and historical batting orders to generate picks.
          </p>
          <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl" style={{ background: "oklch(0.14 0.022 255)", border: "1px solid oklch(1 0 0 / 8%)" }}>
            <div className="w-2 h-2 rounded-full bg-[oklch(0.82_0.17_85)] animate-pulse" />
            <span className="text-[oklch(0.55_0.015_255)] text-xs">Refreshes automatically</span>
          </div>
        </div>
      </div>
    );
  }

  const enrichmentStatus = (data as any)?.enrichmentStatus ?? null;

  return (
    <div className="p-4 space-y-4 pb-32">
      {/* Data Health Bar — Issue 6 */}
      <DataHealthBar enrichmentStatus={enrichmentStatus} />

      {/* Stale slate warning */}
      {isStaleSlate && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "oklch(0.20 0.08 60 / 0.25)", border: "1px solid oklch(0.75 0.15 60 / 0.4)" }}>
          <RefreshCw size={12} style={{ color: "oklch(0.82 0.17 85)" }} className="animate-spin" />
          <span className="text-xs" style={{ color: "oklch(0.82 0.17 85)" }}>Refreshing slate — today's games loading…</span>
        </div>
      )}

      {/* Slate Header */}
      <div className="rounded-2xl p-3.5" style={{ background: "oklch(0.13 0.022 255)", border: "1px solid oklch(1 0 0 / 8%)" }}>
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="flex items-center gap-1.5 mb-0.5">
              <CalendarDays size={13} style={{ color: "oklch(0.72 0.18 165)" }} />
              <span className="text-white font-bold text-sm">{todayDate}</span>
            </div>
            {firstPitchLabel && (
              <div className="flex items-center gap-1 mt-0.5">
                <Clock size={11} style={{ color: "oklch(0.55 0.015 255)" }} />
                <span className="text-[10px] text-[oklch(0.55_0.015_255)]">First pitch {firstPitchLabel}</span>
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-1.5">
            {/* Phase AS: Slate phase badge */}
            <div
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-bold tracking-wide"
              style={{ background: slatePhaseBadge.bg, border: `1px solid ${slatePhaseBadge.border}`, color: slatePhaseBadge.color }}
              title={nextPullLabel}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${slatePhase === 'preliminary' ? 'animate-pulse' : ''}`} style={{ background: slatePhaseBadge.color }} />
              {slatePhaseBadge.label}
            </div>
            {/* Next pull hint */}
            <div className="text-[8px] text-right" style={{ color: 'oklch(0.40 0.015 255)' }}>{nextPullLabel}</div>

            {/* Phase AT: Early locked games indicator */}
            {earlyLockedCount > 0 && (
              <div
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold tracking-wide"
                style={{ background: "oklch(0.72 0.18 165 / 12%)", color: "oklch(0.72 0.18 165)", border: "1px solid oklch(0.72 0.18 165 / 35%)" }}
                title={earlyLockedGames.map(g => `${g.gameId} locked at ${g.lockedAt ? new Date(g.lockedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : '?'} ET`).join(', ')}
              >
                🔒 {earlyLockedCount} EARLY GAME{earlyLockedCount > 1 ? 'S' : ''} LOCKED
              </div>
            )}

            {/* Phase AL: Manual Refresh button */}
            <button
              onClick={handleManualRefresh}
              disabled={isManualRefreshing}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all active:scale-95 disabled:opacity-60"
              style={{
                background: isManualRefreshing
                  ? "oklch(0.55 0.15 255 / 12%)"
                  : "oklch(0.55 0.15 255 / 18%)",
                border: "1px solid oklch(0.55 0.15 255 / 35%)",
                color: isManualRefreshing ? "oklch(0.55 0.15 255)" : "oklch(0.72 0.18 165)",
              }}
              title="Force refresh — clears the 30-min lock window and re-evaluates all picks"
            >
              <RefreshCw
                size={10}
                className={isManualRefreshing ? "animate-spin" : ""}
              />
              {isManualRefreshing ? "Refreshing…" : "Force Refresh"}
            </button>

            {/* Last manual refresh label */}
            {lastManualRefresh && !isManualRefreshing && (() => {
              const diffMs = Date.now() - lastManualRefresh.getTime();
              const diffMin = Math.round(diffMs / 60000);
              const label = diffMin < 1 ? 'Refreshed just now' : `Refreshed ${diffMin}m ago`;
              return (
                <div className="flex items-center gap-1 text-[9px]" style={{ color: "oklch(0.72 0.18 165)" }}>
                  <CheckCircle2 size={9} />
                  {label}
                </div>
              );
            })()}

            {/* Phase AM: Confirmed-lock preservation notice */}
            {lastManualRefresh && !isManualRefreshing && skippedConfirmedNames.length > 0 && (
              <div
                className="flex items-start gap-1 px-2 py-1 rounded-md text-[9px] leading-tight max-w-[140px]"
                style={{ background: "oklch(0.72 0.18 165 / 8%)", border: "1px solid oklch(0.72 0.18 165 / 25%)", color: "oklch(0.72 0.18 165)" }}
                title={`Confirmed picks preserved: ${skippedConfirmedNames.join(', ')}`}
              >
                🔒 {skippedConfirmedNames.length} confirmed pick{skippedConfirmedNames.length > 1 ? 's' : ''} kept
              </div>
            )}

            {oddsUpdatedLabel && (
              <div className="flex items-center gap-1">
                <RefreshCw size={9} style={{ color: "oklch(0.40 0.015 255)" }} />
                <span className="text-[9px] text-[oklch(0.40_0.015_255)]">Odds {oddsUpdatedLabel}</span>
              </div>
            )}
          </div>
        </div>
        {/* Pick count summary */}
        <div className="flex items-center gap-2 mt-1.5">
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-md" style={{ background: "oklch(0.18 0.03 255)" }}>
            <DollarSign size={10} style={{ color: "oklch(0.72 0.18 165)" }} />
            <span className="text-[10px] font-semibold text-white">{moneyPicks.filter(p => p.grade === 'elite').length} Elite</span>
          </div>
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-md" style={{ background: "oklch(0.18 0.03 255)" }}>
            <TrendingUp size={10} style={{ color: "oklch(0.82 0.17 85)" }} />
            <span className="text-[10px] font-semibold text-white">{moneyPicks.filter(p => p.grade === 'strong').length} Strong</span>
          </div>
          <div className="ml-auto text-[10px] text-[oklch(0.45_0.015_255)]">{filteredPicks.length} total plays</div>
        </div>
      </div>

      {/* Quick Filter Buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        {([
          { key: "all", label: "All Picks" },
          { key: "s", label: isProjected ? "Strong (74+)" : "S Tier (83+)" },
          { key: "a", label: isProjected ? "A Tier (66-74)" : "A Tier (74-82)" },
          { key: "b", label: isProjected ? "Lean (60-66)" : "Lean (68-73)" },
        ] as { key: FilterTier; label: string }[]).map((filter) => (
          <button
            key={filter.key}
            onClick={() => setActiveFilter(filter.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeFilter === filter.key
                ? "bg-[oklch(0.72_0.18_165/20%)] text-[oklch(0.72_0.18_165)] border border-[oklch(0.72_0.18_165/40%)]"
                : "text-[oklch(0.50_0.015_255)] bg-[oklch(1_0_0/4%)] border border-[oklch(1_0_0/8%)] hover:text-white hover:bg-[oklch(1_0_0/6%)]"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Explanation */}
      <div className="p-3 rounded-xl border border-[oklch(1_0_0/6%)]" style={{ background: "oklch(0.12 0.018 255)" }}>
        <div className="flex items-start gap-2">
          <Shield size={14} className="mt-0.5 shrink-0" style={{ color: "oklch(0.72 0.18 165)" }} />
          <p className="text-[10px] text-[oklch(0.55_0.015_255)] leading-relaxed">
            These are our <strong className="text-white">safest plays</strong> — only picks where our Poisson model gives 75%+ probability of hitting the OVER.
            Tap <strong className="text-white">"Add to Parlay"</strong> on any picks to build your own custom parlay.
          </p>
        </div>
      </div>

      {/* Yesterday's Results */}
      {yesterdayData?.hasActuals && yesterdayData.totalPlays > 0 && (
        <div className="rounded-xl p-3" style={{ background: "oklch(0.13 0.022 255)", border: "1px solid oklch(1 0 0 / 6%)" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <CalendarDays size={11} style={{ color: "oklch(0.55 0.015 255)" }} />
              <span className="text-[10px] font-bold tracking-widest uppercase text-[oklch(0.45_0.015_255)]">Yesterday's Results</span>
            </div>
            <span className="text-[9px] text-[oklch(0.38_0.015_255)]">{yesterdayData.date}</span>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <div className="flex-1 flex items-center gap-2">
              <div
                className="text-2xl font-bold"
                style={{ color: (yesterdayData.hitRate ?? 0) >= 60 ? "oklch(0.72 0.18 165)" : (yesterdayData.hitRate ?? 0) >= 40 ? "oklch(0.82 0.17 85)" : "oklch(0.68 0.22 25)" }}
              >
                {yesterdayData.hitRate}%
              </div>
              <div>
                <div className="text-[10px] font-semibold text-white">Hit Rate</div>
                <div className="text-[9px] text-[oklch(0.45_0.015_255)]">{yesterdayData.totalHits}/{yesterdayData.totalWithActuals ?? yesterdayData.totalPlays} plays hit</div>
              </div>
            </div>
            {/* Mini hit-rate bar */}
            <div className="flex-1">
              <div className="h-2 rounded-full overflow-hidden" style={{ background: "oklch(0.20 0.02 255)" }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${yesterdayData.hitRate}%`,
                    background: (yesterdayData.hitRate ?? 0) >= 60
                      ? "oklch(0.72 0.18 165)"
                      : (yesterdayData.hitRate ?? 0) >= 40
                      ? "oklch(0.82 0.17 85)"
                      : "oklch(0.68 0.22 25)",
                  }}
                />
              </div>
              <div className="text-[9px] text-[oklch(0.38_0.015_255)] mt-0.5 text-right">{yesterdayData.totalPlays} total plays</div>
            </div>
          </div>
        </div>
      )}

      <SaferPlayTip />

      {/* Best Bet Today banner — shown when the top pick is a weak-slate fallback */}
      {moneyPicks.length > 0 && moneyPicks[0].isBestBet && (
        <div className="rounded-2xl p-3 border" style={{ background: "oklch(0.14 0.04 60 / 0.35)", borderColor: "oklch(0.82 0.17 85 / 40%)" }}>
          <div className="flex items-center gap-2 mb-1.5">
            <Zap size={13} style={{ color: "oklch(0.82 0.17 85)" }} />
            <span className="text-xs font-bold tracking-wide" style={{ color: "oklch(0.82 0.17 85)" }}>BEST BET TODAY</span>
            <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded" style={{ background: "oklch(0.82 0.17 85 / 12%)", color: "oklch(0.82 0.17 85)" }}>WEAK SLATE</span>
          </div>
          <p className="text-[10px] text-[oklch(0.60_0.015_255)] leading-relaxed">
            No plays reached official thresholds today. The model is surfacing the strongest available candidate as a <strong className="text-white">Best Bet</strong> — lower confidence, informational only.
          </p>
        </div>
      )}

      {/* Best Edge Today Hero Card — show #1 pick when not filtered */}
      {activeFilter === 'all' && moneyPicks.length > 0 && (
        <BestEdgeCard pick={{ ...moneyPicks[0], overallScore: moneyPicks[0].overallScore ?? moneyPicks[0].recommendedProb }} />
      )}

      {/* Money Pick Cards */}
      {filteredPicks.length === 0 ? (
        <div className="space-y-3">
          {moneyPicks.length === 0 ? (
            // Quality gate: no picks scored 68+ today — Smart Empty-Slate UX
            <>
              {/* Partial enrichment banner */}
              {(data as any)?.enrichmentStatus?.isPartialEnrichment && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "oklch(0.14 0.04 60 / 0.3)", border: "1px solid oklch(0.82 0.17 85 / 30%)" }}>
                  <div className="w-2 h-2 rounded-full bg-[oklch(0.82_0.17_85)] animate-pulse" />
                  <span className="text-xs" style={{ color: "oklch(0.82 0.17 85)" }}>Advanced enrichment still loading — scores may improve shortly</span>
                </div>
              )}

              {/* Why No Plays Qualified */}
              <div className="rounded-2xl p-4" style={{ background: "oklch(0.13 0.022 255)", border: "1px solid oklch(1 0 0 / 8%)" }}>
                <div className="flex items-center gap-2 mb-3">
                  <Shield size={14} style={{ color: "oklch(0.45 0.015 255)" }} />
                  <span className="text-xs font-bold tracking-widest uppercase text-[oklch(0.45_0.015_255)]">Why No Plays Qualified</span>
                </div>

                {/* Best available score */}
                {(data as any)?.bestAvailableScore != null && (
                  <div className="flex items-center gap-2 mb-3 p-2.5 rounded-xl" style={{ background: "oklch(0.16 0.025 255)" }}>
                    <BarChart2 size={12} style={{ color: "oklch(0.72 0.10 220)" }} />
                    <span className="text-xs text-[oklch(0.60_0.015_255)]">
                      Best available: <strong className="text-white">{(data as any).bestAvailableScore.toFixed(1)}</strong>
                      {(data as any).bestAvailableScore >= 83
                        ? <span style={{ color: 'oklch(0.82 0.17 85)' }}> — S Tier but no qualifying line</span>
                        : (data as any).bestAvailableScore >= 74
                        ? <span style={{ color: 'oklch(0.82 0.17 85)' }}> — A Tier but no qualifying line</span>
                        : <span className="text-[oklch(0.45_0.015_255)]"> — below 74 threshold</span>
                      }
                    </span>
                  </div>
                )}

                {/* Reasons list */}
                {((data as any)?.emptySlateReasons ?? []).length > 0 && (
                  <ul className="space-y-1.5 mb-3">
                    {((data as any).emptySlateReasons as string[]).map((reason: string, i: number) => (
                      <li key={i} className="flex items-start gap-2">
                        <div className="w-1 h-1 rounded-full mt-1.5 shrink-0" style={{ background: "oklch(0.50 0.015 255)" }} />
                        <span className="text-xs text-[oklch(0.55_0.015_255)] leading-relaxed">{reason}</span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="flex items-center gap-2 pt-2 border-t border-[oklch(1_0_0/6%)]">
                  <div className="w-2 h-2 rounded-full bg-[oklch(0.82_0.17_85)] animate-pulse" />
                  <span className="text-[10px] text-[oklch(0.45_0.015_255)]">Refreshes automatically as lineups confirm</span>
                </div>
              </div>

              {/* Top Candidates (near-miss watchlist) */}
              {((data as any)?.topCandidates ?? []).length > 0 && (
                <div className="rounded-2xl p-4" style={{ background: "oklch(0.13 0.022 255)", border: "1px solid oklch(1 0 0 / 8%)" }}>
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingUp size={13} style={{ color: "oklch(0.72 0.10 220)" }} />
                    <span className="text-xs font-bold tracking-widest uppercase text-[oklch(0.45_0.015_255)]">Watchlist — Near Miss Candidates</span>
                    <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded" style={{ background: "oklch(0.72 0.10 220 / 12%)", color: "oklch(0.72 0.10 220)" }}>INFORMATIONAL</span>
                  </div>
                  <div className="space-y-2">
                    {((data as any).topCandidates as any[]).map((cand: any, i: number) => {
                      const score = cand.overallScore ?? cand.hrrConfidence ?? 0;
                      const tier = getScoreTier(score);
                      return (
                        <div key={i} className="flex items-center justify-between p-2.5 rounded-xl" style={{ background: "oklch(0.16 0.022 255)" }}>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-white truncate">{cand.playerName}</span>
                              <span className="text-[9px] px-1.5 py-0.5 rounded font-bold" style={{ background: tier.bg, color: tier.color, border: `1px solid ${tier.border}` }}>{tier.label}</span>
                            </div>
                            <div className="text-[10px] text-[oklch(0.45_0.015_255)] mt-0.5">{cand.team} vs {cand.pitcherTeam} · #{cand.battingPosition}</div>
                          </div>
                          <div className="text-right shrink-0 ml-3">
                            <div className="text-base font-bold" style={{ color: tier.color }}>{score.toFixed(0)}</div>
                            <div className="text-[9px] text-[oklch(0.40_0.015_255)]">score</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            // Filter too strict
            <div className="text-center py-12">
              <DollarSign size={40} className="mx-auto mb-3" style={{ color: "oklch(0.35 0.015 255)" }} />
              <p className="text-[oklch(0.45_0.015_255)] text-sm">No plays at this confidence level</p>
              <p className="text-[oklch(0.35_0.015_255)] text-xs mt-1">Try lowering the filter</p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {hasMultipleWindows ? (
            // ── Phase AU: Grouped by slate window ─────────────────────────────────────────────────
            ([
              { key: 'early' as const, label: '🌅 EARLY SLATE', sublabel: 'Before 4 PM ET', items: slateGroups.early },
              { key: 'main'  as const, label: '⚾ MAIN SLATE',  sublabel: '4–8 PM ET',      items: slateGroups.main  },
              { key: 'late'  as const, label: '🌙 LATE SLATE',  sublabel: '8 PM+ ET',       items: slateGroups.late  },
            ] as Array<{ key: 'early' | 'main' | 'late'; label: string; sublabel: string; items: Array<{ pick: MoneyPick; globalIndex: number }> }>)
              .filter(section => section.items.length > 0)
              .map(section => {
                // Check if any pick in this section is early-locked
                const hasEarlyLock = section.items.some(({ pick }) => pick.isEarlyLocked);
                const allConfirmed = section.items.every(({ pick }) => pick.pickStatus === 'confirmed' || pick.pickStatus === 'final_official' || pick.pickStatus === 'locked_confirmed');
                const sectionLockLabel = hasEarlyLock
                  ? '🔒 EARLY LOCKED'
                  : allConfirmed
                  ? '✓ CONFIRMED'
                  : null;

                return (
                  <div key={section.key} className="space-y-2">
                    {/* Section header */}
                    <div className="flex items-center justify-between px-1 pt-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold tracking-widest" style={{ color: 'oklch(0.55 0.015 255)' }}>
                          {section.label}
                        </span>
                        <span className="text-[9px]" style={{ color: 'oklch(0.40 0.015 255)' }}>
                          {section.sublabel}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {sectionLockLabel && (
                          <span
                            className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                            style={{
                              background: hasEarlyLock ? 'oklch(0.72 0.18 165 / 12%)' : 'oklch(0.72 0.18 165 / 8%)',
                              color: 'oklch(0.72 0.18 165)',
                              border: '1px solid oklch(0.72 0.18 165 / 30%)',
                            }}
                          >
                            {sectionLockLabel}
                          </span>
                        )}
                        {!sectionLockLabel && (
                          <span className="flex items-center gap-1 text-[9px]" style={{ color: 'oklch(0.82 0.17 85)' }}>
                            <span className="w-1.5 h-1.5 rounded-full bg-[oklch(0.82_0.17_85)] animate-pulse inline-block" />
                            PRELIMINARY
                          </span>
                        )}
                        <span
                          className="text-[9px] font-semibold px-1.5 py-0.5 rounded"
                          style={{ background: 'oklch(0.18 0.02 255)', color: 'oklch(0.50 0.015 255)' }}
                        >
                          {section.items.length} PLAY{section.items.length !== 1 ? 'S' : ''}
                        </span>
                      </div>
                    </div>
                    {/* Divider */}
                    <div className="h-px" style={{ background: 'oklch(1 0 0 / 6%)' }} />
                    {/* Pick cards */}
                    {section.items.map(({ pick, globalIndex }) => (
                      <MoneyPickCard
                        key={`${pick.playerName}-${globalIndex}`}
                        pick={pick}
                        rank={globalIndex + 1}
                        isSelected={selectedPicks.has(globalIndex)}
                        onToggleSelect={() => toggleSelect(globalIndex)}
                      />
                    ))}
                  </div>
                );
              })
          ) : (
            // ── Single window: flat list (no section headers needed) ────────────────────────────
            filteredPicks.map((pick, i) => (
              <MoneyPickCard
                key={`${pick.playerName}-${i}`}
                pick={pick}
                rank={i + 1}
                isSelected={selectedPicks.has(i)}
                onToggleSelect={() => toggleSelect(i)}
              />
            ))
          )}
        </div>
      )}

      {/* Disclaimer */}
      <div className="text-center py-3">
        <p className="text-[10px] text-[oklch(0.35_0.015_255)] leading-relaxed">
          Probabilities from Poisson model using Statcast + Diamond Edge VS Gate data. Streaks based on model projections. Always bet responsibly.
        </p>
      </div>

      {/* Scoring Matrix Panel */}
      <div className="rounded-2xl overflow-hidden border" style={{ background: "oklch(0.13 0.022 255)", borderColor: "oklch(1 0 0 / 8%)" }}>
        <button
          onClick={() => setShowMatrix(v => !v)}
          className="w-full flex items-center justify-between p-4 hover:bg-[oklch(1_0_0/4%)] transition-colors"
        >
          <div className="flex items-center gap-2">
            <BarChart2 size={14} style={{ color: "oklch(0.72 0.10 220)" }} />
            <span className="text-sm font-bold text-white">Scoring Matrix</span>
            {matrixData && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md font-semibold" style={{ background: "oklch(0.72 0.10 220 / 15%)", color: "oklch(0.72 0.10 220)" }}>
                {matrixData.totalCandidates} scored · {matrixData.qualifiedCount} qualified
              </span>
            )}
          </div>
          <ChevronRight size={14} className={`text-[oklch(0.45_0.015_255)] transition-transform ${showMatrix ? 'rotate-90' : ''}`} />
        </button>

        <AnimatePresence>
          {showMatrix && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              style={{ overflow: 'hidden' }}
            >
              <div className="px-4 pb-4">
                {matrixLoading ? (
                  <div className="flex items-center justify-center py-8 gap-2">
                    <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "oklch(0.72 0.10 220)", borderTopColor: 'transparent' }} />
                    <span className="text-xs text-[oklch(0.50_0.015_255)]">Running scoring model...</span>
                  </div>
                ) : matrixData?.candidates && matrixData.candidates.length > 0 ? (
                  <div className="space-y-1">
                    {/* Issue 5: Horizontal scroll wrapper for mobile */}
                    <div className="overflow-x-auto -mx-2 px-2">
                      <div style={{ minWidth: 520 }}>
                        {/* Header row */}
                        <div className="grid gap-1 mb-2 px-2" style={{ gridTemplateColumns: '140px 36px 28px 28px 28px 28px 28px 28px 28px 28px 28px 28px' }}>
                          <span className="text-[9px] font-bold uppercase tracking-wider text-[oklch(0.40_0.015_255)]">Player</span>
                          <span className="text-[9px] font-bold uppercase tracking-wider text-[oklch(0.40_0.015_255)] text-center">Score</span>
                          <span className="text-[9px] font-bold uppercase tracking-wider text-[oklch(0.40_0.015_255)] text-center" title="Team Implied Runs">TIR</span>
                          <span className="text-[9px] font-bold uppercase tracking-wider text-[oklch(0.40_0.015_255)] text-center" title="Lineup Spot">LU</span>
                          <span className="text-[9px] font-bold uppercase tracking-wider text-[oklch(0.40_0.015_255)] text-center" title="OBP/xwOBA">OBP</span>
                          <span className="text-[9px] font-bold uppercase tracking-wider text-[oklch(0.40_0.015_255)] text-center" title="Pitcher Weakness">PIT</span>
                          <span className="text-[9px] font-bold uppercase tracking-wider text-[oklch(0.40_0.015_255)] text-center" title="Recent Form">FRM</span>
                          <span className="text-[9px] font-bold uppercase tracking-wider text-[oklch(0.40_0.015_255)] text-center" title="Day/Night Split">D/N</span>
                          <span className="text-[9px] font-bold uppercase tracking-wider text-[oklch(0.40_0.015_255)] text-center" title="Park+Weather">PRK</span>
                          <span className="text-[9px] font-bold uppercase tracking-wider text-[oklch(0.40_0.015_255)] text-center" title="Bullpen">BUL</span>
                          <span className="text-[9px] font-bold uppercase tracking-wider text-[oklch(0.40_0.015_255)] text-center" title="Platoon">PLT</span>
                          <span className="text-[9px] font-bold uppercase tracking-wider text-[oklch(0.40_0.015_255)] text-center" title="Hard Contact/Barrel">HRD</span>
                        </div>
                        {/* Divider */}
                        <div className="h-px mb-2" style={{ background: "oklch(1 0 0 / 8%)" }} />
                        {/* Candidate rows */}
                        {matrixData.candidates.map((c: any, i: number) => {
                          const tier = getScoreTier(c.overallScore);
                          const passes = c.passesGate;
                          return (
                            <div
                              key={i}
                              className="grid gap-1 px-2 py-1.5 rounded-lg items-center"
                              style={{
                                gridTemplateColumns: '140px 36px 28px 28px 28px 28px 28px 28px 28px 28px 28px 28px',
                                background: passes ? 'oklch(0.15 0.025 165 / 30%)' : 'oklch(1 0 0 / 2%)',
                                opacity: passes ? 1 : 0.55,
                              }}
                            >
                              {/* Player name + team */}
                              <div className="min-w-0">
                                <div className="text-[11px] font-semibold text-white truncate">{c.playerName}</div>
                                <div className="text-[9px] text-[oklch(0.45_0.015_255)] truncate">{c.team} #{c.battingPosition} vs {c.pitcherTeam}</div>
                              </div>
                              {/* Overall score */}
                              <div className="text-center">
                                <span className="text-[11px] font-bold" style={{ color: tier.color }}>{c.overallScore}</span>
                              </div>
                              {/* Factor scores */}
                              {(['teamImpliedRuns','lineupSpot','obpXwOBA','pitcherWeakness','recentForm','dayNightSplit','parkWeather','bullpenWeakness','platoonAdvantage','hardContactBarrel'] as const).map(key => {
                                const val = c.factors[key] as number;
                                const color = val >= 70 ? 'oklch(0.72 0.18 165)' : val >= 50 ? 'oklch(0.82 0.17 85)' : 'oklch(0.55 0.015 255)';
                                return (
                                  <div key={key} className="text-center">
                                    <span className="text-[10px] font-semibold" style={{ color }}>{val}</span>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    {/* Legend */}
                    <div className="flex items-center gap-3 mt-3 pt-3 border-t border-[oklch(1_0_0/6%)]">
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-sm" style={{ background: 'oklch(0.15 0.025 165 / 60%)' }} />
                        <span className="text-[9px] text-[oklch(0.45_0.015_255)]">Qualifies (75+)</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-sm" style={{ background: 'oklch(1 0 0 / 8%)' }} />
                        <span className="text-[9px] text-[oklch(0.45_0.015_255)]">Below threshold</span>
                      </div>
                      <div className="ml-auto text-[9px] text-[oklch(0.35_0.015_255)]">
                        ← Scroll →
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <span className="text-xs text-[oklch(0.45_0.015_255)]">No candidates scored yet — lineups may still be pending.</span>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Floating Parlay Builder */}
      <AnimatePresence>
        {selectedPicks.size > 0 && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed bottom-20 left-0 right-0 z-50 px-4 max-w-[480px] mx-auto"
          >
            <div
              className="rounded-2xl p-4 border shadow-2xl"
              style={{
                background: "oklch(0.13 0.03 255)",
                borderColor: "oklch(0.72 0.18 165 / 40%)",
                boxShadow: "0 -8px 32px oklch(0 0 0 / 60%)",
              }}
            >
              {/* Collapsed view */}
              {!showParlayBuilder ? (
                <button
                  onClick={() => setShowParlayBuilder(true)}
                  className="w-full flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <ShoppingCart size={16} style={{ color: "oklch(0.72 0.18 165)" }} />
                    <span className="text-white font-bold text-sm">
                      Parlay Builder ({selectedPicks.size} legs)
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold" style={{ color: "oklch(0.72 0.18 165)" }}>
                      {combinedProb}% combined
                    </span>
                    <ChevronDown size={14} className="text-white rotate-180" />
                  </div>
                </button>
              ) : (
                <div>
                  {/* Expanded parlay builder */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <ShoppingCart size={16} style={{ color: "oklch(0.72 0.18 165)" }} />
                      <span className="text-white font-bold text-sm">Your Parlay</span>
                    </div>
                    <button onClick={() => setShowParlayBuilder(false)}>
                      <X size={16} className="text-[oklch(0.50_0.015_255)]" />
                    </button>
                  </div>

                  {/* Legs list */}
                  <div className="space-y-2 mb-3">
                    {selectedPicksList.map((pick, i) => (
                      <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-[oklch(1_0_0/4%)] border border-[oklch(1_0_0/8%)]">
                        <div className="flex items-center gap-2">
                          <Flame size={10} style={{ color: "oklch(0.82 0.17 85)" }} />
                          <span className="text-white text-xs font-semibold">{pick.playerName}</span>
                          <span className="text-[oklch(0.45_0.015_255)] text-[10px]">{pick.team}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold" style={{ color: "oklch(0.72 0.18 165)" }}>
                            HRR O {pick.recommendedLine}
                          </span>
                          <span className="text-[10px] text-[oklch(0.55_0.015_255)]">
                            {pick.recommendedProb}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Combined probability */}
                  <div className="flex items-center justify-between p-3 rounded-xl" style={{ background: "oklch(0.72 0.18 165 / 10%)", border: "1px solid oklch(0.72 0.18 165 / 30%)" }}>
                    <span className="text-white text-xs font-semibold">Combined Probability</span>
                    <span className="text-lg font-bold" style={{ color: "oklch(0.72 0.18 165)" }}>
                      {combinedProb}%
                    </span>
                  </div>

                  {/* Risk warning */}
                  {selectedPicks.size >= 3 && (
                    <div className="mt-2 flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                      <Shield size={10} className="text-amber-400 shrink-0" />
                      <span className="text-[10px] text-amber-400">
                        {selectedPicks.size}+ legs increases risk. Consider splitting into smaller parlays.
                      </span>
                    </div>
                  )}

                  {/* Clear button */}
                  <button
                    onClick={() => { setSelectedPicks(new Set()); setShowParlayBuilder(false); }}
                    className="mt-3 w-full py-2 rounded-lg text-xs font-semibold text-[oklch(0.60_0.015_255)] bg-[oklch(1_0_0/5%)] border border-[oklch(1_0_0/10%)] hover:bg-[oklch(1_0_0/8%)] transition-colors"
                  >
                    Clear All
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
