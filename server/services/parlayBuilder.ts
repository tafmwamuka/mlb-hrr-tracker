/**
 * Parlay Builder — Diamond Edge
 *
 * Provides:
 *   1. Parlay math utilities (odds conversion, combined odds, EV)
 *   2. Sportsbook pricing penalty tiers
 *   3. Multi-factor play scorer (modelProb + edge + EV + pricing + fairOddsDiff)
 *   4. Three parlay category builders:
 *      🏆 SAFEST    — highest hit probability, target +100 minimum
 *      💎 BEST VALUE — highest positive EV, largest model vs book gap, target +100–+250
 *      🚀 PLUS MONEY — must finish at plus odds, target +150–+400, positive EV required
 *   5. Ultra-Juiced filter: plays worse than -1000 → research-only
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
  // Approximate vig removal: assume ~5% overround for favorites
  const raw = impliedProbFromAmerican(american);
  // For heavy favorites the vig is smaller as a fraction; use raw as approximation
  // A more precise approach would require both sides, but we only have the over side
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

export type PricingPenaltyTier =
  | 'NONE'        // -110 to -400: no penalty
  | 'SMALL'       // -401 to -600: small penalty
  | 'MODERATE'    // -601 to -1000: moderate penalty
  | 'HEAVY'       // worse than -1000: heavy penalty
  | 'ULTRA_JUICED'; // worse than -1000: research only (same threshold, different label)

export interface PricingPenalty {
  tier: PricingPenaltyTier;
  multiplier: number;   // 1.0 = no penalty, 0.5 = 50% score reduction
  label: string;
  isUltraJuiced: boolean;
}

/**
 * Returns the pricing penalty for a given American odds value.
 * Penalties reduce the composite score to discourage stacking heavy favorites.
 */
export function getPricingPenalty(american: number): PricingPenalty {
  // Only applies to negative (favorite) odds
  if (american >= 0) {
    return { tier: 'NONE', multiplier: 1.0, label: 'No penalty', isUltraJuiced: false };
  }

  const abs = Math.abs(american);

  if (abs <= 400) {
    return { tier: 'NONE', multiplier: 1.0, label: 'No penalty', isUltraJuiced: false };
  }
  if (abs <= 600) {
    return { tier: 'SMALL', multiplier: 0.85, label: 'Small penalty (-401 to -600)', isUltraJuiced: false };
  }
  if (abs <= 1000) {
    return { tier: 'MODERATE', multiplier: 0.65, label: 'Moderate penalty (-601 to -1000)', isUltraJuiced: false };
  }
  // Worse than -1000
  return { tier: 'ULTRA_JUICED', multiplier: 0.35, label: 'Heavy penalty (worse than -1000)', isUltraJuiced: true };
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

  // Composite score (0-100)
  compositeScore: number;

  // Parlay eligibility
  inPreferredRange: boolean;  // -150 to -250
  inAvoidRange: boolean;      // worse than -500

  // Source metadata
  source: 'pitcher' | 'hitter';
  pitcherName?: string;       // for hitter plays
  gameTime?: string;
}

/**
 * Compute a composite score for a play using multi-factor weighting.
 *
 * Weights:
 *   - Model Probability:  35%
 *   - Edge %:             25%
 *   - Expected Value:     20%
 *   - Pricing (penalty):  10% (negative impact from heavy favorites)
 *   - Fair Odds Diff:     10%
 */
export function computeCompositeScore(params: {
  modelProbability: number;
  edge: number;
  ev: number;
  bookOdds: number;
  fairOdds: number;
}): number {
  const { modelProbability, edge, ev, bookOdds, fairOdds } = params;

  // 1. Model probability component (0-35)
  const probScore = Math.min(35, modelProbability * 35);

  // 2. Edge component (0-25) — edge of 0.10 (10%) = full 25 pts
  const edgeScore = Math.min(25, Math.max(0, edge * 250));

  // 3. EV component (0-20) — EV of +$20 per $100 = full 20 pts
  const evScore = Math.min(20, Math.max(0, (ev / 20) * 20));

  // 4. Pricing penalty component (0-10) — no penalty = 10 pts, ultra-juiced = 0
  const penalty = getPricingPenalty(bookOdds);
  const pricingScore = 10 * penalty.multiplier;

  // 5. Fair odds difference component (0-10)
  // Positive = model thinks it's worth more than book is pricing
  const fairDecimal = americanToDecimal(fairOdds);
  const bookDecimal = americanToDecimal(bookOdds);
  const fairDiff = fairDecimal - bookDecimal;
  const fairScore = Math.min(10, Math.max(0, fairDiff * 20));

  const raw = probScore + edgeScore + evScore + pricingScore + fairScore;
  return Math.round(Math.min(100, Math.max(0, raw)));
}

