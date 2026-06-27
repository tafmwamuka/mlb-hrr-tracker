/**
 * playQualityScore.ts
 * 
 * NEW Play Quality Score (PQS) system — replaces edge-primary ranking.
 * 
 * PHILOSOPHY:
 * Diamond Edge is a retail product. Retail users judge quality by win rate,
 * not by long-run EV. A pick that hits 80% of the time at -8% edge feels
 * better to users than a pick that hits 38% at +12% edge, even if the
 * professional quant prefers the latter.
 *
 * The PQS system solves this by:
 *   1. PROBABILITY GATE: minimum 60% Poisson model probability to qualify
 *   2. PQS RANKING: probability-first score with value as a bonus
 *   3. TIER LABELS: reflect actual expected win rate, not just edge
 *
 * PQS Formula:
 *   PQS = (poissonProb × 55)              // 0-55 pts — primary axis
 *       + (clampedEdge × 25)              // 0-25 pts — value bonus
 *       + (historicalAgreement × 12)      // 0-12 pts — model/history consistency
 *       + (oddsValue × 8)                 // 0-8 pts  — price quality
 *
 * This means:
 *   80% prob + 8% edge + strong history + fair odds ≈ 85 PQS (Elite)
 *   38% prob + 17% edge                             ≈ 45 PQS (Research only)
 *
 * Quality gates:
 *   PQS ≥ 75 + prob ≥ 70% → ELITE (shown prominently, tracked)
 *   PQS ≥ 60 + prob ≥ 60% → STRONG (shown, tracked)
 *   PQS ≥ 45 + prob ≥ 50% → LEAN (shown with warning, not tracked)
 *   Below thresholds       → RESEARCH ONLY (hidden from main board)
 */

import { poissonOverProbability } from './poissonModel';
import { americanToImpliedProbability, removeVig } from './oddsApiService';
import { calcEV, probToAmericanOdds } from './valueEngine';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PQSTier = 'ELITE' | 'STRONG' | 'LEAN' | 'RESEARCH';

export interface PQSInput {
  // Poisson model probability (0-100) — THE primary signal
  poissonProb: number;

  // Sportsbook odds (American) — null if not available
  bookOdds: number | null;

  // Historical hit rate at this line from last 5-7 games (0-100) — null if unavailable  
  historicalHitRate: number | null;

  // Number of historical games available (for confidence weighting)
  historicalSampleSize: number;

  // Matrix score from aiRankingService (0-100) — contextual signal
  matrixScore: number;
}

export interface PQSResult {
  pqs: number;               // 0-100 Play Quality Score
  tier: PQSTier;             // ELITE / STRONG / LEAN / RESEARCH
  qualifies: boolean;        // true if meets minimum thresholds
  
  // Component breakdown for display
  components: {
    probabilityScore: number;   // 0-55 (Poisson model probability contribution)
    valueBonus: number;         // 0-25 (edge bonus when odds available)
    consistencyScore: number;   // 0-12 (model vs historical agreement)
    oddsQualityScore: number;   // 0-8  (price/odds quality)
  };

  // Derived metrics
  poissonProb: number;          // the input probability
  edge: number | null;          // model minus book (null if no odds)
  ev: number | null;            // expected value % (null if no odds)
  fairOdds: number;             // fair American odds from model
  impliedProbBook: number | null; // vig-free book probability

  // Human readable
  tierLabel: string;            // "Elite Pick" / "Strong Play" / "Lean" / "Research"
  tierReason: string;           // one-line explanation of tier
  qualifyReason: string | null; // why it doesn't qualify (null if it does)
}

// ─── Component calculators ────────────────────────────────────────────────────

/**
 * Probability score: 0-55 points
 * This is the primary axis. High probability = high score regardless of edge.
 * 
 * 90% prob → 55 pts (near-certain)
 * 75% prob → 41 pts (strong)
 * 60% prob → 33 pts (minimum qualifying)
 * 50% prob → 27 pts (coin flip — research only)
 * 38% prob → 21 pts (longshot)
 */
function calcProbabilityScore(prob: number): number {
  // Sigmoid-like curve that rewards high probabilities disproportionately
  // prob is 0-100
  const p = prob / 100;
  
  // Base linear: p × 55
  // But we want to reward 70%+ more than 50-60%
  // Apply a convex curve above 60%
  if (p >= 0.70) {
    // Strong acceleration above 70%
    return Math.round(Math.min(55, 30 + (p - 0.60) * 125));
  } else if (p >= 0.60) {
    // Linear from 60%-70%: 27 to 30 pts
    return Math.round(27 + (p - 0.60) * 30);
  } else {
    // Below 60%: linear 0 to 27
    return Math.round(p * 45);
  }
}

