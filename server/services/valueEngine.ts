/**
 * Value Engine — Sharp Bettor EV System
 *
 * Converts model true probability + sportsbook odds into:
 *   - Expected Value (EV%)
 *   - Fair American odds
 *   - Value tier (SAFE_VALUE / BALANCED_VALUE / CEILING_PLAY / PASS)
 *   - Value tag (BEST VALUE / MISPRICED / ELITE EDGE / MONITORING / PASS)
 *   - Alt-line comparison (BETTER VALUE flag)
 *   - Mispriced market detection
 *
 * Spec (pasted_content_14.txt):
 *   SAFE VALUE:    odds -175 to +110, edge ≥ +3%, hit prob ≥ 58%
 *   BALANCED:      odds +110 to +220, edge ≥ +5%, hit prob ≥ 35%
 *   CEILING PLAY:  odds +220 to +700, edge ≥ +7%, hit prob ≥ 22%
 *   PASS:          negative EV (regardless of projection)
 */

import { americanToImpliedProbability } from "./oddsApiService";

// ── Types ──────────────────────────────────────────────────────────────────────

export type ValueTier = "SAFE_VALUE" | "BALANCED_VALUE" | "CEILING_PLAY" | "PASS";
export type ValueTag = "BEST VALUE" | "MISPRICED" | "ELITE EDGE" | "BETTER VALUE" | "MONITORING" | "PASS";

