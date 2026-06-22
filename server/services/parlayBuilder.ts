/**
 * Parlay Builder — Diamond Edge
 *
 * Provides:
 *   1. Parlay math utilities (odds conversion, combined odds, EV)
 *   2. Sportsbook pricing penalty tiers (updated thresholds)
 *   3. Multi-factor play scorer (modelProb + edge + EV + pricing + fairOddsDiff)
 *   4. Best Single Value Play finder (target +110 to -105)
 *   5. Three parlay category builders:
 *      🏆 SAFEST    — highest hit probability, target +100 minimum
 *      💎 BEST VALUE — highest positive EV, largest model vs book gap, target +100–+250
 *      🚀 PLUS MONEY — must finish at plus odds, target +150–+400, positive EV required
 *   6. Ultra-Juiced filter: plays worse than -600 → research-only
 *
 * PRICING TIERS (updated):
 *   VALUE ZONE:        +110 to -400   → No penalty (preferred)
 *   ACCEPTABLE JUICED: -401 to -600   → Small penalty
 *   RESEARCH ONLY:     worse than -600 → Ultra-Juiced, excluded from recommendations
 *
 * PARLAY LEG TARGETS:
 *   Preferred leg range: -150 to -400
 *   Preferred final odds: +100 to +300
 *   Avoid: worse than -600
 */

// ─── Odds Math ────────────────────────────────────────────────────────────────

/** Convert American odds to decimal odds */
export function americanToDecimal(american: number): number {
  if (american > 0) return american / 100 + 1;
  return 100 / Math.abs(american) + 1;
}

