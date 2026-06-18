/**
 * PitcherEdgePicks — Hero board at the top of the Pitchers tab
 *
 * Displays Official Money Picks, Elite Safety, Best Value, Dual Edge,
 * and Stack Alert pitcher prop recommendations.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  ChevronDown,
  ChevronUp,
  Zap,
  Shield,
  TrendingUp,
  Star,
  Layers,
  AlertTriangle,
  RefreshCw,
  Target,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type PitcherPropTier =
  | "OFFICIAL"
  | "ELITE_SAFETY"
  | "BEST_VALUE"
  | "DUAL_EDGE"
  | "STACK_ALERT"
  | "QUALIFIED";

interface PitcherEdgePick {
  pitcherName: string;
  pitcherTeam: string;
  opponentTeam: string;
  pitcherHand: string;
  gameTime: string;
  propType: "strikeouts" | "walks";
  line: number;
  bookOdds: number;
  fairOdds: number;
  modelProbability: number;
  impliedProbability: number;
  edge: number;
  pitcherEdgeScore: number;
  tms: number;
  tier: PitcherPropTier;
  hasDisciplineEdge: boolean;
  isDualEdge: boolean;
  qualifyingReasons: string[];
  riskFlags: string[];
  disciplineGrade: string | null;
  opponentKRate: number | null;
  opponentBBRate: number | null;
  historicalHitRate: number | null;
  sampleSize: number;
}

// ── Tier config ───────────────────────────────────────────────────────────────

const TIER_CONFIG: Record<
  PitcherPropTier,
  {
    label: string;
    icon: React.ElementType;
    bg: string;
    border: string;
    badge: string;
    text: string;
    description: string;
  }
> = {
  OFFICIAL: {
    label: "💎 Official Pitcher Money Pick",
    icon: Star,
    bg: "bg-[oklch(0.18_0.05_280)]",
    border: "border-[oklch(0.55_0.25_280)]",
    badge: "bg-[oklch(0.55_0.25_280)] text-white",
    text: "text-[oklch(0.85_0.15_280)]",
    description: "Highest-confidence pitcher prop — all signals aligned",
  },
  ELITE_SAFETY: {
    label: "🛡 Elite Safety",
    icon: Shield,
    bg: "bg-[oklch(0.16_0.04_240)]",
    border: "border-[oklch(0.50_0.18_240)]",
    badge: "bg-[oklch(0.50_0.18_240)] text-white",
    text: "text-[oklch(0.80_0.12_240)]",
    description: "Very high probability, short odds — lower risk",
  },
  BEST_VALUE: {
    label: "💰 Best Value",
    icon: TrendingUp,
    bg: "bg-[oklch(0.16_0.05_150)]",
    border: "border-[oklch(0.55_0.20_150)]",
    badge: "bg-[oklch(0.55_0.20_150)] text-white",
    text: "text-[oklch(0.80_0.14_150)]",
    description: "Positive odds with strong market edge",
  },
  DUAL_EDGE: {
    label: "⚡ Dual Edge",
    icon: Zap,
    bg: "bg-[oklch(0.17_0.06_60)]",
    border: "border-[oklch(0.72_0.22_60)]",
    badge: "bg-[oklch(0.72_0.22_60)] text-black",
    text: "text-[oklch(0.82_0.18_60)]",
    description: "Both K and BB qualify for this pitcher",
  },
  STACK_ALERT: {
    label: "🔥 Stack Alert",
    icon: Layers,
    bg: "bg-[oklch(0.17_0.06_25)]",
    border: "border-[oklch(0.68_0.22_25)]",
    badge: "bg-[oklch(0.68_0.22_25)] text-white",
    text: "text-[oklch(0.82_0.16_25)]",
    description: "3+ pitchers qualify in this game",
  },
  QUALIFIED: {
    label: "✓ Qualified",
    icon: Target,
    bg: "bg-[oklch(0.15_0.02_255)]",
    border: "border-[oklch(0.35_0.05_255)]",
    badge: "bg-[oklch(0.35_0.05_255)] text-white",
    text: "text-[oklch(0.70_0.05_255)]",
    description: "Meets minimum thresholds",
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatOdds(odds: number): string {
  return odds >= 0 ? `+${odds}` : `${odds}`;
}

function gradeColor(grade: string | null): string {
  if (!grade) return "text-[oklch(0.55_0.015_255)]";
  if (grade === "A+" || grade === "A") return "text-[oklch(0.72_0.18_165)]";
  if (grade === "B") return "text-[oklch(0.82_0.17_85)]";
  if (grade === "C") return "text-[oklch(0.68_0.22_25)]";
  return "text-[oklch(0.60_0.20_0)]";
}

function tmsColor(tms: number): string {
  if (tms >= 75) return "text-[oklch(0.72_0.18_165)]";
  if (tms >= 60) return "text-[oklch(0.82_0.17_85)]";
  if (tms >= 45) return "text-[oklch(0.68_0.22_25)]";
  return "text-[oklch(0.60_0.20_0)]";
}

// ── Pick Card ─────────────────────────────────────────────────────────────────

function PitcherPickCard({ pick }: { pick: PitcherEdgePick }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = TIER_CONFIG[pick.tier];
  const Icon = cfg.icon;
  const propLabel = pick.propType === "strikeouts" ? "Strikeouts" : "Walks";
  const propAbbr = pick.propType === "strikeouts" ? "K" : "BB";

  return (
    <div
      className={`rounded-2xl border ${cfg.border} ${cfg.bg} overflow-hidden mb-3`}
    >
      {/* Header row */}
      <div className="px-4 pt-3 pb-2">
        {/* Tier badge */}
        <div className="flex items-center gap-2 mb-2">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cfg.badge}`}>
            {cfg.label}
          </span>
          {pick.hasDisciplineEdge && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[oklch(0.55_0.25_280)] text-white">
              💎 DISCIPLINE EDGE
            </span>
          )}
          {pick.isDualEdge && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[oklch(0.72_0.22_60)] text-black">
              ⚡ DUAL
            </span>
          )}
        </div>

        {/* Pitcher + matchup */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="text-white font-bold text-base leading-tight truncate">
              {pick.pitcherName}
            </div>
            <div className="text-[oklch(0.55_0.015_255)] text-xs mt-0.5">
              {pick.pitcherTeam} vs {pick.opponentTeam} · {pick.gameTime}
            </div>
          </div>

          {/* Prop box */}
          <div className="text-right shrink-0">
            <div className={`font-stat text-2xl font-extrabold leading-none ${cfg.text}`}>
              {pick.line} {propAbbr}
            </div>
            <div className="text-[oklch(0.55_0.015_255)] text-xs mt-0.5">
              {propLabel} Over
            </div>
          </div>
        </div>

        {/* Stat row */}
        <div className="flex items-center gap-3 mt-2.5 flex-wrap">
          <div className="flex flex-col items-center">
            <span className={`font-stat text-lg font-bold leading-none ${cfg.text}`}>
              {pick.modelProbability}%
            </span>
            <span className="text-[oklch(0.45_0.015_255)] text-[10px]">Model</span>
          </div>
          <div className="w-px h-6 bg-[oklch(1_0_0/10%)]" />
          <div className="flex flex-col items-center">
            <span className="font-stat text-lg font-bold leading-none text-[oklch(0.65_0.015_255)]">
              {pick.impliedProbability}%
            </span>
            <span className="text-[oklch(0.45_0.015_255)] text-[10px]">Book</span>
          </div>
          <div className="w-px h-6 bg-[oklch(1_0_0/10%)]" />
          <div className="flex flex-col items-center">
            <span className={`font-stat text-lg font-bold leading-none ${pick.edge >= 5 ? "text-[oklch(0.72_0.18_165)]" : "text-[oklch(0.82_0.17_85)]"}`}>
              +{pick.edge}%
            </span>
            <span className="text-[oklch(0.45_0.015_255)] text-[10px]">Edge</span>
          </div>
          <div className="w-px h-6 bg-[oklch(1_0_0/10%)]" />
          <div className="flex flex-col items-center">
            <span className="font-stat text-lg font-bold leading-none text-white">
              {formatOdds(pick.bookOdds)}
            </span>
            <span className="text-[oklch(0.45_0.015_255)] text-[10px]">Odds</span>
          </div>
          <div className="w-px h-6 bg-[oklch(1_0_0/10%)]" />
          <div className="flex flex-col items-center">
            <span className="font-stat text-lg font-bold leading-none text-[oklch(0.65_0.015_255)]">
              {formatOdds(pick.fairOdds)}
            </span>
            <span className="text-[oklch(0.45_0.015_255)] text-[10px]">Fair</span>
          </div>
        </div>

        {/* TMS + Discipline Grade row */}
        <div className="flex items-center gap-3 mt-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[oklch(0.45_0.015_255)] text-xs">TMS</span>
            <span className={`font-stat font-bold text-sm ${tmsColor(pick.tms)}`}>
              {pick.tms}
            </span>
          </div>
          {pick.disciplineGrade && (
            <>
              <span className="text-[oklch(0.30_0.015_255)]">·</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[oklch(0.45_0.015_255)] text-xs">Opp Grade</span>
                <span className={`font-stat font-bold text-sm ${gradeColor(pick.disciplineGrade)}`}>
                  {pick.disciplineGrade}
                </span>
              </div>
            </>
          )}
          {pick.pitcherEdgeScore >= 70 && (
            <>
              <span className="text-[oklch(0.30_0.015_255)]">·</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[oklch(0.45_0.015_255)] text-xs">Edge Score</span>
                <span className="font-stat font-bold text-sm text-[oklch(0.72_0.18_165)]">
                  {pick.pitcherEdgeScore}
                </span>
              </div>
            </>
          )}
          {pick.historicalHitRate !== null && pick.sampleSize >= 5 && (
            <>
              <span className="text-[oklch(0.30_0.015_255)]">·</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[oklch(0.45_0.015_255)] text-xs">Historical</span>
                <span className="font-stat font-bold text-sm text-[oklch(0.82_0.17_85)]">
                  {pick.historicalHitRate}%
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Expand toggle */}
      <button
        className="w-full flex items-center justify-between px-4 py-2 border-t border-[oklch(1_0_0/8%)] text-[oklch(0.55_0.015_255)] text-xs hover:bg-[oklch(1_0_0/4%)] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="flex items-center gap-1.5">
          <Icon size={12} />
          {expanded ? "Hide analysis" : "View analysis"}
        </span>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {/* Expanded analysis */}
      {expanded && (
        <div className="px-4 pb-4 pt-2 border-t border-[oklch(1_0_0/6%)] space-y-3">
          {/* Why this pick */}
          {pick.qualifyingReasons.length > 0 && (
            <div>
              <div className="text-[oklch(0.55_0.015_255)] text-[10px] uppercase tracking-wider mb-1.5">
                Why this pick
              </div>
              <div className="space-y-1">
                {pick.qualifyingReasons.map((reason, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-[oklch(0.72_0.015_255)]">
                    <span className={`mt-0.5 shrink-0 ${cfg.text}`}>✓</span>
                    <span>{reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Opponent stats */}
          {(pick.opponentKRate !== null || pick.opponentBBRate !== null) && (
            <div>
              <div className="text-[oklch(0.55_0.015_255)] text-[10px] uppercase tracking-wider mb-1.5">
                Opponent discipline
              </div>
              <div className="flex gap-4">
                {pick.opponentKRate !== null && (
                  <div className="flex flex-col">
                    <span className="font-stat font-bold text-base text-[oklch(0.82_0.17_85)]">
                      {pick.opponentKRate}%
                    </span>
                    <span className="text-[oklch(0.45_0.015_255)] text-[10px]">K Rate</span>
                  </div>
                )}
                {pick.opponentBBRate !== null && (
                  <div className="flex flex-col">
                    <span className="font-stat font-bold text-base text-[oklch(0.68_0.22_25)]">
                      {pick.opponentBBRate}%
                    </span>
                    <span className="text-[oklch(0.45_0.015_255)] text-[10px]">BB Rate</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Risk flags */}
          {pick.riskFlags.length > 0 && (
            <div>
              <div className="text-[oklch(0.55_0.015_255)] text-[10px] uppercase tracking-wider mb-1.5">
                Risk flags
              </div>
              <div className="space-y-1">
                {pick.riskFlags.map((flag, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-[oklch(0.68_0.22_25)]">
                    <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                    <span>{flag}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Disclaimer */}
          <p className="text-[oklch(0.40_0.015_255)] text-[10px] leading-relaxed border-t border-[oklch(1_0_0/6%)] pt-2">
            For informational purposes only. Not financial or betting advice. Always bet responsibly.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function PitcherEdgePicks() {
  const { data, isLoading, refetch, isFetching } = trpc.discipline.getPitcherEdgePicks.useQuery(
    undefined,
    { staleTime: 10 * 60 * 1000 }
  );

  const picks = data?.picks ?? [];
  const dualEdgePitchers = data?.dualEdgePitchers ?? [];
  const stackAlertGames = data?.stackAlertGames ?? [];

  // Group picks by tier
  const official = picks.filter(p => p.tier === "OFFICIAL");
  const eliteSafety = picks.filter(p => p.tier === "ELITE_SAFETY");
  const bestValue = picks.filter(p => p.tier === "BEST_VALUE");
  const dualEdge = picks.filter(p => p.tier === "DUAL_EDGE");
  const stackAlert = picks.filter(p => p.tier === "STACK_ALERT");
  const qualified = picks.filter(p => p.tier === "QUALIFIED");

  if (isLoading) {
    return (
      <div className="px-4 py-6">
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-36 rounded-2xl bg-[oklch(0.16_0.025_255)]" />
          ))}
        </div>
      </div>
    );
  }

  if (picks.length === 0) {
    return (
      <div className="px-4 py-8 text-center">
        <div className="text-4xl mb-3">⚾</div>
        <div className="text-white font-semibold text-base mb-1">No Pitcher Edge Picks Today</div>
        <p className="text-[oklch(0.50_0.015_255)] text-sm leading-relaxed max-w-xs mx-auto">
          No pitcher props currently meet the minimum thresholds. This may be because sportsbook lines
          are not yet posted, or today's matchups don't have qualifying edges.
        </p>
        <button
          className="mt-4 flex items-center gap-2 mx-auto text-[oklch(0.55_0.25_280)] text-sm font-medium"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 pb-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 pt-1">
        <div>
          <div className="text-white font-bold text-base">Pitcher Edge Lab</div>
          <div className="text-[oklch(0.50_0.015_255)] text-xs">
            {picks.length} qualifying prop{picks.length !== 1 ? "s" : ""}
            {dualEdgePitchers.length > 0 && ` · ${dualEdgePitchers.length} dual-edge`}
            {stackAlertGames.length > 0 && ` · ${stackAlertGames.length} stack alert`}
          </div>
        </div>
        <button
          className="flex items-center gap-1.5 text-[oklch(0.55_0.25_280)] text-xs font-medium"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Official Money Picks */}
      {official.length > 0 && (
        <div className="mb-4">
          <div className="text-[oklch(0.55_0.015_255)] text-[10px] uppercase tracking-wider mb-2">
            Official Pitcher Money Picks
          </div>
          {official.map((pick, i) => (
            <PitcherPickCard key={`official-${i}`} pick={pick} />
          ))}
        </div>
      )}

      {/* Elite Safety */}
      {eliteSafety.length > 0 && (
        <div className="mb-4">
          <div className="text-[oklch(0.55_0.015_255)] text-[10px] uppercase tracking-wider mb-2">
            Elite Safety Plays
          </div>
          {eliteSafety.map((pick, i) => (
            <PitcherPickCard key={`elite-${i}`} pick={pick} />
          ))}
        </div>
      )}

      {/* Dual Edge */}
      {dualEdge.length > 0 && (
        <div className="mb-4">
          <div className="text-[oklch(0.55_0.015_255)] text-[10px] uppercase tracking-wider mb-2">
            Dual Edge Pitchers
          </div>
          {dualEdge.map((pick, i) => (
            <PitcherPickCard key={`dual-${i}`} pick={pick} />
          ))}
        </div>
      )}

      {/* Best Value */}
      {bestValue.length > 0 && (
        <div className="mb-4">
          <div className="text-[oklch(0.55_0.015_255)] text-[10px] uppercase tracking-wider mb-2">
            Best Value Plays
          </div>
          {bestValue.map((pick, i) => (
            <PitcherPickCard key={`value-${i}`} pick={pick} />
          ))}
        </div>
      )}

      {/* Stack Alert */}
      {stackAlert.length > 0 && (
        <div className="mb-4">
          <div className="text-[oklch(0.55_0.015_255)] text-[10px] uppercase tracking-wider mb-2">
            Stack Alert Games
          </div>
          {stackAlert.map((pick, i) => (
            <PitcherPickCard key={`stack-${i}`} pick={pick} />
          ))}
        </div>
      )}

      {/* Qualified (collapsed by default, show toggle) */}
      {qualified.length > 0 && (
        <QualifiedSection picks={qualified} />
      )}

      {/* Generated at */}
      {data?.generatedAt && (
        <p className="text-center text-[oklch(0.35_0.015_255)] text-[10px] mt-2">
          Generated {new Date(data.generatedAt).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}

function QualifiedSection({ picks }: { picks: PitcherEdgePick[] }) {
  const [show, setShow] = useState(false);
  return (
    <div className="mb-4">
      <button
        className="w-full flex items-center justify-between text-[oklch(0.50_0.015_255)] text-[10px] uppercase tracking-wider mb-2"
        onClick={() => setShow(!show)}
      >
        <span>Other Qualifying Plays ({picks.length})</span>
        {show ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {show && picks.map((pick, i) => (
        <PitcherPickCard key={`qual-${i}`} pick={pick} />
      ))}
    </div>
  );
}
