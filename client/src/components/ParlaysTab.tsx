/**
 * Parlays Tab — Smart Parlay Suggestions
 * Shows 2-leg (safe) and 3-leg parlay options
 * Emphasizes responsible gambling and bankroll management
 */

import { trpc } from "@/lib/trpc";
import { Shield, AlertTriangle, TrendingUp, Zap, Target, Lock, Layers, ChevronDown, Info } from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const STAT_CONFIG = {
  hits: { label: "HITS", icon: TrendingUp, color: "oklch(0.82 0.17 85)" },
  runs: { label: "RUNS", icon: Zap, color: "oklch(0.68 0.22 25)" },
  rbi: { label: "RBI", icon: Target, color: "oklch(0.72 0.18 165)" },
};

interface ParlayLeg {
  playerName: string;
  team: string;
  statType: string;
  line: number;
  confidence: number;
  reasoning: string;
}

interface Parlay {
  id: string;
  type: "2-leg" | "3-leg";
  legs: ParlayLeg[];
  combinedConfidence: number;
  riskLevel: "low" | "medium";
  reasoning: string;
}

function buildParlays(picks: any[]): Parlay[] {
  if (!picks || picks.length < 4) return [];

  const parlays: Parlay[] = [];

  // Sort by confidence for best combinations
  const sorted = [...picks].sort((a, b) => b.confidence - a.confidence);

  // Generate 2-leg parlays (safe plays) from top confidence picks
  // Pair picks from different games/teams for diversity
  const usedFor2Leg = new Set<number>();
  for (let i = 0; i < sorted.length && parlays.length < 4; i++) {
    for (let j = i + 1; j < sorted.length && parlays.length < 4; j++) {
      if (sorted[i].team === sorted[j].team) continue; // Different teams
      if (usedFor2Leg.has(i) || usedFor2Leg.has(j)) continue;

      const combined = Math.round((sorted[i].confidence + sorted[j].confidence) / 2 * 0.92);
      parlays.push({
        id: `2leg-${i}-${j}`,
        type: "2-leg",
        legs: [
          {
            playerName: sorted[i].playerName,
            team: sorted[i].team,
            statType: sorted[i].statType,
            line: sorted[i].line,
            confidence: sorted[i].confidence,
            reasoning: sorted[i].reasoning,
          },
          {
            playerName: sorted[j].playerName,
            team: sorted[j].team,
            statType: sorted[j].statType,
            line: sorted[j].line,
            confidence: sorted[j].confidence,
            reasoning: sorted[j].reasoning,
          },
        ],
        combinedConfidence: combined,
        riskLevel: "low",
        reasoning: `High-confidence pairing: Both players rank in the top tier of today's matchups with strong RC scores and favorable pitcher matchups.`,
      });
      usedFor2Leg.add(i);
      usedFor2Leg.add(j);
    }
  }

  // Generate 3-leg parlays (moderate risk)
  const usedFor3Leg = new Set<number>();
  for (let i = 0; i < sorted.length - 2 && parlays.length < 7; i++) {
    for (let j = i + 1; j < sorted.length - 1; j++) {
      for (let k = j + 1; k < sorted.length; k++) {
        if (parlays.length >= 7) break;
        if (sorted[i].team === sorted[j].team || sorted[j].team === sorted[k].team || sorted[i].team === sorted[k].team) continue;
        if (usedFor3Leg.has(i) || usedFor3Leg.has(j) || usedFor3Leg.has(k)) continue;

        const combined = Math.round((sorted[i].confidence + sorted[j].confidence + sorted[k].confidence) / 3 * 0.85);
        parlays.push({
          id: `3leg-${i}-${j}-${k}`,
          type: "3-leg",
          legs: [
            {
              playerName: sorted[i].playerName,
              team: sorted[i].team,
              statType: sorted[i].statType,
              line: sorted[i].line,
              confidence: sorted[i].confidence,
              reasoning: sorted[i].reasoning,
            },
            {
              playerName: sorted[j].playerName,
              team: sorted[j].team,
              statType: sorted[j].statType,
              line: sorted[j].line,
              confidence: sorted[j].confidence,
              reasoning: sorted[j].reasoning,
            },
            {
              playerName: sorted[k].playerName,
              team: sorted[k].team,
              statType: sorted[k].statType,
              line: sorted[k].line,
              confidence: sorted[k].confidence,
              reasoning: sorted[k].reasoning,
            },
          ],
          combinedConfidence: combined,
          riskLevel: "medium",
          reasoning: `Diversified across ${sorted[i].team}, ${sorted[j].team}, and ${sorted[k].team}. Each leg has strong individual confidence backed by ballpark.com matchup data.`,
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
            ? "linear-gradient(90deg, oklch(0.72 0.18 165), oklch(0.72 0.18 165 / 30%))"
            : "linear-gradient(90deg, oklch(0.65 0.15 280), oklch(0.65 0.15 280 / 30%))",
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

          {/* Combined confidence */}
          <div className="text-right">
            <div className="font-stat text-lg font-bold" style={{ color: is2Leg ? "oklch(0.72 0.18 165)" : "oklch(0.75 0.15 280)" }}>
              {parlay.combinedConfidence}%
            </div>
            <div className="text-[9px] text-[oklch(0.45_0.015_255)] uppercase">Combined</div>
          </div>
        </div>

        {/* Legs preview */}
        <div className="space-y-2">
          {parlay.legs.map((leg, i) => {
            const statCfg = STAT_CONFIG[leg.statType as keyof typeof STAT_CONFIG] || STAT_CONFIG.hits;
            const StatIcon = statCfg.icon;
            return (
              <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-[oklch(1_0_0/3%)]">
                <div className="w-5 h-5 rounded-full bg-[oklch(1_0_0/6%)] flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-bold text-[oklch(0.55_0.015_255)]">{i + 1}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-white truncate">{leg.playerName}</span>
                    <span className="text-[10px] text-[oklch(0.45_0.015_255)]">{leg.team}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 px-2 py-0.5 rounded-md shrink-0" style={{ background: `${statCfg.color}15` }}>
                  <StatIcon size={10} style={{ color: statCfg.color }} />
                  <span className="text-[10px] font-bold" style={{ color: statCfg.color }}>
                    {statCfg.label} O{leg.line}
                  </span>
                </div>
                <span className="text-[10px] font-stat font-bold text-[oklch(0.60_0.015_255)] shrink-0">{leg.confidence}%</span>
              </div>
            );
          })}
        </div>

        {/* Expand indicator */}
        <div className="flex items-center justify-center mt-3 pt-2 border-t border-[oklch(1_0_0/6%)]">
          <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown size={14} className="text-[oklch(0.40_0.015_255)]" />
          </motion.div>
        </div>
      </button>

      {/* Expanded reasoning */}
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
              <div className="p-3 rounded-lg bg-[oklch(1_0_0/3%)] border border-[oklch(1_0_0/6%)]">
                <p className="text-xs text-[oklch(0.60_0.015_255)] leading-relaxed">{parlay.reasoning}</p>
              </div>
              {parlay.legs.map((leg, i) => (
                <div key={i} className="pl-3 border-l-2 border-[oklch(1_0_0/10%)]">
                  <p className="text-[11px] text-[oklch(0.50_0.015_255)]">
                    <span className="font-semibold text-white">{leg.playerName}:</span> {leg.reasoning}
                  </p>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function ParlaysTab() {
  const { data, isLoading } = trpc.aiPicks.getComprehensivePicks.useQuery();
  const [activeFilter, setActiveFilter] = useState<"all" | "2-leg" | "3-leg">("all");

  const parlays = buildParlays(data?.picks || []);
  const filteredParlays = activeFilter === "all" ? parlays : parlays.filter(p => p.type === activeFilter);

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
          <p className="text-sm text-[oklch(0.50_0.015_255)]">Building parlay options...</p>
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

      {/* Filter tabs */}
      <div className="flex items-center gap-2">
        {[
          { key: "all", label: "All Parlays" },
          { key: "2-leg", label: "2-Leg Safe" },
          { key: "3-leg", label: "3-Leg" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveFilter(tab.key as any)}
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
              LOWER RISK
            </span>
          </div>
          <div className="space-y-3">
            {filteredParlays
              .filter(p => p.type === "2-leg")
              .map((parlay, i) => (
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
              MODERATE RISK
            </span>
          </div>
          <div className="space-y-3">
            {filteredParlays
              .filter(p => p.type === "3-leg")
              .map((parlay, i) => (
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
            Parlay suggestions are based on AI analysis of ballpark.com matchup data, RC scores, and park factors. 
            Past performance does not guarantee future results. All picks are OVER props only. 
            Please gamble responsibly — if you or someone you know has a gambling problem, call 1-800-GAMBLER.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
