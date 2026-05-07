/**
 * Parlays Tab — Smart Parlay Suggestions (Savant + Ballpark Combined)
 * Uses combined Savant Statcast + Ballpark.com RC data for the safest selections
 * Shows 2-leg (safe) and 3-leg parlay options with detailed reasoning
 */

import { trpc } from "@/lib/trpc";
import {
  Shield, AlertTriangle, TrendingUp, Zap, Target, Lock, Layers,
  ChevronDown, Info, BarChart3, Activity, Crosshair, Gauge, Flame
} from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SaferPlayTip } from "@/components/SaferPlayTip";

const STAT_CONFIG = {
  hits: { label: "HITS", icon: TrendingUp, color: "oklch(0.82 0.17 85)" },
  runs: { label: "RUNS", icon: Zap, color: "oklch(0.68 0.22 25)" },
  rbi: { label: "RBI", icon: Target, color: "oklch(0.72 0.18 165)" },
  hrr: { label: "HRR", icon: Flame, color: "oklch(0.75 0.15 280)" },
};

interface SavantMetrics {
  xwOBA: number;
  hardHitPct: number;
  exitVelocity: number;
  barrelPct: number;
  kPct: number;
  bbPct: number;
  xBA: number;
  xSLG: number;
  sprintSpeed: number;
  savantScore: number;
  savantFactors: string[];
}

interface ParlayLeg {
  playerName: string;
  team: string;
  statType: string;
  line: number;
  confidence: number;
  combinedScore: number;
  reasoning: string;
  ballparkReasoning: string;
  savantMetrics?: SavantMetrics;
}

interface Parlay {
  id: string;
  type: "2-leg" | "3-leg";
  legs: ParlayLeg[];
  combinedConfidence: number;
  avgCombinedScore: number;
  riskLevel: "low" | "medium";
  reasoning: string;
}

/**
 * Check if two players are in the same game.
 * Same game = player A's team is player B's pitcherTeam or vice versa.
 */
function isSameGame(a: any, b: any): boolean {
  // If pitcherTeam is available, use it for precise game identification
  if (a.pitcherTeam && b.pitcherTeam) {
    return (a.team === b.pitcherTeam || b.team === a.pitcherTeam);
  }
  // Fallback: same team = same game
  return a.team === b.team;
}

// Minimum combined score threshold for parlay inclusion
const MIN_2LEG_SCORE = 75;
const MIN_3LEG_SCORE = 70;

