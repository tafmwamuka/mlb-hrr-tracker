/**
 * PitcherEdgePicks — Hero board at the top of the Pitchers tab
 *
 * 4-tier display:
 *   Section 1: 🏆 Elite Plays
 *   Section 2: 🔥 Official Pitcher Plays
 *   Section 3: 🛡 Qualified Leans (not in official results)
 *   Section 4: 🧪 Projection Board (research only, collapsed)
 *
 * No-empty-board rule: if no Elite/Official plays, auto-shows best Qualified Leans.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  ChevronDown,
  ChevronUp,
  Zap,
  Shield,
  Layers,
  AlertTriangle,
  RefreshCw,
  FlaskConical,
  Trophy,
  Flame,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type PitcherPropTier =
  | "ELITE"
  | "OFFICIAL"
  | "LEAN"
  | "PROJECTION"
  | "DUAL_EDGE"
  | "STACK_ALERT";

interface RejectedPlay {
  pitcherName: string;
  pitcherTeam: string;
  opponentTeam: string;
  propType: "strikeouts" | "walks";
  line: number;
  modelProbability: number;   // as %
  requiredThreshold: number;  // as %
  rejectionReasons: string[];
  rejectionSummary: string;
  supportingFactors: number;  // count of supporting factors
  requiredFactors: number;
  hasMarketData: boolean;
  edge: number | null;
}

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
  isOfficialPlay: boolean;
  isLeanPlay: boolean;
  isProjectionOnly: boolean;
  hasMarketData: boolean;
  // Pricing penalty
  pricingPenaltyTier?: string;
  pricingPenaltyLabel?: string;
  isUltraJuiced?: boolean;
  adjustedEdgeScore?: number;
  // Actionability
  actionabilityScore?: number;
  playCategory?: PlayCategory;
}

type PlayCategory =
  | 'OFFICIAL_PLAY'
  | 'VALUE_PLAY'
  | 'SINGLE_BET'
  | 'PARLAY_LEG'
  | 'RESEARCH_ONLY';

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
  ELITE: {
    label: "🏆 ELITE PLAY",
    icon: Trophy,
    bg: "bg-[oklch(0.18_0.06_60)]",
    border: "border-[oklch(0.72_0.22_60)]",
    badge: "bg-[oklch(0.72_0.22_60)] text-black",
    text: "text-[oklch(0.90_0.20_60)]",
    description: "Highest-confidence — all signals aligned, 5+ factors",
  },
  OFFICIAL: {
    label: "🔥 OFFICIAL PLAY",
    icon: Flame,
    bg: "bg-[oklch(0.18_0.05_280)]",
    border: "border-[oklch(0.55_0.25_280)]",
    badge: "bg-[oklch(0.55_0.25_280)] text-white",
    text: "text-[oklch(0.85_0.15_280)]",
    description: "Primary recommendation — tracked in Results & ROI",
  },
  LEAN: {
    label: "🛡 QUALIFIED LEAN",
    icon: Shield,
    bg: "bg-[oklch(0.16_0.04_240)]",
    border: "border-[oklch(0.45_0.14_240)]",
    badge: "bg-[oklch(0.45_0.14_240)] text-white",
    text: "text-[oklch(0.78_0.10_240)]",
    description: "Meets lean threshold — NOT in official results",
  },
  PROJECTION: {
    label: "🧪 PROJECTION ONLY",
    icon: FlaskConical,
    bg: "bg-[oklch(0.14_0.02_255)]",
    border: "border-[oklch(0.30_0.04_255)]",
    badge: "bg-[oklch(0.30_0.04_255)] text-white",
    text: "text-[oklch(0.60_0.04_255)]",
    description: "Research only — not a recommendation",
  },
  DUAL_EDGE: {
    label: "⚡ DUAL EDGE",
    icon: Zap,
    bg: "bg-[oklch(0.17_0.06_60)]",
    border: "border-[oklch(0.72_0.22_60)]",
    badge: "bg-[oklch(0.72_0.22_60)] text-black",
    text: "text-[oklch(0.82_0.18_60)]",
    description: "Both K and BB qualify for this pitcher",
  },
  STACK_ALERT: {
    label: "🔥 STACK ALERT",
    icon: Layers,
    bg: "bg-[oklch(0.17_0.06_25)]",
    border: "border-[oklch(0.68_0.22_25)]",
    badge: "bg-[oklch(0.68_0.22_25)] text-white",
    text: "text-[oklch(0.82_0.16_25)]",
    description: "3+ pitchers qualify in this game",
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
  const propLabel = pick.propType === "strikeouts" ? "Strikeouts" : "Walks";
  const propAbbr = pick.propType === "strikeouts" ? "K" : "BB";

  return (
    <div className={`rounded-2xl border ${cfg.border} ${cfg.bg} overflow-hidden mb-3`}>
      {/* Header row */}
      <div className="px-4 pt-3 pb-2">
        {/* Tier badge row */}
        <div className="flex items-center gap-2 mb-2 flex-wrap">
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
          {pick.isLeanPlay && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[oklch(0.25_0.03_240)] text-[oklch(0.65_0.10_240)]">
              Not in official results
            </span>
          )}
          {pick.isProjectionOnly && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[oklch(0.20_0.02_255)] text-[oklch(0.50_0.04_255)]">
              {pick.hasMarketData ? "Research only" : "Awaiting Market Data"}
            </span>
          )}
          {/* Pricing penalty badge */}
          {pick.pricingPenaltyTier && pick.pricingPenaltyTier !== 'NONE' && (
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded-full border"
              style={{
                // ULTRA_JUICED (worse than -600): red — Research Only
                // SMALL (-401 to -600): yellow — Acceptable Juiced
                background: pick.pricingPenaltyTier === 'ULTRA_JUICED' || pick.pricingPenaltyTier === 'HEAVY' || pick.pricingPenaltyTier === 'MODERATE'
                  ? 'oklch(0.68 0.22 25 / 15%)'
                  : 'oklch(0.82 0.17 85 / 12%)',
                color: pick.pricingPenaltyTier === 'ULTRA_JUICED' || pick.pricingPenaltyTier === 'HEAVY' || pick.pricingPenaltyTier === 'MODERATE'
                  ? 'oklch(0.68 0.22 25)'
                  : 'oklch(0.82 0.17 85)',
                borderColor: pick.pricingPenaltyTier === 'ULTRA_JUICED' || pick.pricingPenaltyTier === 'HEAVY' || pick.pricingPenaltyTier === 'MODERATE'
                  ? 'oklch(0.68 0.22 25 / 30%)'
                  : 'oklch(0.82 0.17 85 / 25%)',
              }}
            >
              {pick.pricingPenaltyLabel}
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
              {pick.line}+ {propAbbr}
            </div>
            <div className="text-[oklch(0.55_0.015_255)] text-xs mt-0.5">
              {propLabel} Over
            </div>
          </div>
        </div>

        {/* Key stats row */}
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          {/* Model probability */}
          <div className="flex flex-col items-center">
            <span className={`font-stat text-lg font-bold leading-none ${cfg.text}`}>
              {pick.modelProbability.toFixed(1)}%
            </span>
            <span className="text-[oklch(0.45_0.015_255)] text-[9px] mt-0.5">Model</span>
          </div>

          <div className="w-px h-8 bg-[oklch(1_0_0/10%)]" />

          {/* Book odds */}
          <div className="flex flex-col items-center">
            <span className="font-stat text-lg font-bold leading-none text-white">
              {pick.bookOdds !== 0 ? formatOdds(pick.bookOdds) : "—"}
            </span>
            <span className="text-[oklch(0.45_0.015_255)] text-[9px] mt-0.5">Book</span>
          </div>

          <div className="w-px h-8 bg-[oklch(1_0_0/10%)]" />

          {/* Fair odds */}
          <div className="flex flex-col items-center">
            <span className="font-stat text-lg font-bold leading-none text-[oklch(0.65_0.015_255)]">
              {formatOdds(pick.fairOdds)}
            </span>
            <span className="text-[oklch(0.45_0.015_255)] text-[9px] mt-0.5">Fair</span>
          </div>

          <div className="w-px h-8 bg-[oklch(1_0_0/10%)]" />

          {/* Edge */}
          <div className="flex flex-col items-center">
            <span className={`font-stat text-lg font-bold leading-none ${pick.edge > 0 ? "text-[oklch(0.72_0.18_165)]" : "text-[oklch(0.60_0.20_0)]"}`}>
              {pick.edge > 0 ? "+" : ""}{pick.edge.toFixed(1)}%
            </span>
            <span className="text-[oklch(0.45_0.015_255)] text-[9px] mt-0.5">Edge</span>
          </div>

          <div className="w-px h-8 bg-[oklch(1_0_0/10%)]" />

          {/* TMS */}
          <div className="flex flex-col items-center">
            <span className={`font-stat text-lg font-bold leading-none ${tmsColor(pick.tms)}`}>
              {pick.tms}
            </span>
            <span className="text-[oklch(0.45_0.015_255)] text-[9px] mt-0.5">TMS</span>
          </div>

          {pick.disciplineGrade && (
            <>
              <div className="w-px h-8 bg-[oklch(1_0_0/10%)]" />
              <div className="flex flex-col items-center">
                <span className={`font-stat text-lg font-bold leading-none ${gradeColor(pick.disciplineGrade)}`}>
                  {pick.disciplineGrade}
                </span>
                <span className="text-[oklch(0.45_0.015_255)] text-[9px] mt-0.5">Grade</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Expand toggle */}
      <button
        className="w-full flex items-center justify-center gap-1 py-2 border-t border-[oklch(1_0_0/8%)] text-[oklch(0.50_0.015_255)] text-xs"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {expanded ? "Less" : "Details"}
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-[oklch(1_0_0/8%)] pt-3">
          {/* Qualifying reasons */}
          {pick.qualifyingReasons.length > 0 && (
            <div>
              <div className="text-[oklch(0.50_0.015_255)] text-[10px] uppercase tracking-wider mb-1.5">
                Why This Play
              </div>
              <div className="space-y-1">
                {pick.qualifyingReasons.map((reason, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-[oklch(0.75_0.015_255)]">
                    <span className="text-[oklch(0.72_0.18_165)] mt-0.5">✓</span>
                    <span>{reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Opponent stats */}
          {(pick.opponentKRate !== null || pick.opponentBBRate !== null) && (
            <div>
              <div className="text-[oklch(0.50_0.015_255)] text-[10px] uppercase tracking-wider mb-1.5">
                Opponent Profile
              </div>
              <div className="flex gap-4">
                {pick.opponentKRate !== null && (
                  <div>
                    <span className="text-[oklch(0.55_0.015_255)] text-xs">K Rate: </span>
                    <span className="text-white text-xs font-semibold">{pick.opponentKRate.toFixed(1)}%</span>
                  </div>
                )}
                {pick.opponentBBRate !== null && (
                  <div>
                    <span className="text-[oklch(0.55_0.015_255)] text-xs">BB Rate: </span>
                    <span className="text-white text-xs font-semibold">{pick.opponentBBRate.toFixed(1)}%</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Historical */}
          {pick.historicalHitRate !== null && pick.sampleSize >= 5 && (
            <div className="flex items-center gap-2">
              <span className="text-[oklch(0.55_0.015_255)] text-xs">Historical Hit Rate:</span>
              <span className="text-white text-xs font-semibold">{pick.historicalHitRate.toFixed(0)}%</span>
              <span className="text-[oklch(0.40_0.015_255)] text-xs">({pick.sampleSize} games)</span>
            </div>
          )}

          {/* Risk flags */}
          {pick.riskFlags.length > 0 && (
            <div>
              <div className="text-[oklch(0.50_0.015_255)] text-[10px] uppercase tracking-wider mb-1.5">
                Risk Flags
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

// ── Collapsible section ───────────────────────────────────────────────────────

function CollapsibleSection({
  title,
  subtitle,
  picks,
  defaultOpen = false,
  idPrefix,
}: {
  title: string;
  subtitle?: string;
  picks: PitcherEdgePick[];
  defaultOpen?: boolean;
  idPrefix: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (picks.length === 0) return null;

  return (
    <div className="mb-4">
      <button
        className="w-full flex items-center justify-between mb-2"
        onClick={() => setOpen(!open)}
      >
        <div>
          <span className="text-[oklch(0.55_0.015_255)] text-[10px] uppercase tracking-wider">
            {title}
          </span>
          {subtitle && (
            <span className="text-[oklch(0.40_0.015_255)] text-[10px] ml-2">{subtitle}</span>
          )}
        </div>
        <div className="flex items-center gap-1 text-[oklch(0.45_0.015_255)]">
          <span className="text-[10px]">{picks.length}</span>
          {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </div>
      </button>
      {open && picks.map((pick, i) => (
        <PitcherPickCard key={`${idPrefix}-${i}`} pick={pick} />
      ))}
    </div>
  );
}

// ── Filter config ─────────────────────────────────────────────────────────────

type FilterKey = 'official' | 'value' | 'single' | 'parlay' | 'research' | 'all';

const FILTER_CONFIG: Record<FilterKey, { label: string; categories: PlayCategory[] | 'all' }> = {
  official:  { label: '🔥 Official',     categories: ['OFFICIAL_PLAY'] },
  value:     { label: '💎 Value',         categories: ['VALUE_PLAY'] },
  single:    { label: '🎯 Single Bets',   categories: ['SINGLE_BET'] },
  parlay:    { label: '🔗 Parlay Plays',  categories: ['PARLAY_LEG'] },
  research:  { label: '🧪 Research',      categories: ['RESEARCH_ONLY'] },
  all:       { label: 'All',              categories: 'all' },
};

// Default active filters: Official + Value + Single Bets + Parlay
const DEFAULT_ACTIVE_FILTERS: FilterKey[] = ['official', 'value', 'single', 'parlay'];

// ── Main component ────────────────────────────────────────────────────────────

export function PitcherEdgePicks() {
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showResearchArchive, setShowResearchArchive] = useState(false);
  const [activeFilters, setActiveFilters] = useState<FilterKey[]>(DEFAULT_ACTIVE_FILTERS);

  const { data, isLoading, refetch, isFetching } = trpc.discipline.getPitcherEdgePicks.useQuery(
    undefined,
    { staleTime: 10 * 60 * 1000 }
  );

  const picks = data?.picks ?? [];
  const rejectedPlays: RejectedPlay[] = (data as any)?.rejectedPlays ?? [];
  const dualEdgePitchers = data?.dualEdgePitchers ?? [];
  const stackAlertGames = data?.stackAlertGames ?? [];

  // Sort all picks by actionabilityScore descending (falls back to pitcherEdgeScore)
  const sortedPicks = [...picks].sort((a, b) =>
    ((b.actionabilityScore ?? b.pitcherEdgeScore) - (a.actionabilityScore ?? a.pitcherEdgeScore))
  );

  // Separate research-only picks
  const mainPicks = sortedPicks.filter(p =>
    p.playCategory !== 'RESEARCH_ONLY' && !p.isProjectionOnly && !p.isUltraJuiced
  );
  const researchPicks = sortedPicks.filter(p =>
    p.playCategory === 'RESEARCH_ONLY' || p.isProjectionOnly || p.isUltraJuiced
  );

  // Determine which categories are active for filtering
  const isAllActive = activeFilters.includes('all');
  const isResearchActive = activeFilters.includes('research');

  // Filtered main picks based on active filters
  const filteredMainPicks = isAllActive
    ? mainPicks
    : mainPicks.filter(p => {
        const cat = p.playCategory ?? 'RESEARCH_ONLY';
        return activeFilters.some(f => {
          const cfg = FILTER_CONFIG[f];
          return cfg.categories !== 'all' && cfg.categories.includes(cat as PlayCategory);
        });
      });

  // Group filtered picks by category for section display
  const officialFiltered = filteredMainPicks.filter(p => p.playCategory === 'OFFICIAL_PLAY');
  const valueFiltered = filteredMainPicks.filter(p => p.playCategory === 'VALUE_PLAY');
  const singleFiltered = filteredMainPicks.filter(p => p.playCategory === 'SINGLE_BET');
  const parlayFiltered = filteredMainPicks.filter(p => p.playCategory === 'PARLAY_LEG');

  // Toggle a filter button (multi-select, except 'all' is exclusive)
  function toggleFilter(key: FilterKey) {
    if (key === 'all') {
      setActiveFilters(['all']);
      return;
    }
    setActiveFilters(prev => {
      const withoutAll = prev.filter(f => f !== 'all');
      if (withoutAll.includes(key)) {
        const next = withoutAll.filter(f => f !== key);
        return next.length === 0 ? DEFAULT_ACTIVE_FILTERS : next;
      }
      return [...withoutAll, key];
    });
  }

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
            {mainPicks.length} actionable play{mainPicks.length !== 1 ? "s" : ""}
            {dualEdgePitchers.length > 0 && ` · ${dualEdgePitchers.length} dual-edge`}
            {stackAlertGames.length > 0 && ` · ${stackAlertGames.length} stack alert`}
            {researchPicks.length > 0 && ` · ${researchPicks.length} in archive`}
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

      {/* ── Filter Bar ────────────────────────────────────────────────────────── */}
      <div className="flex gap-1.5 flex-wrap mb-4">
        {(Object.keys(FILTER_CONFIG) as FilterKey[]).map(key => {
          const isActive = activeFilters.includes(key) || (key === 'all' && activeFilters.includes('all'));
          // Count picks for this filter
          const cfg = FILTER_CONFIG[key];
          let count = 0;
          if (key === 'all') count = mainPicks.length;
          else if (key === 'research') count = researchPicks.length;
          else if (cfg.categories !== 'all') {
            count = mainPicks.filter(p => cfg.categories.includes(p.playCategory as PlayCategory)).length;
          }
          return (
            <button
              key={key}
              onClick={() => toggleFilter(key)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all ${
                isActive
                  ? 'bg-[oklch(0.55_0.25_280)] border-[oklch(0.55_0.25_280)] text-white'
                  : 'bg-transparent border-[oklch(1_0_0/12%)] text-[oklch(0.55_0.015_255)] hover:border-[oklch(1_0_0/25%)]'
              }`}
            >
              {cfg.label}
              {count > 0 && (
                <span className={`text-[10px] font-bold ${isActive ? 'text-white/80' : 'text-[oklch(0.45_0.015_255)]'}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Main Board: sorted by Actionability Score ─────────────────────────── */}
      {filteredMainPicks.length === 0 && !isResearchActive && (
        <div className="py-6 text-center">
          <div className="text-[oklch(0.45_0.015_255)] text-sm">
            No plays match the selected filters.
          </div>
          <button
            className="mt-2 text-[oklch(0.55_0.25_280)] text-xs font-medium"
            onClick={() => setActiveFilters(DEFAULT_ACTIVE_FILTERS)}
          >
            Reset filters
          </button>
        </div>
      )}

      {/* Official Plays section */}
      {officialFiltered.length > 0 && (
        <div className="mb-4">
          <div className="text-[oklch(0.55_0.015_255)] text-[10px] uppercase tracking-wider mb-2">
            🔥 Official Plays
            <span className="ml-2 text-[oklch(0.40_0.015_255)] normal-case">Tracked in Results & ROI</span>
          </div>
          {officialFiltered.map((pick, i) => (
            <PitcherPickCard key={`official-${i}`} pick={pick} />
          ))}
        </div>
      )}

      {/* Value Plays section */}
      {valueFiltered.length > 0 && (
        <div className="mb-4">
          <div className="text-[oklch(0.55_0.015_255)] text-[10px] uppercase tracking-wider mb-2">
            💎 Value Plays
            <span className="ml-2 text-[oklch(0.40_0.015_255)] normal-case">Positive EV · Live odds</span>
          </div>
          {valueFiltered.map((pick, i) => (
            <PitcherPickCard key={`value-${i}`} pick={pick} />
          ))}
        </div>
      )}

      {/* Best Single Bets section */}
      {singleFiltered.length > 0 && (
        <div className="mb-4">
          <div className="text-[oklch(0.55_0.015_255)] text-[10px] uppercase tracking-wider mb-2">
            🎯 Best Single Bets
            <span className="ml-2 text-[oklch(0.40_0.015_255)] normal-case">Near-even money · +110 to -150</span>
          </div>
          {singleFiltered.map((pick, i) => (
            <PitcherPickCard key={`single-${i}`} pick={pick} />
          ))}
        </div>
      )}

      {/* Parlay Plays section */}
      {parlayFiltered.length > 0 && (
        <div className="mb-4">
          <div className="text-[oklch(0.55_0.015_255)] text-[10px] uppercase tracking-wider mb-2">
            🔗 Parlay Plays
            <span className="ml-2 text-[oklch(0.40_0.015_255)] normal-case">-150 to -400 · Positive EV</span>
          </div>
          {parlayFiltered.map((pick, i) => (
            <PitcherPickCard key={`parlay-${i}`} pick={pick} />
          ))}
        </div>
      )}

      {/* ── Research Archive (collapsed by default) ───────────────────────────── */}
      {(researchPicks.length > 0 || isResearchActive) && (
        <div className="mt-2 mb-4">
          <button
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-[oklch(0.14_0.02_255)] border border-[oklch(1_0_0/8%)] text-left"
            onClick={() => setShowResearchArchive(v => !v)}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm">🧪</span>
              <div>
                <span className="text-[oklch(0.55_0.015_255)] text-xs font-semibold">Research Archive</span>
                <span className="text-[oklch(0.38_0.015_255)] text-[10px] ml-2">
                  Projection Only · Ultra-Juiced · Odds worse than -600
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1 text-[oklch(0.40_0.015_255)]">
              <span className="text-[10px]">{researchPicks.length}</span>
              {showResearchArchive ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </div>
          </button>

          {showResearchArchive && researchPicks.length > 0 && (
            <div className="mt-2">
              <div className="px-3 py-2 mb-2 rounded-lg bg-[oklch(0.16_0.04_25)/30%] border border-[oklch(0.68_0.22_25)/20%]">
                <p className="text-[oklch(0.65_0.18_25)] text-[10px] leading-relaxed">
                  ⚠️ These plays are <strong>not recommended for betting</strong>. They are shown for research and transparency only.
                  Plays worse than -600, projection-only plays, and ultra-juiced plays appear here.
                </p>
              </div>
              {researchPicks.map((pick, i) => (
                <PitcherPickCard key={`research-${i}`} pick={pick} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Rejected Play Diagnostics Panel ───────────────────────────────────── */}
      {rejectedPlays.length > 0 && (
        <div className="mt-4">
          <button
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-[oklch(0.14_0.02_255)] border border-[oklch(1_0_0/6%)] text-left"
            onClick={() => setShowDiagnostics(v => !v)}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle size={12} className="text-[oklch(0.65_0.18_60)]" />
              <span className="text-[oklch(0.55_0.015_255)] text-xs font-medium">
                {rejectedPlays.length} Rejected Play{rejectedPlays.length !== 1 ? "s" : ""} — Diagnostics
              </span>
            </div>
            <div className="flex items-center gap-1 text-[oklch(0.40_0.015_255)]">
              <span className="text-[10px]">Why were these excluded?</span>
              {showDiagnostics ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </div>
          </button>

          {showDiagnostics && (
            <div className="mt-2 space-y-2">
              {rejectedPlays.map((r, i) => (
                <div
                  key={`rejected-${i}`}
                  className="rounded-xl bg-[oklch(0.13_0.018_255)] border border-[oklch(1_0_0/5%)] p-3"
                >
                  {/* Header */}
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="text-white font-semibold text-sm">{r.pitcherName}</div>
                      <div className="text-[oklch(0.45_0.015_255)] text-xs">
                        Market: {r.propType === "strikeouts" ? "Strikeouts" : "Walks"} · Line: O{r.line}
                      </div>
                      <div className="text-[oklch(0.40_0.015_255)] text-[10px] mt-0.5">
                        {r.pitcherTeam} vs {r.opponentTeam}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[oklch(0.65_0.18_25)/15%] text-[oklch(0.65_0.18_25)]">
                        REJECTED
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        r.hasMarketData
                          ? 'bg-[oklch(0.72_0.18_165)/15%] text-[oklch(0.72_0.18_165)]'
                          : 'bg-[oklch(0.55_0.015_255)/10%] text-[oklch(0.50_0.015_255)]'
                      }`}>
                        Odds: {r.hasMarketData ? 'Live' : 'Missing'}
                      </span>
                    </div>
                  </div>

                  {/* Stats grid: Model Prob | Required | Edge | EV Status */}
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <div className="bg-[oklch(0.18_0.02_255)] rounded-lg p-2">
                      <div className="text-[oklch(0.40_0.015_255)] text-[10px] mb-0.5">Model Probability</div>
                      <div className="text-white font-bold text-sm">{r.modelProbability.toFixed(1)}%</div>
                    </div>
                    <div className="bg-[oklch(0.18_0.02_255)] rounded-lg p-2">
                      <div className="text-[oklch(0.40_0.015_255)] text-[10px] mb-0.5">Required Threshold</div>
                      <div className="text-[oklch(0.65_0.18_25)] font-bold text-sm">{r.requiredThreshold.toFixed(1)}%</div>
                    </div>
                    <div className="bg-[oklch(0.18_0.02_255)] rounded-lg p-2">
                      <div className="text-[oklch(0.40_0.015_255)] text-[10px] mb-0.5">Odds Status</div>
                      <div className={`font-bold text-sm ${r.hasMarketData ? 'text-[oklch(0.72_0.18_165)]' : 'text-[oklch(0.65_0.18_25)]'}`}>
                        {r.hasMarketData ? 'Live' : 'Missing'}
                      </div>
                    </div>
                    <div className="bg-[oklch(0.18_0.02_255)] rounded-lg p-2">
                      <div className="text-[oklch(0.40_0.015_255)] text-[10px] mb-0.5">EV Status</div>
                      <div className={`font-bold text-sm ${
                        !r.hasMarketData ? 'text-[oklch(0.50_0.015_255)]'
                        : r.edge !== null && r.edge > 0 ? 'text-[oklch(0.72_0.18_165)]'
                        : 'text-[oklch(0.65_0.18_25)]'
                      }`}>
                        {!r.hasMarketData ? 'N/A — No Odds'
                          : r.edge !== null && r.edge > 0 ? `+${r.edge.toFixed(1)}% Edge`
                          : r.edge !== null ? `${r.edge.toFixed(1)}% (Negative)`
                          : 'N/A'}
                      </div>
                    </div>
                  </div>

                  {/* Rejection reason summary */}
                  <div className="mb-2">
                    <div className="text-[oklch(0.40_0.015_255)] text-[10px] mb-1">Rejection Reason</div>
                    <div className="text-[oklch(0.65_0.18_25)] text-xs font-medium">{r.rejectionSummary}</div>
                  </div>

                  {/* Detailed rejection reasons */}
                  <div className="space-y-1">
                    {r.rejectionReasons.map((reason, j) => (
                      <div key={j} className="flex items-start gap-1.5">
                        <span className="text-[oklch(0.65_0.18_25)] text-xs mt-0.5">✗</span>
                        <span className="text-[oklch(0.55_0.015_255)] text-xs">{reason}</span>
                      </div>
                    ))}
                  </div>

                  {/* Supporting factors count */}
                  <div className="mt-2 pt-2 border-t border-[oklch(1_0_0/5%)] flex items-center gap-2">
                    <span className="text-[oklch(0.40_0.015_255)] text-[10px]">Supporting factors:</span>
                    <span className={`text-xs font-bold ${r.supportingFactors >= r.requiredFactors ? 'text-[oklch(0.72_0.18_165)]' : 'text-[oklch(0.65_0.18_25)]'}`}>
                      {r.supportingFactors}/{r.requiredFactors}
                    </span>
                    <span className="text-[oklch(0.40_0.015_255)] text-[10px]">required for Official</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
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
