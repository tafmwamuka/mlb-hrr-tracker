/**
 * HRR Tab - Combined Hits + Runs + RBI Props
 * Uses dedicated getHRRPicks endpoint with Poisson probability model
 * Shows alternate lines, real sportsbook odds, edge vs book, and pick quality
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, TrendingUp, Zap, Target, Activity, BarChart3, Flame, Shield, DollarSign } from "lucide-react";
import { SaferPlayTip } from "@/components/SaferPlayTip";

interface AlternateLine {
  line: number;
  overProb: number;
  underProb: number;
}

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
  // New enriched fields
  overProbability: number;
  pickQuality: "strong" | "moderate" | "lean" | "avoid";
  lineSource: string;
  bookOdds: number | null;
  bookImpliedProb: number | null;
  alternateLines: AlternateLine[];
  fairLine: number;
  // theLAB + streak + day/night (now wired from backend)
  streakInfo?: {
    streakType: 'hot' | 'cold' | 'neutral';
    streakLength: number;
    last5HitRate: number;
    trendDirection: 'up' | 'down' | 'stable';
  } | null;
  dayNightSplit?: {
    gameTimeType: 'day' | 'night';
    splitAvg: number;
    splitBoost: number;
    favorable: boolean;
    splitGames: number;
  } | null;
  theLabEdge?: {
    edgeScore: number;
    strongHitCandidate: boolean;
    last5HitRate: number;
    odds?: string;
    provider?: string;
  } | null;
}

function getQualityConfig(quality: string) {
  switch (quality) {
    case "strong":
      return { label: "STRONG EDGE", color: "oklch(0.72 0.18 165)", bg: "oklch(0.72 0.18 165)" };
    case "moderate":
      return { label: "MODERATE EDGE", color: "oklch(0.82 0.17 85)", bg: "oklch(0.82 0.17 85)" };
    case "lean":
      return { label: "LEAN", color: "oklch(0.68 0.22 25)", bg: "oklch(0.68 0.22 25)" };
    default:
      return { label: "LOW EDGE", color: "oklch(0.50 0.10 255)", bg: "oklch(0.50 0.10 255)" };
  }
}

function getProbColor(prob: number): string {
  if (prob >= 70) return "oklch(0.72 0.18 165)";
  if (prob >= 55) return "oklch(0.82 0.17 85)";
  if (prob >= 40) return "oklch(0.68 0.22 25)";
  return "oklch(0.55 0.15 255)";
}

function HRRCard({ pick, rank }: { pick: HRRPick; rank: number }) {
  const [expanded, setExpanded] = useState(false);
  const qualityCfg = getQualityConfig(pick.pickQuality);
  const probColor = getProbColor(pick.overProbability);

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

          {/* HRR Line + Probability */}
          <div className="flex flex-col items-end gap-1">
            <div
              className="px-3 py-1.5 rounded-lg text-sm font-bold"
              style={{
                background: `${probColor}20`,
                color: probColor,
                border: `1px solid ${probColor}40`,
              }}
            >
              HRR O {pick.hrrLine}
            </div>
            <span className="text-xs font-bold" style={{ color: probColor }}>
              {pick.overProbability}% over prob
            </span>
          </div>
        </div>

        {/* Pick Quality + Edge Badge + Streak + Day/Night */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <div
            className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide"
            style={{ background: `${qualityCfg.bg}20`, color: qualityCfg.color, border: `1px solid ${qualityCfg.bg}30` }}
          >
            <Shield size={10} className="inline mr-0.5" />{qualityCfg.label}
          </div>
          {pick.edge > 0 && (
            <div className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: "oklch(0.72 0.18 165 / 15%)", color: "oklch(0.72 0.18 165)" }}>
              +{pick.edge}% edge vs book
            </div>
          )}
          {pick.bookOdds && (
            <div className="px-2 py-0.5 rounded text-[10px] font-semibold" style={{ background: "oklch(0.20 0.02 255)", color: "oklch(0.60 0.15 200)" }}>
              <DollarSign size={9} className="inline" />{pick.bookOdds > 0 ? `+${pick.bookOdds}` : pick.bookOdds}
            </div>
          )}
          {/* Streak badge from theLAB */}
          {pick.streakInfo?.streakType === 'hot' && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded" style={{ background: "oklch(0.68 0.22 25 / 15%)", border: "1px solid oklch(0.68 0.22 25 / 35%)", color: "oklch(0.82 0.17 85)" }}>
              <Flame size={9} />
              <span className="text-[10px] font-bold">
                {pick.streakInfo.streakLength >= 3 ? `🔥 ${pick.streakInfo.streakLength}-game streak` : `HOT ${pick.streakInfo.last5HitRate}%`}
              </span>
            </div>
          )}
          {pick.streakInfo?.streakType === 'cold' && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded" style={{ background: "oklch(0.55 0.15 240 / 15%)", border: "1px solid oklch(0.55 0.15 240 / 35%)", color: "oklch(0.65 0.12 240)" }}>
              <span className="text-[10px] font-bold">❄️ COLD {pick.streakInfo.last5HitRate}%</span>
            </div>
          )}
          {/* Day/Night split badge */}
          {pick.dayNightSplit && (
            <div className="px-2 py-0.5 rounded text-[10px] font-bold" style={{
              background: pick.dayNightSplit.favorable ? "oklch(0.72 0.18 165 / 12%)" : "oklch(0.18 0.02 255)",
              border: `1px solid ${pick.dayNightSplit.favorable ? "oklch(0.72 0.18 165 / 30%)" : "oklch(1 0 0 / 8%)"}`,
              color: pick.dayNightSplit.favorable ? "oklch(0.72 0.18 165)" : "oklch(0.50 0.015 255)",
            }}>
              {pick.dayNightSplit.gameTimeType === 'day' ? '☀️' : '🌙'} {pick.dayNightSplit.gameTimeType}
              {pick.dayNightSplit.favorable && ` +${pick.dayNightSplit.splitBoost}%`}
            </div>
          )}
          {/* theLAB strong hit candidate */}
          {pick.theLabEdge?.strongHitCandidate && (
            <div className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: "oklch(0.82 0.17 85 / 20%)", color: "oklch(0.82 0.17 85)", border: "1px solid oklch(0.82 0.17 85 / 40%)" }}>
              ⭐ theLAB Pick
            </div>
          )}
          <div className="px-2 py-0.5 rounded text-[10px] font-semibold" style={{ background: "oklch(0.20 0.02 255)", color: "oklch(0.50 0.015 255)" }}>
            {pick.lineSource}
          </div>
        </div>

        {/* HRR Breakdown Bar */}
        <div className="mb-3 p-3 rounded-xl" style={{ background: "oklch(0.12 0.018 255)" }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[oklch(0.55_0.015_255)]">Expected Breakdown</span>
            <span className="text-sm font-bold text-white">
              Proj: <span style={{ color: probColor }}>{pick.expectedTotal}</span> vs Line: <span className="text-[oklch(0.55_0.015_255)]">{pick.hrrLine}</span>
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

        {/* Alternate Lines */}
        {pick.alternateLines.length > 0 && (
          <div className="mb-3">
            <span className="text-[10px] font-semibold text-[oklch(0.45_0.015_255)] uppercase tracking-wide">Alternate Lines</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {pick.alternateLines.map((alt) => {
                const isActive = alt.line === pick.hrrLine;
                const altColor = getProbColor(alt.overProb);
                return (
                  <div
                    key={alt.line}
                    className="px-2 py-1 rounded-lg text-center"
                    style={{
                      background: isActive ? `${altColor}20` : "oklch(0.16 0.02 255)",
                      border: isActive ? `1px solid ${altColor}50` : "1px solid oklch(1 0 0 / 5%)",
                    }}
                  >
                    <div className="text-[10px] font-bold" style={{ color: isActive ? altColor : "oklch(0.65 0.015 255)" }}>
                      O {alt.line}
                    </div>
                    <div className="text-[9px] font-semibold" style={{ color: altColor }}>
                      {alt.overProb}%
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Reasoning */}
        <p className="text-xs text-[oklch(0.60_0.015_255)] leading-relaxed mb-2">
          {pick.reasoning}
        </p>

        {/* Expand button */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-center gap-1 py-2 text-xs font-medium text-[oklch(0.50_0.015_255)] hover:text-white transition-colors"
        >
          {expanded ? "Hide Details" : "View Full Analysis"}
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
                {/* Per-stat projection */}
                <div>
                  <span className="text-[10px] font-semibold text-[oklch(0.45_0.015_255)] uppercase tracking-wide">Per-Stat Projection (per game)</span>
                  <div className="mt-2 space-y-2">
                    <StatBar label="Hits" value={pick.expectedHits} max={2.5} color="oklch(0.82 0.17 85)" />
                    <StatBar label="Runs" value={pick.expectedRuns} max={1.5} color="oklch(0.68 0.22 25)" />
                    <StatBar label="RBI" value={pick.expectedRBI} max={1.5} color="oklch(0.72 0.18 165)" />
                  </div>
                </div>

                {/* Savant metrics */}
                {pick.savantMetrics && (
                  <div>
                    <span className="text-[10px] font-semibold text-[oklch(0.45_0.015_255)] uppercase tracking-wide">Statcast Metrics</span>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <MetricBox label="xwOBA" value={pick.savantMetrics.xwOBA.toFixed(3)} good={pick.savantMetrics.xwOBA > 0.370} />
                      <MetricBox label="Hard Hit%" value={`${pick.savantMetrics.hardHitPct.toFixed(0)}%`} good={pick.savantMetrics.hardHitPct > 45} />
                      <MetricBox label="Exit Velo" value={`${pick.savantMetrics.exitVelocity.toFixed(1)}`} good={pick.savantMetrics.exitVelocity > 90} />
                      <MetricBox label="Barrel%" value={`${pick.savantMetrics.barrelPct.toFixed(0)}%`} good={pick.savantMetrics.barrelPct > 10} />
                    </div>
                  </div>
                )}

                {/* Book comparison */}
                {pick.bookImpliedProb && (
                  <div className="p-2.5 rounded-lg" style={{ background: "oklch(0.12 0.018 255)" }}>
                    <span className="text-[10px] font-semibold text-[oklch(0.45_0.015_255)]">BOOK vs MODEL</span>
                    <div className="mt-1.5 flex items-center gap-3">
                      <div className="flex-1">
                        <div className="text-[10px] text-[oklch(0.50_0.015_255)]">Book implied</div>
                        <div className="text-sm font-bold text-[oklch(0.60_0.015_255)]">{pick.bookImpliedProb}%</div>
                      </div>
                      <div className="text-lg font-bold" style={{ color: pick.edge > 0 ? "oklch(0.72 0.18 165)" : "oklch(0.55 0.15 255)" }}>
                        →
                      </div>
                      <div className="flex-1">
                        <div className="text-[10px] text-[oklch(0.50_0.015_255)]">Our model</div>
                        <div className="text-sm font-bold" style={{ color: probColor }}>{pick.overProbability}%</div>
                      </div>
                      <div className="flex-1 text-right">
                        <div className="text-[10px] text-[oklch(0.50_0.015_255)]">Edge</div>
                        <div className="text-sm font-bold" style={{ color: pick.edge > 0 ? "oklch(0.72 0.18 165)" : "oklch(0.68 0.22 25)" }}>
                          {pick.edge > 0 ? "+" : ""}{pick.edge}%
                        </div>
                      </div>
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

                {/* Fair line info */}
                <div className="p-2.5 rounded-lg" style={{ background: "oklch(0.12 0.018 255)" }}>
                  <span className="text-[10px] font-semibold text-[oklch(0.45_0.015_255)]">LINE ANALYSIS</span>
                  <p className="text-[11px] text-[oklch(0.60_0.015_255)] mt-1 leading-relaxed">
                    Fair line (50/50): <strong className="text-white">O {pick.fairLine}</strong>.
                    Active line: <strong className="text-white">O {pick.hrrLine}</strong>.
                    {pick.hrrLine < pick.fairLine
                      ? " Line is below fair value — edge on the OVER."
                      : pick.hrrLine === pick.fairLine
                      ? " Line is at fair value — coin flip."
                      : " Line is above fair value — tighter margin."}
                    {" "}Expected total: <strong className="text-white">{pick.expectedTotal}</strong>.
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
  // Use the dedicated HRR endpoint with Poisson model + Odds API
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
    edge: pick.edge ?? 0,
    reasoning: pick.reasoning,
    ballparkReasoning: pick.ballparkReasoning,
    rcScore: pick.rcScore,
    combinedScore: pick.combinedScore,
    parkFactor: pick.parkFactor,
    savantMetrics: pick.savantMetrics,
    // New enriched fields
    overProbability: pick.overProbability ?? pick.hrrConfidence,
    pickQuality: pick.pickQuality ?? "lean",
    lineSource: pick.lineSource ?? "model",
    bookOdds: pick.bookOdds ?? null,
    bookImpliedProb: pick.bookImpliedProb ?? null,
    alternateLines: pick.alternateLines ?? [],
    fairLine: pick.fairLine ?? pick.hrrLine,
  }));

  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="animate-pulse rounded-2xl h-48" style={{ background: "oklch(0.14 0.022 255)" }} />
        ))}
      </div>
    );
  }

  const hasOddsData = (data as any)?.hasOddsData;

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
            Hits + Runs + RBI · Poisson probability model
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "oklch(0.20 0.03 255)", color: "oklch(0.72 0.18 165)" }}>
            {hrrPicks.length} picks
          </div>
          {hasOddsData && (
            <span className="text-[9px] font-medium" style={{ color: "oklch(0.55 0.15 200)" }}>
              Live odds data
            </span>
          )}
        </div>
      </div>

      {/* Explanation card */}
      <div className="p-3 rounded-xl border border-[oklch(1_0_0/6%)]" style={{ background: "oklch(0.12 0.018 255)" }}>
        <div className="flex items-start gap-2">
          <Activity size={14} className="mt-0.5 shrink-0" style={{ color: "oklch(0.72 0.18 165)" }} />
          <div>
            <span className="text-xs font-semibold text-white">How It Works</span>
            <p className="text-[10px] text-[oklch(0.55_0.015_255)] mt-0.5 leading-relaxed">
              We project each player's Hits + Runs + RBI using Statcast data, park factors, batting position, and pitcher matchup. 
              A <strong className="text-white">Poisson model</strong> calculates the true probability of going OVER each line. 
              When sportsbook odds are available, we compare to find <strong className="text-white">edges</strong> where our model disagrees with the market.
              Alternate lines show your options at different risk levels.
            </p>
          </div>
        </div>
      </div>

      <SaferPlayTip />

      {/* HRR Pick Cards */}
      <div className="space-y-3">
        {hrrPicks.map((pick, i) => (
          <HRRCard key={`${pick.playerName}-${i}`} pick={pick} rank={i + 1} />
        ))}
      </div>

      {/* Disclaimer */}
      <div className="text-center py-3">
        <p className="text-[10px] text-[oklch(0.35_0.015_255)] leading-relaxed">
          Probabilities from Poisson model using Statcast + Ballpark.com data.
          {hasOddsData ? " Live odds from major US sportsbooks." : " Sportsbook odds update when available."}
          {" "}Always bet responsibly.
        </p>
      </div>
    </div>
  );
}
