import { describe, it, expect } from 'vitest';
import {
  americanToDecimal,
  decimalToAmerican,
  impliedProbFromAmerican,
  parlayAmericanOdds,
  calcEV,
  getPricingPenalty,
  scorePitcherPlay,
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
  it('calculates 2x -225 ≈ +104', () => {
    const result = parlayAmericanOdds([-225, -225]);
    // decimal: (100/225 + 1) * (100/225 + 1) ≈ 1.444 * 1.444 ≈ 2.086 → +109
    expect(result).toBeGreaterThan(100);
    expect(result).toBeLessThan(130);
  });
});

describe('calcEV', () => {
  it('returns positive EV when model probability exceeds implied', () => {
    // Model says 70%, book implies 60% (-150 → 0.6)
    const ev = calcEV(0.70, -150);
    expect(ev).toBeGreaterThan(0);
  });
  it('returns negative EV when model probability is below implied', () => {
    const ev = calcEV(0.50, -200);
    expect(ev).toBeLessThan(0);
  });
  it('returns a number for zero bookOdds (no market data)', () => {
    // 0 means no market data — calcEV still returns a number
    const ev = calcEV(0.70, 0);
    expect(typeof ev).toBe('number');
    expect(isNaN(ev)).toBe(false);
  });
});

// ─── Pricing penalty ──────────────────────────────────────────────────────────

describe('getPricingPenalty', () => {
  it('returns NONE for odds in -110 to -400 range', () => {
    expect(getPricingPenalty(-200).tier).toBe('NONE');
    expect(getPricingPenalty(-110).tier).toBe('NONE');
    expect(getPricingPenalty(-400).tier).toBe('NONE');
  });
  it('returns SMALL for -401 to -600', () => {
    expect(getPricingPenalty(-500).tier).toBe('SMALL');
    expect(getPricingPenalty(-401).tier).toBe('SMALL');
    expect(getPricingPenalty(-600).tier).toBe('SMALL');
  });
  it('returns MODERATE for -601 to -1000', () => {
    expect(getPricingPenalty(-750).tier).toBe('MODERATE');
    expect(getPricingPenalty(-1000).tier).toBe('MODERATE');
  });
  it('returns ULTRA_JUICED for worse than -1000', () => {
    expect(getPricingPenalty(-1001).tier).toBe('ULTRA_JUICED');
    expect(getPricingPenalty(-2000).tier).toBe('ULTRA_JUICED');
    expect(getPricingPenalty(-1001).isUltraJuiced).toBe(true);
  });
  it('returns NONE for zero (no odds)', () => {
    // 0 means no odds available
    expect(getPricingPenalty(0).tier).toBe('NONE');
  });
  it('returns NONE for positive odds', () => {
    expect(getPricingPenalty(150).tier).toBe('NONE');
  });
});

// ─── scorePlay ────────────────────────────────────────────────────────────────

describe('scorePitcherPlay', () => {
  it('marks ultra-juiced plays correctly', () => {
    const play = scorePitcherPlay({
      pitcherName: 'Test Pitcher',
      pitcherTeam: 'NYY',
      opponentTeam: 'BOS',
      propType: 'strikeouts',
      line: 6.5,
      bookOdds: -1500,
      fairOdds: -800,
      modelProbability: 0.92,
      impliedProbability: 0.94,
      edge: 0.05,
    });
    expect(play.isUltraJuiced).toBe(true);
    expect(play.pricingPenalty.tier).toBe('ULTRA_JUICED');
  });

  it('marks preferred range plays correctly', () => {
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
    makePlay('P4', 'CHC', 'strikeouts', -1200, 0.90, 0.010),
  ];

  it('separates ultra-juiced plays', () => {
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
});
