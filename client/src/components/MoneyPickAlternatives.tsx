/**
 * Money Pick Alternatives
 *
 * Collapsible section that appears under each official Money Pick.
 * Shows Safer / Better Value / Ceiling alternatives grounded in real
 * Diamond Edge model data and sportsbook odds.
 *
 * IMPORTANT: These are DISPLAY-ONLY and never affect the official record,
 * hit rate, ROI, or any performance statistics.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Shield, Gem, Zap, XCircle, Info } from "lucide-react";

// ─── Types (mirrors server PickAlternative) ───────────────────────────────────

export type AlternativeTier = "SAFER" | "BETTER_VALUE" | "CEILING" | "NONE";

export interface PickAlternative {
  tier: AlternativeTier;
  marketLabel: string;
  bookOdds: number;
  trueProb: number;
  impliedProb: number;
  edge: number;
  fairOdds: number;
  ev: number;
  reason: string;
}

// ─── Tier config ──────────────────────────────────────────────────────────────

const TIER_CONFIG = {
  SAFER: {
    icon: Shield,
    label: "Safer Alternative",
    shortLabel: "SAFER",
    color: "oklch(0.72 0.18 165)",
    bg: "oklch(0.72 0.18 165 / 10%)",
    border: "oklch(0.72 0.18 165 / 25%)",
    description: "Higher-probability path for users prioritising consistency",
  },
  BETTER_VALUE: {
    icon: Gem,
    label: "Better Value",
    shortLabel: "BEST VALUE",
    color: "oklch(0.82 0.17 85)",
    bg: "oklch(0.82 0.17 85 / 10%)",
    border: "oklch(0.82 0.17 85 / 25%)",
    description: "Strongest balance between payout and probability",
  },
  CEILING: {
    icon: Zap,
    label: "Ceiling Play",
    shortLabel: "CEILING",
    color: "oklch(0.65 0.15 280)",
    bg: "oklch(0.65 0.15 280 / 10%)",
    border: "oklch(0.65 0.15 280 / 25%)",
    description: "Aggressive ladder with positive EV and higher upside",
  },
  NONE: {
    icon: XCircle,
    label: "No Better Alternative",
    shortLabel: "NONE",
    color: "oklch(0.45 0.015 255)",
    bg: "oklch(0.18 0.02 255)",
    border: "oklch(1 0 0 / 8%)",
    description: "",
  },
} as const;

// ─── Single alternative card ──────────────────────────────────────────────────

function AlternativeCard({ alt }: { alt: PickAlternative }) {
  const cfg = TIER_CONFIG[alt.tier];
  const Icon = cfg.icon;
  const oddsStr = alt.bookOdds > 0 ? `+${alt.bookOdds}` : `${alt.bookOdds}`;
  const fairStr = alt.fairOdds > 0 ? `+${alt.fairOdds}` : `${alt.fairOdds}`;
  const edgePositive = alt.edge > 0;

  return (
    <div
      className="rounded-xl overflow-hidden border"
      style={{ background: cfg.bg, borderColor: cfg.border }}
    >
      {/* Tier header */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b"
        style={{ borderColor: cfg.border, background: `${cfg.color}08` }}
      >
        <Icon size={12} style={{ color: cfg.color }} />
        <span className="text-[11px] font-bold tracking-wide" style={{ color: cfg.color }}>
          {cfg.label.toUpperCase()}
        </span>
        <span
          className="ml-auto text-[10px] px-2 py-0.5 rounded-full font-bold border"
          style={{ color: cfg.color, borderColor: cfg.border, background: `${cfg.color}10` }}
        >
          {alt.marketLabel}
        </span>
      </div>

      {/* Stats grid */}
      <div className="px-3 py-2.5">
        <div className="grid grid-cols-4 gap-2 mb-2.5">
          {/* Odds */}
          <div className="text-center">
            <div className="text-[9px] text-[oklch(0.40_0.015_255)] uppercase mb-0.5">Odds</div>
            <div className="text-sm font-bold" style={{ color: cfg.color }}>{oddsStr}</div>
          </div>
          {/* True Prob */}
          <div className="text-center">
            <div className="text-[9px] text-[oklch(0.40_0.015_255)] uppercase mb-0.5">Model %</div>
            <div
              className="text-sm font-bold"
              style={{ color: alt.trueProb >= 65 ? "oklch(0.72 0.18 165)" : alt.trueProb >= 50 ? "oklch(0.82 0.17 85)" : "oklch(0.65 0.015 255)" }}
            >
              {alt.trueProb}%
            </div>
          </div>
          {/* Implied Prob */}
          <div className="text-center">
            <div className="text-[9px] text-[oklch(0.40_0.015_255)] uppercase mb-0.5">Book %</div>
            <div className="text-sm font-bold text-[oklch(0.55_0.015_255)]">{alt.impliedProb}%</div>
          </div>
          {/* Edge */}
          <div className="text-center">
            <div className="text-[9px] text-[oklch(0.40_0.015_255)] uppercase mb-0.5">Edge</div>
            <div
              className="text-sm font-bold"
              style={{ color: edgePositive ? "oklch(0.72 0.18 165)" : "oklch(0.68 0.22 25)" }}
            >
              {edgePositive ? "+" : ""}{alt.edge}%
            </div>
          </div>
        </div>

        {/* Fair odds row */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] text-[oklch(0.45_0.015_255)]">Fair Odds</span>
          <span className="text-[11px] font-bold text-[oklch(0.65_0.015_255)]">{fairStr}</span>
        </div>

        {/* Reason */}
        <p className="text-[10px] text-[oklch(0.50_0.015_255)] leading-relaxed">{alt.reason}</p>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface MoneyPickAlternativesProps {
  alternatives: PickAlternative[];
  playerName: string;
}

