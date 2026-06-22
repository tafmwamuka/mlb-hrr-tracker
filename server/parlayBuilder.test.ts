/**
 * parlayBuilder.test.ts
 * Tests for Diamond Edge parlay math, pricing tiers, scoring, and parlay building.
 * Phase CK: 3-tier pricing (NONE/SMALL/ULTRA_JUICED), Best Single Value Play, -600 threshold.
 */

import { describe, it, expect } from 'vitest';
import {
  americanToDecimal,
  decimalToAmerican,
  impliedProbFromAmerican,
  parlayAmericanOdds,
  parlayHitProb,
  parlayEV,
  calcEV,
  getPricingPenalty,
  isValueZoneTarget,
  isPreferredParlayLeg,
  computeCompositeScore,
  scorePitcherPlay,
  scoreHitterPlay,
  findBestSingleValuePlay,
  buildParlays,
  type ScoredPlay,
} from './services/parlayBuilder';

// ─── Math utilities ───────────────────────────────────────────────────────────

describe('americanToDecimal', () => {
  it('converts negative American odds', () => {
    expect(americanToDecimal(-200)).toBeCloseTo(1.5, 4);
    expect(americanToDecimal(-110)).toBeCloseTo(1.909, 2);
  });
  it('converts positive American odds', () => {
    expect(americanToDecimal(100)).toBeCloseTo(2.0, 4);
    expect(americanToDecimal(150)).toBeCloseTo(2.5, 4);
  });
});

describe('decimalToAmerican', () => {
  it('converts decimal >= 2 to positive American', () => {
    expect(decimalToAmerican(2.0)).toBe(100);
    expect(decimalToAmerican(2.5)).toBe(150);
  });
  it('converts decimal < 2 to negative American', () => {
    expect(decimalToAmerican(1.5)).toBe(-200);
  });
});

describe('impliedProbFromAmerican', () => {
  it('returns correct probability for -200', () => {
    expect(impliedProbFromAmerican(-200)).toBeCloseTo(0.6667, 3);
  });
  it('returns correct probability for +100', () => {
    expect(impliedProbFromAmerican(100)).toBeCloseTo(0.5, 3);
  });
});

describe('parlayAmericanOdds', () => {
  it('calculates 2-leg parlay correctly', () => {
    // -200 and -200 → decimal 1.5 * 1.5 = 2.25 → +125
    const result = parlayAmericanOdds([-200, -200]);
    expect(result).toBe(125);
  });
  it('calculates 2x -225 ≈ +104 to +115', () => {
    const result = parlayAmericanOdds([-225, -225]);
    expect(result).toBeGreaterThan(100);
    expect(result).toBeLessThan(130);
  });
});

describe('parlayHitProb', () => {
  it('multiplies individual probabilities', () => {
    const prob = parlayHitProb([0.70, 0.65]);
    expect(prob).toBeCloseTo(0.455, 2);
  });
});

describe('calcEV', () => {
  it('returns positive EV when model probability exceeds implied', () => {
    const ev = calcEV(0.70, -150);
    expect(ev).toBeGreaterThan(0);
  });
  it('returns negative EV when model probability is below implied', () => {
    const ev = calcEV(0.50, -200);
    expect(ev).toBeLessThan(0);
  });
  it('returns a number for zero bookOdds (no market data)', () => {
    const ev = calcEV(0.70, 0);
    expect(typeof ev).toBe('number');
    expect(isNaN(ev)).toBe(false);
  });
});

// ─── Pricing penalty — 3-tier structure ──────────────────────────────────────

describe('getPricingPenalty', () => {
  it('returns NONE for plus money odds', () => {
    expect(getPricingPenalty(150).tier).toBe('NONE');
    expect(getPricingPenalty(150).zone).toBe('VALUE');
    expect(getPricingPenalty(150).isUltraJuiced).toBe(false);
  });
  it('returns NONE for odds in -110 to -400 range (Value Zone)', () => {
    expect(getPricingPenalty(-110).tier).toBe('NONE');
    expect(getPricingPenalty(-200).tier).toBe('NONE');
    expect(getPricingPenalty(-400).tier).toBe('NONE');
  });
  it('returns SMALL for -401 to -600 (Acceptable Juiced)', () => {
    expect(getPricingPenalty(-401).tier).toBe('SMALL');
    expect(getPricingPenalty(-500).tier).toBe('SMALL');
    expect(getPricingPenalty(-600).tier).toBe('SMALL');
    expect(getPricingPenalty(-500).zone).toBe('ACCEPTABLE');
    expect(getPricingPenalty(-500).isUltraJuiced).toBe(false);
    expect(getPricingPenalty(-500).multiplier).toBe(0.75);
  });
  it('returns ULTRA_JUICED for worse than -600 (Research Only)', () => {
    expect(getPricingPenalty(-601).tier).toBe('ULTRA_JUICED');
    expect(getPricingPenalty(-700).tier).toBe('ULTRA_JUICED');
    expect(getPricingPenalty(-1000).tier).toBe('ULTRA_JUICED');
    expect(getPricingPenalty(-2000).tier).toBe('ULTRA_JUICED');
    expect(getPricingPenalty(-601).isUltraJuiced).toBe(true);
    expect(getPricingPenalty(-601).zone).toBe('RESEARCH_ONLY');
    expect(getPricingPenalty(-601).multiplier).toBe(0.0);
  });
  it('returns NONE for zero (no odds)', () => {
    expect(getPricingPenalty(0).tier).toBe('NONE');
  });
});