/** Convert decimal odds to American odds */
export function decimalToAmerican(decimal: number): number {
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

/** Implied probability from American odds (includes vig) */
export function impliedProbFromAmerican(american: number): number {
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

/** Vig-free implied probability (removes overround from a single side) */
export function vigFreeProb(american: number): number {
  const raw = impliedProbFromAmerican(american);
  return Math.min(0.99, Math.max(0.01, raw * 0.95));
}

/** Calculate combined parlay decimal odds from array of American odds */
export function parlayDecimalOdds(legs: number[]): number {
  return legs.reduce((acc, american) => acc * americanToDecimal(american), 1);
}

/** Calculate combined parlay American odds from array of American odds */
export function parlayAmericanOdds(legs: number[]): number {
  const decimal = parlayDecimalOdds(legs);
  return decimalToAmerican(decimal);
}

/** Expected Value for a $100 bet: EV = (prob * profit) - ((1 - prob) * stake) */
export function calcEV(modelProb: number, american: number): number {
  const decimal = americanToDecimal(american);
  const profit = (decimal - 1) * 100;
  const ev = modelProb * profit - (1 - modelProb) * 100;
  return Math.round(ev * 10) / 10;
}

/** Combined parlay hit probability (product of individual probs) */
export function parlayHitProb(probs: number[]): number {
  return probs.reduce((acc, p) => acc * p, 1);
}

/** Combined parlay EV for a $100 bet */
export function parlayEV(probs: number[], americanOdds: number[]): number {
  const combinedProb = parlayHitProb(probs);
  const combinedAmerican = parlayAmericanOdds(americanOdds);
  return calcEV(combinedProb, combinedAmerican);
}

// ─── Sportsbook Pricing Penalty ───────────────────────────────────────────────

/**
 * UPDATED TIERS:
 *   NONE        — +110 to -400  (Value Zone, preferred)
 *   SMALL       — -401 to -600  (Acceptable Juiced)
 *   ULTRA_JUICED — worse than -600 (Research Only, excluded from recommendations)
 */
export type PricingPenaltyTier =
  | 'NONE'         // +110 to -400: Value Zone, no penalty
  | 'SMALL'        // -401 to -600: Acceptable Juiced, small penalty
  | 'ULTRA_JUICED'; // worse than -600: Research Only, excluded from all recommendations

export interface PricingPenalty {
  tier: PricingPenaltyTier;
  multiplier: number;   // 1.0 = no penalty, 0.0 = fully excluded
  label: string;
  isUltraJuiced: boolean;
  zone: 'VALUE' | 'ACCEPTABLE' | 'RESEARCH_ONLY';
}

/**
 * Returns the pricing penalty for a given American odds value.
 *
 * Value Zone (+110 to -400):    No penalty — preferred for all recommendations
 * Acceptable Juiced (-401 to -600): Small penalty — usable but not ideal
 * Research Only (worse than -600): Ultra-Juiced — excluded from all recommendations
 */
export function getPricingPenalty(american: number): PricingPenalty {
  // Plus money or near-even odds — Value Zone
  if (american >= -400) {
    return {
      tier: 'NONE',
      multiplier: 1.0,
      label: 'Value Zone (+110 to -400)',
      isUltraJuiced: false,
      zone: 'VALUE',
    };
  }

  const abs = Math.abs(american);

  // -401 to -600: Acceptable Juiced
  if (abs <= 600) {
    return {
      tier: 'SMALL',
      multiplier: 0.75,
      label: 'Acceptable Juiced (-401 to -600)',
      isUltraJuiced: false,
      zone: 'ACCEPTABLE',
    };
  }

  // Worse than -600: Research Only
  return {
    tier: 'ULTRA_JUICED',
    multiplier: 0.0,
    label: 'Research Only (worse than -600)',
    isUltraJuiced: true,
    zone: 'RESEARCH_ONLY',
  };
}

// ─── Value Zone Check ─────────────────────────────────────────────────────────

/** Check if odds are in the Best Single Value Play target range (+110 to -105) */
export function isValueZoneTarget(american: number): boolean {
  // +110 to -105: near-even money, best single bet value zone
  if (american >= 110) return true;  // +110 or better (plus money)
  if (american < 0 && Math.abs(american) <= 105) return true;  // -105 or lighter
  return false;
}

/** Check if odds are in the preferred parlay leg range (-150 to -400) */
export function isPreferredParlayLeg(american: number): boolean {
  if (american < 0) {
    const abs = Math.abs(american);
    return abs >= 150 && abs <= 400;
  }
  return false;
}

// ─── Multi-Factor Play Scorer ─────────────────────────────────────────────────

export interface ScoredPlay {
  // Identity
  playerName: string;
  team: string;
  propType: string;       // e.g. "strikeouts", "walks", "hits", "runs", "rbi"
  line: number;
  bookOdds: number;       // American odds from sportsbook
  fairOdds: number;       // Model's fair American odds

  // Core metrics
  modelProbability: number;   // 0-1
  impliedProbability: number; // vig-free 0-1
  edge: number;               // modelProb - impliedProb (0-1)
  edgePct: number;            // edge * 100
  ev: number;                 // Expected value per $100

  // Pricing
  pricingPenalty: PricingPenalty;
  isUltraJuiced: boolean;

  // Zone flags
  isValueZoneTarget: boolean;   // +110 to -105 (Best Single Value Play target)
  inPreferredRange: boolean;    // -150 to -400 (preferred parlay leg)
  inAvoidRange: boolean;        // worse than -600 (research only)

  // Composite score (0-100)
  compositeScore: number;

  // Source metadata
  source: 'pitcher' | 'hitter';
  pitcherName?: string;       // for hitter plays
  gameTime?: string;
}

/**
 * Compute a composite score for a play using multi-factor weighting.
 *
 * Priority order (per spec):
 *   1. Positive EV:              25%
 *   2. Reasonable sportsbook price: 20% (pricing penalty applied)
 *   3. Strong model probability: 25%
 *   4. Edge %:                   20%
 *   5. Fair odds difference:     10%
 */
export function computeCompositeScore(params: {
  modelProbability: number;
  edge: number;
  ev: number;
  bookOdds: number;
  fairOdds: number;
}): number {
  const { modelProbability, edge, ev, bookOdds, fairOdds } = params;

  // 1. EV component (0-25) — EV of +$25 per $100 = full 25 pts
  const evScore = Math.min(25, Math.max(0, (ev / 25) * 25));

  // 2. Pricing component (0-20) — Value Zone = 20 pts, Acceptable = 15 pts, Research = 0
  const penalty = getPricingPenalty(bookOdds);
  const pricingScore = 20 * penalty.multiplier;

  // 3. Model probability component (0-25)
  const probScore = Math.min(25, modelProbability * 25);

  // 4. Edge component (0-20) — edge of 0.10 (10%) = full 20 pts
  const edgeScore = Math.min(20, Math.max(0, edge * 200));

  // 5. Fair odds difference component (0-10)
  const fairDecimal = americanToDecimal(fairOdds);
  const bookDecimal = americanToDecimal(bookOdds);
  const fairDiff = fairDecimal - bookDecimal;
  const fairScore = Math.min(10, Math.max(0, fairDiff * 20));

  const raw = evScore + pricingScore + probScore + edgeScore + fairScore;
  return Math.round(Math.min(100, Math.max(0, raw)));
}

/**
 * Convert a PitcherEdgePick into a ScoredPlay.
 */
export function scorePitcherPlay(pick: {
  pitcherName: string;
  pitcherTeam: string;
  opponentTeam: string;
  propType: 'strikeouts' | 'walks';
  line: number;
  bookOdds: number;
  fairOdds: number;
  modelProbability: number;
  impliedProbability: number;
  edge: number;
  gameTime?: string;
}): ScoredPlay {
  const ev = calcEV(pick.modelProbability, pick.bookOdds);
  const penalty = getPricingPenalty(pick.bookOdds);
  const edgePct = Math.round(pick.edge * 1000) / 10;
  const absOdds = Math.abs(pick.bookOdds);

  const compositeScore = computeCompositeScore({
    modelProbability: pick.modelProbability,
    edge: pick.edge,
    ev,
    bookOdds: pick.bookOdds,
    fairOdds: pick.fairOdds,
  });

  return {
    playerName: pick.pitcherName,
    team: pick.pitcherTeam,
    propType: pick.propType,
    line: pick.line,
    bookOdds: pick.bookOdds,
    fairOdds: pick.fairOdds,
    modelProbability: pick.modelProbability,
    impliedProbability: pick.impliedProbability,
    edge: pick.edge,
    edgePct,
    ev,
    pricingPenalty: penalty,
    isUltraJuiced: penalty.isUltraJuiced,
    isValueZoneTarget: isValueZoneTarget(pick.bookOdds),
    inPreferredRange: pick.bookOdds < 0 && absOdds >= 150 && absOdds <= 400,
    inAvoidRange: penalty.isUltraJuiced,
    source: 'pitcher',
    compositeScore,
    gameTime: pick.gameTime,
  };
}

export function scoreHitterPlay(pick: {
  playerName: string;
  team: string;
  pitcher?: string;
  propType: string;
  line: number;
  bookOdds: number;
  fairLine: number;
  modelProbability: number;
  edge: number;
  gameTime?: string;
}): ScoredPlay {
  const impliedProb = vigFreeProb(pick.bookOdds);
  const ev = calcEV(pick.modelProbability, pick.bookOdds);
  const penalty = getPricingPenalty(pick.bookOdds);
  const edgePct = Math.round(pick.edge * 1000) / 10;
  const absOdds = Math.abs(pick.bookOdds);

  const compositeScore = computeCompositeScore({
    modelProbability: pick.modelProbability,
    edge: pick.edge,
    ev,
    bookOdds: pick.bookOdds,
    fairOdds: pick.fairLine,
  });

  return {
    playerName: pick.playerName,
    team: pick.team,
    propType: pick.propType,
    line: pick.line,
    bookOdds: pick.bookOdds,
    fairOdds: pick.fairLine,
    modelProbability: pick.modelProbability,
    impliedProbability: impliedProb,
    edge: pick.edge,
    edgePct,
    ev,
    pricingPenalty: penalty,
    isUltraJuiced: penalty.isUltraJuiced,
    isValueZoneTarget: isValueZoneTarget(pick.bookOdds),
    inPreferredRange: pick.bookOdds < 0 && absOdds >= 150 && absOdds <= 400,
    inAvoidRange: penalty.isUltraJuiced,
    source: 'hitter',
    pitcherName: pick.pitcher,
    compositeScore,
    gameTime: pick.gameTime,
  };
}

// ─── Best Single Value Play ───────────────────────────────────────────────────

export interface BestSingleValuePlay {
  play: ScoredPlay;
  qualificationReasons: string[];
  confidenceLabel: string;   // "High", "Medium", "Low"
  confidenceScore: number;   // 0-100
}

/**
 * Find the best single straight-bet value play.
 *
 * Target: +110 to -105 odds (near-even money)
 * Requirements:
 *   - Positive EV
 *   - Strong model edge (>= 3%)
 *   - Live sportsbook odds (bookOdds !== 0)
 *   - Not ultra-juiced
 *   - No major red flags
 *
 * Falls back to best positive-EV play in Value Zone if no near-even plays exist.
 */
export function findBestSingleValuePlay(plays: ScoredPlay[]): BestSingleValuePlay | null {
  const eligible = plays.filter(p =>
    !p.isUltraJuiced &&
    p.bookOdds !== 0 &&
    p.ev > 0 &&
    p.edge >= 0.03  // minimum 3% edge
  );

  if (eligible.length === 0) return null;

  // First priority: plays in the value zone target (+110 to -105)
  const valueZonePlays = eligible.filter(p => p.isValueZoneTarget);

  // Second priority: best positive-EV play in the full Value Zone (+110 to -400)
  const valueZoneFallback = eligible.filter(p => !p.isUltraJuiced && p.pricingPenalty.zone === 'VALUE');

  // Pick the best candidate
  const candidates = valueZonePlays.length > 0 ? valueZonePlays : valueZoneFallback;
  if (candidates.length === 0) return null;

  // Sort by composite score desc
  const sorted = [...candidates].sort((a, b) => b.compositeScore - a.compositeScore);
  const best = sorted[0];

  // Build qualification reasons
  const reasons: string[] = [];

  if (best.ev > 0) {
    reasons.push(`Positive EV: +$${best.ev.toFixed(1)} per $100`);
  }
  if (best.edgePct >= 5) {
    reasons.push(`Strong model edge: ${best.edgePct.toFixed(1)}% over sportsbook`);
  } else if (best.edgePct >= 3) {
    reasons.push(`Model edge: ${best.edgePct.toFixed(1)}% over sportsbook`);
  }
  if (best.isValueZoneTarget) {
    reasons.push(`Near-even money pricing (${formatOdds(best.bookOdds)}) — optimal value zone`);
  } else {
    reasons.push(`Value Zone pricing (${formatOdds(best.bookOdds)}) — reasonable sportsbook price`);
  }
  if (best.modelProbability >= 0.65) {
    reasons.push(`High model confidence: ${Math.round(best.modelProbability * 100)}% probability`);
  } else if (best.modelProbability >= 0.55) {
    reasons.push(`Solid model confidence: ${Math.round(best.modelProbability * 100)}% probability`);
  }

  // Confidence label
  let confidenceLabel: string;
  let confidenceScore: number;
  if (best.compositeScore >= 70 && best.ev >= 10 && best.isValueZoneTarget) {
    confidenceLabel = 'High';
    confidenceScore = best.compositeScore;
  } else if (best.compositeScore >= 50 && best.ev > 0) {
    confidenceLabel = 'Medium';
    confidenceScore = best.compositeScore;
  } else {
    confidenceLabel = 'Low';
    confidenceScore = best.compositeScore;
  }

  return {
    play: best,
    qualificationReasons: reasons,
    confidenceLabel,
    confidenceScore,
  };
}

// ─── Parlay Leg ───────────────────────────────────────────────────────────────

export interface ParlayLeg {
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

export interface BuiltParlay {
  category: 'SAFEST' | 'BEST_VALUE' | 'PLUS_MONEY';
  categoryLabel: string;
  categoryIcon: string;
  legs: ParlayLeg[];
  combinedOdds: number;       // American
  combinedOddsDisplay: string; // e.g. "+125" or "-110"
  hitProbability: number;     // 0-1
  hitProbabilityPct: number;  // 0-100
  combinedEV: number;
  isPositiveEV: boolean;
  meetsOddsTarget: boolean;
  oddsTarget: string;
  legCount: number;
}

function formatOdds(american: number): string {
  return american >= 0 ? `+${american}` : `${american}`;
}

// ─── Parlay Builder ───────────────────────────────────────────────────────────

/**
 * Build the three recommended parlays from a pool of scored plays.
 *
 * UPDATED RULES:
 * - Preferred leg range: -150 to -400
 * - Preferred final parlay odds: +100 to +300
 * - Avoid: worse than -600 (ultra-juiced, research only)
 * - Ultra-juiced plays (-600+) are excluded from all parlays
 *
 * SAFEST:     Highest combined hit probability. Prefer -150 to -400 legs.
 *             Target: +100 minimum combined.
 * BEST VALUE: Highest positive EV. Largest model vs book gap.
 *             Target: +100 to +250 combined.
 * PLUS MONEY: Must finish at plus odds. Positive EV required.
 *             Target: +150 to +300 combined.
 */
export function buildParlays(plays: ScoredPlay[]): {
  safestParlay: BuiltParlay | null;
  bestValueParlay: BuiltParlay | null;
  plusMoneyParlay: BuiltParlay | null;
  ultraJuicedPlays: ScoredPlay[];
  bestSingleValuePlay: BestSingleValuePlay | null;
} {
  // Separate ultra-juiced plays (worse than -600)
  const ultraJuiced = plays.filter(p => p.isUltraJuiced);
  const eligible = plays.filter(p => !p.isUltraJuiced && p.bookOdds !== 0);

  // Find best single value play from all eligible plays
  const bestSingleValuePlay = findBestSingleValuePlay(eligible);

  // Filter to plays with positive EV for value/plus-money parlays
  const positiveEVPlays = eligible.filter(p => p.ev > 0);

  // ── SAFEST PARLAY ─────────────────────────────────────────────────────────
  // Rank by modelProbability desc, prefer -150 to -400 range
  const safestCandidates = [...eligible].sort((a, b) => {
    const aPreferred = a.inPreferredRange;
    const bPreferred = b.inPreferredRange;
    if (aPreferred && !bPreferred) return -1;
    if (!aPreferred && bPreferred) return 1;
    return b.modelProbability - a.modelProbability;
  });

  const safestLegs = pickDiverseLegs(safestCandidates, 2);
  const safestParlay = safestLegs.length >= 2
    ? buildParlayResult('SAFEST', '🏆 Safest Parlay', '🏆', safestLegs, '+100')
    : null;

  // ── BEST VALUE PARLAY ─────────────────────────────────────────────────────
  // Rank by EV desc, then edge desc, prefer -150 to -400 range
  const valueCandidates = [...positiveEVPlays].sort((a, b) => {
    const aPreferred = a.inPreferredRange;
    const bPreferred = b.inPreferredRange;
    if (aPreferred && !bPreferred) return -1;
    if (!aPreferred && bPreferred) return 1;
    if (b.ev !== a.ev) return b.ev - a.ev;
    return b.edgePct - a.edgePct;
  });

  const valueLegs = pickDiverseLegs(valueCandidates, 2);
  const bestValueParlay = valueLegs.length >= 2
    ? buildParlayResult('BEST_VALUE', '💎 Best Value Parlay', '💎', valueLegs, '+100 to +250')
    : null;

  // ── PLUS MONEY PARLAY ─────────────────────────────────────────────────────
  // Must finish at plus odds (+150 to +300)
  // Positive EV required per leg
  // Prefer lighter lines (-150 to -250) to achieve plus-money combined
  const plusMoneyCandidates = [...positiveEVPlays].sort((a, b) => {
    const aAbs = Math.abs(a.bookOdds);
    const bAbs = Math.abs(b.bookOdds);
    // Prefer -150 to -225 for plus-money construction
    const aIdeal = a.bookOdds < 0 ? (aAbs >= 150 && aAbs <= 225) : true;
    const bIdeal = b.bookOdds < 0 ? (bAbs >= 150 && bAbs <= 225) : true;
    if (aIdeal && !bIdeal) return -1;
    if (!aIdeal && bIdeal) return 1;
    return b.ev - a.ev;
  });

  // Try to find 2 legs that produce +150 to +300 combined
  const plusMoneyLegs = pickPlusMoneyLegs(plusMoneyCandidates);
  const plusMoneyParlay = plusMoneyLegs.length >= 2
    ? buildParlayResult('PLUS_MONEY', '🚀 Plus Money Parlay', '🚀', plusMoneyLegs, '+150 to +300')
    : null;

  return {
    safestParlay,
    bestValueParlay,
    plusMoneyParlay,
    ultraJuicedPlays: ultraJuiced,
    bestSingleValuePlay,
  };
}

/** Pick 2 legs from diverse teams/games */
function pickDiverseLegs(candidates: ScoredPlay[], count: number): ScoredPlay[] {
  const selected: ScoredPlay[] = [];
  const usedTeams = new Set<string>();

  for (const play of candidates) {
    if (selected.length >= count) break;
    if (usedTeams.has(play.team)) continue;
    selected.push(play);
    usedTeams.add(play.team);
  }

  // If we couldn't get diverse legs, fall back to top candidates
  if (selected.length < count) {
    for (const play of candidates) {
      if (selected.length >= count) break;
      if (!selected.includes(play)) selected.push(play);
    }
  }

  return selected;
}

/** Pick 2 legs that produce combined odds of +150 to +300 */
function pickPlusMoneyLegs(candidates: ScoredPlay[]): ScoredPlay[] {
  const pool = candidates.slice(0, 10);

  let bestPair: ScoredPlay[] = [];
  let bestScore = -Infinity;

  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i];
      const b = pool[j];

      if (a.team === b.team) continue;

      const combined = parlayAmericanOdds([a.bookOdds, b.bookOdds]);

      // Must be plus money
      if (combined < 100) continue;

      // Prefer +150 to +300 range (tightened from +400)
      const inTarget = combined >= 150 && combined <= 300;
      const combinedEV = parlayEV(
        [a.modelProbability, b.modelProbability],
        [a.bookOdds, b.bookOdds]
      );

      const pairScore = (inTarget ? 50 : 0) + (combinedEV > 0 ? 30 : 0) + (a.compositeScore + b.compositeScore) / 2;

      if (pairScore > bestScore) {
        bestScore = pairScore;
        bestPair = [a, b];
      }
    }
  }

  // If no plus-money pair found, try 3-leg parlays with lighter odds
  if (bestPair.length === 0) {
    const lightCandidates = candidates.filter(p => Math.abs(p.bookOdds) <= 300);
    if (lightCandidates.length >= 3) {
      const legs = pickDiverseLegs(lightCandidates, 3);
      const combined = parlayAmericanOdds(legs.map(l => l.bookOdds));
      if (combined >= 100) return legs;
    }
  }

  return bestPair;
}

