/**
 * Money Picks Tab - Shows only 75%+ probability alternate lines
 * These are the "safest" plays from our HRR model
 * Each card shows the recommended alternate line with high probability
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Flame, Shield, TrendingUp, Target, Zap, DollarSign, CheckCircle2 } from "lucide-react";
import { SaferPlayTip } from "@/components/SaferPlayTip";

interface AlternateLine {
  line: number;
  overProb: number;
  underProb: number;
}

interface MoneyPick {
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
  // Computed for Money Picks
  recommendedLine: number;
  recommendedProb: number;
}

function getProbColor(prob: number): string {
  if (prob >= 85) return "oklch(0.72 0.18 165)";
  if (prob >= 75) return "oklch(0.78 0.16 140)";
  return "oklch(0.82 0.17 85)";
}

function getConfidenceTier(prob: number): { label: string; emoji: string } {
  if (prob >= 90) return { label: "LOCK", emoji: "🔒" };
  if (prob >= 85) return { label: "STRONG", emoji: "💪" };
  if (prob >= 80) return { label: "SOLID", emoji: "✅" };
  return { label: "GOOD", emoji: "👍" };
}

function MoneyPickCard({ pick, rank }: { pick: MoneyPick; rank: number }) {
  const [expanded, setExpanded] = useState(false);
  const probColor = getProbColor(pick.recommendedProb);
  const tier = getConfidenceTier(pick.recommendedProb);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: rank * 0.05, duration: 0.35 }}
      className="rounded-2xl overflow-hidden border border-[oklch(1_0_0/8%)]"
      style={{ background: "oklch(0.14 0.022 255)" }}
    >
      {/* Top accent bar */}
      <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${probColor}, ${probColor}60)` }} />

      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            {/* Rank + Tier */}
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-lg font-bold" style={{ color: probColor }}>{tier.emoji}</span>
              <span className="text-[10px] font-bold text-[oklch(0.45_0.015_255)]">#{rank}</span>
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

          {/* Recommended line + probability */}
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
            <div className="flex items-center gap-1">
              <CheckCircle2 size={10} style={{ color: probColor }} />
              <span className="text-xs font-bold" style={{ color: probColor }}>
                {pick.recommendedProb}% hit rate
              </span>
            </div>
          </div>
        </div>

        {/* Confidence badge */}
        <div className="flex items-center gap-2 mb-3">
          <div
            className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide"
            style={{ background: `${probColor}15`, color: probColor, border: `1px solid ${probColor}30` }}
          >
            {tier.label} PLAY
          </div>
          {pick.edge > 0 && (
            <div className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: "oklch(0.72 0.18 165 / 15%)", color: "oklch(0.72 0.18 165)", border: "1px solid oklch(0.72 0.18 165 / 30%)" }}>
              +{pick.edge}% edge
            </div>
          )}
          <div className="px-2 py-0.5 rounded text-[10px] text-[oklch(0.50_0.015_255)]" style={{ background: "oklch(0.18 0.02 255)" }}>
            {pick.lineSource}
          </div>
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
            {pick.alternateLines.filter(a => a.overProb >= 40).map((alt) => {
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

        {/* Quick reasoning */}
        <p className="text-[11px] text-[oklch(0.55_0.015_255)] leading-relaxed mb-2">
          {pick.reasoning}
        </p>

        {/* Expand for more */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-[11px] font-semibold transition-colors"
          style={{ color: probColor }}
        >
          <ChevronDown size={12} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
          {expanded ? "Hide Details" : "View Details"}
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
              <div className="mt-3 space-y-3 pt-3 border-t border-[oklch(1_0_0/6%)]">
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
  const { data, isLoading } = trpc.aiPicks.getHRRPicks.useQuery();

  // Filter picks to only those with at least one alternate line at 75%+
  // Then pick the highest line that still has 75%+ probability as the "money pick"
  const moneyPicks: MoneyPick[] = (data?.picks || [])
    .map((pick: any) => {
      const alternateLines: AlternateLine[] = pick.alternateLines || [];
      // Find the highest line with 75%+ probability
      const qualifyingLines = alternateLines
        .filter((a: AlternateLine) => a.overProb >= 75)
        .sort((a: AlternateLine, b: AlternateLine) => b.line - a.line);

      if (qualifyingLines.length === 0) return null;

      const recommended = qualifyingLines[0];

      return {
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
      } as MoneyPick;
    })
    .filter((p: MoneyPick | null): p is MoneyPick => p !== null)
    // Sort by: highest recommended line first (more value), then by probability
    .sort((a: MoneyPick, b: MoneyPick) => {
      if (b.recommendedLine !== a.recommendedLine) return b.recommendedLine - a.recommendedLine;
      return b.recommendedProb - a.recommendedProb;
    });

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
            <DollarSign size={20} style={{ color: "oklch(0.72 0.18 165)" }} />
            Money Picks
          </h2>
          <p className="text-[oklch(0.50_0.015_255)] text-xs mt-0.5">
            75%+ probability plays · highest value alternates
          </p>
        </div>
        <div className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "oklch(0.20 0.03 255)", color: "oklch(0.72 0.18 165)" }}>
          {moneyPicks.length} plays
        </div>
      </div>

      {/* Explanation */}
      <div className="p-3 rounded-xl border border-[oklch(1_0_0/6%)]" style={{ background: "oklch(0.12 0.018 255)" }}>
        <div className="flex items-start gap-2">
          <Shield size={14} className="mt-0.5 shrink-0" style={{ color: "oklch(0.72 0.18 165)" }} />
          <p className="text-[10px] text-[oklch(0.55_0.015_255)] leading-relaxed">
            These are our <strong className="text-white">safest plays</strong> — only picks where our Poisson model gives 75%+ probability of hitting the OVER.
            We show the <strong className="text-white">highest line</strong> that still clears the 75% threshold for maximum value.
          </p>
        </div>
      </div>

      <SaferPlayTip />

      {/* Money Pick Cards */}
      {moneyPicks.length === 0 ? (
        <div className="text-center py-12">
          <DollarSign size={40} className="mx-auto mb-3" style={{ color: "oklch(0.35 0.015 255)" }} />
          <p className="text-[oklch(0.45_0.015_255)] text-sm">No 75%+ plays available right now</p>
          <p className="text-[oklch(0.35_0.015_255)] text-xs mt-1">Check back when games are closer</p>
        </div>
      ) : (
        <div className="space-y-3">
          {moneyPicks.map((pick, i) => (
            <MoneyPickCard key={`${pick.playerName}-${i}`} pick={pick} rank={i + 1} />
          ))}
        </div>
      )}

      {/* Disclaimer */}
      <div className="text-center py-3">
        <p className="text-[10px] text-[oklch(0.35_0.015_255)] leading-relaxed">
          Probabilities from Poisson model using Statcast + Ballpark.com data. Always bet responsibly.
        </p>
      </div>
    </div>
  );
}
