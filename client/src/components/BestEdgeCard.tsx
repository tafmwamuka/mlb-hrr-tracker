/**
 * BestEdgeCard — Diamond Edge Premium Hero Card
 * Shows the #1 ranked pick of the day in a large glassmorphism hero format.
 */

import { motion } from "framer-motion";
import { Flame, TrendingUp, Shield, DollarSign, Target, Zap } from "lucide-react";

interface BestEdgePick {
  playerName: string;
  team: string;
  pitcherTeam: string;
  pitcher: string;
  battingPosition: number;
  recommendedLine: number;
  recommendedProb: number;
  overallScore: number;
  edge: number;
  odds?: string | null;
  reasons?: string[];
  riskFlags?: string[];
  expectedHits: number;
  expectedRuns: number;
  expectedRBI: number;
  expectedTotal: number;
  streakInfo?: {
    streakType: 'hot' | 'cold' | 'neutral';
    streakLength: number;
    last5HitRate: number;
  } | null;
}

function getTierConfig(score: number) {
  if (score >= 90) return {
    tier: 'S',
    label: 'S TIER',
    color: 'oklch(0.82 0.17 85)',
    gradientFrom: 'oklch(0.82 0.17 85 / 20%)',
    gradientTo: 'oklch(0.82 0.17 85 / 5%)',
    border: 'oklch(0.82 0.17 85 / 50%)',
    glow: '0 0 40px oklch(0.82 0.17 85 / 25%), 0 0 80px oklch(0.82 0.17 85 / 10%)',
    accentBar: 'linear-gradient(90deg, oklch(0.82 0.17 85), oklch(0.82 0.17 85 / 30%))',
  };
  if (score >= 85) return {
    tier: 'A',
    label: 'A TIER',
    color: 'oklch(0.72 0.18 165)',
    gradientFrom: 'oklch(0.72 0.18 165 / 20%)',
    gradientTo: 'oklch(0.72 0.18 165 / 5%)',
    border: 'oklch(0.72 0.18 165 / 50%)',
    glow: '0 0 40px oklch(0.72 0.18 165 / 25%), 0 0 80px oklch(0.72 0.18 165 / 10%)',
    accentBar: 'linear-gradient(90deg, oklch(0.72 0.18 165), oklch(0.72 0.18 165 / 30%))',
  };
  return {
    tier: 'B',
    label: 'B TIER',
    color: 'oklch(0.72 0.10 220)',
    gradientFrom: 'oklch(0.72 0.10 220 / 15%)',
    gradientTo: 'oklch(0.72 0.10 220 / 5%)',
    border: 'oklch(0.72 0.10 220 / 40%)',
    glow: '0 0 30px oklch(0.72 0.10 220 / 20%)',
    accentBar: 'linear-gradient(90deg, oklch(0.72 0.10 220), oklch(0.72 0.10 220 / 30%))',
  };
}

