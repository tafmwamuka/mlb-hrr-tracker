/**
 * HRR Tab - Combined Hits + Runs + RBI Props
 * Uses dedicated getHRRPicks endpoint that calculates projections from real player stats
 * Ranked by HRR-specific probability (not general AI pick order)
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, TrendingUp, Zap, Target, Activity, BarChart3, Flame } from "lucide-react";

interface HRRPick {
  playerName: string;
  team: string;
  pitcher: string;
  pitcherTeam: string;
  battingPosition: number;
  hrrConfidence: number;
  hrrLine: number;
  expectedHits: number;
  expectedRuns: number;
  expectedRBI: number;
  expectedTotal: number;
  edge: number;
  reasoning: string;
  ballparkReasoning: string;
  rcScore: number;
  combinedScore: number;
  parkFactor: number;
  savantMetrics?: {
    xwOBA: number;
    hardHitPct: number;
    exitVelocity: number;
    barrelPct: number;
  };
}

function getGrade(score: number): { label: string; color: string } {
  if (score >= 90) return { label: "A+", color: "oklch(0.72 0.18 165)" };
  if (score >= 80) return { label: "A", color: "oklch(0.75 0.17 150)" };
  if (score >= 70) return { label: "B+", color: "oklch(0.82 0.17 85)" };
  if (score >= 60) return { label: "B", color: "oklch(0.70 0.12 60)" };
  return { label: "C+", color: "oklch(0.60 0.10 30)" };
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 85) return "oklch(0.72 0.18 165)";
  if (confidence >= 75) return "oklch(0.82 0.17 85)";
  if (confidence >= 65) return "oklch(0.68 0.22 25)";
  return "oklch(0.55 0.15 255)";
}

function HRRCard({ pick, rank }: { pick: HRRPick; rank: number }) {
  const [expanded, setExpanded] = useState(false);
  const grade = getGrade(pick.combinedScore);
  const confColor = getConfidenceColor(pick.hrrConfidence);

  const rankBadge = rank <= 3
    ? { bg: "linear-gradient(135deg, oklch(0.82 0.17 85), oklch(0.68 0.22 25))", label: rank === 1 ? "🔥 BEST BET" : rank === 2 ? "⚡ ELITE" : "✨ STRONG" }
    : { bg: "linear-gradient(135deg, oklch(0.30 0.03 255), oklch(0.25 0.02 255))", label: `#${rank}` };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: rank * 0.04, duration: 0.3 }}
      className="rounded-2xl overflow-hidden border border-[oklch(1_0_0/8%)]"
      style={{ background: "oklch(0.14 0.022 255)" }}
    >
      {/* Top gradient accent */}
      {rank <= 3 && (
        <div className="h-[2px]" style={{ background: rankBadge.bg }} />
      )}

      <div className="p-4">
        {/* Header: Rank + Player + Line */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            {/* Rank badge */}
            <div
              className="px-2.5 py-1 rounded-lg text-xs font-bold text-white"
              style={{ background: rankBadge.bg }}
            >
              {rankBadge.label}
            </div>
            <div>
              <div className="text-white font-bold text-base">{pick.playerName}</div>
              <div className="text-[oklch(0.55_0.015_255)] text-xs">
                {pick.team} · Batting #{pick.battingPosition} · vs {pick.pitcher}
              </div>
            </div>
          </div>

          {/* HRR Line Badge */}
          <div className="flex flex-col items-end gap-1">
            <div
              className="px-3 py-1.5 rounded-lg text-sm font-bold"
              style={{
                background: `${confColor}20`,
                color: confColor,
                border: `1px solid ${confColor}40`,
              }}
            >
              HRR O {pick.hrrLine}
            </div>
            <span className="text-xs font-semibold" style={{ color: confColor }}>
              {pick.hrrConfidence}% conf
            </span>
          </div>
        </div>

        {/* HRR Breakdown Bar */}
        <div className="mb-3 p-3 rounded-xl" style={{ background: "oklch(0.12 0.018 255)" }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[oklch(0.55_0.015_255)]">Expected Breakdown</span>
            <span className="text-sm font-bold text-white">
              Total: <span style={{ color: confColor }}>{pick.expectedTotal.toFixed(1)}</span>
            </span>
          </div>

          {/* Visual breakdown */}
          <div className="flex gap-1 h-6 rounded-lg overflow-hidden mb-2">
            <div
              className="flex items-center justify-center text-[10px] font-bold text-white"
              style={{
                width: `${(pick.expectedHits / pick.expectedTotal) * 100}%`,
                background: "oklch(0.82 0.17 85)",
                minWidth: "20%",
              }}
            >
              H {pick.expectedHits.toFixed(1)}
            </div>
            <div
              className="flex items-center justify-center text-[10px] font-bold text-white"
              style={{
                width: `${(pick.expectedRuns / pick.expectedTotal) * 100}%`,
                background: "oklch(0.68 0.22 25)",
                minWidth: "20%",
              }}
            >
              R {pick.expectedRuns.toFixed(1)}
            </div>
            <div
              className="flex items-center justify-center text-[10px] font-bold text-white"
              style={{
                width: `${(pick.expectedRBI / pick.expectedTotal) * 100}%`,
                background: "oklch(0.72 0.18 165)",
                minWidth: "20%",
              }}
            >
              RBI {pick.expectedRBI.toFixed(1)}
            </div>
          </div>

          {/* Stat labels */}
          <div className="flex justify-between text-[10px]">
            <span style={{ color: "oklch(0.82 0.17 85)" }}>
              <TrendingUp size={10} className="inline mr-0.5" />Hits
            </span>
            <span style={{ color: "oklch(0.68 0.22 25)" }}>
              <Zap size={10} className="inline mr-0.5" />Runs
            </span>
            <span style={{ color: "oklch(0.72 0.18 165)" }}>
              <Target size={10} className="inline mr-0.5" />RBI
            </span>
          </div>
        </div>

        {/* Score pills */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          <div className="px-2 py-0.5 rounded text-[10px] font-semibold" style={{ background: "oklch(0.20 0.02 255)", color: grade.color }}>
            <BarChart3 size={10} className="inline mr-0.5" />RC {pick.rcScore}
          </div>
          <div className="px-2 py-0.5 rounded text-[10px] font-semibold" style={{ background: "oklch(0.20 0.02 255)", color: "oklch(0.75 0.15 200)" }}>
            <Activity size={10} className="inline mr-0.5" />Combined {pick.combinedScore}
          </div>
          {pick.savantMetrics && (
            <>
              <div className="px-2 py-0.5 rounded text-[10px] font-semibold" style={{ background: "oklch(0.20 0.02 255)", color: "oklch(0.70 0.12 60)" }}>
                xwOBA {pick.savantMetrics.xwOBA.toFixed(3)}
              </div>
              <div className="px-2 py-0.5 rounded text-[10px] font-semibold" style={{ background: "oklch(0.20 0.02 255)", color: "oklch(0.65 0.15 30)" }}>
                HH% {pick.savantMetrics.hardHitPct.toFixed(0)}
              </div>
            </>
          )}
          <div className="px-2 py-0.5 rounded text-[10px] font-semibold" style={{ background: "oklch(0.20 0.02 255)", color: pick.edge > 0.5 ? "oklch(0.72 0.18 165)" : "oklch(0.60 0.10 30)" }}>
            Edge +{pick.edge.toFixed(2)}
          </div>
        </div>

        {/* Reasoning */}
        <p className="text-xs text-[oklch(0.60_0.015_255)] leading-relaxed mb-2">
          {pick.reasoning}
        </p>

        {/* Expand button */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-center gap-1 py-2 text-xs font-medium text-[oklch(0.50_0.015_255)] hover:text-white transition-colors"
        >
          {expanded ? "Hide Details" : "View Analysis"}
          <ChevronDown size={14} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>

        {/* Expanded details */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="pt-3 border-t border-[oklch(1_0_0/8%)] space-y-3">
                {/* Per-stat confidence */}
                <div>
                  <span className="text-[10px] font-semibold text-[oklch(0.45_0.015_255)] uppercase tracking-wide">Per-Stat Projection (per game)</span>
                  <div className="mt-2 space-y-2">
                    <StatBar label="Hits" value={pick.expectedHits} max={3} color="oklch(0.82 0.17 85)" />
                    <StatBar label="Runs" value={pick.expectedRuns} max={2.5} color="oklch(0.68 0.22 25)" />
                    <StatBar label="RBI" value={pick.expectedRBI} max={3} color="oklch(0.72 0.18 165)" />
                  </div>
                </div>

                {/* Savant metrics */}
                {pick.savantMetrics && (
                  <div>
                    <span className="text-[10px] font-semibold text-[oklch(0.45_0.015_255)] uppercase tracking-wide">Savant Metrics vs Pitcher</span>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <MetricBox label="xwOBA" value={pick.savantMetrics.xwOBA.toFixed(3)} good={pick.savantMetrics.xwOBA > 0.370} />
                      <MetricBox label="Hard Hit%" value={`${pick.savantMetrics.hardHitPct.toFixed(0)}%`} good={pick.savantMetrics.hardHitPct > 45} />
                      <MetricBox label="Exit Velo" value={`${pick.savantMetrics.exitVelocity.toFixed(1)}`} good={pick.savantMetrics.exitVelocity > 90} />
                      <MetricBox label="Barrel%" value={`${pick.savantMetrics.barrelPct.toFixed(0)}%`} good={pick.savantMetrics.barrelPct > 10} />
                    </div>
                  </div>
                )}

                {/* Ballpark reasoning */}
                <div className="p-2.5 rounded-lg" style={{ background: "oklch(0.12 0.018 255)" }}>
                  <span className="text-[10px] font-semibold text-[oklch(0.45_0.015_255)]">PROJECTION BASIS</span>
                  <p className="text-[11px] text-[oklch(0.60_0.015_255)] mt-1 leading-relaxed">
                    {pick.ballparkReasoning}
                  </p>
                </div>

                {/* Line explanation */}
                <div className="p-2.5 rounded-lg" style={{ background: "oklch(0.12 0.018 255)" }}>
                  <span className="text-[10px] font-semibold text-[oklch(0.45_0.015_255)]">WHY THIS LINE?</span>
                  <p className="text-[11px] text-[oklch(0.60_0.015_255)] mt-1 leading-relaxed">
                    Expected total of <strong className="text-white">{pick.expectedTotal.toFixed(1)} HRR</strong> vs line of{" "}
                    <strong className="text-white">{pick.hrrLine}</strong>.
                    {pick.edge > 0.5
                      ? " Strong edge — projected well above the line."
                      : pick.edge > 0.2
                      ? " Moderate edge — projected above the line."
                      : " Thin edge — close to the line, higher variance."}
                    {" "}Park factor: {pick.parkFactor > 1.05 ? "hitter-friendly" : pick.parkFactor < 0.95 ? "pitcher-friendly" : "neutral"} ({pick.parkFactor.toFixed(2)}).
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function StatBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-medium w-8" style={{ color }}>{label}</span>
      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "oklch(0.20 0.02 255)" }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[11px] font-bold text-white w-8 text-right">{value.toFixed(1)}</span>
    </div>
  );
}

function MetricBox({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className="p-2 rounded-lg text-center" style={{ background: "oklch(0.16 0.02 255)" }}>
      <div className="text-[10px] text-[oklch(0.45_0.015_255)]">{label}</div>
      <div className={`text-sm font-bold ${good ? "text-[oklch(0.72_0.18_165)]" : "text-white"}`}>{value}</div>
    </div>
  );
}

export function HRRTab() {
  // Use the dedicated HRR endpoint with real stat-based calculations
  const { data, isLoading } = trpc.aiPicks.getHRRPicks.useQuery();

  const hrrPicks: HRRPick[] = (data?.picks || []).map((pick: any) => ({
    playerName: pick.playerName,
    team: pick.team,
    pitcher: pick.pitcher,
    pitcherTeam: pick.pitcherTeam,
    battingPosition: pick.battingPosition,
    hrrConfidence: pick.hrrConfidence,
    hrrLine: pick.hrrLine,
    expectedHits: pick.expectedHits,
    expectedRuns: pick.expectedRuns,
    expectedRBI: pick.expectedRBI,
    expectedTotal: pick.expectedTotal,
    edge: pick.edge,
    reasoning: pick.reasoning,
    ballparkReasoning: pick.ballparkReasoning,
    rcScore: pick.rcScore,
    combinedScore: pick.combinedScore,
    parkFactor: pick.parkFactor,
    savantMetrics: pick.savantMetrics,
  }));

  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="animate-pulse rounded-2xl h-40" style={{ background: "oklch(0.14 0.022 255)" }} />
        ))}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-white font-bold text-lg flex items-center gap-2">
            <Flame size={20} style={{ color: "oklch(0.68 0.22 25)" }} />
            HRR Combined Props
          </h2>
          <p className="text-[oklch(0.50_0.015_255)] text-xs mt-0.5">
            Hits + Runs + RBI combined over/under
          </p>
        </div>
        <div className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "oklch(0.20 0.03 255)", color: "oklch(0.72 0.18 165)" }}>
          {hrrPicks.length} picks
        </div>
      </div>

      {/* Explanation card */}
      <div className="p-3 rounded-xl border border-[oklch(1_0_0/6%)]" style={{ background: "oklch(0.12 0.018 255)" }}>
        <div className="flex items-start gap-2">
          <Activity size={14} className="mt-0.5 shrink-0" style={{ color: "oklch(0.72 0.18 165)" }} />
          <div>
            <span className="text-xs font-semibold text-white">How HRR Works</span>
            <p className="text-[10px] text-[oklch(0.55_0.015_255)] mt-0.5 leading-relaxed">
              HRR combines a player's Hits + Runs + RBI into one prop. If the line is <strong className="text-white">OVER 3.5</strong>, 
              you need the player to total 4+ across all three stats. We project each stat individually using per-game season averages, 
              park factors, batting position, and Savant + Ballpark data.
            </p>
          </div>
        </div>
      </div>

      {/* HRR Pick Cards */}
      <div className="space-y-3">
        {hrrPicks.map((pick, i) => (
          <HRRCard key={`${pick.playerName}-${i}`} pick={pick} rank={i + 1} />
        ))}
      </div>

      {/* Disclaimer */}
      <div className="text-center py-3">
        <p className="text-[10px] text-[oklch(0.35_0.015_255)] leading-relaxed">
          HRR projections based on season per-game averages + Savant + Ballpark.com analysis.
          Always bet responsibly within your means.
        </p>
      </div>
    </div>
  );
}