function buildParlays(picks: any[]): Parlay[] {
  if (!picks || picks.length < 4) return [];

  const parlays: Parlay[] = [];

  // Sort by combinedScore (Savant + Ballpark) for best combinations
  // Stat priority tiebreaker: Hits > Runs > RBI (RBI is riskiest)
  const STAT_PRIORITY: Record<string, number> = { hits: 3, runs: 2, rbi: 1, slg: 0 };
  const sorted = [...picks]
    .sort((a, b) => {
      const scoreDiff = (b.combinedScore || b.confidence) - (a.combinedScore || a.confidence);
      if (Math.abs(scoreDiff) < 3) {
        return (STAT_PRIORITY[b.statType] || 0) - (STAT_PRIORITY[a.statType] || 0);
      }
      return scoreDiff;
    });

  // Filter to only high-confidence picks for parlays
  const eligible2Leg = sorted.filter(p => (p.combinedScore || p.confidence) >= MIN_2LEG_SCORE);
  const eligible3Leg = sorted.filter(p => (p.combinedScore || p.confidence) >= MIN_3LEG_SCORE);

  // Generate 2-leg parlays (safe plays) — pair highest combined-score picks from DIFFERENT GAMES
  const usedFor2Leg = new Set<number>();
  for (let i = 0; i < eligible2Leg.length && parlays.length < 4; i++) {
    for (let j = i + 1; j < eligible2Leg.length && parlays.length < 4; j++) {
      // Enforce different games (not just different teams)
      if (isSameGame(eligible2Leg[i], eligible2Leg[j])) continue;
      if (usedFor2Leg.has(i) || usedFor2Leg.has(j)) continue;

      const avgScore = Math.round(((eligible2Leg[i].combinedScore || eligible2Leg[i].confidence) + (eligible2Leg[j].combinedScore || eligible2Leg[j].confidence)) / 2);
      const combined = Math.round(avgScore * 0.92);

      const savantFactors1 = eligible2Leg[i].savantMetrics?.savantFactors || [];
      const savantFactors2 = eligible2Leg[j].savantMetrics?.savantFactors || [];

      parlays.push({
        id: `2leg-${i}-${j}`,
        type: "2-leg",
        legs: [
          {
            playerName: eligible2Leg[i].playerName,
            team: eligible2Leg[i].team,
            statType: eligible2Leg[i].statType,
            line: eligible2Leg[i].line,
            confidence: eligible2Leg[i].confidence,
            combinedScore: eligible2Leg[i].combinedScore || eligible2Leg[i].confidence,
            reasoning: eligible2Leg[i].reasoning,
            ballparkReasoning: eligible2Leg[i].ballparkReasoning || "",
            savantMetrics: eligible2Leg[i].savantMetrics,
          },
          {
            playerName: eligible2Leg[j].playerName,
            team: eligible2Leg[j].team,
            statType: eligible2Leg[j].statType,
            line: eligible2Leg[j].line,
            confidence: eligible2Leg[j].confidence,
            combinedScore: eligible2Leg[j].combinedScore || eligible2Leg[j].confidence,
            reasoning: eligible2Leg[j].reasoning,
            ballparkReasoning: eligible2Leg[j].ballparkReasoning || "",
            savantMetrics: eligible2Leg[j].savantMetrics,
          },
        ],
        combinedConfidence: combined,
        avgCombinedScore: avgScore,
        riskLevel: "low",
        reasoning: `Both legs backed by elite Savant Statcast data + Ballpark.com RC analysis. ${savantFactors1[0] || "Strong matchup"} (${eligible2Leg[i].playerName}) paired with ${savantFactors2[0] || "favorable conditions"} (${eligible2Leg[j].playerName}). Different games reduce correlation risk.`,
      });
      usedFor2Leg.add(i);
      usedFor2Leg.add(j);
    }
  }

  // Generate 3-leg parlays (moderate risk) — diversified across DIFFERENT GAMES
  const usedFor3Leg = new Set<number>();
  for (let i = 0; i < eligible3Leg.length - 2 && parlays.length < 7; i++) {
    for (let j = i + 1; j < eligible3Leg.length - 1; j++) {
      for (let k = j + 1; k < eligible3Leg.length; k++) {
        if (parlays.length >= 7) break;
        // Enforce ALL legs from different games
        if (isSameGame(eligible3Leg[i], eligible3Leg[j])) continue;
        if (isSameGame(eligible3Leg[j], eligible3Leg[k])) continue;
        if (isSameGame(eligible3Leg[i], eligible3Leg[k])) continue;
        if (usedFor3Leg.has(i) || usedFor3Leg.has(j) || usedFor3Leg.has(k)) continue;

        const avgScore = Math.round(((eligible3Leg[i].combinedScore || eligible3Leg[i].confidence) + (eligible3Leg[j].combinedScore || eligible3Leg[j].confidence) + (eligible3Leg[k].combinedScore || eligible3Leg[k].confidence)) / 3);
        const combined = Math.round(avgScore * 0.85);

        parlays.push({
          id: `3leg-${i}-${j}-${k}`,
          type: "3-leg",
          legs: [
            {
              playerName: eligible3Leg[i].playerName,
              team: eligible3Leg[i].team,
              statType: eligible3Leg[i].statType,
              line: eligible3Leg[i].line,
              confidence: eligible3Leg[i].confidence,
              combinedScore: eligible3Leg[i].combinedScore || eligible3Leg[i].confidence,
              reasoning: eligible3Leg[i].reasoning,
              ballparkReasoning: eligible3Leg[i].ballparkReasoning || "",
              savantMetrics: eligible3Leg[i].savantMetrics,
            },
            {
              playerName: eligible3Leg[j].playerName,
              team: eligible3Leg[j].team,
              statType: eligible3Leg[j].statType,
              line: eligible3Leg[j].line,
              confidence: eligible3Leg[j].confidence,
              combinedScore: eligible3Leg[j].combinedScore || eligible3Leg[j].confidence,
              reasoning: eligible3Leg[j].reasoning,
              ballparkReasoning: eligible3Leg[j].ballparkReasoning || "",
              savantMetrics: eligible3Leg[j].savantMetrics,
            },
            {
              playerName: eligible3Leg[k].playerName,
              team: eligible3Leg[k].team,
              statType: eligible3Leg[k].statType,
              line: eligible3Leg[k].line,
              confidence: eligible3Leg[k].confidence,
              combinedScore: eligible3Leg[k].combinedScore || eligible3Leg[k].confidence,
              reasoning: eligible3Leg[k].reasoning,
              ballparkReasoning: eligible3Leg[k].ballparkReasoning || "",
              savantMetrics: eligible3Leg[k].savantMetrics,
            },
          ],
          combinedConfidence: combined,
          avgCombinedScore: avgScore,
          riskLevel: "medium",
          reasoning: `Diversified across ${eligible3Leg[i].team}, ${eligible3Leg[j].team}, and ${eligible3Leg[k].team}. All legs scored ${MIN_3LEG_SCORE}+ combined (Savant + Ballpark). Different games eliminate correlation risk.`,
        });
        usedFor3Leg.add(i);
        usedFor3Leg.add(j);
        usedFor3Leg.add(k);
        break;
      }
      if (parlays.length >= 7) break;
    }
  }

  return parlays;
}

