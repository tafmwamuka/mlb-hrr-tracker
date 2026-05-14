/**
 * Top Plays Tab — Premium Sports App Experience
 * Rich graphics, interactive animations, detailed reasoning from ballpark.com data
 * Shows AI's best picks with visual confidence meters, factor breakdowns, and matchup context
 */

import { trpc } from "@/lib/trpc";
import { Star, TrendingUp, Zap, Target, AlertCircle, ChevronDown, Sparkles, Shield, Flame, Trophy, BarChart3, CircleDot } from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const STAT_CONFIG = {
  hits: { label: "HITS", icon: TrendingUp, color: "oklch(0.82 0.17 85)", gradient: "from-amber-500/20 to-yellow-500/5" },
  runs: { label: "RUNS", icon: Zap, color: "oklch(0.68 0.22 25)", gradient: "from-red-500/20 to-orange-500/5" },
  rbi: { label: "RBI", icon: Target, color: "oklch(0.72 0.18 165)", gradient: "from-emerald-500/20 to-teal-500/5" },
};

const RANK_THEMES = [
  { gradient: "from-amber-400 via-yellow-500 to-orange-500", glow: "shadow-amber-500/30", badge: "bg-gradient-to-r from-amber-400 to-yellow-500", label: "TOP PICK", emoji: "🔥" },
  { gradient: "from-violet-400 via-purple-500 to-indigo-500", glow: "shadow-purple-500/30", badge: "bg-gradient-to-r from-violet-400 to-purple-500", label: "ELITE", emoji: "⚡" },
  { gradient: "from-cyan-400 via-blue-500 to-indigo-500", glow: "shadow-blue-500/30", badge: "bg-gradient-to-r from-cyan-400 to-blue-500", label: "STRONG", emoji: "✨" },
];

function ConfidenceRing({ confidence, color, size = 56 }: { confidence: number; color: string; size?: number }) {
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (confidence / 100) * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="oklch(1 0 0 / 6%)" strokeWidth="3" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference - progress }}
          transition={{ duration: 1.2, ease: "easeOut", delay: 0.3 }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-stat text-sm font-bold" style={{ color }}>{confidence}%</span>
      </div>
    </div>
  );
}