/**
 * Value bonus: 0-25 points
 * Edge contributes value, but CAPPED at 25 pts.
 * A massive edge at low probability still can't overcome a low probability score.
 * 
 * Edge +15%+ → 25 pts
 * Edge +8%   → 18 pts
 * Edge +4%   → 12 pts
 * Edge +1%   → 5 pts
 * Edge 0%    → 0 pts
 * Edge <0%   → 0 pts (negative edge gives no bonus, but doesn't penalize PQS)
 */
function calcValueBonus(edge: number | null): number {
  if (edge === null || edge <= 0) return 0;
  // Sqrt curve: rewards moderate edge, diminishing returns above 10%
  return Math.round(Math.min(25, Math.sqrt(edge / 15) * 25));
}

/**
 * Consistency score: 0-12 points
 * Rewards agreement between Poisson model and historical hit rate.
 * If both say 75%, that's more reliable than model saying 75% but history saying 40%.
 * 
 * Agreement within 5%  → 12 pts
 * Agreement within 10% → 8 pts
 * Agreement within 20% → 4 pts
 * Disagreement >20%    → 0 pts (or small sample — discounted)
 */
function calcConsistencyScore(
  poissonProb: number,
  historicalHitRate: number | null,
  sampleSize: number
): number {
  if (historicalHitRate === null || sampleSize < 3) {
    // No history — neutral score (6 pts) so lack of data doesn't punish picks
    return 6;
  }

  const gap = Math.abs(poissonProb - historicalHitRate);
  
  // Weight by sample size — small samples get partial credit
  const sampleWeight = Math.min(1.0, sampleSize / 7);
  
  let rawScore: number;
  if (gap <= 5) rawScore = 12;
  else if (gap <= 10) rawScore = 8;
  else if (gap <= 20) rawScore = 4;
  else rawScore = 0;

  return Math.round(rawScore * sampleWeight);
}

/**
 * Odds quality score: 0-8 points
 * Rewards picks with reasonable pricing (not ultra-juiced).
 * A pick at -115 (near fair odds) scores higher than -400 (too much juice).
 * 
 * +100 to -130  → 8 pts (great pricing)
 * -130 to -200  → 5 pts (acceptable)
 * -200 to -350  → 2 pts (juiced)
 * -350+         → 0 pts (ultra-juiced)
 * No odds       → 4 pts (neutral)
 */
function calcOddsQualityScore(bookOdds: number | null): number {
  if (bookOdds === null) return 4; // neutral
  if (bookOdds >= -130) return 8;
  if (bookOdds >= -200) return 5;
  if (bookOdds >= -350) return 2;
  return 0;
}

// ─── Main PQS calculator ──────────────────────────────────────────────────────

export function calculatePQS(input: PQSInput): PQSResult {
  const { poissonProb, bookOdds, historicalHitRate, historicalSampleSize, matrixScore } = input;

  // Compute vig-free edge if odds are available
  let edge: number | null = null;
  let ev: number | null = null;
  let impliedProbBook: number | null = null;

  if (bookOdds !== null) {
    const rawImplied = americanToImpliedProbability(bookOdds); // 0-1
    const vigFreeImplied = (rawImplied / 1.045) * 100; // 0-100
    impliedProbBook = Math.round(vigFreeImplied * 10) / 10;
    edge = Math.round((poissonProb - vigFreeImplied) * 10) / 10;
    ev = calcEV(poissonProb, bookOdds);
  }

  const fairOdds = probToAmericanOdds(poissonProb);

  // Component scores
  const probabilityScore = calcProbabilityScore(poissonProb);
  const valueBonus = calcValueBonus(edge);
  const consistencyScore = calcConsistencyScore(poissonProb, historicalHitRate, historicalSampleSize);
  const oddsQualityScore = calcOddsQualityScore(bookOdds);

  // Raw PQS
  const rawPQS = probabilityScore + valueBonus + consistencyScore + oddsQualityScore;

  // Matrix score blended in as a small contextual signal (max 5 pts)
  // This prevents the 10-factor matrix from being ignored entirely
  const matrixBonus = Math.round((matrixScore / 100) * 5);
  const pqs = Math.min(100, Math.round(rawPQS + matrixBonus));

  // Determine tier — BOTH PQS and probability must pass
  let tier: PQSTier;
  let qualifies: boolean;
  let tierLabel: string;
  let tierReason: string;
  let qualifyReason: string | null = null;

  if (pqs >= 75 && poissonProb >= 70) {
    tier = 'ELITE';
    qualifies = true;
    tierLabel = 'Elite Pick';
    tierReason = `${poissonProb.toFixed(0)}% hit probability with strong supporting factors`;
  } else if (pqs >= 60 && poissonProb >= 60) {
    tier = 'STRONG';
    qualifies = true;
    tierLabel = 'Strong Play';
    tierReason = `${poissonProb.toFixed(0)}% hit probability — solid play`;
  } else if (pqs >= 45 && poissonProb >= 50) {
    tier = 'LEAN';
    qualifies = true; // shows on board with warning
    tierLabel = 'Lean';
    tierReason = `${poissonProb.toFixed(0)}% hit probability — below official threshold`;
  } else {
    tier = 'RESEARCH';
    qualifies = false;
    tierLabel = 'Research Only';
    tierReason = 'Does not meet minimum probability threshold';
    
    if (poissonProb < 50) {
      qualifyReason = `Model probability ${poissonProb.toFixed(0)}% is below the 50% minimum — expected to miss more than hit`;
    } else if (pqs < 45) {
      qualifyReason = `PQS ${pqs} below minimum 45 — insufficient supporting factors`;
    } else {
      qualifyReason = 'Does not meet combined probability + quality threshold';
    }
  }

  return {
    pqs,
    tier,
    qualifies,
    components: {
      probabilityScore,
      valueBonus,
      consistencyScore,
      oddsQualityScore,
    },
    poissonProb,
    edge,
    ev,
    fairOdds,
    impliedProbBook,
    tierLabel,
    tierReason,
    qualifyReason,
  };
}