// ─── Savant Metric Pill ───────────────────────────────────────────────────────
function MetricPill({ icon: Icon, label, value, color }: { icon: any; label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-[oklch(1_0_0/4%)] border border-[oklch(1_0_0/8%)]">
      <Icon size={10} style={{ color }} />
      <span className="text-[9px] text-[oklch(0.45_0.015_255)] uppercase">{label}</span>
      <span className="text-[10px] font-bold" style={{ color }}>{value}</span>
    </div>
  );
}

// ─── Parlay Card ──────────────────────────────────────────────────────────────
function ParlayCard({ parlay, index }: { parlay: Parlay; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const is2Leg = parlay.type === "2-leg";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.4 }}
      className="relative rounded-xl overflow-hidden border"
      style={{
        background: is2Leg
          ? "linear-gradient(145deg, oklch(0.14 0.03 165 / 40%), oklch(0.12 0.020 255))"
          : "linear-gradient(145deg, oklch(0.14 0.03 280 / 40%), oklch(0.12 0.020 255))",
        borderColor: is2Leg ? "oklch(0.72 0.18 165 / 30%)" : "oklch(0.65 0.15 280 / 30%)",
      }}
    >
      {/* Top accent */}
      <div
        className="h-0.5 w-full"
        style={{
          background: is2Leg
            ? "linear-gradient(90deg, oklch(0.72 0.18 165), oklch(0.82 0.17 85), oklch(0.72 0.18 165 / 30%))"
            : "linear-gradient(90deg, oklch(0.65 0.15 280), oklch(0.68 0.22 25), oklch(0.65 0.15 280 / 30%))",
        }}
      />

      <button onClick={() => setExpanded(!expanded)} className="w-full text-left p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div
              className="px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1"
              style={{
                background: is2Leg ? "oklch(0.72 0.18 165 / 20%)" : "oklch(0.65 0.15 280 / 20%)",
                color: is2Leg ? "oklch(0.72 0.18 165)" : "oklch(0.75 0.15 280)",
              }}
            >
              <Layers size={12} />
              {parlay.type === "2-leg" ? "2-LEG SAFE" : "3-LEG"}
            </div>
            {is2Leg && (
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20">
                <Shield size={10} className="text-emerald-400" />
                <span className="text-[10px] text-emerald-400 font-semibold">LOW RISK</span>
              </div>
            )}
            {!is2Leg && (
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-500/10 border border-purple-500/20">
                <AlertTriangle size={10} className="text-purple-400" />
                <span className="text-[10px] text-purple-400 font-semibold">MODERATE</span>
              </div>
            )}
          </div>

          {/* Combined scores */}
          <div className="text-right">
            <div className="font-stat text-lg font-bold" style={{ color: is2Leg ? "oklch(0.72 0.18 165)" : "oklch(0.75 0.15 280)" }}>
              {parlay.combinedConfidence}%
            </div>
            <div className="text-[9px] text-[oklch(0.45_0.015_255)] uppercase">
              Score: {parlay.avgCombinedScore}
            </div>
          </div>
        </div>

        {/* Legs preview */}
        <div className="space-y-2">
          {parlay.legs.map((leg, i) => {
            const statCfg = STAT_CONFIG[leg.statType as keyof typeof STAT_CONFIG] || STAT_CONFIG.hits;
            const StatIcon = statCfg.icon;
            return (
              <div key={i} className="flex items-center gap-2 p-2.5 rounded-lg bg-[oklch(1_0_0/3%)] border border-[oklch(1_0_0/5%)]">
                <div className="w-5 h-5 rounded-full bg-[oklch(1_0_0/6%)] flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-bold text-[oklch(0.55_0.015_255)]">{i + 1}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-white truncate">{leg.playerName}</span>
                    <span className="text-[10px] text-[oklch(0.45_0.015_255)]">{leg.team}</span>
                  </div>
                  {/* Mini Savant indicators */}
                  {leg.savantMetrics && (
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 font-medium">
                        xwOBA {leg.savantMetrics.xwOBA.toFixed(3)}
                      </span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 font-medium">
                        HH {leg.savantMetrics.hardHitPct.toFixed(0)}%
                      </span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium">
                        EV {leg.savantMetrics.exitVelocity.toFixed(0)}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-md" style={{ background: `${statCfg.color}15` }}>
                    <StatIcon size={10} style={{ color: statCfg.color }} />
                    <span className="text-[10px] font-bold" style={{ color: statCfg.color }}>
                      {statCfg.label} O{leg.line}
                    </span>
                  </div>
                  <span className="text-[9px] font-stat font-bold text-[oklch(0.55_0.015_255)]">
                    CS: {leg.combinedScore}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Expand indicator */}
        <div className="flex items-center justify-center mt-3 pt-2 border-t border-[oklch(1_0_0/6%)]">
          <span className="text-[10px] text-[oklch(0.40_0.015_255)] mr-1">
            {expanded ? "Hide" : "View"} Savant Analysis
          </span>
          <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown size={14} className="text-[oklch(0.40_0.015_255)]" />
          </motion.div>
        </div>
      </button>

      {/* Expanded Savant Analysis */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3">
              {/* Parlay reasoning */}
              <div className="p-3 rounded-lg bg-[oklch(1_0_0/3%)] border border-[oklch(1_0_0/6%)]">
                <div className="flex items-start gap-2">
                  <BarChart3 size={12} className="text-blue-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-[oklch(0.60_0.015_255)] leading-relaxed">{parlay.reasoning}</p>
                </div>
              </div>

              {/* Per-leg Savant breakdown */}
              {parlay.legs.map((leg, i) => (
                <div key={i} className="rounded-lg border border-[oklch(1_0_0/8%)] bg-[oklch(1_0_0/2%)] p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold text-white">{leg.playerName}</span>
                    <span className="text-[9px] text-[oklch(0.45_0.015_255)]">({leg.team})</span>
                  </div>

                  {/* Savant metrics grid */}
                  {leg.savantMetrics && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      <MetricPill icon={Crosshair} label="xwOBA" value={leg.savantMetrics.xwOBA.toFixed(3)} color="#60a5fa" />
                      <MetricPill icon={Activity} label="HH%" value={`${leg.savantMetrics.hardHitPct.toFixed(0)}%`} color="#f97316" />
                      <MetricPill icon={Gauge} label="EV" value={`${leg.savantMetrics.exitVelocity.toFixed(0)}`} color="#34d399" />
                      <MetricPill icon={Target} label="Brl%" value={`${leg.savantMetrics.barrelPct.toFixed(1)}%`} color="#a78bfa" />
                      <MetricPill icon={TrendingUp} label="xBA" value={leg.savantMetrics.xBA.toFixed(3)} color="#fbbf24" />
                      <MetricPill icon={Zap} label="xSLG" value={leg.savantMetrics.xSLG.toFixed(3)} color="#f472b6" />
                    </div>
                  )}

                  {/* Savant factors */}
                  {leg.savantMetrics?.savantFactors && leg.savantMetrics.savantFactors.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {leg.savantMetrics.savantFactors.slice(0, 3).map((factor, fi) => (
                        <span key={fi} className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-300 border border-violet-500/20">
                          {factor}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Reasoning */}
                  <p className="text-[11px] text-[oklch(0.50_0.015_255)] leading-relaxed">
                    {leg.reasoning}
                  </p>
                  {leg.ballparkReasoning && (
                    <p className="text-[10px] text-[oklch(0.40_0.015_255)] italic mt-1">
                      {leg.ballparkReasoning}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * Build HRR-only parlays — all legs are HRR combined props
 */
function buildHRRParlays(hrrLegs: any[]): Parlay[] {
  if (!hrrLegs || hrrLegs.length < 2) return [];
  const parlays: Parlay[] = [];

  // Sort by confidence
  const sorted = [...hrrLegs].sort((a, b) => b.confidence - a.confidence);

  // Build 2-leg HRR parlays from different games
  const used2 = new Set<number>();
  for (let i = 0; i < sorted.length && parlays.length < 3; i++) {
    for (let j = i + 1; j < sorted.length && parlays.length < 3; j++) {
      if (used2.has(i) || used2.has(j)) continue;
      if (isSameGame(sorted[i], sorted[j])) continue;
      const avgConf = Math.round((sorted[i].confidence + sorted[j].confidence) / 2);
      parlays.push({
        id: `hrr-2leg-${i}-${j}`,
        type: "2-leg",
        legs: [sorted[i], sorted[j]],
        combinedConfidence: Math.round(avgConf * 0.92),
        avgCombinedScore: avgConf,
        riskLevel: "low",
        reasoning: `Both legs are HRR combined props (Hits+Runs+RBI) — the safest prop type. ${sorted[i].playerName} and ${sorted[j].playerName} from different games.`,
      });
      used2.add(i);
      used2.add(j);
    }
  }

  // Build 3-leg HRR parlays
  const used3 = new Set<number>();
  for (let i = 0; i < sorted.length - 2 && parlays.length < 5; i++) {
    for (let j = i + 1; j < sorted.length - 1; j++) {
      for (let k = j + 1; k < sorted.length; k++) {
        if (parlays.length >= 5) break;
        if (used3.has(i) || used3.has(j) || used3.has(k)) continue;
        if (isSameGame(sorted[i], sorted[j]) || isSameGame(sorted[j], sorted[k]) || isSameGame(sorted[i], sorted[k])) continue;
        const avgConf = Math.round((sorted[i].confidence + sorted[j].confidence + sorted[k].confidence) / 3);
        parlays.push({
          id: `hrr-3leg-${i}-${j}-${k}`,
          type: "3-leg",
          legs: [sorted[i], sorted[j], sorted[k]],
          combinedConfidence: Math.round(avgConf * 0.85),
          avgCombinedScore: avgConf,
          riskLevel: "medium",
          reasoning: `All HRR combined props across 3 different games. Lower risk per leg since HRR combines all offensive production.`,
        });
        used3.add(i);
        used3.add(j);
        used3.add(k);
        break;
      }
      if (parlays.length >= 5) break;
    }
  }

  return parlays;
}

export function ParlaysTab() {
  const { data, isLoading } = trpc.aiPicks.getComprehensivePicks.useQuery();
  const { data: hrrData } = trpc.aiPicks.getHRRPicks.useQuery();
  const [activeFilter, setActiveFilter] = useState<"all" | "2-leg" | "3-leg" | "hrr">("all");

  // Convert HRR picks into parlay-compatible format
  const hrrLegs = (hrrData?.picks || []).map((pick: any) => ({
    playerName: pick.playerName,
    team: pick.team,
    pitcherTeam: pick.pitcherTeam,
    statType: "hrr",
    line: pick.alternateLines?.find((a: any) => a.overProb >= 0.75)?.line || pick.alternateLines?.[0]?.line || 1.5,
    confidence: Math.round((pick.alternateLines?.find((a: any) => a.overProb >= 0.75)?.overProb || pick.overProbability || 0.7) * 100),
    combinedScore: Math.round((pick.overProbability || 0.7) * 100),
    reasoning: pick.reasoning || "",
    ballparkReasoning: pick.ballparkReasoning || "",
    savantMetrics: pick.savantMetrics,
  }));

  // Merge individual picks with HRR picks for parlay building
  const allLegs = [...(data?.picks || []), ...hrrLegs];
  const parlays = buildParlays(allLegs);
  
  // Also build HRR-only parlays (all legs are HRR combined)
  const hrrParlays = buildHRRParlays(hrrLegs);
  
  const filteredParlays = activeFilter === "all" 
    ? [...parlays, ...hrrParlays]
    : activeFilter === "hrr" 
      ? hrrParlays 
      : parlays.filter(p => p.type === activeFilter);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center py-16">
        <div className="text-center">
          <motion.div
            className="w-14 h-14 rounded-full border-2 border-transparent mx-auto mb-4"
            style={{ borderTopColor: "oklch(0.72 0.18 165)", borderRightColor: "oklch(0.65 0.15 280)" }}
            animate={{ rotate: 360 }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
          />
          <p className="text-sm text-[oklch(0.50_0.015_255)]">Analyzing Savant + Ballpark data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
      {/* Responsible Gambling Banner */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl p-3.5 border border-amber-500/20 bg-amber-500/5"
      >
        <div className="flex items-start gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0">
            <Info size={16} className="text-amber-400" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-amber-300 mb-1">BANKROLL MANAGEMENT</h4>
            <p className="text-[11px] text-[oklch(0.60_0.015_255)] leading-relaxed">
              We suggest not exceeding your bankroll limits. Bet within your means and treat this as entertainment, not income.
              Never chase losses. Set a daily/weekly budget and stick to it.
            </p>
          </div>
        </div>
      </motion.div>

      <SaferPlayTip />

      {/* Data Source Indicator */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[oklch(1_0_0/3%)] border border-[oklch(1_0_0/6%)]">
        <BarChart3 size={12} className="text-blue-400" />
        <span className="text-[10px] text-[oklch(0.55_0.015_255)]">
          Parlays built from <span className="text-blue-400 font-semibold">Savant Statcast</span> + <span className="text-emerald-400 font-semibold">Ballpark.com RC</span> combined scoring
        </span>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {[
          { key: "all", label: "All Parlays" },
          { key: "2-leg", label: "2-Leg Safe" },
          { key: "3-leg", label: "3-Leg" },
          { key: "hrr", label: "HRR Parlays" },
        ].map((tab: { key: string; label: string }) => (
          <button
            key={tab.key}
            onClick={() => setActiveFilter(tab.key as "all" | "2-leg" | "3-leg" | "hrr")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeFilter === tab.key
                ? "bg-white/10 text-white border border-white/20"
                : "text-[oklch(0.50_0.015_255)] hover:text-white hover:bg-white/5"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Section: 2-Leg Parlays */}
      {(activeFilter === "all" || activeFilter === "2-leg") && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Shield size={14} className="text-emerald-400" />
            <h3 className="text-sm font-bold text-white">Safe Plays (2-Leg)</h3>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              HIGHEST COMBINED SCORE
            </span>
          </div>
          <div className="space-y-3">
            {filteredParlays
              .filter((p: Parlay) => p.type === "2-leg" && !p.id.startsWith("hrr-"))
              .map((parlay: Parlay, i: number) => (
                <ParlayCard key={parlay.id} parlay={parlay} index={i} />
              ))}
          </div>
        </div>
      )}

      {/* Section: HRR Parlays */}
      {(activeFilter === "all" || activeFilter === "hrr") && hrrParlays.length > 0 && (
        <div className={activeFilter === "all" ? "mt-6" : ""}>
          <div className="flex items-center gap-2 mb-3">
            <Flame size={14} className="text-purple-400" />
            <h3 className="text-sm font-bold text-white">HRR Combined Parlays</h3>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
              SAFEST PROP TYPE
            </span>
          </div>
          <div className="space-y-3">
            {hrrParlays.map((parlay: Parlay, i: number) => (
              <ParlayCard key={parlay.id} parlay={parlay} index={i} />
            ))}
          </div>
        </div>
      )}

      {/* Section: 3-Leg Parlays */}
      {(activeFilter === "all" || activeFilter === "3-leg") && (
        <div className={activeFilter === "all" ? "mt-6" : ""}>
          <div className="flex items-center gap-2 mb-3">
            <Layers size={14} className="text-purple-400" />
            <h3 className="text-sm font-bold text-white">3-Leg Parlays</h3>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
              DIVERSIFIED RISK
            </span>
          </div>
          <div className="space-y-3">
            {filteredParlays
              .filter((p: Parlay) => p.type === "3-leg" && !p.id.startsWith("hrr-"))
              .map((parlay: Parlay, i: number) => (
                <ParlayCard key={parlay.id} parlay={parlay} index={i} />
              ))}
          </div>
        </div>
      )}

      {/* Bottom disclaimer */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="rounded-lg p-3 bg-[oklch(1_0_0/2%)] border border-[oklch(1_0_0/6%)] mt-4"
      >
        <div className="flex items-start gap-2">
          <Lock size={12} className="text-[oklch(0.40_0.015_255)] mt-0.5 shrink-0" />
          <p className="text-[10px] text-[oklch(0.40_0.015_255)] leading-relaxed">
            Parlay suggestions use combined Savant Statcast metrics (xwOBA, Hard Hit%, EV, Barrel%) + Ballpark.com RC analysis.
            Past performance does not guarantee future results. All picks are OVER props only.
            Please gamble responsibly — if you or someone you know has a gambling problem, call 1-800-GAMBLER.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