export interface ValueAnalysis {
  /** Model true probability (0-100) */
  trueProb: number;
  /** Sportsbook implied probability (0-100, vig-included) */
  impliedProb: number;
  /** Vig-removed implied probability (0-100) */
  vigFreeImpliedProb: number;
  /** Edge = trueProb - vigFreeImpliedProb (percentage points) */
  edge: number;
  /** Expected Value % = edge / (1 - vigFreeImpliedProb/100) */
  ev: number;
  /** Fair American odds derived from trueProb */
  fairOdds: number;
  /** Sportsbook American odds */
  bookOdds: number;
  /** Risk tier classification */
  valueTier: ValueTier;
  /** Display tag */
  valueTag: ValueTag;
  /** True if sportsbook is offering significantly better price than fair */
  isMispriced: boolean;
  /** True if alt line has better EV than main line */
  altLineIsBetter: boolean;
  /** Best alt line details if available */
  bestAltLine?: {
    line: number;
    overOdds: number;
    impliedProb: number;
    edge: number;
    ev: number;
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Convert true probability (0-100) to fair American odds.
 * 60% → -150, 40% → +150, 50% → -100/+100
 */
export function probToAmericanOdds(prob: number): number {
  const p = Math.max(0.01, Math.min(0.99, prob / 100));
  if (p >= 0.5) {
    return Math.round(-(p / (1 - p)) * 100);
  } else {
    return Math.round(((1 - p) / p) * 100);
  }
}

/**
 * Calculate Expected Value % for a bet.
 * EV% = (trueProb * (payoutMultiplier)) - (1 - trueProb)
 * where payoutMultiplier = 100/|odds| for favorites, odds/100 for underdogs
 */
export function calcEV(trueProb: number, bookOdds: number): number {
  const p = trueProb / 100;
  let payout: number;
  if (bookOdds < 0) {
    payout = 100 / Math.abs(bookOdds); // e.g. -150 → 0.667
  } else {
    payout = bookOdds / 100; // e.g. +130 → 1.30
  }
  return Math.round((p * payout - (1 - p)) * 1000) / 10; // returns % e.g. +4.5
}

/**
 * Classify value tier based on spec rules.
 */
export function getValueTier(
  bookOdds: number,
  edge: number,
  trueProb: number
): ValueTier {
  // Negative EV → always PASS
  if (edge <= 0) return "PASS";

  // SAFE VALUE: odds -175 to +110, edge ≥ +3%, hit prob ≥ 58%
  if (bookOdds >= -175 && bookOdds <= 110 && edge >= 3 && trueProb >= 58) {
    return "SAFE_VALUE";
  }

  // BALANCED VALUE: odds +110 to +220, edge ≥ +5%, hit prob ≥ 35%
  if (bookOdds > 110 && bookOdds <= 220 && edge >= 5 && trueProb >= 35) {
    return "BALANCED_VALUE";
  }

  // CEILING PLAY: odds +220 to +700, edge ≥ +7%, hit prob ≥ 22%
  if (bookOdds > 220 && bookOdds <= 700 && edge >= 7 && trueProb >= 22) {
    return "CEILING_PLAY";
  }

  // Positive edge but doesn't meet tier criteria → MONITORING
  return "PASS";
}

/**
 * Assign display value tag.
 */
export function getValueTag(
  edge: number,
  isMispriced: boolean,
  altLineIsBetter: boolean,
  valueTier: ValueTier
): ValueTag {
  if (valueTier === "PASS") return "PASS";
  if (isMispriced) return "MISPRICED";
  if (altLineIsBetter) return "BETTER VALUE";
  if (edge >= 8) return "ELITE EDGE";
  if (edge >= 4) return "BEST VALUE";
  return "MONITORING";
}

// ── Main analyzer ──────────────────────────────────────────────────────────────

export interface AltLineInput {
  line: number;
  overOdds: number;
  underOdds?: number;
  impliedOverProb?: number;
}

/**
 * Full value analysis for a single pick.
 *
 * @param trueProb    Model probability (0-100) for OVER hitting
 * @param bookOdds    Sportsbook American odds for the main line (e.g. -150, +110)
 * @param altLines    Optional alternate lines from sportsbook
 */
export function analyzeValue(
  trueProb: number,
  bookOdds: number,
  altLines?: AltLineInput[]
): ValueAnalysis {
  // Implied probability (vig-included)
  const impliedProb = Math.round(americanToImpliedProbability(bookOdds) * 1000) / 10; // 0-100

  // Vig-free implied prob: for a single side we approximate by assuming ~4.5% vig
  // (standard -110/-110 book = 52.4% each = 4.8% total vig)
  // Simple approach: vigFree = implied / 1.045
  const vigFreeImpliedProb = Math.round((impliedProb / 1.045) * 10) / 10;

  // Edge (percentage points)
  const edge = Math.round((trueProb - vigFreeImpliedProb) * 10) / 10;

  // EV%
  const ev = calcEV(trueProb, bookOdds);

  // Fair odds
  const fairOdds = probToAmericanOdds(trueProb);

  // Mispriced: fair odds vs book differ by 20%+ implied prob
  const fairImpliedProb = trueProb;
  const mispricingGap = Math.abs(fairImpliedProb - vigFreeImpliedProb);
  const isMispriced = mispricingGap >= 20 && edge > 0;

  // Alt-line comparison
  let altLineIsBetter = false;
  let bestAltLine: ValueAnalysis["bestAltLine"] | undefined;

  if (altLines && altLines.length > 0) {
    let bestAltEV = ev; // must beat main line EV by 5%+
    for (const alt of altLines) {
      const altImplied = americanToImpliedProbability(alt.overOdds) * 100;
      const altVigFree = altImplied / 1.045;
      const altEdge = Math.round((trueProb - altVigFree) * 10) / 10;
      const altEV = calcEV(trueProb, alt.overOdds);
      if (altEV > bestAltEV + 5) {
        bestAltEV = altEV;
        altLineIsBetter = true;
        bestAltLine = {
          line: alt.line,
          overOdds: alt.overOdds,
          impliedProb: Math.round(altImplied * 10) / 10,
          edge: altEdge,
          ev: altEV,
        };
      }
    }
  }

  // Value tier and tag
  const valueTier = getValueTier(bookOdds, edge, trueProb);
  const valueTag = getValueTag(edge, isMispriced, altLineIsBetter, valueTier);

  return {
    trueProb,
    impliedProb,
    vigFreeImpliedProb,
    edge,
    ev,
    fairOdds,
    bookOdds,
    valueTier,
    valueTag,
    isMispriced,
    altLineIsBetter,
    bestAltLine,
  };
}