/**
 * Filter and sort picks using PQS.
 * 
 * Replaces the current overallScore-based sorting in hrrPicksService.ts.
 * 
 * Usage:
 *   const ranked = rankByPQS(enrichedPicks, { maxPicks: 6, minTier: 'STRONG' });
 */
export interface PQSRankInput {
  playerName: string;
  overallScore: number;       // from aiRankingService (matrix score)
  overProbability: number;    // Poisson over probability (0-100)
  bookOdds?: string | null;   // American odds string e.g. "-115"
  historicalHitRate?: number | null;
  historicalSampleSize?: number;
  [key: string]: any;         // pass-through for other fields
}

export interface PQSRankOptions {
  maxPicks?: number;          // default 6
  minTier?: PQSTier;          // default 'STRONG' — 'LEAN' shows leans too
  allowLeanWithWarning?: boolean; // if true, LEAN picks show with disclaimer
}

export function rankByPQS(
  picks: PQSRankInput[],
  options: PQSRankOptions = {}
): Array<PQSRankInput & { pqsResult: PQSResult }> {
  const {
    maxPicks = 6,
    minTier = 'STRONG',
    allowLeanWithWarning = true,
  } = options;

  // Compute PQS for each pick
  const scored = picks.map(pick => {
    const bookOddsNum = pick.bookOdds
      ? parseInt(String(pick.bookOdds).replace(/[^0-9+-]/g, ''), 10)
      : null;

    const pqsResult = calculatePQS({
      poissonProb: pick.overProbability,
      bookOdds: isNaN(bookOddsNum as number) ? null : bookOddsNum,
      historicalHitRate: pick.historicalHitRate ?? null,
      historicalSampleSize: pick.historicalSampleSize ?? 0,
      matrixScore: pick.overallScore,
    });

    return { ...pick, pqsResult };
  });

  // Determine minimum qualifying tier
  const tierOrder: PQSTier[] = ['ELITE', 'STRONG', 'LEAN', 'RESEARCH'];
  const minTierIndex = tierOrder.indexOf(minTier);

  // Filter: must qualify AND meet minimum tier
  const qualified = scored.filter(p => {
    const pickTierIndex = tierOrder.indexOf(p.pqsResult.tier);
    if (!p.pqsResult.qualifies) return false;
    if (pickTierIndex > minTierIndex) {
      // Below minimum tier — only include LEAN if allowLeanWithWarning
      if (p.pqsResult.tier === 'LEAN' && allowLeanWithWarning) return true;
      return false;
    }
    return true;
  });

  // Sort by PQS descending, tiebreak by poissonProb
  qualified.sort((a, b) => {
    const pqsDiff = b.pqsResult.pqs - a.pqsResult.pqs;
    if (Math.abs(pqsDiff) > 2) return pqsDiff;
    return b.pqsResult.poissonProb - a.pqsResult.poissonProb;
  });

  return qualified.slice(0, maxPicks);
}

/**
 * Get a human-readable explanation of why a pick qualifies or doesn't.
 * Used in the "Why This Play" section of pick cards.
 */
