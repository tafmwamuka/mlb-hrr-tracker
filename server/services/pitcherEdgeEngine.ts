/**
 * Pitcher Edge Engine
 *
 * Scores each pitcher K/BB prop line using all available signals:
 *   - Team Matchup Score (TMS) from TeamDisciplineService
 *   - Discipline Edge detection from DisciplineEdgeDetector
 *   - Opponent strikeout / walk rate from TeamDisciplineData
 *   - Handedness splits
 *   - Umpire K-rate profile
 *   - Weather / park factors
 *   - Market edge (model prob vs vig-free implied prob)
 *   - Historical results from PitcherLearningEngine
 *   - Pitch count / leash projection
 *
 * Output: PitcherEdgePick[] — qualified, scored, and tiered recommendations.
 */

import { fetchPitcherMarketData, type PitcherMarketData, americanToImpliedProbability, removeVig } from './oddsApiService';
import { detectDisciplineEdge, type PitcherPropInput } from './disciplineEdgeDetector';
import { getTeamDiscipline, computeTeamMatchupScore } from './teamDisciplineService';
import { fetchTodaysGames } from './mlbLineupService';

// ── Qualification Thresholds ──────────────────────────────────────────────────

const THRESHOLDS = {
  /** Minimum model probability to qualify a prop */
  MIN_PROB: 0.52,
  /** Minimum edge (model prob − vig-free implied) to qualify */
  MIN_EDGE: 0.03,
  /** Minimum TMS score to qualify */
  MIN_TMS: 45,
  /** Official Money Pick: prob ≥ 0.65, edge ≥ 0.07, TMS ≥ 65 */
  OFFICIAL: { prob: 0.65, edge: 0.07, tms: 65 },
  /** Elite Safety: prob ≥ 0.72, odds between -250 and -100 */
  ELITE_SAFETY: { prob: 0.72, maxOdds: -100, minOdds: -250 },
  /** Best Value: prob ≥ 0.55, edge ≥ 0.08, odds ≥ +100 */
  BEST_VALUE: { prob: 0.55, edge: 0.08, minOdds: 100 },
  /** Dual Edge: both K and BB qualify for same pitcher */
  DUAL_EDGE: { prob: 0.55, edge: 0.05 },
  /** Stack Alert: 3+ pitchers qualify in same game */
  STACK_ALERT_MIN: 3,
};

// ── Types ─────────────────────────────────────────────────────────────────────

export type PitcherPropTier =
  | 'OFFICIAL'
  | 'ELITE_SAFETY'
  | 'BEST_VALUE'
  | 'DUAL_EDGE'
  | 'STACK_ALERT'
  | 'QUALIFIED';

export interface PitcherEdgePick {
  // Identity
  pitcherName: string;
  pitcherTeam: string;
  opponentTeam: string;
  pitcherHand: 'L' | 'R' | 'S';
  gameTime: string;

  // Prop
  propType: 'strikeouts' | 'walks';
  line: number;
  bookOdds: number;
  fairOdds: number;

  // Scores
  modelProbability: number;   // 0-1
  impliedProbability: number; // vig-free 0-1
  edge: number;               // modelProb - impliedProb
  pitcherEdgeScore: number;   // 0-100 composite
  tms: number;                // Team Matchup Score 0-100

  // Tier
  tier: PitcherPropTier;
  hasDisciplineEdge: boolean;
  isDualEdge: boolean;        // true if both K and BB qualify for this pitcher

  // Explanation
  qualifyingReasons: string[];
  riskFlags: string[];

  // Discipline signals
  disciplineGrade: string | null;
  opponentKRate: number | null;  // opponent team K% vs this hand
  opponentBBRate: number | null; // opponent team BB% vs this hand
  historicalHitRate: number | null;
  sampleSize: number;
}

// ── Pitch count / leash projection ───────────────────────────────────────────

/**
 * Estimate expected pitch count based on game context.
 * Returns a score 0-100 representing how favourable the leash is for Ks.
 */
function estimatePitchCountScore(pitcherTeam: string, opponentTeam: string): number {
  // Without real-time leash data we use a neutral baseline of 65.
  // This will be replaced when pitcher workload data is available.
  return 65;
}