/**
 * Convert a PitcherEdgePick or EnrichedMoneyPick into a ScoredPlay.
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
    compositeScore,
    inPreferredRange: pick.bookOdds < 0 && absOdds >= 150 && absOdds <= 250,
    inAvoidRange: pick.bookOdds < 0 && absOdds > 500,
    source: 'pitcher',
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
    compositeScore,
    inPreferredRange: pick.bookOdds < 0 && absOdds >= 150 && absOdds <= 250,
    inAvoidRange: pick.bookOdds < 0 && absOdds > 500,
    source: 'hitter',
    pitcherName: pick.pitcher,
    gameTime: pick.gameTime,
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
 * Rules:
 * - Prefer legs from different games (different pitcherTeam/team)
 * - Preferred odds range per leg: -150 to -250
 * - Avoid -500 or worse unless no comparable value plays exist
 * - Ultra-juiced plays (-1000+) are excluded from all parlays
 *
 * SAFEST:    Highest combined hit probability. Can use stronger favorites.
 *            Target: +100 minimum combined.
 * BEST VALUE: Highest positive EV. Largest model vs book gap.
 *            Target: +100 to +250 combined.
 * PLUS MONEY: Must finish at plus odds. Positive EV required.
 *            Target: +150 to +400 combined.
 */
export function buildParlays(plays: ScoredPlay[]): {
  safestParlay: BuiltParlay | null;
  bestValueParlay: BuiltParlay | null;
  plusMoneyParlay: BuiltParlay | null;
  ultraJuicedPlays: ScoredPlay[];
} {
  // Separate ultra-juiced plays
  const ultraJuiced = plays.filter(p => p.isUltraJuiced);
  const eligible = plays.filter(p => !p.isUltraJuiced && p.bookOdds !== 0);

  // Filter to plays with positive EV for value/plus-money parlays
  const positiveEVPlays = eligible.filter(p => p.ev > 0);

  // ── SAFEST PARLAY ─────────────────────────────────────────────────────────
  // Rank by modelProbability desc, then compositeScore desc
  // Prefer plays in -150 to -400 range (not too light, not too heavy)
  const safestCandidates = [...eligible].sort((a, b) => {
    // Prefer preferred range
    const aPreferred = Math.abs(a.bookOdds) >= 150 && Math.abs(a.bookOdds) <= 400;
    const bPreferred = Math.abs(b.bookOdds) >= 150 && Math.abs(b.bookOdds) <= 400;
    if (aPreferred && !bPreferred) return -1;
    if (!aPreferred && bPreferred) return 1;
    return b.modelProbability - a.modelProbability;
  });

  const safestLegs = pickDiverseLegs(safestCandidates, 2);
  const safestParlay = safestLegs.length >= 2
    ? buildParlayResult('SAFEST', '🏆 Safest Parlay', '🏆', safestLegs, '+100')
    : null;

  // ── BEST VALUE PARLAY ─────────────────────────────────────────────────────
  // Rank by EV desc, then edge desc
  // Prefer plays in -150 to -250 range
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
  // Must finish at plus odds (+150 to +400)
  // Positive EV required per leg
  // Prefer lighter lines that contribute to plus-money combined odds
  // Target legs around -175 to -225 each
  const plusMoneyCandidates = [...positiveEVPlays].sort((a, b) => {
    // Prefer legs that will produce plus-money combined odds
    // Lighter odds = better for plus-money target
    const aAbs = Math.abs(a.bookOdds);
    const bAbs = Math.abs(b.bookOdds);
    // Prefer range -150 to -225 for plus-money construction
    const aIdeal = aAbs >= 150 && aAbs <= 225;
    const bIdeal = bAbs >= 150 && bAbs <= 225;
    if (aIdeal && !bIdeal) return -1;
    if (!aIdeal && bIdeal) return 1;
    // Among equals, prefer higher EV
    return b.ev - a.ev;
  });

  // Try to find 2 legs that produce +150 to +400 combined
  const plusMoneyLegs = pickPlusMoneyLegs(plusMoneyCandidates);
  const plusMoneyParlay = plusMoneyLegs.length >= 2
    ? buildParlayResult('PLUS_MONEY', '🚀 Plus Money Parlay', '🚀', plusMoneyLegs, '+150 to +400')
    : null;

  return {
    safestParlay,
    bestValueParlay,
    plusMoneyParlay,
    ultraJuicedPlays: ultraJuiced,
  };
}

/** Pick 2 legs from diverse teams/games */
function pickDiverseLegs(candidates: ScoredPlay[], count: number): ScoredPlay[] {
  const selected: ScoredPlay[] = [];
  const usedTeams = new Set<string>();

  for (const play of candidates) {
    if (selected.length >= count) break;
    // Avoid same team in both legs
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

/** Pick 2 legs that produce combined odds of +150 to +400 */
function pickPlusMoneyLegs(candidates: ScoredPlay[]): ScoredPlay[] {
  // Try all pairs from top 10 candidates
  const pool = candidates.slice(0, 10);

  let bestPair: ScoredPlay[] = [];
  let bestScore = -Infinity;

  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i];
      const b = pool[j];

      // Avoid same team
      if (a.team === b.team) continue;

      const combined = parlayAmericanOdds([a.bookOdds, b.bookOdds]);

      // Must be plus money
      if (combined < 100) continue;

      // Prefer +150 to +400 range
      const inTarget = combined >= 150 && combined <= 400;
      const combinedEV = parlayEV(
        [a.modelProbability, b.modelProbability],
        [a.bookOdds, b.bookOdds]
      );

      // Score this pair: prefer in-target + positive EV + high composite
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