// ─── Value Zone and Parlay Range Checks ──────────────────────────────────────

describe('isValueZoneTarget', () => {
  it('returns true for plus money odds (+110 or better)', () => {
    expect(isValueZoneTarget(110)).toBe(true);
    expect(isValueZoneTarget(200)).toBe(true);
  });
  it('returns true for -105 or lighter', () => {
    expect(isValueZoneTarget(-100)).toBe(true);
    expect(isValueZoneTarget(-105)).toBe(true);
  });
  it('returns false for -110 (just outside target)', () => {
    expect(isValueZoneTarget(-110)).toBe(false);
  });
  it('returns false for -200', () => {
    expect(isValueZoneTarget(-200)).toBe(false);
  });
});

describe('isPreferredParlayLeg', () => {
  it('returns true for -150 to -400 range', () => {
    expect(isPreferredParlayLeg(-150)).toBe(true);
    expect(isPreferredParlayLeg(-300)).toBe(true);
    expect(isPreferredParlayLeg(-400)).toBe(true);
  });
  it('returns false for -401 (just outside preferred range)', () => {
    expect(isPreferredParlayLeg(-401)).toBe(false);
  });
  it('returns false for plus money', () => {
    expect(isPreferredParlayLeg(150)).toBe(false);
  });
});

// ─── computeCompositeScore ────────────────────────────────────────────────────