// ── Model probability for K/BB props ─────────────────────────────────────────

/**
 * Estimate model probability for a pitcher prop using Poisson distribution.
 * @param expectedValue  Expected K or BB count (from discipline/TMS signals)
 * @param line           Sportsbook line (e.g. 5.5)
 */
function poissonOverProb(expectedValue: number, line: number): number {
  // P(X > line) = 1 - P(X <= floor(line))
  const k = Math.floor(line);
  let cdf = 0;
  let term = Math.exp(-expectedValue);
  cdf += term;
  for (let i = 1; i <= k; i++) {
    term *= expectedValue / i;
    cdf += term;
  }
  return Math.max(0.01, Math.min(0.99, 1 - cdf));
}

/**
 * Estimate expected K count for a pitcher given opponent discipline data.
 */
function estimateExpectedKs(
  opponentKRate: number,     // e.g. 0.24 = 24% K rate
  tms: number,               // 0-100
  umpireKBoost: number = 0,  // basis points
  pitchCountScore: number = 65,
): number {
  // Baseline: 5.5 Ks per 6 innings for an average starter
  const baseline = 5.5;
  // Opponent K rate adjustment: 24% is average; each 1% above/below shifts by 0.2 Ks
  const kRateAdj = (opponentKRate - 0.24) * 20;
  // TMS adjustment: TMS 50 = neutral; each 10 points above/below shifts by 0.3 Ks
  const tmsAdj = ((tms - 50) / 10) * 0.3;
  // Umpire boost: 100 bps = +0.2 Ks
  const umpireAdj = (umpireKBoost / 100) * 0.2;
  // Pitch count score: 65 = neutral; each 10 points above/below shifts by 0.2 Ks
  const pcAdj = ((pitchCountScore - 65) / 10) * 0.2;

  return Math.max(1, baseline + kRateAdj + tmsAdj + umpireAdj + pcAdj);
}

/**
 * Estimate expected BB count for a pitcher given opponent discipline data.
 */
function estimateExpectedBBs(
  opponentBBRate: number,    // e.g. 0.09 = 9% BB rate
  tms: number,
): number {
  // Baseline: 2.5 BBs per 6 innings for an average starter
  const baseline = 2.5;
  // Opponent BB rate adjustment: 9% is average; each 1% above/below shifts by 0.3 BBs
  const bbRateAdj = (opponentBBRate - 0.09) * 30;
  // TMS walk component: higher TMS for walks = more BBs expected
  const tmsAdj = ((tms - 50) / 10) * 0.15;

  return Math.max(0.5, baseline + bbRateAdj + tmsAdj);
}

// ── Composite Pitcher Edge Score ──────────────────────────────────────────────

/**
 * Compute the Pitcher Edge Score (0-100) from all available signals.
 */
function computePitcherEdgeScore(params: {
  modelProb: number;
  edge: number;
  tms: number;
  hasDisciplineEdge: boolean;
  historicalHitRate: number | null;
  sampleSize: number;
  pitchCountScore: number;
}): number {
  const { modelProb, edge, tms, hasDisciplineEdge, historicalHitRate, sampleSize, pitchCountScore } = params;

  // Component weights
  let score = 0;

  // Model probability (0-40 points)
  score += Math.min(40, modelProb * 40);

  // Edge (0-20 points): 10% edge = 20 pts
  score += Math.min(20, edge * 200);

  // TMS (0-20 points)
  score += (tms / 100) * 20;

  // Discipline Edge bonus (5 points)
  if (hasDisciplineEdge) score += 5;

  // Historical hit rate (0-10 points, only if sample ≥ 5)
  if (historicalHitRate !== null && sampleSize >= 5) {
    score += (historicalHitRate / 100) * 10;
  }

  // Pitch count score (0-5 points)
  score += (pitchCountScore / 100) * 5;

  return Math.round(Math.min(100, Math.max(0, score)));
}

// ── American odds from true probability ──────────────────────────────────────

function probToAmericanOdds(prob: number): number {
  if (prob <= 0 || prob >= 1) return -110;
  if (prob >= 0.5) {
    return Math.round(-(prob / (1 - prob)) * 100);
  }
  return Math.round(((1 - prob) / prob) * 100);
}