export function BestEdgeCard({ pick }: { pick: BestEdgePick }) {
  const cfg = getTierConfig(pick.overallScore);
  const isHot = pick.streakInfo?.streakType === 'hot' && (pick.streakInfo?.streakLength ?? 0) >= 3;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-2xl overflow-hidden relative"
      style={{
        background: `linear-gradient(135deg, ${cfg.gradientFrom}, oklch(0.13 0.022 255), ${cfg.gradientTo})`,
        border: `1px solid ${cfg.border}`,
        boxShadow: cfg.glow,
      }}
    >
      {/* Top accent bar */}
      <div className="h-[4px]" style={{ background: cfg.accentBar }} />

      {/* Header label */}
      <div className="px-4 pt-3 pb-0 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Zap size={11} style={{ color: cfg.color }} />
          <span className="text-[9px] font-bold tracking-widest uppercase" style={{ color: cfg.color }}>
            Best Edge Today
          </span>
        </div>
        {/* Tier badge */}
        <div
          className="px-2.5 py-0.5 rounded-lg text-[10px] font-bold tracking-widest font-stat"
          style={{ background: `${cfg.color}18`, border: `1px solid ${cfg.border}`, color: cfg.color }}
        >
          {cfg.label}
        </div>
      </div>

      <div className="p-4 pt-2.5">
        {/* Player name + matchup */}
        <div className="flex items-start justify-between mb-3">
          <div>
            <div
              className="text-2xl font-bold leading-tight tracking-tight"
              style={{ color: 'white', fontFamily: "'Inter', sans-serif" }}
            >
              {pick.playerName}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm font-semibold" style={{ color: cfg.color }}>{pick.team}</span>
              <span className="text-[oklch(0.45_0.015_255)] text-xs">vs</span>
              <span className="text-[oklch(0.65_0.015_255)] text-xs">{pick.pitcherTeam}</span>
              <span className="text-[oklch(0.40_0.015_255)] text-[10px]">· #{pick.battingPosition}</span>
            </div>
            <div className="text-[10px] text-[oklch(0.42_0.015_255)] mt-0.5">
              vs {pick.pitcher}
            </div>
          </div>

          {/* Score ring */}
          <div className="flex flex-col items-center gap-1">
            <div
              className="w-14 h-14 rounded-2xl flex flex-col items-center justify-center font-stat"
              style={{
                background: `${cfg.color}15`,
                border: `2px solid ${cfg.border}`,
                boxShadow: `0 0 16px ${cfg.color}30`,
              }}
            >
              <span className="text-xl font-bold leading-none" style={{ color: cfg.color }}>
                {pick.overallScore}
              </span>
              <span className="text-[8px] font-bold tracking-widest" style={{ color: `${cfg.color}80` }}>
                SCORE
              </span>
            </div>
          </div>
        </div>

        {/* Market + odds row */}
        <div className="flex items-center gap-2 mb-3">
          <div
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold"
            style={{
              background: `${cfg.color}18`,
              border: `1.5px solid ${cfg.border}`,
            }}
          >
            <span className="text-base" style={{ color: cfg.color }}>HRR O {pick.recommendedLine}</span>
            <span className="text-[10px] text-[oklch(0.50_0.015_255)]">·</span>
            <span className="text-sm font-bold" style={{ color: cfg.color }}>{pick.recommendedProb}%</span>
          </div>
          <div className="flex flex-col items-center gap-1 px-3 py-2 rounded-xl" style={{ background: "oklch(0.18 0.025 255)", border: "1px solid oklch(1 0 0 / 8%)" }}>
            {pick.odds ? (
              <>
                <DollarSign size={11} style={{ color: "oklch(0.82 0.17 85)" }} />
                <span className="text-sm font-bold" style={{ color: "oklch(0.82 0.17 85)" }}>{pick.odds}</span>
              </>
            ) : (
              <>
                <TrendingUp size={11} style={{ color: cfg.color }} />
                <span className="text-[10px] font-bold" style={{ color: cfg.color }}>+{pick.edge}%</span>
              </>
            )}
            <span className="text-[8px] text-[oklch(0.38_0.015_255)]">EDGE</span>
          </div>
        </div>

        {/* H/R/RBI breakdown */}
        <div className="flex gap-1.5 mb-3">
          {[
            { label: 'H', value: pick.expectedHits, color: 'oklch(0.82 0.17 85)' },
            { label: 'R', value: pick.expectedRuns, color: 'oklch(0.68 0.22 25)' },
            { label: 'RBI', value: pick.expectedRBI, color: 'oklch(0.72 0.18 165)' },
          ].map(({ label, value, color }) => (
            <div
              key={label}
              className="flex-1 flex flex-col items-center py-2 rounded-xl"
              style={{ background: `${color}10`, border: `1px solid ${color}25` }}
            >
              <span className="text-base font-bold font-stat" style={{ color }}>{value}</span>
              <span className="text-[9px] font-bold tracking-widest" style={{ color: `${color}80` }}>{label}</span>
            </div>
          ))}
          <div
            className="flex-1 flex flex-col items-center py-2 rounded-xl"
            style={{ background: `${cfg.color}12`, border: `1.5px solid ${cfg.border}` }}
          >
            <span className="text-base font-bold font-stat" style={{ color: cfg.color }}>{pick.expectedTotal}</span>
            <span className="text-[9px] font-bold tracking-widest" style={{ color: `${cfg.color}80` }}>PROJ</span>
          </div>
        </div>

        {/* Top 2 reasons */}
        {pick.reasons && pick.reasons.length > 0 && (
          <div className="space-y-1 mb-3">
            {pick.reasons.slice(0, 2).map((reason, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span style={{ color: cfg.color }} className="text-[10px] mt-0.5 shrink-0">✓</span>
                <span className="text-[10px] text-[oklch(0.60_0.015_255)] leading-tight">{reason}</span>
              </div>
            ))}
          </div>
        )}

        {/* Bottom row: streak + risk summary */}
        <div className="flex items-center gap-2">
          {isHot && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-md" style={{ background: "oklch(0.82 0.17 85 / 12%)", border: "1px solid oklch(0.82 0.17 85 / 30%)" }}>
              <Flame size={9} style={{ color: "oklch(0.82 0.17 85)" }} />
              <span className="text-[9px] font-bold" style={{ color: "oklch(0.82 0.17 85)" }}>
                {pick.streakInfo!.streakLength}-game streak
              </span>
            </div>
          )}
          {pick.riskFlags && pick.riskFlags.length > 0 && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-md" style={{ background: "oklch(0.68 0.22 25 / 10%)", border: "1px solid oklch(0.68 0.22 25 / 25%)" }}>
              <Shield size={9} style={{ color: "oklch(0.82 0.17 85)" }} />
              <span className="text-[9px] text-[oklch(0.55_0.015_255)]">{pick.riskFlags.length} risk flag{pick.riskFlags.length > 1 ? 's' : ''}</span>
            </div>
          )}
          <div className="ml-auto flex items-center gap-1">
            <Target size={9} style={{ color: "oklch(0.45 0.015 255)" }} />
            <span className="text-[9px] text-[oklch(0.40_0.015_255)]">#{pick.battingPosition} in lineup</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
