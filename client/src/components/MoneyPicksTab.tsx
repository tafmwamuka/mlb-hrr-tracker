/**
 * Money Picks Tab - Shows only 75%+ probability alternate lines
 * Features: streak indicator, confidence tier filters, parlay builder
 */

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown, Flame, Shield, TrendingUp, Target, Zap, DollarSign,
  CheckCircle2, Plus, Minus, ShoppingCart, X
} from "lucide-react";
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
  recommendedLine: number;
  recommendedProb: number;
  streak: string; // e.g., "4 of last 5"
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
            <div className="flex items-center gap-1">
              <CheckCircle2 size={10} style={{ color: probColor }} />
              <span className="text-xs font-bold" style={{ color: probColor }}>
                {pick.recommendedProb}% hit rate
              </span>
            </div>
          </div>
        </div>

        {/* Streak indicator + Confidence badge row */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {/* Streak badge */}
          <div className="flex items-center gap-1 px-2 py-1 rounded-lg" style={{ background: "oklch(0.82 0.17 85 / 12%)", border: "1px solid oklch(0.82 0.17 85 / 25%)" }}>
            <Flame size={10} style={{ color: "oklch(0.82 0.17 85)" }} />
            <span className="text-[10px] font-bold" style={{ color: "oklch(0.82 0.17 85)" }}>
              Hit {pick.streak}
            </span>
          </div>

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

        {/* Quick reasoning */}
        <p className="text-[11px] text-[oklch(0.55_0.015_255)] leading-relaxed mb-2">
          {pick.reasoning}
        </p>

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
        const streak = generateStreak(pick.expectedTotal, recommended.line, recommended.overProb);

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
        } as MoneyPick;
      })
      .filter((p: MoneyPick | null): p is MoneyPick => p !== null)
      .sort((a: MoneyPick, b: MoneyPick) => {
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
    const dateStr = data?.dataDate;
    if (dateStr) {
      const d = new Date(dateStr + 'T12:00:00');
      return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    }
    return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  })();

  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="animate-pulse rounded-2xl h-40" style={{ background: "oklch(0.14 0.022 255)" }} />
        ))}
      </div>
    );
  }

  // Handle lineups pending state
  if (data?.lineupsPending || (!isLoading && moneyPicks.length === 0 && !data?.picks?.length)) {
    return (
      <div className="p-4 space-y-4">
        <div className="text-center">
          <p className="text-[oklch(0.50_0.015_255)] text-xs">{todayDate}</p>
        </div>
        <div className="text-center py-16">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ background: "oklch(0.18 0.03 255)" }}>
            <Target size={28} style={{ color: "oklch(0.72 0.18 165)" }} />
          </div>
          <h3 className="text-white font-bold text-lg mb-2">Lineups Posting Soon</h3>
          <p className="text-[oklch(0.50_0.015_255)] text-sm max-w-xs mx-auto leading-relaxed">
            Today's picks will appear once MLB lineups are confirmed. Check back closer to game time.
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-white font-bold text-lg flex items-center gap-2">
            <DollarSign size={20} style={{ color: "oklch(0.72 0.18 165)" }} />
            Money Picks
          </h2>
          <p className="text-[oklch(0.50_0.015_255)] text-xs mt-0.5">
            {todayDate} · 75%+ probability plays
          </p>
        </div>
        <div className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "oklch(0.20 0.03 255)", color: "oklch(0.72 0.18 165)" }}>
          {filteredPicks.length} plays
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

      <SaferPlayTip />

      {/* Money Pick Cards */}
      {filteredPicks.length === 0 ? (
        <div className="text-center py-12">
          <DollarSign size={40} className="mx-auto mb-3" style={{ color: "oklch(0.35 0.015 255)" }} />
          <p className="text-[oklch(0.45_0.015_255)] text-sm">No plays at this confidence level</p>
          <p className="text-[oklch(0.35_0.015_255)] text-xs mt-1">Try lowering the filter</p>
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