export function getPQSExplanation(result: PQSResult): {
  headline: string;
  bullets: string[];
  riskNote: string | null;
} {
  const bullets: string[] = [];

  // Probability bullet
  if (result.poissonProb >= 75) {
    bullets.push(`${result.poissonProb.toFixed(0)}% Poisson model probability — high-confidence play`);
  } else if (result.poissonProb >= 60) {
    bullets.push(`${result.poissonProb.toFixed(0)}% model probability — solid qualifying play`);
  } else {
    bullets.push(`${result.poissonProb.toFixed(0)}% model probability — below ideal threshold`);
  }

  // Edge bullet
  if (result.edge !== null && result.edge > 0) {
    bullets.push(`+${result.edge.toFixed(1)}% edge over sportsbook implied probability`);
  } else if (result.edge !== null && result.edge < 0) {
    bullets.push(`Book is ${Math.abs(result.edge).toFixed(1)}% ahead of model — reduced value`);
  } else {
    bullets.push(`No sportsbook odds — model-derived line used`);
  }

  // Consistency bullet
  if (result.components.consistencyScore >= 10) {
    bullets.push(`Strong agreement between model and historical performance`);
  } else if (result.components.consistencyScore >= 6) {
    bullets.push(`Moderate consistency between model and recent history`);
  } else {
    bullets.push(`Model and recent history show divergence — higher uncertainty`);
  }

  // EV bullet
  if (result.ev !== null && result.ev > 0) {
    bullets.push(`+${result.ev.toFixed(1)}% expected value per $100 wagered`);
  }

  const headline = result.tier === 'ELITE'
    ? `Elite Play — ${result.poissonProb.toFixed(0)}% probability, PQS ${result.pqs}`
    : result.tier === 'STRONG'
    ? `Strong Play — ${result.poissonProb.toFixed(0)}% probability, PQS ${result.pqs}`
    : result.tier === 'LEAN'
    ? `Lean — ${result.poissonProb.toFixed(0)}% probability (below official threshold)`
    : `Research Only — ${result.qualifyReason}`;

  const riskNote = result.tier === 'LEAN'
    ? 'This pick is below the official qualification threshold. Not tracked in results.'
    : result.poissonProb < 65
    ? `Model probability of ${result.poissonProb.toFixed(0)}% means this misses ~${(100 - result.poissonProb).toFixed(0)}% of the time.`
    : null;

  return { headline, bullets, riskNote };
}

/**
 * The single qualifying threshold check used in hrrPicksService.ts.
 * Call this instead of the current `overallScore >= 78` filter.
 * 
 * Usage:
 *   const moneyPicks = enrichedPicks.filter(p => 
 *     passesQualityGate(p.overProbability, p.overallScore, p.bookOdds)
 *   );
 */
export function passesQualityGate(
  poissonProb: number,
  matrixScore: number,
  bookOdds: string | null,
  historicalHitRate: number | null = null,
  historicalSampleSize: number = 0
): boolean {
  const bookOddsNum = bookOdds
    ? parseInt(String(bookOdds).replace(/[^0-9+-]/g, ''), 10)
    : null;

  const result = calculatePQS({
    poissonProb,
    bookOdds: isNaN(bookOddsNum as number) ? null : bookOddsNum,
    historicalHitRate,
    historicalSampleSize,
    matrixScore,
  });

  // Official picks: STRONG or ELITE only (prob >= 60%, PQS >= 60)
  return result.tier === 'ELITE' || result.tier === 'STRONG';
}

/**
 * Quick scoring matrix display data.
 * Shows what score a player would need to reach each tier.
 */
export function getQualificationGap(
  poissonProb: number,
  matrixScore: number,
  bookOdds: string | null
): {
  currentPQS: number;
  currentTier: PQSTier;
  gapToStrong: number;    // pts needed to reach STRONG (0 if already there)
  gapToElite: number;     // pts needed to reach ELITE (0 if already there)
  primaryBlocker: string; // what's holding it back
} {
  const bookOddsNum = bookOdds
    ? parseInt(String(bookOdds).replace(/[^0-9+-]/g, ''), 10)
    : null;

  const result = calculatePQS({
    poissonProb,
    bookOdds: isNaN(bookOddsNum as number) ? null : bookOddsNum,
    historicalHitRate: null,
    historicalSampleSize: 0,
    matrixScore,
  });

  const gapToStrong = Math.max(0, 60 - result.pqs);
  const gapToElite = Math.max(0, 75 - result.pqs);

  let primaryBlocker = '';
  if (poissonProb < 60) {
    primaryBlocker = `Model probability ${poissonProb.toFixed(0)}% too low (need 60%+)`;
  } else if (result.pqs < 60) {
    primaryBlocker = `PQS ${result.pqs} below threshold (need 60+)`;
  } else if (poissonProb < 70 && result.pqs < 75) {
    primaryBlocker = `Need 70%+ probability for Elite tier`;
  } else {
    primaryBlocker = 'Meets all thresholds';
  }

  return {
    currentPQS: result.pqs,
    currentTier: result.tier,
    gapToStrong,
    gapToElite,
    primaryBlocker,
  };
}