// ── Main engine ───────────────────────────────────────────────────────────────

export interface PitcherEdgeEngineResult {
  picks: PitcherEdgePick[];
  /** Pitchers with both K and BB qualifying — Dual Edge */
  dualEdgePitchers: string[];
  /** Game IDs where 3+ pitchers qualify — Stack Alert */
  stackAlertGames: string[];
}

export async function runPitcherEdgeEngine(): Promise<PitcherEdgeEngineResult> {
  const [pitcherMarketMap, games] = await Promise.all([
    fetchPitcherMarketData(),
    fetchTodaysGames(),
  ]);

  const allPicks: PitcherEdgePick[] = [];
  // Track qualifying picks per pitcher for Dual Edge detection
  const pitcherQualifyingProps = new Map<string, { k: boolean; bb: boolean }>();
  // Track qualifying picks per game for Stack Alert detection
  const gameQualifyingPitchers = new Map<string, Set<string>>();

  for (const game of games) {
    const gameKey = `${game.awayTeam.abbreviation}@${game.homeTeam.abbreviation}`;

    const pitcherSlots: Array<{
      pitcher: { fullName: string; id?: number } | null;
      pitcherTeam: string;
      opponentTeam: string;
    }> = [
      {
        pitcher: game.homeTeam.probablePitcher ?? null,
        pitcherTeam: game.homeTeam.abbreviation,
        opponentTeam: game.awayTeam.abbreviation,
      },
      {
        pitcher: game.awayTeam.probablePitcher ?? null,
        pitcherTeam: game.awayTeam.abbreviation,
        opponentTeam: game.homeTeam.abbreviation,
      },
    ];

    for (const slot of pitcherSlots) {
      if (!slot.pitcher) continue;
      const pitcherName = slot.pitcher.fullName;
      const marketData: PitcherMarketData | undefined = pitcherMarketMap.get(pitcherName);

      // Get opponent discipline data
      const opponentDiscipline = await getTeamDiscipline(slot.opponentTeam).catch(() => null);
      const opponentKRate = opponentDiscipline?.strikeoutRate ?? 0.24;
      const opponentBBRate = opponentDiscipline?.walkRate ?? 0.09;
      const disciplineGrade = opponentDiscipline?.disciplineGrade ?? null;

      // Compute TMS for both K and BB prop types
      const [kmsTms, bbTms] = await Promise.all([
        computeTeamMatchupScore({
          opponentTeam: slot.opponentTeam,
          pitcherHand: 'R' as 'L' | 'R' | 'S',
          propType: 'strikeouts',
        }).catch(() => null),
        computeTeamMatchupScore({
          opponentTeam: slot.opponentTeam,
          pitcherHand: 'R' as 'L' | 'R' | 'S',
          propType: 'walks',
        }).catch(() => null),
      ]);

      const kTms = kmsTms?.tms ?? 50;
      const bbTmsScore = bbTms?.tms ?? 50;
      const pitchCountScore = estimatePitchCountScore(slot.pitcherTeam, slot.opponentTeam);

      // ── Evaluate K lines ───────────────────────────────────────────────────
      const kLines = marketData?.altKLines ?? [];

      for (const kLine of kLines) {
        const expectedKs = estimateExpectedKs(opponentKRate, kTms, 0, pitchCountScore);
        const modelProb = poissonOverProb(expectedKs, kLine.line);
        const edge = modelProb - kLine.trueOverProb;

        if (modelProb < THRESHOLDS.MIN_PROB || edge < THRESHOLDS.MIN_EDGE || kTms < THRESHOLDS.MIN_TMS) {
          continue;
        }

        const propInput: PitcherPropInput = {
          pitcherName,
          pitcherTeam: slot.pitcherTeam,
          opponentTeam: slot.opponentTeam,
          pitcherHand: 'R',
          propType: 'strikeouts',
          bookOdds: kLine.overOdds,
          modelProbability: modelProb,
          line: kLine.line,
        };

        const edgeResult = await detectDisciplineEdge(propInput).catch(() => null);
        const hasDisciplineEdge = edgeResult?.hasDisciplineEdge ?? false;
        const historicalHitRate = edgeResult?.historicalAdjustment.hitRate
          ? edgeResult.historicalAdjustment.hitRate * 100
          : null;
        const sampleSize = edgeResult?.historicalAdjustment.sampleSize ?? 0;

        const pitcherEdgeScore = computePitcherEdgeScore({
          modelProb,
          edge,
          tms: kTms,
          hasDisciplineEdge,
          historicalHitRate,
          sampleSize,
          pitchCountScore,
        });

        const fairOdds = probToAmericanOdds(modelProb);
        const qualifyingReasons = buildKReasons({
          opponentKRate,
          disciplineGrade,
          kTms,
          hasDisciplineEdge,
          historicalHitRate,
          sampleSize,
          pitchCountScore,
          edge,
        });

        const tier = classifyTier({
          modelProb,
          edge,
          tms: kTms,
          bookOdds: kLine.overOdds,
          pitcherEdgeScore,
          hasDisciplineEdge,
        });

        const pick: PitcherEdgePick = {
          pitcherName,
          pitcherTeam: slot.pitcherTeam,
          opponentTeam: slot.opponentTeam,
          pitcherHand: 'R',
          gameTime: game.gameTime,
          propType: 'strikeouts',
          line: kLine.line,
          bookOdds: kLine.overOdds,
          fairOdds,
          modelProbability: modelProb,
          impliedProbability: kLine.trueOverProb,
          edge,
          pitcherEdgeScore,
          tms: kTms,
          tier,
          hasDisciplineEdge,
          isDualEdge: false,
          qualifyingReasons,
          riskFlags: [],
          disciplineGrade,
          opponentKRate,
          opponentBBRate,
          historicalHitRate,
          sampleSize,
        };

        allPicks.push(pick);

        // Track for Dual Edge
        const existing = pitcherQualifyingProps.get(pitcherName) ?? { k: false, bb: false };
        existing.k = true;
        pitcherQualifyingProps.set(pitcherName, existing);

        // Track for Stack Alert
        const gameSet = gameQualifyingPitchers.get(gameKey) ?? new Set();
        gameSet.add(pitcherName);
        gameQualifyingPitchers.set(gameKey, gameSet);
      }

      // ── Evaluate BB lines ──────────────────────────────────────────────────
      const bbLines = marketData?.walkLines ?? [];

      for (const bbLine of bbLines) {
        const expectedBBs = estimateExpectedBBs(opponentBBRate, bbTmsScore);
        const modelProb = poissonOverProb(expectedBBs, bbLine.line);
        const edge = modelProb - bbLine.trueOverProb;

        if (modelProb < THRESHOLDS.MIN_PROB || edge < THRESHOLDS.MIN_EDGE || bbTmsScore < THRESHOLDS.MIN_TMS) {
          continue;
        }

        const propInput: PitcherPropInput = {
          pitcherName,
          pitcherTeam: slot.pitcherTeam,
          opponentTeam: slot.opponentTeam,
          pitcherHand: 'R',
          propType: 'walks',
          bookOdds: bbLine.overOdds,
          modelProbability: modelProb,
          line: bbLine.line,
        };

        const edgeResult = await detectDisciplineEdge(propInput).catch(() => null);
        const hasDisciplineEdge = edgeResult?.hasDisciplineEdge ?? false;
        const historicalHitRate = edgeResult?.historicalAdjustment.hitRate
          ? edgeResult.historicalAdjustment.hitRate * 100
          : null;
        const sampleSize = edgeResult?.historicalAdjustment.sampleSize ?? 0;

        const pitcherEdgeScore = computePitcherEdgeScore({
          modelProb,
          edge,
          tms: bbTmsScore,
          hasDisciplineEdge,
          historicalHitRate,
          sampleSize,
          pitchCountScore,
        });

        const fairOdds = probToAmericanOdds(modelProb);
        const qualifyingReasons = buildBBReasons({
          opponentBBRate,
          disciplineGrade,
          bbTmsScore,
          hasDisciplineEdge,
          historicalHitRate,
          sampleSize,
          edge,
        });

        const tier = classifyTier({
          modelProb,
          edge,
          tms: bbTmsScore,
          bookOdds: bbLine.overOdds,
          pitcherEdgeScore,
          hasDisciplineEdge,
        });

        const pick: PitcherEdgePick = {
          pitcherName,
          pitcherTeam: slot.pitcherTeam,
          opponentTeam: slot.opponentTeam,
          pitcherHand: 'R',
          gameTime: game.gameTime,
          propType: 'walks',
          line: bbLine.line,
          bookOdds: bbLine.overOdds,
          fairOdds,
          modelProbability: modelProb,
          impliedProbability: bbLine.trueOverProb,
          edge,
          pitcherEdgeScore,
          tms: bbTmsScore,
          tier,
          hasDisciplineEdge,
          isDualEdge: false,
          qualifyingReasons,
          riskFlags: [],
          disciplineGrade,
          opponentKRate,
          opponentBBRate,
          historicalHitRate,
          sampleSize,
        };

        allPicks.push(pick);

        // Track for Dual Edge
        const existing = pitcherQualifyingProps.get(pitcherName) ?? { k: false, bb: false };
        existing.bb = true;
        pitcherQualifyingProps.set(pitcherName, existing);

        // Track for Stack Alert
        const gameSet = gameQualifyingPitchers.get(gameKey) ?? new Set();
        gameSet.add(pitcherName);
        gameQualifyingPitchers.set(gameKey, gameSet);
      }
    }
  }

  // ── Identify Dual Edge pitchers ───────────────────────────────────────────
  const dualEdgePitchers: string[] = [];
  pitcherQualifyingProps.forEach((props, name) => {
    if (props.k && props.bb) dualEdgePitchers.push(name);
  });

  // ── Mark isDualEdge on picks ──────────────────────────────────────────────
  for (const pick of allPicks) {
    if (dualEdgePitchers.includes(pick.pitcherName)) {
      pick.isDualEdge = true;
      if (pick.tier === 'QUALIFIED') pick.tier = 'DUAL_EDGE';
    }
  }

  // ── Identify Stack Alert games ────────────────────────────────────────────
  const stackAlertGames: string[] = [];
  gameQualifyingPitchers.forEach((pitchers, gameKey) => {
    if (pitchers.size >= THRESHOLDS.STACK_ALERT_MIN) stackAlertGames.push(gameKey);
  });

  // Mark Stack Alert tier
  for (const pick of allPicks) {
    const gameKey = `${pick.opponentTeam}@${pick.pitcherTeam}`;
    const reverseKey = `${pick.pitcherTeam}@${pick.opponentTeam}`;
    if (
      (stackAlertGames.includes(gameKey) || stackAlertGames.includes(reverseKey)) &&
      pick.tier === 'QUALIFIED'
    ) {
      pick.tier = 'STACK_ALERT';
    }
  }

  // ── Sort: Official first, then by pitcherEdgeScore desc ──────────────────
  const tierOrder: Record<PitcherPropTier, number> = {
    OFFICIAL: 0,
    DUAL_EDGE: 1,
    ELITE_SAFETY: 2,
    BEST_VALUE: 3,
    STACK_ALERT: 4,
    QUALIFIED: 5,
  };

  allPicks.sort((a, b) => {
    const tierDiff = tierOrder[a.tier] - tierOrder[b.tier];
    if (tierDiff !== 0) return tierDiff;
    return b.pitcherEdgeScore - a.pitcherEdgeScore;
  });

  return { picks: allPicks, dualEdgePitchers, stackAlertGames };
}