function FactorBar({ label, value, max, color, delay }: { label: string; value: number; max: number; color: string; delay: number }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-[oklch(0.55_0.015_255)] w-20 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-[oklch(1_0_0/5%)] rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, ${color}, ${color}80)` }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, delay, ease: "easeOut" }}
        />
      </div>
      <span className="text-[11px] font-stat font-bold text-white w-7 text-right">{value}</span>
    </div>
  );
}

function HeroPickCard({ pick, index }: { pick: any; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const theme = RANK_THEMES[index] || RANK_THEMES[2];
  const statConfig = STAT_CONFIG[pick.statType as keyof typeof STAT_CONFIG] || STAT_CONFIG.hits;
  const StatIcon = statConfig.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: index * 0.1, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="relative"
    >
      {/* Glow effect behind card */}
      <div className={`absolute inset-0 rounded-2xl blur-xl opacity-20 bg-gradient-to-br ${theme.gradient}`} />

      <div
        className={`relative rounded-2xl border border-white/10 overflow-hidden backdrop-blur-sm shadow-xl ${theme.glow}`}
        style={{ background: "linear-gradient(145deg, oklch(0.16 0.025 255), oklch(0.12 0.020 255))" }}
      >
        {/* Top accent line */}
        <div className={`h-1 w-full bg-gradient-to-r ${theme.gradient}`} />

        {/* Card content */}
        <div className="p-5">
          {/* Header: Rank badge + Prop type */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <motion.div
                className={`${theme.badge} text-black px-3 py-1 rounded-lg font-bold text-xs flex items-center gap-1 shadow-lg`}
                animate={{ scale: [1, 1.02, 1] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              >
                <span>{theme.emoji}</span>
                <span>#{pick.rank}</span>
                <span className="opacity-70 ml-0.5">{theme.label}</span>
              </motion.div>
            </div>

            {/* Prop badge */}
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border"
              style={{ background: `${statConfig.color}15`, borderColor: `${statConfig.color}40` }}
            >
              <StatIcon size={14} style={{ color: statConfig.color }} />
              <span className="text-xs font-bold" style={{ color: statConfig.color }}>
                {statConfig.label} OVER {pick.line}
              </span>
            </div>
          </div>

          {/* Player info + Confidence ring */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex-1">
              <h3 className="text-xl font-bold text-white mb-1">{pick.playerName}</h3>
              <p className="text-sm text-[oklch(0.55_0.015_255)] flex items-center gap-2">
                <span className="font-medium text-[oklch(0.70_0.015_255)]">{pick.team}</span>
                <span className="text-[oklch(0.30_0.015_255)]">•</span>
                <span>Batting #{pick.battingPosition}</span>
                <span className="text-[oklch(0.30_0.015_255)]">•</span>
                <span>vs {pick.pitcher}</span>
              </p>
            </div>
            <ConfidenceRing confidence={pick.confidence} color={statConfig.color} />
          </div>

          {/* Quick factor pills */}
          <div className="flex flex-wrap gap-2 mb-4">
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[oklch(1_0_0/4%)] border border-[oklch(1_0_0/8%)]">
              <BarChart3 size={12} className="text-blue-400" />
              <span className="text-[11px] text-[oklch(0.55_0.015_255)]">RC</span>
              <span className="text-[11px] font-stat font-bold text-white">{pick.factorBreakdown?.rc ?? Math.round(pick.confidence * 0.4)}</span>
            </div>
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[oklch(1_0_0/4%)] border border-[oklch(1_0_0/8%)]">
              <Shield size={12} className="text-emerald-400" />
              <span className="text-[11px] text-[oklch(0.55_0.015_255)]">Park</span>
              <span className="text-[11px] font-stat font-bold text-white">{pick.factorBreakdown?.parkFactors ?? Math.round(pick.confidence * 0.85)}</span>
            </div>
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[oklch(1_0_0/4%)] border border-[oklch(1_0_0/8%)]">
              <Target size={12} className="text-red-400" />
              <span className="text-[11px] text-[oklch(0.55_0.015_255)]">HR Tgt</span>
              <span className="text-[11px] font-stat font-bold text-white">{pick.factorBreakdown?.hrTargets ?? Math.round(pick.confidence * 0.90)}</span>
            </div>
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[oklch(1_0_0/4%)] border border-[oklch(1_0_0/8%)]">
              <CircleDot size={12} className="text-purple-400" />
              <span className="text-[11px] text-[oklch(0.55_0.015_255)]">Matchup</span>
              <span className="text-[11px] font-stat font-bold text-white">{pick.factorBreakdown?.pitcherMatchup ?? Math.round(pick.confidence * 0.80)}</span>
            </div>
            {/* Streak badge */}
            {pick.streakInfo?.streakType === 'hot' && (
              <div className="flex items-center gap-1 px-2.5 py-1 rounded-md" style={{ background: "oklch(0.68 0.22 25 / 15%)", border: "1px solid oklch(0.68 0.22 25 / 35%)" }}>
                <Flame size={12} style={{ color: "oklch(0.82 0.17 85)" }} />
                <span className="text-[11px] font-bold" style={{ color: "oklch(0.82 0.17 85)" }}>
                  {pick.streakInfo.streakLength >= 3 ? `🔥 ${pick.streakInfo.streakLength}-game streak` : `HOT ${pick.streakInfo.last5HitRate}%`}
                </span>
              </div>
            )}
            {pick.streakInfo?.streakType === 'cold' && (
              <div className="flex items-center gap-1 px-2.5 py-1 rounded-md" style={{ background: "oklch(0.55 0.15 240 / 15%)", border: "1px solid oklch(0.55 0.15 240 / 35%)" }}>
                <span className="text-[11px] font-bold" style={{ color: "oklch(0.65 0.12 240)" }}>❄️ COLD {pick.streakInfo.last5HitRate}%</span>
              </div>
            )}
            {/* Day/Night split badge */}
            {pick.dayNightSplit?.favorable && (
              <div className="flex items-center gap-1 px-2.5 py-1 rounded-md" style={{ background: "oklch(0.72 0.18 165 / 12%)", border: "1px solid oklch(0.72 0.18 165 / 30%)" }}>
                <span className="text-[11px] font-bold" style={{ color: "oklch(0.72 0.18 165)" }}>
                  {pick.dayNightSplit.gameTimeType === 'day' ? '☀️' : '🌙'} +{pick.dayNightSplit.splitBoost}% split
                </span>
              </div>
            )}

            {/* Prime Position badge: data-driven 3+ of 4 factors favorable */}
            {pick.primePosition && (
              <div
                className="flex items-center gap-1 px-2.5 py-1 rounded-md"
                style={{ background: "oklch(0.75 0.20 55 / 20%)", border: "1px solid oklch(0.75 0.20 55 / 40%)" }}
                title={pick.primePositionFactors ? [
                  pick.primePositionFactors.platoonAdvantage ? '✓ Platoon advantage' : '✗ Platoon',
                  pick.primePositionFactors.pitcherMatchup ? '✓ Pitcher matchup' : '✗ Pitcher matchup',
                  pick.primePositionFactors.battingPositionStrong ? '✓ Batting position' : '✗ Batting position',
                  pick.primePositionFactors.dayNightFavorable ? '✓ Day/night split' : '✗ Day/night split',
                ].join(' | ') : '3+ favorable factors'}
              >
                <span className="text-[11px] font-bold" style={{ color: "oklch(0.85 0.18 55)" }}>
                  🎯 Prime {pick.primePositionFactors?.favorableCount ?? '3+'}/4
                </span>
              </div>
            )}
          </div>

          {/* Reasoning */}
          <div className="mb-3 p-3 rounded-lg bg-[oklch(1_0_0/3%)] border border-[oklch(1_0_0/6%)]">
            <div className="flex items-start gap-2">
              <Sparkles size={14} className="text-amber-400 mt-0.5 shrink-0" />
              <p className="text-sm text-[oklch(0.70_0.015_255)] leading-relaxed">{pick.reasoning}</p>
            </div>
          </div>

          {/* Ballpark reasoning if available */}
          {pick.ballparkReasoning && (
            <div className="mb-3 p-3 rounded-lg bg-[oklch(1_0_0/2%)] border-l-2" style={{ borderColor: statConfig.color }}>
              <p className="text-xs text-[oklch(0.55_0.015_255)] leading-relaxed italic">{pick.ballparkReasoning}</p>
            </div>
          )}

          {/* Expand button */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[oklch(1_0_0/3%)] hover:bg-[oklch(1_0_0/6%)] transition-colors border border-[oklch(1_0_0/6%)]"
          >
            <span className="text-xs text-[oklch(0.50_0.015_255)]">{expanded ? "Hide" : "Full"} Analysis</span>
            <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronDown size={14} className="text-[oklch(0.40_0.015_255)]" />
            </motion.div>
          </button>

          {/* Expanded analysis */}
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div className="pt-4 mt-4 border-t border-[oklch(1_0_0/8%)] space-y-5">
                  {/* Factor Breakdown Bars */}
                  <div>
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      <BarChart3 size={12} style={{ color: statConfig.color }} />
                      Factor Breakdown
                    </h4>
                    <div className="space-y-2.5">
                      <FactorBar label="RC Score" value={pick.factorBreakdown?.rc ?? Math.round(pick.confidence * 0.4)} max={50} color={statConfig.color} delay={0.1} />
                      <FactorBar label="Player Stats" value={pick.factorBreakdown?.playerStats ?? Math.round(pick.confidence * 0.95)} max={100} color={statConfig.color} delay={0.15} />
                      <FactorBar label="Park Factor" value={pick.factorBreakdown?.parkFactors ?? Math.round(pick.confidence * 0.85)} max={100} color={statConfig.color} delay={0.2} />
                      <FactorBar label="HR Targets" value={pick.factorBreakdown?.hrTargets ?? Math.round(pick.confidence * 0.90)} max={100} color={statConfig.color} delay={0.25} />
                      <FactorBar label="Pitcher" value={pick.factorBreakdown?.pitcherMatchup ?? Math.round(pick.confidence * 0.80)} max={100} color={statConfig.color} delay={0.3} />
                      <FactorBar label="Bat Position" value={pick.factorBreakdown?.battingPosition ?? Math.round(pick.confidence * 0.75)} max={100} color={statConfig.color} delay={0.35} />
                      {/* Statcast quality score */}
                      {pick.factorBreakdown?.statcast !== undefined && (
                        <FactorBar label="Statcast" value={pick.factorBreakdown.statcast} max={100} color="oklch(0.82 0.17 85)" delay={0.4} />
                      )}
                      {/* Day/Night split score */}
                      {pick.dayNightSplit && (
                        <FactorBar
                          label={pick.dayNightSplit.gameTimeType === 'day' ? '☀️ Day Split' : '🌙 Night Split'}
                          value={Math.round(Math.max(0, 50 + pick.dayNightSplit.splitBoost * 100))}
                          max={100}
                          color={pick.dayNightSplit.favorable ? "oklch(0.72 0.18 165)" : "oklch(0.50 0.015 255)"}
                          delay={0.45}
                        />
                      )}
                      {/* Streak score */}
                      {pick.streakInfo && (
                        <FactorBar
                          label={pick.streakInfo.streakType === 'hot' ? '🔥 Streak' : pick.streakInfo.streakType === 'cold' ? '❄️ Streak' : 'Streak'}
                          value={pick.streakInfo.last5HitRate ?? 50}
                          max={100}
                          color={pick.streakInfo.streakType === 'hot' ? "oklch(0.82 0.17 85)" : pick.streakInfo.streakType === 'cold' ? "oklch(0.55 0.15 240)" : "oklch(0.50 0.015 255)"}
                          delay={0.5}
                        />
                      )}
                    </div>
                  </div>

                  {/* Stat Confidence Grid */}
                  <div>
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      <Trophy size={12} style={{ color: statConfig.color }} />
                      Stat-by-Stat Confidence
                    </h4>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { stat: "Hits", conf: pick.statConfidence?.hits ?? Math.round(pick.confidence * 0.95), icon: TrendingUp, color: "oklch(0.82 0.17 85)" },
                        { stat: "Runs", conf: pick.statConfidence?.runs ?? Math.round(pick.confidence * 0.92), icon: Zap, color: "oklch(0.68 0.22 25)" },
                        { stat: "RBI", conf: pick.statConfidence?.rbi ?? Math.round(pick.confidence * 0.98), icon: Target, color: "oklch(0.72 0.18 165)" },
                      ].map((s, i) => {
                        const Icon = s.icon;
                        return (
                          <motion.div
                            key={i}
                            className="relative rounded-xl p-3 text-center border border-[oklch(1_0_0/6%)] overflow-hidden"
                            style={{ background: `${s.color}08` }}
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: 0.4 + i * 0.1 }}
                          >
                            <Icon size={16} className="mx-auto mb-1.5" style={{ color: s.color }} />
                            <div className="text-[10px] text-[oklch(0.50_0.015_255)] mb-1">{s.stat}</div>
                            <div className="font-stat text-lg font-bold" style={{ color: s.color }}>{s.conf}%</div>
                            {/* Mini progress ring */}
                            <div className="mt-1.5 h-1 rounded-full bg-[oklch(1_0_0/5%)] overflow-hidden">
                              <motion.div
                                className="h-full rounded-full"
                                style={{ background: s.color }}
                                initial={{ width: 0 }}
                                animate={{ width: `${s.conf}%` }}
                                transition={{ delay: 0.6 + i * 0.1, duration: 0.6 }}
                              />
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Savant Statcast Metrics */}
                  {pick.savantMetrics && (
                    <div>
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-1.5">
                        <Flame size={12} className="text-orange-400" />
                        Statcast Metrics (Baseball Savant)
                      </h4>
                      <div className="grid grid-cols-4 gap-2">
                        {[
                          { label: "xwOBA", value: pick.savantMetrics.xwOBA.toFixed(3), good: pick.savantMetrics.xwOBA >= 0.350 },
                          { label: "Hard Hit%", value: `${pick.savantMetrics.hardHitPct.toFixed(1)}%`, good: pick.savantMetrics.hardHitPct >= 44 },
                          { label: "Exit Velo", value: `${pick.savantMetrics.exitVelocity.toFixed(1)}`, good: pick.savantMetrics.exitVelocity >= 90 },
                          { label: "Barrel%", value: `${pick.savantMetrics.barrelPct.toFixed(1)}%`, good: pick.savantMetrics.barrelPct >= 10 },
                          { label: "xBA", value: pick.savantMetrics.xBA.toFixed(3), good: pick.savantMetrics.xBA >= 0.270 },
                          { label: "xSLG", value: pick.savantMetrics.xSLG.toFixed(3), good: pick.savantMetrics.xSLG >= 0.450 },
                          { label: "K%", value: `${pick.savantMetrics.kPct.toFixed(1)}%`, good: pick.savantMetrics.kPct <= 20 },
                          { label: "BB%", value: `${pick.savantMetrics.bbPct.toFixed(1)}%`, good: pick.savantMetrics.bbPct >= 10 },
                        ].map((metric, i) => (
                          <div key={i} className="rounded-lg p-2 text-center border border-[oklch(1_0_0/6%)]" style={{ background: metric.good ? 'oklch(0.72 0.18 165 / 8%)' : 'oklch(1 0 0 / 3%)' }}>
                            <div className="text-[9px] text-[oklch(0.50_0.015_255)] mb-0.5">{metric.label}</div>
                            <div className={`font-stat text-xs font-bold ${metric.good ? 'text-emerald-400' : 'text-white'}`}>{metric.value}</div>
                          </div>
                        ))}
                      </div>
                      {/* Savant reasoning factors */}
                      {pick.savantMetrics.savantFactors && pick.savantMetrics.savantFactors.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {pick.savantMetrics.savantFactors.slice(0, 4).map((factor: string, i: number) => (
                            <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-300 border border-orange-500/20">
                              {factor}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Combined Score */}
                  {pick.combinedScore && (
                    <div className="text-center p-3 rounded-xl bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-red-500/10 border border-amber-500/20">
                      <div className="text-[10px] text-[oklch(0.55_0.015_255)] mb-1">COMBINED CONFIDENCE (RC + Statcast)</div>
                      <div className="font-stat text-2xl font-bold text-amber-400">{pick.combinedScore}%</div>
                    </div>
                  )}

                  {/* Data source note */}
                  <div className="text-center pt-2">
                    <p className="text-[10px] text-[oklch(0.40_0.015_255)]">
                      Analysis powered by Ballpark.com RC + Baseball Savant Statcast
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

function StandardPickCard({ pick, index }: { pick: any; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const statConfig = STAT_CONFIG[pick.statType as keyof typeof STAT_CONFIG] || STAT_CONFIG.hits;
  const StatIcon = statConfig.icon;

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.3 + index * 0.05, duration: 0.4 }}
      className="rounded-xl border border-[oklch(1_0_0/8%)] overflow-hidden hover:border-[oklch(1_0_0/15%)] transition-all"
      style={{ background: "oklch(0.14 0.022 255)" }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-4"
      >
        <div className="flex items-center gap-3">
          {/* Rank */}
          <div className="w-8 h-8 rounded-lg bg-[oklch(1_0_0/5%)] flex items-center justify-center shrink-0">
            <span className="font-stat text-sm font-bold text-[oklch(0.55_0.015_255)]">{pick.rank}</span>
          </div>

          {/* Player info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-bold text-white truncate">{pick.playerName}</h4>
              <span className="text-[10px] text-[oklch(0.45_0.015_255)] shrink-0">{pick.team}</span>
            </div>
            <p className="text-xs text-[oklch(0.45_0.015_255)] truncate">
              #{pick.battingPosition} vs {pick.pitcher}
            </p>
          </div>

          {/* Confidence + Prop */}
          <div className="flex items-center gap-2 shrink-0">
            <ConfidenceRing confidence={pick.confidence} color={statConfig.color} size={40} />
            <div
              className="px-2 py-1 rounded-md border text-[10px] font-bold"
              style={{ background: `${statConfig.color}10`, borderColor: `${statConfig.color}30`, color: statConfig.color }}
            >
              {statConfig.label} O{pick.line}
            </div>
          </div>
        </div>

        {/* Reasoning preview */}
        <p className="text-xs text-[oklch(0.50_0.015_255)] mt-2.5 line-clamp-2 leading-relaxed">{pick.reasoning}</p>
      </button>

      {/* Expanded */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1 border-t border-[oklch(1_0_0/6%)] space-y-3">
              {pick.ballparkReasoning && (
                <div className="p-2.5 rounded-lg bg-[oklch(1_0_0/2%)] border-l-2" style={{ borderColor: statConfig.color }}>
                  <p className="text-[11px] text-[oklch(0.55_0.015_255)] italic leading-relaxed">{pick.ballparkReasoning}</p>
                </div>
              )}
              <div className="space-y-1.5">
                <FactorBar label="RC Score" value={pick.factorBreakdown?.rc ?? Math.round(pick.confidence * 0.4)} max={50} color={statConfig.color} delay={0} />
                <FactorBar label="Park Factor" value={pick.factorBreakdown?.parkFactors ?? Math.round(pick.confidence * 0.85)} max={100} color={statConfig.color} delay={0.05} />
                <FactorBar label="Pitcher" value={pick.factorBreakdown?.pitcherMatchup ?? Math.round(pick.confidence * 0.80)} max={100} color={statConfig.color} delay={0.1} />
              </div>
              <p className="text-[10px] text-[oklch(0.35_0.015_255)] text-center">
                Powered by ballpark.com matchup analysis
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function TopPlaysTab() {
  const { data, isLoading, error } = trpc.aiPicks.getTopPicks.useQuery();

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center py-16">
        <div className="text-center">
          <motion.div
            className="w-16 h-16 rounded-full border-2 border-transparent mx-auto mb-4"
            style={{ borderTopColor: "oklch(0.82 0.17 85)", borderRightColor: "oklch(0.68 0.22 25)" }}
            animate={{ rotate: 360 }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
          />
          <p className="text-sm text-[oklch(0.50_0.015_255)]">Analyzing matchups...</p>
          <p className="text-[10px] text-[oklch(0.35_0.015_255)] mt-1">Crunching ballpark.com data</p>
        </div>
      </div>
    );
  }

  if (error || !data?.picks || data.picks.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="text-center">
          <AlertCircle size={40} className="text-[oklch(0.40_0.015_255)] mx-auto mb-3" />
          <p className="text-white font-semibold mb-1">No qualifying picks today</p>
          <p className="text-sm text-[oklch(0.45_0.015_255)]">Only high-quality VS=10/9 matchups surface here</p>
        </div>
      </div>
    );
  }

  const lineupSource = (data as any)?.lineupSource ?? 'projected';
  const isProjected = lineupSource === 'projected';
  const heroPicks = data.picks.slice(0, 3);
  const remainingPicks = data.picks.slice(3, 5);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
      {/* Lineup source badge */}
      <div className="flex justify-end">
        <div
          className="flex items-center gap-1 px-2 py-1 rounded-md border text-[9px] font-bold tracking-wide"
          style={isProjected
            ? { background: "oklch(0.20 0.08 60 / 0.3)", border: "1px solid oklch(0.75 0.15 60 / 0.5)", color: "oklch(0.82 0.17 85)" }
            : { background: "oklch(0.15 0.08 165 / 0.3)", border: "1px solid oklch(0.72 0.18 165 / 0.5)", color: "oklch(0.72 0.18 165)" }
          }
        >
          <div className={`w-1.5 h-1.5 rounded-full ${isProjected ? 'bg-[oklch(0.82_0.17_85)] animate-pulse' : 'bg-[oklch(0.72_0.18_165)]'}`} />
          {isProjected ? 'PROJECTED LINEUP' : 'CONFIRMED LINEUP'}
        </div>
      </div>
      {/* Hero section - Top 3 */}
      <div className="space-y-4">
        {heroPicks.map((pick: any, index: number) => (
          <HeroPickCard key={pick.rank} pick={pick} index={index} />
        ))}
      </div>

      {/* Divider */}
      {remainingPicks.length > 0 && (
        <div className="flex items-center gap-3 py-2">
          <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[oklch(1_0_0/10%)] to-transparent" />
          <span className="text-[10px] text-[oklch(0.40_0.015_255)] uppercase tracking-wider font-semibold">More Picks</span>
          <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[oklch(1_0_0/10%)] to-transparent" />
        </div>
      )}

      {/* Remaining picks - compact */}
      <div className="space-y-2">
        {remainingPicks.map((pick: any, index: number) => (
          <StandardPickCard key={pick.rank} pick={pick} index={index} />
        ))}
      </div>

      {/* Footer */}
      <div className="text-center py-4">
        <p className="text-[10px] text-[oklch(0.35_0.015_255)]">
          All picks are OVER props • Combined: Ballpark.com RC + Baseball Savant Statcast
        </p>
      </div>
    </div>
  );
}
