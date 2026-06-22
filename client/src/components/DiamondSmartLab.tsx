/**
 * Diamond Smart Lab — AI Betting Intelligence Hub
 *
 * Sections:
 *   1. Best Smart Value Play (hero card)
 *   2. Safe Parlay Builder (2-leg + 3-leg)
 *   3. Aggressive Upside Plays (3-4 leg)
 *   4. AI Slate Insights
 *   5. Conversational AI Assistant
 *
 * Architecture: Diamond Edge backend calculates everything.
 * The AI interprets, explains, and builds parlays from real model data.
 */

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { AIChatBox, type Message } from "@/components/AIChatBox";
import {
  Sparkles, Shield, Zap, TrendingUp, AlertTriangle, Info,
  RefreshCw, ChevronDown, Layers, Target, BarChart3, MessageSquare,
  FlaskConical, Star, Activity, CheckCircle2, Clock, XCircle,
  Trophy, Gem, Rocket, FlaskRound, TrendingDown
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

// ── New Parlay Builder types (from getSmartLabParlays) ────────────────────────

interface NewParlayLeg {
  playerName: string;
  team: string;
  propType: string;
  line: number;
  bookOdds: number;
  fairOdds: number;
  modelProbability: number;
  edgePct: number;
  ev: number;
  source: 'pitcher' | 'hitter';
  pitcherName?: string;
  gameTime?: string;
}

interface BuiltParlay {
  category: 'SAFEST' | 'BEST_VALUE' | 'PLUS_MONEY';
  categoryLabel: string;
  categoryIcon: string;
  legs: NewParlayLeg[];
  combinedOdds: number;
  combinedOddsDisplay: string;
  hitProbability: number;
  hitProbabilityPct: number;
  combinedEV: number;
  isPositiveEV: boolean;
  meetsOddsTarget: boolean;
  oddsTarget: string;
  legCount: number;
}

interface UltraJuicedPlay {
  playerName: string;
  team: string;
  propType: string;
  line: number;
  bookOdds: number;
  modelProbability: number;
  edgePct: number;
  ev: number;
  pricingPenaltyLabel: string;
  source: 'pitcher' | 'hitter';
}

interface SmartLabParlays {
  safestParlay: BuiltParlay | null;
  bestValueParlay: BuiltParlay | null;
  plusMoneyParlay: BuiltParlay | null;
  ultraJuicedPlays: UltraJuicedPlay[];
  totalEligiblePlays: number;
  hasPitcherData: boolean;
  hasHitterData: boolean;
  generatedAt: string;
}

// ── Legacy parlay types (for AI analyzeSlate) ─────────────────────────────────

interface ParlayLeg {
  playerName: string;
  team: string;
  line: number;
  reason: string;
  propType?: "hitter" | "strikeouts" | "walks";
}

interface TopPitcherPlay {
  pitcherName: string;
  pitcherTeam: string;
  opponentTeam: string;
  propType: "strikeouts" | "walks";
  line: number;
  modelProbability: number;
  bookOdds: string;
  edge: string;
  tier: string;
  kTms: number;
  disciplineGrade: string;
  hasDisciplineEdge: boolean;
  topReasons: string[];
  altLines: Array<{ line: number; modelProbability: number; bookOdds: string | null; edge: string | null }>;
}

interface SmartParlay {
  type: "2-leg" | "3-leg" | "4-leg";
  legs: ParlayLeg[];
  combinedProfile: string;
  confidenceLabel: "HIGH" | "MEDIUM" | "SPECULATIVE";
}

interface BestValuePlay {
  playerName: string;
  team: string;
  line: number;
  reason: string;
  edgeSummary: string;
  keyRiskFlag: string | null;
}

interface SmartLabAnalysis {
  bestValuePlay: BestValuePlay | null;
  topPitcherPlays: TopPitcherPlay[];
  safeParlays: SmartParlay[];
  upsideParlays: SmartParlay[];
  slateInsights: string;
  riskSummary: string;
  isEmptySlate: boolean;
  emptySlateReasons: string[];
  generatedAt: string;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ConfidenceBadge({ label }: { label: string }) {
  const styles: Record<string, { bg: string; text: string; border: string }> = {
    HIGH: { bg: "oklch(0.72 0.18 165 / 15%)", text: "oklch(0.72 0.18 165)", border: "oklch(0.72 0.18 165 / 30%)" },
    MEDIUM: { bg: "oklch(0.82 0.17 85 / 15%)", text: "oklch(0.82 0.17 85)", border: "oklch(0.82 0.17 85 / 30%)" },
    SPECULATIVE: { bg: "oklch(0.65 0.15 280 / 15%)", text: "oklch(0.65 0.15 280)", border: "oklch(0.65 0.15 280 / 30%)" },
  };
  const s = styles[label] || styles.MEDIUM;
  return (
    <span
      className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
      style={{ background: s.bg, color: s.text, borderColor: s.border }}
    >
      {label}
    </span>
  );
}

function ParlayCard({ parlay, index, isUpside }: { parlay: SmartParlay; index: number; isUpside?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const accentColor = isUpside ? "oklch(0.65 0.15 280)" : "oklch(0.72 0.18 165)";
  const bgGradient = isUpside
    ? "linear-gradient(145deg, oklch(0.14 0.03 280 / 40%), oklch(0.12 0.020 255))"
    : "linear-gradient(145deg, oklch(0.14 0.03 165 / 40%), oklch(0.12 0.020 255))";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07, duration: 0.4 }}
      className="rounded-xl overflow-hidden border"
      style={{ background: bgGradient, borderColor: `${accentColor}30` }}
    >
      {/* Top accent bar */}
      <div className="h-0.5 w-full" style={{ background: `linear-gradient(90deg, ${accentColor}, ${accentColor}30)` }} />

      <button onClick={() => setExpanded(!expanded)} className="w-full text-left p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div
              className="px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1"
              style={{ background: `${accentColor}20`, color: accentColor }}
            >
              <Layers size={11} />
              {parlay.type.toUpperCase()}
            </div>
            <ConfidenceBadge label={parlay.confidenceLabel} />
          </div>
          <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown size={14} className="text-[oklch(0.40_0.015_255)]" />
          </motion.div>
        </div>

        {/* Legs preview */}
        <div className="space-y-2">
          {parlay.legs.map((leg, i) => (
            <div key={i} className="flex items-center gap-2.5 p-2.5 rounded-lg bg-[oklch(1_0_0/3%)] border border-[oklch(1_0_0/6%)]">
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold"
                style={{ background: `${accentColor}20`, color: accentColor }}
              >
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-sm font-semibold text-white truncate">{leg.playerName}</span>
                  <span className="text-[10px] text-[oklch(0.45_0.015_255)]">{leg.team}</span>
                </div>
              </div>
              <div
                className="px-2 py-0.5 rounded-md text-[11px] font-bold shrink-0"
                style={{ background: `${accentColor}15`, color: accentColor }}
              >
                {leg.propType === "strikeouts" ? `${leg.line}+ Ks` : leg.propType === "walks" ? `${leg.line}+ BBs` : `O${leg.line} HRR`}
              </div>
            </div>
          ))}
        </div>
      </button>

      {/* Expanded details */}
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
              {/* Combined profile */}
              <div className="p-3 rounded-lg bg-[oklch(1_0_0/3%)] border border-[oklch(1_0_0/6%)]">
                <div className="flex items-start gap-2">
                  <BarChart3 size={12} className="text-blue-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-[oklch(0.60_0.015_255)] leading-relaxed">{parlay.combinedProfile}</p>
                </div>
              </div>
              {/* Per-leg reasons */}
              {parlay.legs.map((leg, i) => (
                <div key={i} className="rounded-lg border border-[oklch(1_0_0/8%)] bg-[oklch(1_0_0/2%)] p-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-bold text-white">{leg.playerName}</span>
                    <span className="text-[9px] text-[oklch(0.45_0.015_255)]">({leg.team})</span>
                    <span className="ml-auto text-[10px] font-bold" style={{ color: accentColor }}>O{leg.line}</span>
                  </div>
                  <p className="text-[11px] text-[oklch(0.50_0.015_255)] leading-relaxed">{leg.reason}</p>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function HeroValueCard({ play }: { play: BestValuePlay }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="relative rounded-2xl overflow-hidden border border-[oklch(0.82_0.17_85/30%)]"
      style={{ background: "linear-gradient(145deg, oklch(0.14 0.04 85 / 50%), oklch(0.11 0.025 255))" }}
    >
      {/* Top accent */}
      <div className="h-1 w-full" style={{ background: "linear-gradient(90deg, oklch(0.82 0.17 85), oklch(0.75 0.15 280), oklch(0.82 0.17 85 / 30%))" }} />

      <div className="p-5">
        {/* Label */}
        <div className="flex items-center gap-2 mb-4">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[oklch(0.82_0.17_85/15%)] border border-[oklch(0.82_0.17_85/30%)]">
            <Star size={12} className="text-[oklch(0.82_0.17_85)]" />
            <span className="text-xs font-bold text-[oklch(0.82_0.17_85)] tracking-wide">SMART VALUE PLAY</span>
          </div>
        </div>

        {/* Player */}
        <div className="mb-4">
          <h2 className="text-2xl font-extrabold text-white leading-tight">{play.playerName}</h2>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm text-[oklch(0.55_0.015_255)]">{play.team}</span>
            <span className="text-[oklch(0.35_0.015_255)]">·</span>
            <span className="text-sm font-bold text-[oklch(0.82_0.17_85)]">O{play.line} HRR</span>
          </div>
        </div>

        {/* Edge summary */}
        {play.edgeSummary && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-[oklch(0.72_0.18_165/10%)] border border-[oklch(0.72_0.18_165/20%)]">
            <div className="flex items-center gap-1.5">
              <Activity size={11} className="text-[oklch(0.72_0.18_165)] shrink-0" />
              <span className="text-xs text-[oklch(0.72_0.18_165)] font-semibold">{play.edgeSummary}</span>
            </div>
          </div>
        )}

        {/* Reason */}
        <p className="text-sm text-[oklch(0.65_0.015_255)] leading-relaxed mb-4">{play.reason}</p>

        {/* Risk flag */}
        {play.keyRiskFlag && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/8 border border-amber-500/20">
            <AlertTriangle size={11} className="text-amber-400 mt-0.5 shrink-0" />
            <span className="text-[11px] text-amber-300 leading-relaxed">{play.keyRiskFlag}</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function PitcherPlayCard({ play, index }: { play: TopPitcherPlay; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const isK = play.propType === "strikeouts";
  const accentColor = isK ? "oklch(0.68 0.22 25)" : "oklch(0.65 0.15 280)";
  const propLabel = isK ? "Strikeouts" : "Walks";
  const hasLiveOdds = play.bookOdds && !play.bookOdds.includes("Model only");

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07, duration: 0.4 }}
      className="rounded-xl overflow-hidden border"
      style={{ background: `linear-gradient(145deg, oklch(0.14 0.03 ${isK ? '25' : '280'} / 35%), oklch(0.12 0.020 255))`, borderColor: `${accentColor}30` }}
    >
      <div className="h-0.5 w-full" style={{ background: `linear-gradient(90deg, ${accentColor}, ${accentColor}30)` }} />

      <button onClick={() => setExpanded(!expanded)} className="w-full text-left p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1" style={{ background: `${accentColor}20`, color: accentColor }}>
              {isK ? <Target size={11} /> : <Activity size={11} />}
              {propLabel.toUpperCase()}
            </div>
            {play.hasDisciplineEdge && (
              <span className="text-[10px] px-2 py-0.5 rounded-full border font-bold" style={{ background: "oklch(0.82 0.17 85 / 15%)", color: "oklch(0.82 0.17 85)", borderColor: "oklch(0.82 0.17 85 / 30%)" }}>💎 EDGE</span>
            )}
            {!hasLiveOdds && (
              <span className="text-[10px] px-2 py-0.5 rounded-full border font-semibold" style={{ background: "oklch(0.55 0.015 255 / 15%)", color: "oklch(0.55 0.015 255)", borderColor: "oklch(0.55 0.015 255 / 30%)" }}>MODEL ONLY</span>
            )}
          </div>
          <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown size={14} className="text-[oklch(0.40_0.015_255)]" />
          </motion.div>
        </div>

        {/* Pitcher + line */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="text-base font-bold text-white leading-tight">{play.pitcherName}</div>
            <div className="text-[11px] text-[oklch(0.50_0.015_255)] mt-0.5">{play.pitcherTeam} vs {play.opponentTeam}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-xl font-extrabold" style={{ color: accentColor }}>{play.line}+ {isK ? 'Ks' : 'BBs'}</div>
            <div className="text-[11px] text-[oklch(0.55_0.015_255)]">{Math.round(play.modelProbability)}% model</div>
          </div>
        </div>

        {/* Odds row */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg p-2 bg-[oklch(1_0_0/4%)] border border-[oklch(1_0_0/8%)] text-center">
            <div className="text-[9px] text-[oklch(0.40_0.015_255)] mb-0.5">BOOK ODDS</div>
            <div className="text-xs font-bold" style={{ color: hasLiveOdds ? accentColor : "oklch(0.45 0.015 255)" }}>{play.bookOdds}</div>
          </div>
          <div className="rounded-lg p-2 bg-[oklch(1_0_0/4%)] border border-[oklch(1_0_0/8%)] text-center">
            <div className="text-[9px] text-[oklch(0.40_0.015_255)] mb-0.5">EDGE</div>
            <div className="text-xs font-bold" style={{ color: play.edge.startsWith('+') ? "oklch(0.72 0.18 165)" : "oklch(0.55 0.015 255)" }}>{play.edge}</div>
          </div>
          <div className="rounded-lg p-2 bg-[oklch(1_0_0/4%)] border border-[oklch(1_0_0/8%)] text-center">
            <div className="text-[9px] text-[oklch(0.40_0.015_255)] mb-0.5">K TMS</div>
            <div className="text-xs font-bold" style={{ color: play.kTms >= 70 ? "oklch(0.72 0.18 165)" : play.kTms >= 55 ? accentColor : "oklch(0.55 0.015 255)" }}>{play.kTms}</div>
          </div>
        </div>
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
            <div className="px-4 pb-4 space-y-3">
              {/* Tier + discipline */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border" style={{ background: `${accentColor}15`, color: accentColor, borderColor: `${accentColor}30` }}>{play.tier}</span>
                <span className="text-[11px] text-[oklch(0.55_0.015_255)]">Discipline Grade: <span className="font-bold text-white">{play.disciplineGrade}</span></span>
              </div>

              {/* Reasons */}
              {play.topReasons.length > 0 && (
                <div className="space-y-1.5">
                  {play.topReasons.map((r, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="text-[oklch(0.72_0.18_165)] text-xs mt-0.5">✅</span>
                      <span className="text-[11px] text-[oklch(0.60_0.015_255)] leading-relaxed">{r}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Alt lines table */}
              {play.altLines.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold text-[oklch(0.45_0.015_255)] mb-2 uppercase tracking-wide">All {isK ? 'K' : 'BB'} Lines</div>
                  <div className="space-y-1">
                    {play.altLines.map((alt, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-[oklch(1_0_0/3%)] border border-[oklch(1_0_0/6%)]">
                        <span className="text-xs font-bold text-white">{alt.line}+ {isK ? 'Ks' : 'BBs'}</span>
                        <span className="text-[11px]" style={{ color: accentColor }}>{alt.modelProbability}% model</span>
                        <span className="text-[11px] text-[oklch(0.50_0.015_255)]">{alt.bookOdds ?? 'No line'}</span>
                        <span className="text-[11px]" style={{ color: alt.edge && alt.edge.startsWith('+') ? "oklch(0.72 0.18 165)" : "oklch(0.50 0.015 255)" }}>{alt.edge ?? 'N/A'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function SectionHeader({ icon: Icon, title, badge, color = "oklch(0.72 0.18 165)" }: {
  icon: any; title: string; badge?: string; color?: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon size={14} style={{ color }} />
      <h3 className="text-sm font-bold text-white">{title}</h3>
      {badge && (
        <span
          className="text-[10px] px-2 py-0.5 rounded-full border font-semibold"
          style={{ background: `${color}10`, color, borderColor: `${color}30` }}
        >
          {badge}
        </span>
      )}
    </div>
  );
}

// ─── Data Status Panel ───────────────────────────────────────────────────────

type SourceStatus = 'ok' | 'partial' | 'offline' | 'loading' | 'awaiting';

function SourceStatusDot({ status }: { status: SourceStatus }) {
  if (status === 'ok') return <CheckCircle2 size={10} style={{ color: 'oklch(0.72 0.18 165)' }} />;
  if (status === 'partial') return <AlertTriangle size={10} style={{ color: 'oklch(0.82 0.17 85)' }} />;
  if (status === 'loading') return <Clock size={10} style={{ color: 'oklch(0.65 0.15 280)' }} />;
  if (status === 'awaiting') return <Clock size={10} style={{ color: 'oklch(0.65 0.15 280)' }} />;
  return <XCircle size={10} style={{ color: 'oklch(0.68 0.22 25)' }} />;
}

function SourceStatusLabel({ status }: { status: SourceStatus }) {
  if (status === 'ok') return <span style={{ color: 'oklch(0.72 0.18 165)' }} className="text-[9px] font-bold">LIVE</span>;
  if (status === 'partial') return <span style={{ color: 'oklch(0.82 0.17 85)' }} className="text-[9px] font-bold">PARTIAL</span>;
  if (status === 'loading') return <span style={{ color: 'oklch(0.65 0.15 280)' }} className="text-[9px] font-bold">LOADING</span>;
  if (status === 'awaiting') return <span style={{ color: 'oklch(0.65 0.15 280)' }} className="text-[9px] font-bold">AWAITING</span>;
  return <span style={{ color: 'oklch(0.68 0.22 25)' }} className="text-[9px] font-bold">OFFLINE</span>;
}

function DataStatusPanel() {
  const [expanded, setExpanded] = useState(false);
  const { data: status, isLoading } = trpc.smartLab.getDataStatus.useQuery(undefined, {
    refetchInterval: 2 * 60 * 1000, // refresh every 2 min
  });

  if (isLoading || !status) {
    return (
      <div className="rounded-xl px-3 py-2 border border-[oklch(1_0_0/8%)] bg-[oklch(1_0_0/3%)] flex items-center gap-2">
        <Activity size={11} style={{ color: 'oklch(0.45 0.015 255)' }} />
        <span className="text-[10px] text-[oklch(0.45_0.015_255)]">Checking data sources...</span>
      </div>
    );
  }

  // Granular pitcher market sub-statuses
  const pitcherOdds = status.pitcherStrikeoutOdds;
  const hasMainK = (pitcherOdds.mainKCount ?? 0) > 0;
  const hasAltK = (pitcherOdds.altKLineCount ?? 0) > 0;
  const hasWalk = (pitcherOdds.walkLineCount ?? 0) > 0;

  // withinActiveWindow: true = market hours (9 AM–11:30 PM ET), false = overnight
  const hrrWithinWindow = (status.moneyPickOdds as any).withinActiveWindow !== false;
  const pitcherWithinWindow = (pitcherOdds as any).withinActiveWindow !== false;

  const sources: Array<{ label: string; status: SourceStatus; detail?: string }> = [
    {
      label: 'Money Pick Odds',
      status: status.moneyPickOdds.connected ? 'ok' : hrrWithinWindow ? 'offline' : 'awaiting',
      detail: status.moneyPickOdds.connected ? `${status.moneyPickOdds.playerCount} players` : hrrWithinWindow ? 'No data' : 'Market hours 9AM–11:30PM ET',
    },
    {
      label: 'Pitcher K/BB Odds',
      status: pitcherOdds.connected ? 'ok' : pitcherWithinWindow ? 'offline' : 'awaiting',
      detail: pitcherOdds.connected ? `${pitcherOdds.pitcherCount} pitchers` : pitcherWithinWindow ? 'No data' : 'Market hours 9AM–11:30PM ET',
    },
    {
      label: 'Main K Lines',
      status: hasMainK ? 'ok' : pitcherOdds.connected ? 'partial' : pitcherWithinWindow ? 'offline' : 'awaiting',
      detail: hasMainK ? `${pitcherOdds.mainKCount} pitchers` : pitcherOdds.connected ? 'None loaded' : pitcherWithinWindow ? 'Offline' : 'Awaiting market hours',
    },
    {
      label: 'Alt K Lines',
      status: hasAltK ? 'ok' : pitcherOdds.connected ? 'partial' : pitcherWithinWindow ? 'offline' : 'awaiting',
      detail: hasAltK ? `${pitcherOdds.altKLineCount} lines` : pitcherOdds.connected ? 'None loaded' : pitcherWithinWindow ? 'Offline' : 'Awaiting market hours',
    },
    {
      label: 'Walk Lines',
      status: hasWalk ? 'ok' : pitcherOdds.connected ? 'partial' : pitcherWithinWindow ? 'offline' : 'awaiting',
      detail: hasWalk ? `${pitcherOdds.walkLineCount} lines` : pitcherOdds.connected ? 'None loaded' : pitcherWithinWindow ? 'Offline' : 'Awaiting market hours',
    },
    {
      label: 'Game Totals',
      status: status.gameTotals.connected ? 'ok' : 'offline',
      detail: status.gameTotals.connected ? `${status.gameTotals.gameCount} games` : 'No data',
    },
    {
      label: 'Enrichment Cache',
      status: status.enrichmentCache.connected ? 'ok' : 'loading',
      detail: status.enrichmentCache.connected ? 'Warm' : 'Warming up',
    },
    {
      label: 'TMS Database',
      status: status.tmsDatabase.connected ? 'ok' : 'offline',
      detail: status.tmsDatabase.connected ? 'Connected' : 'Offline',
    },
    {
      label: 'Discipline DB',
      status: status.disciplineDatabase.connected ? 'ok' : 'offline',
      detail: status.disciplineDatabase.connected ? 'Connected' : 'Offline',
    },
  ];

  const offlineCount = sources.filter(s => s.status === 'offline').length;
  const awaitingCount = sources.filter(s => s.status === 'awaiting').length;
  const partialCount = sources.filter(s => s.status === 'partial' || s.status === 'loading').length;
  const allOk = offlineCount === 0 && partialCount === 0 && awaitingCount === 0;

  const lastUpdatedStr = (() => {
    if (!status.lastUpdated) return null;
    try {
      const d = new Date(status.lastUpdated);
      const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
      if (diffMin < 1) return 'Just now';
      if (diffMin < 60) return `${diffMin}m ago`;
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } catch { return null; }
  })();

  const overallColor = allOk ? 'oklch(0.72 0.18 165)' : offlineCount > 0 ? 'oklch(0.68 0.22 25)' : awaitingCount > 0 ? 'oklch(0.65 0.15 280)' : 'oklch(0.82 0.17 85)';
  const overallBg = allOk ? 'oklch(0.14 0.03 165 / 0.4)' : offlineCount > 0 ? 'oklch(0.14 0.04 25 / 0.35)' : awaitingCount > 0 ? 'oklch(0.14 0.03 280 / 0.35)' : 'oklch(0.14 0.04 60 / 0.35)';
  const overallBorder = allOk ? 'oklch(0.72 0.18 165 / 25%)' : offlineCount > 0 ? 'oklch(0.68 0.22 25 / 30%)' : awaitingCount > 0 ? 'oklch(0.65 0.15 280 / 30%)' : 'oklch(0.82 0.17 85 / 30%)';

  const summaryLabel = allOk
    ? 'All Data Sources Live'
    : offlineCount > 0
    ? `${offlineCount} Source${offlineCount > 1 ? 's' : ''} Offline`
    : awaitingCount > 0
    ? `Awaiting Market Hours (9AM–11:30PM ET)`
    : `${partialCount} Source${partialCount > 1 ? 's' : ''} Loading`;

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: overallBg, border: `1px solid ${overallBorder}` }}>
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 gap-2"
      >
        <div className="flex items-center gap-2">
          <Activity size={11} style={{ color: overallColor }} />
          <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: overallColor }}>
            {summaryLabel}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {sources.map(s => <SourceStatusDot key={s.label} status={s.status} />)}
          </div>
          {lastUpdatedStr && (
            <div className="flex items-center gap-1">
              <Clock size={9} style={{ color: 'oklch(0.40 0.015 255)' }} />
              <span className="text-[9px] text-[oklch(0.40_0.015_255)]">{lastUpdatedStr}</span>
            </div>
          )}
          <ChevronDown
            size={11}
            className="transition-transform"
            style={{ color: 'oklch(0.45 0.015 255)', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
          />
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 grid grid-cols-2 gap-2">
          {sources.map(s => (
            <div
              key={s.label}
              className="flex items-center justify-between px-2 py-1.5 rounded-lg"
              style={{ background: 'oklch(1 0 0 / 4%)' }}
            >
              <div className="min-w-0">
                <div className="text-[10px] text-[oklch(0.60_0.015_255)] font-medium leading-tight">{s.label}</div>
                {s.detail && <div className="text-[9px] text-[oklch(0.40_0.015_255)] leading-tight">{s.detail}</div>}
              </div>
              <div className="flex items-center gap-1 shrink-0 ml-1">
                <SourceStatusDot status={s.status} />
                <SourceStatusLabel status={s.status} />
              </div>
            </div>
          ))}
          {offlineCount > 0 && (
            <div className="col-span-2 mt-1 text-[9px] text-[oklch(0.50_0.015_255)] leading-relaxed">
              {offlineCount} data source{offlineCount > 1 ? 's are' : ' is'} offline. This may be due to the Odds API time window (active 9AM–11:30PM ET) or a connection issue. Use the Admin panel to bust the cache and retry.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Diamond Parlay Builder Components ──────────────────────────────────────

function formatOdds(american: number): string {
  return american >= 0 ? `+${american}` : `${american}`;
}

function EVBadge({ ev, isPositive }: { ev: number; isPositive: boolean }) {
  const color = isPositive ? 'oklch(0.72 0.18 165)' : 'oklch(0.68 0.22 25)';
  return (
    <span
      className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
      style={{ background: `${color}15`, color, borderColor: `${color}30` }}
    >
      EV {isPositive ? '+' : ''}{ev.toFixed(1)}%
    </span>
  );
}

function OddsTargetBadge({ meets, display }: { meets: boolean; display: string }) {
  const color = meets ? 'oklch(0.82 0.17 85)' : 'oklch(0.55 0.015 255)';
  return (
    <span
      className="text-[10px] font-semibold px-2 py-0.5 rounded-full border"
      style={{ background: `${color}10`, color, borderColor: `${color}25` }}
    >
      Target: {display}
    </span>
  );
}

function NewParlayCard({ parlay, index }: { parlay: BuiltParlay; index: number }) {
  const [expanded, setExpanded] = useState(false);

  const categoryColors: Record<string, { accent: string; bg: string; border: string }> = {
    SAFEST:     { accent: 'oklch(0.72 0.18 165)', bg: 'oklch(0.14 0.03 165 / 40%)', border: 'oklch(0.72 0.18 165 / 25%)' },
    BEST_VALUE: { accent: 'oklch(0.82 0.17 85)',  bg: 'oklch(0.13 0.03 85 / 40%)',  border: 'oklch(0.82 0.17 85 / 25%)' },
    PLUS_MONEY: { accent: 'oklch(0.68 0.22 25)',  bg: 'oklch(0.14 0.04 25 / 40%)',  border: 'oklch(0.68 0.22 25 / 25%)' },
  };
  const c = categoryColors[parlay.category] ?? categoryColors.SAFEST;

  const isPlus = parlay.combinedOdds >= 0;
  const oddsColor = isPlus ? 'oklch(0.72 0.18 165)' : 'oklch(0.82 0.17 85)';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.4 }}
      className="rounded-xl overflow-hidden border"
      style={{ background: c.bg, borderColor: c.border }}
    >
      {/* Top accent bar */}
      <div className="h-0.5 w-full" style={{ background: `linear-gradient(90deg, ${c.accent}, ${c.accent}30)` }} />

      <button onClick={() => setExpanded(!expanded)} className="w-full text-left p-4">
        {/* Header row */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-base">{parlay.categoryIcon}</span>
            <span className="text-xs font-bold text-white">{parlay.categoryLabel.replace(/^[^ ]+ /, '')}</span>
          </div>
          <div className="flex items-center gap-2">
            <EVBadge ev={parlay.combinedEV} isPositive={parlay.isPositiveEV} />
            <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronDown size={14} className="text-[oklch(0.40_0.015_255)]" />
            </motion.div>
          </div>
        </div>

        {/* Combined odds + hit probability */}
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 rounded-lg p-2.5 bg-[oklch(1_0_0/5%)] border border-[oklch(1_0_0/10%)] text-center">
            <div className="text-[9px] text-[oklch(0.40_0.015_255)] mb-0.5">PARLAY ODDS</div>
            <div className="text-xl font-extrabold" style={{ color: oddsColor }}>{parlay.combinedOddsDisplay}</div>
          </div>
          <div className="flex-1 rounded-lg p-2.5 bg-[oklch(1_0_0/5%)] border border-[oklch(1_0_0/10%)] text-center">
            <div className="text-[9px] text-[oklch(0.40_0.015_255)] mb-0.5">HIT PROB</div>
            <div className="text-xl font-extrabold text-white">{parlay.hitProbabilityPct.toFixed(0)}%</div>
          </div>
          <div className="flex-1 rounded-lg p-2.5 bg-[oklch(1_0_0/5%)] border border-[oklch(1_0_0/10%)] text-center">
            <div className="text-[9px] text-[oklch(0.40_0.015_255)] mb-0.5">LEGS</div>
            <div className="text-xl font-extrabold text-white">{parlay.legCount}</div>
          </div>
        </div>

        {/* Odds target badge */}
        <div className="flex items-center gap-2 mb-3">
          <OddsTargetBadge meets={parlay.meetsOddsTarget} display={parlay.oddsTarget} />
          {parlay.meetsOddsTarget && (
            <span className="text-[10px] text-[oklch(0.72_0.18_165)] font-semibold">✓ Target met</span>
          )}
        </div>

        {/* Legs preview */}
        <div className="space-y-2">
          {parlay.legs.map((leg, i) => {
            const propLabel = leg.propType === 'strikeouts' ? `${leg.line}+ Ks`
              : leg.propType === 'walks' ? `${leg.line}+ BBs`
              : `O${leg.line} HRR`;
            const hasOdds = leg.bookOdds !== 0;
            return (
              <div key={i} className="flex items-center gap-2.5 p-2.5 rounded-lg bg-[oklch(1_0_0/3%)] border border-[oklch(1_0_0/6%)]">
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold"
                  style={{ background: `${c.accent}20`, color: c.accent }}
                >
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-sm font-semibold text-white truncate">{leg.playerName}</span>
                    <span className="text-[10px] text-[oklch(0.45_0.015_255)]">{leg.team}</span>
                  </div>
                  {leg.pitcherName && leg.pitcherName !== leg.playerName && (
                    <div className="text-[10px] text-[oklch(0.40_0.015_255)]">P: {leg.pitcherName}</div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-0.5 shrink-0">
                  <div className="px-2 py-0.5 rounded-md text-[11px] font-bold" style={{ background: `${c.accent}15`, color: c.accent }}>
                    {propLabel}
                  </div>
                  {hasOdds && (
                    <div className="text-[10px] text-[oklch(0.50_0.015_255)]">{formatOdds(leg.bookOdds)}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </button>

      {/* Expanded details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3">
              {/* Per-leg details */}
              {parlay.legs.map((leg, i) => {
                const propLabel = leg.propType === 'strikeouts' ? `${leg.line}+ Ks`
                  : leg.propType === 'walks' ? `${leg.line}+ BBs`
                  : `O${leg.line} HRR`;
                const hasOdds = leg.bookOdds !== 0;
                return (
                  <div key={i} className="rounded-lg border border-[oklch(1_0_0/8%)] bg-[oklch(1_0_0/2%)] p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-bold text-white">{leg.playerName}</span>
                      <span className="text-[9px] text-[oklch(0.45_0.015_255)]">({leg.team})</span>
                      <span className="ml-auto text-[10px] font-bold" style={{ color: c.accent }}>{propLabel}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-center">
                        <div className="text-[9px] text-[oklch(0.40_0.015_255)]">BOOK</div>
                        <div className="text-xs font-bold" style={{ color: hasOdds ? c.accent : 'oklch(0.45 0.015 255)' }}>
                          {hasOdds ? formatOdds(leg.bookOdds) : '—'}
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-[9px] text-[oklch(0.40_0.015_255)]">FAIR</div>
                        <div className="text-xs font-bold text-white">{formatOdds(leg.fairOdds)}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-[9px] text-[oklch(0.40_0.015_255)]">EDGE</div>
                        <div className="text-xs font-bold" style={{ color: leg.edgePct > 0 ? 'oklch(0.72 0.18 165)' : 'oklch(0.55 0.015 255)' }}>
                          {leg.edgePct > 0 ? '+' : ''}{leg.edgePct.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="text-[9px] text-[oklch(0.40_0.015_255)]">MODEL PROB:</div>
                      <div className="text-[10px] font-bold text-white">{(leg.modelProbability * 100).toFixed(1)}%</div>
                      <div className="text-[9px] text-[oklch(0.40_0.015_255)] ml-2">EV:</div>
                      <div className="text-[10px] font-bold" style={{ color: leg.ev > 0 ? 'oklch(0.72 0.18 165)' : 'oklch(0.68 0.22 25)' }}>
                        {leg.ev > 0 ? '+' : ''}{leg.ev.toFixed(1)}%
                      </div>
                      <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded" style={{ background: leg.source === 'pitcher' ? 'oklch(0.68 0.22 25 / 20%)' : 'oklch(0.65 0.15 280 / 20%)', color: leg.source === 'pitcher' ? 'oklch(0.68 0.22 25)' : 'oklch(0.65 0.15 280)' }}>
                        {leg.source === 'pitcher' ? 'PITCHER' : 'HITTER'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function UltraJuicedSection({ plays }: { plays: UltraJuicedPlay[] }) {
  const [expanded, setExpanded] = useState(false);
  if (plays.length === 0) return null;
  return (
    <div>
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 mb-3 group"
      >
        <FlaskRound size={14} style={{ color: 'oklch(0.65 0.15 280)' }} />
        <h3 className="text-sm font-bold text-white">Ultra-Juiced Plays</h3>
        <span className="text-[10px] px-2 py-0.5 rounded-full border font-semibold" style={{ background: 'oklch(0.65 0.15 280 / 10%)', color: 'oklch(0.65 0.15 280)', borderColor: 'oklch(0.65 0.15 280 / 30%)' }}>
          RESEARCH ONLY
        </span>
        <span className="text-[10px] text-[oklch(0.45_0.015_255)] ml-auto">{plays.length} plays</span>
        <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown size={14} className="text-[oklch(0.40_0.015_255)]" />
        </motion.div>
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="rounded-xl border border-[oklch(0.65_0.15_280/20%)] bg-[oklch(0.65_0.15_280/5%)] p-3 mb-3">
              <div className="flex items-start gap-2">
                <AlertTriangle size={12} className="text-amber-400 mt-0.5 shrink-0" />
                <p className="text-[11px] text-[oklch(0.55_0.015_255)] leading-relaxed">
                  These plays are priced worse than -1000. They are tracked for research and diagnostics but are <strong>not recommended</strong> as parlay pieces or official plays due to poor betting value.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              {plays.map((play, i) => {
                const propLabel = play.propType === 'strikeouts' ? `${play.line}+ Ks`
                  : play.propType === 'walks' ? `${play.line}+ BBs`
                  : `O${play.line} HRR`;
                return (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-[oklch(1_0_0/3%)] border border-[oklch(1_0_0/6%)]">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-sm font-semibold text-white truncate">{play.playerName}</span>
                        <span className="text-[10px] text-[oklch(0.45_0.015_255)]">{play.team}</span>
                      </div>
                      <div className="text-[10px] text-[oklch(0.40_0.015_255)] mt-0.5">{play.pricingPenaltyLabel}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <div className="text-xs font-bold" style={{ color: 'oklch(0.65 0.15 280)' }}>{propLabel}</div>
                      <div className="text-[10px] text-[oklch(0.55_0.015_255)]">{formatOdds(play.bookOdds)}</div>
                      <div className="text-[10px]" style={{ color: play.edgePct > 0 ? 'oklch(0.72 0.18 165)' : 'oklch(0.55 0.015 255)' }}>
                        Edge: {play.edgePct > 0 ? '+' : ''}{play.edgePct.toFixed(1)}%
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DiamondParlayBuilder() {
  const { data: parlayData, isLoading, refetch, isFetching } = trpc.smartLab.getSmartLabParlays.useQuery(undefined, {
    refetchInterval: 5 * 60 * 1000,
  });

  const parlays = parlayData as SmartLabParlays | undefined;

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Gem size={16} style={{ color: 'oklch(0.82 0.17 85)' }} />
          <h2 className="text-sm font-extrabold text-white tracking-wide">DIAMOND PARLAY BUILDER</h2>
          <span className="text-[10px] px-2 py-0.5 rounded-full border font-bold" style={{ background: 'oklch(0.82 0.17 85 / 12%)', color: 'oklch(0.82 0.17 85)', borderColor: 'oklch(0.82 0.17 85 / 30%)' }}>VALUE-FIRST</span>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold text-[oklch(0.50_0.015_255)] hover:text-white hover:bg-white/5 transition-all disabled:opacity-50"
        >
          <RefreshCw size={10} className={isFetching ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Value-first explanation */}
      <div className="rounded-xl p-3 border border-[oklch(0.82_0.17_85/15%)] bg-[oklch(0.82_0.17_85/5%)]">
        <p className="text-[11px] text-[oklch(0.55_0.015_255)] leading-relaxed">
          Plays ranked by <strong className="text-white">EV + Edge% + Model Probability + Sportsbook Pricing</strong>. Ultra-juiced plays (-1000+) are excluded from parlays. Target: +100 to +300 combined odds.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <motion.div
            className="w-8 h-8 rounded-full border-2 border-transparent"
            style={{ borderTopColor: 'oklch(0.82 0.17 85)' }}
            animate={{ rotate: 360 }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
          />
        </div>
      ) : !parlays || parlays.totalEligiblePlays === 0 ? (
        <div className="text-center py-8">
          <Gem size={24} className="text-[oklch(0.35_0.015_255)] mx-auto mb-3" />
          <p className="text-sm text-[oklch(0.50_0.015_255)]">Parlay Builder — Projection Only</p>
          <p className="text-xs text-[oklch(0.40_0.015_255)] mt-1 leading-relaxed">
            No live sportsbook odds available. Parlay Builder requires real book odds to calculate EV and combined odds.
            <br />
            <span className="text-[oklch(0.50_0.015_255)]">Sportsbook lines are available during market hours (9AM–11:30PM ET).</span>
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Three parlay categories */}
          {[parlays.safestParlay, parlays.bestValueParlay, parlays.plusMoneyParlay].filter(Boolean).map((parlay, i) => (
            <NewParlayCard key={parlay!.category} parlay={parlay!} index={i} />
          ))}

          {/* No parlays built */}
          {!parlays.safestParlay && !parlays.bestValueParlay && !parlays.plusMoneyParlay && (
            <div className="text-center py-6">
              <TrendingDown size={20} className="text-[oklch(0.40_0.015_255)] mx-auto mb-2" />
              <p className="text-sm text-[oklch(0.50_0.015_255)]">Not enough plays with live odds to build parlays.</p>
              <p className="text-xs text-[oklch(0.40_0.015_255)] mt-1">{parlays.totalEligiblePlays} eligible plays found — need 2+ with sportsbook lines.</p>
            </div>
          )}

          {/* Ultra-juiced section */}
          {parlays.ultraJuicedPlays && parlays.ultraJuicedPlays.length > 0 && (
            <div className="border-t border-[oklch(1_0_0/8%)] pt-4">
              <UltraJuicedSection plays={parlays.ultraJuicedPlays} />
            </div>
          )}

          {/* Data source info */}
          <div className="flex items-center gap-3 pt-1">
            <div className="text-[10px] text-[oklch(0.35_0.015_255)]">
              {parlays.totalEligiblePlays} eligible plays
              {parlays.hasPitcherData && ' · Pitcher K/BB'}
              {parlays.hasHitterData && ' · HRR'}
            </div>
            {parlays.generatedAt && (
              <div className="ml-auto text-[10px] text-[oklch(0.35_0.015_255)]">
                {new Date(parlays.generatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function DiamondSmartLab() {
  const [analysis, setAnalysis] = useState<SmartLabAnalysis | null>(null);
  const [chatMessages, setChatMessages] = useState<Message[]>([]);
  const [activeSection, setActiveSection] = useState<"analysis" | "parlays" | "chat">("parlays");

  const { data: slateData, isLoading: slateLoading } = trpc.smartLab.getSlateData.useQuery(undefined, {
    refetchInterval: 5 * 60 * 1000, // refresh every 5 min
  });

  const analyzeMutation = trpc.smartLab.analyzeSlate.useMutation({
    onSuccess: (data) => setAnalysis(data as SmartLabAnalysis),
  });

  const chatMutation = trpc.smartLab.chat.useMutation({
    onSuccess: (data) => {
      setChatMessages(prev => [
        ...prev,
        { role: "assistant", content: data.reply },
      ]);
    },
  });

  const handleAnalyze = useCallback(() => {
    analyzeMutation.mutate();
  }, [analyzeMutation]);

  const handleSendMessage = useCallback((content: string) => {
    const newMessages: Message[] = [...chatMessages, { role: "user", content }];
    setChatMessages(newMessages);
    chatMutation.mutate({
      messages: newMessages
        .filter(m => m.role !== "system")
        .map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
    });
  }, [chatMessages, chatMutation]);

  // Loading state
  if (slateLoading) {
    return (
      <div className="flex-1 flex items-center justify-center py-16">
        <div className="text-center">
          <motion.div
            className="w-14 h-14 rounded-full border-2 border-transparent mx-auto mb-4"
            style={{ borderTopColor: "oklch(0.82 0.17 85)", borderRightColor: "oklch(0.65 0.15 280)" }}
            animate={{ rotate: 360 }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
          />
          <p className="text-sm text-[oklch(0.50_0.015_255)]">Loading Diamond Edge data...</p>
        </div>
      </div>
    );
  }

  const hasPicks = (slateData?.pickCount ?? 0) > 0;
  const lineupsPending = slateData?.lineupsPending ?? false;

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl p-4 border border-[oklch(0.82_0.17_85/20%)]"
        style={{ background: "linear-gradient(145deg, oklch(0.13 0.03 85 / 40%), oklch(0.11 0.025 255))" }}
      >
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "oklch(0.82 0.17 85 / 15%)" }}>
            <FlaskConical size={20} style={{ color: "oklch(0.82 0.17 85)" }} />
          </div>
          <div>
            <h1 className="text-base font-extrabold text-white tracking-wide">DIAMOND SMART LAB</h1>
            <p className="text-[11px] text-[oklch(0.50_0.015_255)]">AI Betting Intelligence · Powered by Diamond Edge</p>
          </div>
          {slateData?.dataDate && (
            <div className="ml-auto text-right">
              <div className="text-[10px] text-[oklch(0.40_0.015_255)]">Slate</div>
              <div className="text-xs font-semibold text-[oklch(0.60_0.015_255)]">{slateData.dataDate}</div>
            </div>
          )}
        </div>
        <p className="text-[11px] text-[oklch(0.45_0.015_255)] leading-relaxed">
          The AI interprets Diamond Edge model outputs to identify value, build smart parlays, and explain every recommendation. All analysis is grounded in real model data — no invented odds or fabricated probabilities.
        </p>
      </motion.div>

      {/* ── Section Tabs ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        {[
          { key: "analysis", label: "Smart Analysis", icon: Sparkles },
          { key: "chat", label: "AI Assistant", icon: MessageSquare },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveSection(key as "analysis" | "parlays" | "chat")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeSection === key
                ? "bg-white/10 text-white border border-white/20"
                : "text-[oklch(0.50_0.015_255)] hover:text-white hover:bg-white/5"
            }`}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>
      {/* ── Data Status Panel ──────────────────────────────────────────────────── */}
      <DataStatusPanel />

      {/* ── Parlay Builder Section ───────────────────────────────────────────────────────────────── */}
      {activeSection === "parlays" && (
        <div className="space-y-5">
          <div className="rounded-xl p-3 border border-amber-500/20 bg-amber-500/5">
            <div className="flex items-start gap-2">
              <Info size={13} className="text-amber-400 mt-0.5 shrink-0" />
              <p className="text-[11px] text-[oklch(0.60_0.015_255)] leading-relaxed">
                <span className="text-amber-300 font-semibold">Bankroll Management:</span> Never exceed your limits. Treat this as entertainment, not income. Never chase losses.
              </p>
            </div>
          </div>
          <DiamondParlayBuilder />
        </div>
      )}

      {/* ── Analysis Section ─────────────────────────────────────────────────── */}
      {activeSection === "analysis" && (
        <div className="space-y-5">

          {/* Responsible gambling notice */}
          <div className="rounded-xl p-3 border border-amber-500/20 bg-amber-500/5">
            <div className="flex items-start gap-2">
              <Info size={13} className="text-amber-400 mt-0.5 shrink-0" />
              <p className="text-[11px] text-[oklch(0.60_0.015_255)] leading-relaxed">
                <span className="text-amber-300 font-semibold">Bankroll Management:</span> Never exceed your limits. Treat this as entertainment, not income. Never chase losses.
              </p>
            </div>
          </div>

          {/* Generate button */}
          {!analysis && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-6"
            >
              {lineupsPending ? (
                <div className="space-y-3">
                  <div className="w-16 h-16 rounded-full bg-[oklch(1_0_0/5%)] flex items-center justify-center mx-auto">
                    <FlaskConical size={28} className="text-[oklch(0.45_0.015_255)]" />
                  </div>
                  <h3 className="text-base font-bold text-white">Lineups Not Yet Posted</h3>
                  <p className="text-sm text-[oklch(0.50_0.015_255)] max-w-xs mx-auto leading-relaxed">
                    Today's lineups haven't been posted yet. Smart Lab analysis will be available once MLB releases starting lineups (usually 2–3 hours before first pitch).
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center" style={{ background: "oklch(0.82 0.17 85 / 10%)" }}>
                    <Sparkles size={28} style={{ color: "oklch(0.82 0.17 85)" }} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white mb-1">Ready to Analyze</h3>
                    <p className="text-sm text-[oklch(0.50_0.015_255)] max-w-xs mx-auto leading-relaxed">
                      {hasPicks
                        ? `${slateData?.pickCount} official Diamond Edge picks ready. Generate your Smart Lab analysis.`
                        : "No official picks qualify yet, but Smart Lab can analyze near-miss candidates."}
                    </p>
                  </div>
                  <button
                    onClick={handleAnalyze}
                    disabled={analyzeMutation.isPending}
                    className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm mx-auto transition-all active:scale-95 disabled:opacity-50"
                    style={{ background: "linear-gradient(135deg, oklch(0.82 0.17 85), oklch(0.75 0.15 280))", color: "oklch(0.10 0.020 255)" }}
                  >
                    {analyzeMutation.isPending ? (
                      <>
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                        >
                          <RefreshCw size={14} />
                        </motion.div>
                        Analyzing Slate...
                      </>
                    ) : (
                      <>
                        <Sparkles size={14} />
                        Generate Smart Lab Analysis
                      </>
                    )}
                  </button>
                </div>
              )}
            </motion.div>
          )}

          {/* Analysis results */}
          {analysis && (
            <div className="space-y-5">

              {/* Refresh button */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[oklch(0.40_0.015_255)]">
                  Generated {new Date(analysis.generatedAt).toLocaleTimeString()}
                </span>
                <button
                  onClick={handleAnalyze}
                  disabled={analyzeMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[oklch(0.55_0.015_255)] hover:text-white hover:bg-white/5 transition-all disabled:opacity-50"
                >
                  <RefreshCw size={11} className={analyzeMutation.isPending ? "animate-spin" : ""} />
                  Refresh
                </button>
              </div>

              {/* Empty slate notice */}
              {analysis.isEmptySlate && (
                <div className="rounded-xl p-4 border border-[oklch(0.65_0.15_280/30%)] bg-[oklch(0.65_0.15_280/8%)]">
                  <div className="flex items-start gap-2.5">
                    <Info size={14} className="text-[oklch(0.65_0.15_280)] mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-[oklch(0.65_0.15_280)] mb-1">Near-Miss Analysis Mode</p>
                      <p className="text-[11px] text-[oklch(0.55_0.015_255)] leading-relaxed">
                        Today's slate lacks strong official edges. The analysis below is based on the closest qualifying candidates — treat with appropriate caution.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Section 1: Best Smart Value Play */}
              {analysis.bestValuePlay && (
                <div>
                  <SectionHeader icon={Star} title="Best Smart Value Play" badge="FEATURED" color="oklch(0.82 0.17 85)" />
                  <HeroValueCard play={analysis.bestValuePlay} />
                </div>
              )}

              {/* Section 1b: Top Pitcher Plays */}
              {analysis.topPitcherPlays && analysis.topPitcherPlays.length > 0 && (
                <div>
                  <SectionHeader icon={Target} title="Top Pitcher Props" badge="K &amp; BB" color="oklch(0.68 0.22 25)" />
                  <div className="space-y-3">
                    {analysis.topPitcherPlays.map((play, i) => (
                      <PitcherPlayCard key={i} play={play} index={i} />
                    ))}
                  </div>
                </div>
              )}

              {/* Section 2: Safe Parlay Builder */}
              {analysis.safeParlays.length > 0 && (
                <div>
                  <SectionHeader icon={Shield} title="Safe Parlay Builder" badge="PRIMARY FOCUS" color="oklch(0.72 0.18 165)" />
                  <div className="space-y-3">
                    {analysis.safeParlays.map((parlay, i) => (
                      <ParlayCard key={i} parlay={parlay} index={i} />
                    ))}
                  </div>
                </div>
              )}

              {/* Section 3: Aggressive Upside Plays */}
              {analysis.upsideParlays.length > 0 && (
                <div>
                  <SectionHeader icon={Zap} title="Higher-Upside Plays" badge="AGGRESSIVE" color="oklch(0.65 0.15 280)" />
                  <div className="space-y-3">
                    {analysis.upsideParlays.map((parlay, i) => (
                      <ParlayCard key={i} parlay={parlay} index={i} isUpside />
                    ))}
                  </div>
                </div>
              )}

              {/* Section 4: AI Slate Insights */}
              {analysis.slateInsights && (
                <div>
                  <SectionHeader icon={TrendingUp} title="AI Slate Insights" color="oklch(0.68 0.22 25)" />
                  <div
                    className="rounded-xl p-4 border border-[oklch(0.68_0.22_25/20%)]"
                    style={{ background: "linear-gradient(145deg, oklch(0.14 0.03 25 / 30%), oklch(0.12 0.020 255))" }}
                  >
                    <p className="text-sm text-[oklch(0.65_0.015_255)] leading-relaxed">{analysis.slateInsights}</p>
                  </div>
                </div>
              )}

              {/* Section 5: Risk & Edge Summary */}
              {analysis.riskSummary && (
                <div>
                  <SectionHeader icon={AlertTriangle} title="Risk & Edge Analysis" color="oklch(0.82 0.17 85)" />
                  <div className="rounded-xl p-4 border border-amber-500/20 bg-amber-500/5">
                    <p className="text-sm text-[oklch(0.65_0.015_255)] leading-relaxed">{analysis.riskSummary}</p>
                  </div>
                </div>
              )}

              {/* No results fallback */}
              {!analysis.bestValuePlay && analysis.safeParlays.length === 0 && (
                <div className="text-center py-8">
                  <Target size={28} className="text-[oklch(0.40_0.015_255)] mx-auto mb-3" />
                  <p className="text-sm text-[oklch(0.50_0.015_255)]">
                    {analysis.slateInsights || "No strong plays identified for today's slate."}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Chat Section ─────────────────────────────────────────────────────── */}
      {activeSection === "chat" && (
        <div className="space-y-3">
          <div className="rounded-xl p-3 border border-[oklch(0.65_0.15_280/20%)] bg-[oklch(0.65_0.15_280/5%)]">
            <div className="flex items-start gap-2">
              <MessageSquare size={12} className="text-[oklch(0.65_0.15_280)] mt-0.5 shrink-0" />
              <p className="text-[11px] text-[oklch(0.55_0.015_255)] leading-relaxed">
                Ask anything about today's slate. The AI is grounded in real Diamond Edge data — no invented stats or odds.
              </p>
            </div>
          </div>

          <AIChatBox
            messages={chatMessages}
            onSendMessage={handleSendMessage}
            isLoading={chatMutation.isPending}
            placeholder="Ask about today's slate, parlays, value plays..."
            height={480}
            emptyStateMessage="Ask Diamond Smart Lab anything about today's slate"
            suggestedPrompts={[
              "Build me a safe 2-man HRR parlay",
              "What is today's best value edge?",
              "Which plays correlate best?",
              "Give me the highest-floor play",
              "Which game environment is strongest today?",
              "What are the main risks today?",
            ]}
          />
        </div>
      )}
    </div>
  );
}