function buildParlayResult(
  category: BuiltParlay['category'],
  categoryLabel: string,
  categoryIcon: string,
  legs: ScoredPlay[],
  oddsTarget: string,
): BuiltParlay {
  const odds = legs.map(l => l.bookOdds);
  const probs = legs.map(l => l.modelProbability);
  const combinedOdds = parlayAmericanOdds(odds);
  const hitProb = parlayHitProb(probs);
  const combinedEV = parlayEV(probs, odds);

  const parlayLegs: ParlayLeg[] = legs.map(l => ({
    playerName: l.playerName,
    team: l.team,
    propType: l.propType,
    line: l.line,
    bookOdds: l.bookOdds,
    fairOdds: l.fairOdds,
    modelProbability: l.modelProbability,
    edgePct: l.edgePct,
    ev: l.ev,
    source: l.source,
    pitcherName: l.pitcherName,
    gameTime: l.gameTime,
  }));

  return {
    category,
    categoryLabel,
    categoryIcon,
    legs: parlayLegs,
    combinedOdds,
    combinedOddsDisplay: formatOdds(combinedOdds),
    hitProbability: Math.round(hitProb * 1000) / 1000,
    hitProbabilityPct: Math.round(hitProb * 1000) / 10,
    combinedEV: Math.round(combinedEV * 10) / 10,
    isPositiveEV: combinedEV > 0,
    meetsOddsTarget: combinedOdds >= 100,
    oddsTarget,
    legCount: legs.length,
  };
}