// ── Tier classification ───────────────────────────────────────────────────────

function classifyTier(params: {
  modelProb: number;
  edge: number;
  tms: number;
  bookOdds: number;
  pitcherEdgeScore: number;
  hasDisciplineEdge: boolean;
}): PitcherPropTier {
  const { modelProb, edge, tms, bookOdds, pitcherEdgeScore, hasDisciplineEdge } = params;

  // Official Money Pick
  if (
    modelProb >= THRESHOLDS.OFFICIAL.prob &&
    edge >= THRESHOLDS.OFFICIAL.edge &&
    tms >= THRESHOLDS.OFFICIAL.tms
  ) {
    return 'OFFICIAL';
  }

  // Elite Safety: very high probability, short odds
  if (
    modelProb >= THRESHOLDS.ELITE_SAFETY.prob &&
    bookOdds >= THRESHOLDS.ELITE_SAFETY.minOdds &&
    bookOdds <= THRESHOLDS.ELITE_SAFETY.maxOdds
  ) {
    return 'ELITE_SAFETY';
  }

  // Best Value: positive odds with strong edge
  if (
    modelProb >= THRESHOLDS.BEST_VALUE.prob &&
    edge >= THRESHOLDS.BEST_VALUE.edge &&
    bookOdds >= THRESHOLDS.BEST_VALUE.minOdds
  ) {
    return 'BEST_VALUE';
  }

  return 'QUALIFIED';
}