export function MoneyPickAlternatives({ alternatives, playerName }: MoneyPickAlternativesProps) {
  const [open, setOpen] = useState(false);

  // Determine if there are any real alternatives
  const realAlts = alternatives.filter(a => a.tier !== "NONE");
  const hasNone = realAlts.length === 0;

  return (
    <div className="mt-3">
      {/* Toggle button */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border transition-all active:scale-[0.99]"
        style={{
          background: open ? "oklch(0.82 0.17 85 / 8%)" : "oklch(1 0 0 / 3%)",
          borderColor: open ? "oklch(0.82 0.17 85 / 30%)" : "oklch(1 0 0 / 8%)",
        }}
      >
        <Gem size={12} style={{ color: "oklch(0.82 0.17 85)" }} />
        <span className="text-[11px] font-bold" style={{ color: "oklch(0.82 0.17 85)" }}>
          💎 Money Pick Alternatives
        </span>
        {!hasNone && (
          <div className="flex items-center gap-1 ml-1">
            {realAlts.map(a => {
              const cfg = TIER_CONFIG[a.tier];
              return (
                <span
                  key={a.tier}
                  className="text-[9px] px-1.5 py-0.5 rounded-full font-bold border"
                  style={{ color: cfg.color, borderColor: cfg.border, background: cfg.bg }}
                >
                  {cfg.shortLabel}
                </span>
              );
            })}
          </div>
        )}
        <motion.div
          className="ml-auto"
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown size={13} className="text-[oklch(0.40_0.015_255)]" />
        </motion.div>
      </button>

      {/* Expanded content */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="pt-2 space-y-2">
              {/* Disclaimer */}
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[oklch(1_0_0/3%)] border border-[oklch(1_0_0/8%)]">
                <Info size={11} className="text-[oklch(0.45_0.015_255)] mt-0.5 shrink-0" />
                <p className="text-[10px] text-[oklch(0.40_0.015_255)] leading-relaxed">
                  Alternatives are <strong className="text-[oklch(0.55_0.015_255)]">display-only</strong> and never affect the official Diamond Edge record, hit rate, or ROI. Official Money Picks remain unchanged.
                </p>
              </div>

              {hasNone ? (
                /* No qualifying alternatives */
                <div className="flex items-center gap-2 px-3 py-3 rounded-xl border border-[oklch(1_0_0/8%)] bg-[oklch(1_0_0/2%)]">
                  <XCircle size={14} className="text-[oklch(0.40_0.015_255)] shrink-0" />
                  <div>
                    <p className="text-[11px] font-semibold text-[oklch(0.55_0.015_255)]">No Better Alternative Found</p>
                    <p className="text-[10px] text-[oklch(0.40_0.015_255)] mt-0.5">
                      No alternate HRR line meets the minimum edge and probability thresholds. The official play is the strongest available option.
                    </p>
                  </div>
                </div>
              ) : (
                /* Tier order: Safer → Better Value → Ceiling */
                (['SAFER', 'BETTER_VALUE', 'CEILING'] as AlternativeTier[])
                  .map(tier => realAlts.find(a => a.tier === tier))
                  .filter(Boolean)
                  .map(alt => <AlternativeCard key={alt!.tier} alt={alt!} />)
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