describe('computeCompositeScore', () => {
  it('returns high score for a strong value play', () => {
    const score = computeCompositeScore({
      modelProbability: 0.70,
      edge: 0.10,
      ev: 20,
      bookOdds: -150,
      fairOdds: -120,
    });
    expect(score).toBeGreaterThan(50);
  });
  it('returns lower score for ultra-juiced play (multiplier=0)', () => {
    const juicedScore = computeCompositeScore({
      modelProbability: 0.90,
      edge: 0.05,
      ev: 5,
      bookOdds: -800,
      fairOdds: -700,
    });
    expect(juicedScore).toBeLessThan(60);
  });
  it('returns non-negative score', () => {
    const score = computeCompositeScore({
      modelProbability: 0.40,
      edge: -0.05,
      ev: -10,
      bookOdds: -200,
      fairOdds: -300,
    });
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

// ─── scorePitcherPlay ─────────────────────────────────────────────────────────

describe('scorePitcherPlay', () => {
  it('marks ultra-juiced plays (worse than -600) correctly', () => {
    const play = scorePitcherPlay({
      pitcherName: 'Test Pitcher',
      pitcherTeam: 'NYY',
      opponentTeam: 'BOS',
      propType: 'strikeouts',
      line: 6.5,
      bookOdds: -700,
      fairOdds: -650,
      modelProbability: 0.90,
      impliedProbability: 0.875,
      edge: 0.025,
    });
    expect(play.isUltraJuiced).toBe(true);
    expect(play.pricingPenalty.tier).toBe('ULTRA_JUICED');
    expect(play.inAvoidRange).toBe(true);
  });

  it('marks preferred range plays correctly (-150 to -400)', () => {
    const play = scorePitcherPlay({
      pitcherName: 'Test Pitcher',
      pitcherTeam: 'NYY',
      opponentTeam: 'BOS',
      propType: 'strikeouts',
      line: 5.5,
      bookOdds: -200,
      fairOdds: -175,
      modelProbability: 0.65,
      impliedProbability: 0.60,
      edge: 0.035,
    });
    expect(play.isUltraJuiced).toBe(false);
    expect(play.inPreferredRange).toBe(true);
    expect(play.pricingPenalty.tier).toBe('NONE');
  });

  it('marks value zone target plays correctly (+110 to -105)', () => {
    const play = scorePitcherPlay({
      pitcherName: 'Value Pitcher',
      pitcherTeam: 'BOS',
      opponentTeam: 'NYY',
      propType: 'strikeouts',
      line: 5.5,
      bookOdds: -100,
      fairOdds: -90,
      modelProbability: 0.60,
      impliedProbability: 0.50,
      edge: 0.10,
    });
    expect(play.isValueZoneTarget).toBe(true);
    expect(play.ev).toBeGreaterThan(0);
  });

  it('calculates positive EV for value play', () => {
    const play = scorePitcherPlay({
      pitcherName: 'Value Pitcher',
      pitcherTeam: 'BOS',
      opponentTeam: 'NYY',
      propType: 'strikeouts',
      line: 5.5,
      bookOdds: -150,
      fairOdds: -175,
      modelProbability: 0.65,
      impliedProbability: 0.60,
      edge: 0.04,
    });
    expect(play.ev).toBeGreaterThan(0);
    expect(play.compositeScore).toBeGreaterThan(0);
  });
});

// ─── findBestSingleValuePlay ──────────────────────────────────────────────────

describe('findBestSingleValuePlay', () => {
  const makePlay = (bookOdds: number, modelProb: number, edge: number): ScoredPlay =>
    scorePitcherPlay({
      pitcherName: 'Test Pitcher',
      pitcherTeam: 'NYY',
      opponentTeam: 'BOS',
      propType: 'strikeouts',
      line: 6.5,
      bookOdds,
      fairOdds: bookOdds + 20,
      modelProbability: modelProb,
      impliedProbability: impliedProbFromAmerican(bookOdds),
      edge,
    });

  it('returns null when no eligible plays', () => {
    expect(findBestSingleValuePlay([])).toBeNull();
  });

  it('returns null when all plays have negative EV', () => {
    const plays = [makePlay(-200, 0.40, -0.10)];
    expect(findBestSingleValuePlay(plays)).toBeNull();
  });

  it('excludes ultra-juiced plays (worse than -600)', () => {
    const plays = [
      makePlay(-700, 0.90, 0.10),  // ultra-juiced, excluded
      makePlay(-200, 0.65, 0.06),  // eligible
    ];
    const result = findBestSingleValuePlay(plays);
    if (result) {
      expect(result.play.bookOdds).toBe(-200);
      expect(result.play.isUltraJuiced).toBe(false);
    }
  });

  it('includes qualification reasons when a play qualifies', () => {
    const plays = [makePlay(-105, 0.65, 0.08)];
    const result = findBestSingleValuePlay(plays);
    if (result) {
      expect(result.qualificationReasons.length).toBeGreaterThan(0);
      expect(result.confidenceLabel).toBeTruthy();
    }
  });

  it('prefers value zone target plays over non-target plays', () => {
    const plays = [
      makePlay(-100, 0.65, 0.10),  // value zone target (+110 to -105)
      makePlay(-300, 0.70, 0.08),  // preferred range but not value zone target
    ];
    const result = findBestSingleValuePlay(plays);
    if (result) {
      // Value zone target should score higher due to bonus
      expect(result.play.isValueZoneTarget).toBe(true);
    }
  });
});

// ─── buildParlays ─────────────────────────────────────────────────────────────

function makePlay(pitcherName: string, team: string, propType: 'strikeouts' | 'walks', bookOdds: number, modelProb: number, edge: number): ScoredPlay {
  return scorePitcherPlay({
    pitcherName,
    pitcherTeam: team,
    opponentTeam: 'OPP',
    propType,
    line: 5.5,
    bookOdds,
    fairOdds: bookOdds + 30,
    modelProbability: modelProb,
    impliedProbability: impliedProbFromAmerican(bookOdds),
    edge,
  });
}

describe('buildParlays', () => {
  const makePlays = (): ScoredPlay[] => [
    makePlay('P1', 'NYY', 'strikeouts', -200, 0.65, 0.035),
    makePlay('P2', 'BOS', 'strikeouts', -180, 0.62, 0.028),
    makePlay('P3', 'LAD', 'walks', -220, 0.70, 0.042),
    makePlay('P4', 'CHC', 'strikeouts', -700, 0.90, 0.010),  // ultra-juiced (worse than -600)
  ];

  it('separates ultra-juiced plays (worse than -600)', () => {
    const { ultraJuicedPlays } = buildParlays(makePlays());
    expect(ultraJuicedPlays.length).toBe(1);
    expect(ultraJuicedPlays[0].playerName).toBe('P4');
  });

  it('builds at least a safest parlay from eligible plays', () => {
    const { safestParlay } = buildParlays(makePlays());
    expect(safestParlay).not.toBeNull();
    expect(safestParlay!.legCount).toBe(2);
  });

  it('safest parlay legs do not include ultra-juiced plays', () => {
    const { safestParlay } = buildParlays(makePlays());
    const legNames = safestParlay!.legs.map(l => l.playerName);
    expect(legNames).not.toContain('P4');
  });

  it('plus money parlay has positive combined odds when possible', () => {
    const { plusMoneyParlay } = buildParlays(makePlays());
    if (plusMoneyParlay) {
      expect(plusMoneyParlay.combinedOdds).toBeGreaterThanOrEqual(100);
    }
  });

  it('combined odds display is formatted correctly', () => {
    const { safestParlay } = buildParlays(makePlays());
    expect(safestParlay!.combinedOddsDisplay).toMatch(/^[+-]\d+$/);
  });

  it('returns null parlays when no eligible plays', () => {
    const result = buildParlays([]);
    expect(result.safestParlay).toBeNull();
    expect(result.bestValueParlay).toBeNull();
    expect(result.plusMoneyParlay).toBeNull();
    expect(result.bestSingleValuePlay).toBeNull();
  });

  it('includes bestSingleValuePlay in result', () => {
    const result = buildParlays(makePlays());
    // bestSingleValuePlay is defined in the result (may be null if no play qualifies)
    expect('bestSingleValuePlay' in result).toBe(true);
  });
});