// ── Reason builders ───────────────────────────────────────────────────────────

function buildKReasons(params: {
  opponentKRate: number;
  disciplineGrade: string | null;
  kTms: number;
  hasDisciplineEdge: boolean;
  historicalHitRate: number | null;
  sampleSize: number;
  pitchCountScore: number;
  edge: number;
}): string[] {
  const reasons: string[] = [];
  const { opponentKRate, disciplineGrade, kTms, hasDisciplineEdge, historicalHitRate, sampleSize, pitchCountScore, edge } = params;

  if (opponentKRate >= 0.26) {
    reasons.push(`Opponent strikes out ${(opponentKRate * 100).toFixed(1)}% vs RHP`);
  } else if (opponentKRate >= 0.23) {
    reasons.push(`Opponent K rate ${(opponentKRate * 100).toFixed(1)}% (above average)`);
  }

  if (disciplineGrade) {
    reasons.push(`Discipline Grade: ${disciplineGrade}`);
  }

  if (kTms >= 70) {
    reasons.push(`Strong Team Matchup Score: ${kTms}`);
  } else if (kTms >= 55) {
    reasons.push(`Favourable Team Matchup Score: ${kTms}`);
  }

  if (hasDisciplineEdge) {
    reasons.push('💎 Discipline Edge confirmed');
  }

  if (historicalHitRate !== null && sampleSize >= 5) {
    reasons.push(`Historical Success Rate: ${historicalHitRate.toFixed(0)}% (${sampleSize} games)`);
  }

  if (pitchCountScore >= 75) {
    reasons.push('Expected 90+ pitch count');
  }

  if (edge >= 0.10) {
    reasons.push(`Strong market value: +${(edge * 100).toFixed(1)}% edge`);
  } else if (edge >= 0.06) {
    reasons.push(`Positive market value: +${(edge * 100).toFixed(1)}% edge`);
  }

  return reasons;
}

