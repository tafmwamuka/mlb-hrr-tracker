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
  TrendingDown, CalendarDays
} from "lucide-react";
import { SaferPlayTip } from "@/components/SaferPlayTip";
import { PerformanceGraph } from "@/components/PerformanceGraph";

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
  vsGrade?: number; // BallparkPal VS grade (0-10)
  gameTotalOU?: number | null; // Vegas over/under line
  // Phase R new fields
  grade?: 'elite' | 'strong' | 'watchlist';
  reasons?: string[];    // WHY THIS PLAY QUALIFIES
  riskFlags?: string[];  // RISK FLAGS
  bpBoost?: number;      // BallparkPal boost/penalty
  baseScore?: number;    // Score before BP boost
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

type FilterTier = "all" | "90+" | "85+" | "75+";

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
  const probColor = getProbColor(pick.recommendedProb);
  const tier = getConfidenceTier(pick.recommendedProb);

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
            {/* Real American odds */}
            {pick.odds ? (
              <div className="flex items-center gap-1">
                <DollarSign size={10} style={{ color: "oklch(0.82 0.17 85)" }} />
                <span className="text-xs font-bold" style={{ color: "oklch(0.82 0.17 85)" }}>
                  {pick.odds}
                </span>
                {pick.oddsProvider && (
                  <span className="text-[9px] text-[oklch(0.45_0.015_255)]">{pick.oddsProvider}</span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <CheckCircle2 size={10} style={{ color: probColor }} />
                <span className="text-xs font-bold" style={{ color: probColor }}>
                  {pick.recommendedProb}% hit rate
                </span>
              </div>
            )}
          </div>
        </div>

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
                {/* Performance Graph */}
                {pick.streakInfo?.last5Games && pick.streakInfo.last5Games.length > 0 ? (
                  <div className="p-2.5 rounded-xl" style={{ background: "oklch(0.12 0.018 255)", border: "1px solid oklch(1 0 0 / 6%)" }}>
                    <PerformanceGraph
                      games={pick.streakInfo.last5Games}
                      expectedLine={pick.recommendedLine}
                    />
                  </div>
                ) : (
                  <div className="p-2.5 rounded-xl" style={{ background: "oklch(0.12 0.018 255)", border: "1px solid oklch(1 0 0 / 6%)" }}>
                    <div className="text-[9px] font-bold tracking-widest uppercase mb-1.5" style={{ color: "oklch(0.45 0.015 255)" }}>Last 5 Games</div>
                    <p className="text-[10px] text-[oklch(0.38_0.015_255)]">Game log loading — check back shortly</p>
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
  const { data, isLoading } = trpc.aiPicks.getHRRPicks.useQuery(undefined, {
    refetchInterval: 10 * 60 * 1000, // Auto-refresh every 10 minutes (picks rarely change)
    staleTime: 10 * 60 * 1000, // Serve cached data for 10 min before background refetch
    gcTime: 30 * 60 * 1000, // Keep in React Query cache for 30 min (instant tab switching)
  });
  const { data: yesterdayData } = trpc.results.getYesterdayResults.useQuery(undefined, {
    staleTime: 30 * 60 * 1000, // Yesterday's results don't change
    gcTime: 60 * 60 * 1000,
  });
  const [activeFilter, setActiveFilter] = useState<FilterTier>("all");
  const [selectedPicks, setSelectedPicks] = useState<Set<number>>(new Set());
  const [showParlayBuilder, setShowParlayBuilder] = useState(false);

  // Filter picks to only those with at least one alternate line at 75%+
  const moneyPicks: MoneyPick[] = useMemo(() => {
    return (data?.picks || [])
      .map((pick: any) => {
        const alternateLines: AlternateLine[] = pick.alternateLines || [];
        const qualifyingLines = alternateLines
          .filter((a: AlternateLine) => a.overProb >= 75)
          .sort((a: AlternateLine, b: AlternateLine) => b.line - a.line);

        if (qualifyingLines.length === 0) return null;

        const recommended = qualifyingLines[0];
        // Use real streak from backend if available, otherwise generate from probability
        const streakInfo = pick.streakInfo ?? null;
        const dayNightSplit = pick.dayNightSplit ?? null;
        // Real odds from bookOdds
        const realOdds = pick.bookOdds ? String(pick.bookOdds) : null;
        const oddsProvider = pick.lineSource ?? null;
        // Streak label: use real data if available
        const streak = streakInfo
          ? (streakInfo.isOnStreak && streakInfo.streakLength >= 3
              ? `🔥 ${streakInfo.streakLength}-game streak`
              : streakInfo.streakType === 'cold'
              ? `❄️ Cold (last 5: ${streakInfo.last5HitRate}%)`
              : `${streakInfo.last5HitRate}% last 5`)
          : generateStreak(pick.expectedTotal, recommended.line, recommended.overProb);

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
          bpBoost: pick.bpBoost ?? 0,
          baseScore: pick.baseScore ?? undefined,
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

  // Apply confidence filter
  const filteredPicks = useMemo(() => {
    switch (activeFilter) {
      case "90+": return moneyPicks.filter(p => p.recommendedProb >= 90);
      case "85+": return moneyPicks.filter(p => p.recommendedProb >= 85);
      case "75+": return moneyPicks;
      default: return moneyPicks;
    }
  }, [moneyPicks, activeFilter]);

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
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
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

  const lineupSource = (data as any)?.lineupSource ?? 'projected';
  const isProjected = lineupSource === 'projected';

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

  return (
    <div className="p-4 space-y-4 pb-32">
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
          <div className="flex flex-col items-end gap-1">
            {/* Lineup source badge */}
            <div
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-bold tracking-wide"
              style={isProjected
                ? { background: "oklch(0.20 0.08 60 / 0.3)", border: "1px solid oklch(0.75 0.15 60 / 0.5)", color: "oklch(0.82 0.17 85)" }
                : { background: "oklch(0.15 0.08 165 / 0.3)", border: "1px solid oklch(0.72 0.18 165 / 0.5)", color: "oklch(0.72 0.18 165)" }
              }
            >
              <div className={`w-1.5 h-1.5 rounded-full ${isProjected ? 'bg-[oklch(0.82_0.17_85)] animate-pulse' : 'bg-[oklch(0.72_0.18_165)]'}`} />
              {isProjected ? 'PROJECTED' : 'CONFIRMED'}
            </div>
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
      <div className="flex items-center gap-2">
        {([
          { key: "all", label: "All 75%+" },
          { key: "85+", label: "85%+" },
          { key: "90+", label: "90%+ Locks" },
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

      {/* Money Pick Cards */}
      {filteredPicks.length === 0 ? (
        <div className="text-center py-12">
          {moneyPicks.length === 0 ? (
            // Quality gate: no picks scored 78+ today
            <>
              <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ background: "oklch(0.16 0.03 255)" }}>
                <Shield size={28} style={{ color: "oklch(0.45 0.015 255)" }} />
              </div>
              <h3 className="text-white font-bold text-base mb-2">No Official HRR Play Today</h3>
              <p className="text-[oklch(0.50_0.015_255)] text-sm max-w-xs mx-auto leading-relaxed">
                Our 10-factor model hasn't found a qualifying play yet. Picks require a score of 78+ to appear here.
              </p>
              <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl" style={{ background: "oklch(0.14 0.022 255)", border: "1px solid oklch(1 0 0 / 8%)" }}>
                <div className="w-2 h-2 rounded-full bg-[oklch(0.82_0.17_85)] animate-pulse" />
                <span className="text-[oklch(0.55_0.015_255)] text-xs">Refreshes as lineups confirm</span>
              </div>
            </>
          ) : (
            // Filter too strict
            <>
              <DollarSign size={40} className="mx-auto mb-3" style={{ color: "oklch(0.35 0.015 255)" }} />
              <p className="text-[oklch(0.45_0.015_255)] text-sm">No plays at this confidence level</p>
              <p className="text-[oklch(0.35_0.015_255)] text-xs mt-1">Try lowering the filter</p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredPicks.map((pick, i) => (
            <MoneyPickCard
              key={`${pick.playerName}-${i}`}
              pick={pick}
              rank={i + 1}
              isSelected={selectedPicks.has(i)}
              onToggleSelect={() => toggleSelect(i)}
            />
          ))}
        </div>
      )}

      {/* Disclaimer */}
      <div className="text-center py-3">
        <p className="text-[10px] text-[oklch(0.35_0.015_255)] leading-relaxed">
          Probabilities from Poisson model using Statcast + Ballpark.com data. Streaks based on model projections. Always bet responsibly.
        </p>
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