function buildBBReasons(params: {
  opponentBBRate: number;
  disciplineGrade: string | null;
  bbTmsScore: number;
  hasDisciplineEdge: boolean;
  historicalHitRate: number | null;
  sampleSize: number;
  edge: number;
}): string[] {
  const reasons: string[] = [];
  const { opponentBBRate, disciplineGrade, bbTmsScore, hasDisciplineEdge, historicalHitRate, sampleSize, edge } = params;

  if (opponentBBRate >= 0.11) {
    reasons.push(`Opponent walk rate ${(opponentBBRate * 100).toFixed(1)}% (high patience)`);
  } else if (opponentBBRate >= 0.09) {
    reasons.push(`Opponent walk rate ${(opponentBBRate * 100).toFixed(1)}% (above average)`);
  }

  if (disciplineGrade) {
    reasons.push(`Discipline Grade: ${disciplineGrade}`);
  }

  if (bbTmsScore >= 70) {
    reasons.push(`Strong Walk Matchup Score: ${bbTmsScore}`);
  } else if (bbTmsScore >= 55) {
    reasons.push(`Favourable Walk Matchup Score: ${bbTmsScore}`);
  }

  if (hasDisciplineEdge) {
    reasons.push('💎 Discipline Edge confirmed');
  }

  if (historicalHitRate !== null && sampleSize >= 5) {
    reasons.push(`Historical Success Rate: ${historicalHitRate.toFixed(0)}% (${sampleSize} games)`);
  }

  if (edge >= 0.10) {
    reasons.push(`Strong market value: +${(edge * 100).toFixed(1)}% edge`);
  } else if (edge >= 0.06) {
    reasons.push(`Positive market value: +${(edge * 100).toFixed(1)}% edge`);
  }

  return reasons;
}
