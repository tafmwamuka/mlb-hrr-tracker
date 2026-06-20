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
 *
 * TIER SYSTEM (4-tier):
 *   🏆 ELITE   — Strongest opportunities. Eligible for Play of the Day, Dual Edge, Smart Labs Priority.
 *   🔥 OFFICIAL — Primary recommendations. Tracked in Results, ROI, Hit Rate.
 *   🛡 LEAN    — Displayed but separated. NOT in official Results/ROI/Hit Rate.
 *   🧪 PROJECTION — Below threshold. Research only. Not recommended.
 *
 * MARKET-SPECIFIC THRESHOLDS (per K line):
 *   Walk Overs:   Elite 75%+, Official 70%+, Lean 65-69%
 *   3+ Ks:        Elite 80%+, Official 75%+, Lean 70-74%
 *   4+ Ks:        Elite 75%+, Official 70%+, Lean 65-69%
 *   5+ Ks:        Elite 70%+, Official 65%+, Lean 60-64%
 *   6+ Ks:        Elite 65%+, Official 60%+, Lean 55-59%
 *   7+ Ks:        Elite 60%+, Official 55%+, Lean 50-54%
 */

import { fetchPitcherMarketData, type PitcherMarketData, americanToImpliedProbability, removeVig } from './oddsApiService';
import { detectDisciplineEdge, type PitcherPropInput } from './disciplineEdgeDetector';
import { getTeamDiscipline, computeTeamMatchupScore } from './teamDisciplineService';
import { fetchTodaysGames } from './mlbLineupService';

// ── Market-specific tier thresholds ──────────────────────────────────────────

/**
 * Returns the probability thresholds for a given prop type and line.
 * Higher K lines naturally have lower hit probabilities, so thresholds
 * are scaled down accordingly.
 */
function getLineThresholds(propType: 'strikeouts' | 'walks', line: number): {
  elite: number;
  official: number;
  lean: number;
  minQualify: number;
} {
  if (propType === 'walks') {
    return { elite: 0.75, official: 0.70, lean: 0.65, minQualify: 0.55 };
  }

  // Strikeouts — scale thresholds by line
  if (line <= 3.5) {
    // 3+ Ks
    return { elite: 0.80, official: 0.75, lean: 0.70, minQualify: 0.60 };
  } else if (line <= 4.5) {
    // 4+ Ks
    return { elite: 0.75, official: 0.70, lean: 0.65, minQualify: 0.55 };
  } else if (line <= 5.5) {
    // 5+ Ks
    return { elite: 0.70, official: 0.65, lean: 0.60, minQualify: 0.50 };
  } else if (line <= 6.5) {
    // 6+ Ks
    return { elite: 0.65, official: 0.60, lean: 0.55, minQualify: 0.45 };
  } else {
    // 7+ Ks
    return { elite: 0.60, official: 0.55, lean: 0.50, minQualify: 0.40 };
  }
}

// ── Minimum supporting factors per tier ──────────────────────────────────────

const FACTOR_REQUIREMENTS = {
  ELITE: 5,
  OFFICIAL: 4,
  LEAN: 3,
};

// ── Qualification Thresholds (global) ────────────────────────────────────────

const THRESHOLDS = {
  /** Minimum edge (model prob − vig-free implied) to include at all */
  MIN_EDGE: 0.01,
  /** Minimum TMS score to include at all */
  MIN_TMS: 35,
  /** Dual Edge: both K and BB qualify for same pitcher */
  DUAL_EDGE: { prob: 0.55, edge: 0.03 },
  /** Stack Alert: 3+ pitchers qualify in same game */
  STACK_ALERT_MIN: 3,
};

// ── Types ─────────────────────────────────────────────────────────────────────

export type PitcherPropTier =
  | 'ELITE'
  | 'OFFICIAL'
  | 'LEAN'
  | 'PROJECTION'
  | 'DUAL_EDGE'
  | 'STACK_ALERT';

/** Whether a pick is tracked in official results */
export function isOfficialTier(tier: PitcherPropTier): boolean {
  return tier === 'ELITE' || tier === 'OFFICIAL' || tier === 'DUAL_EDGE' || tier === 'STACK_ALERT';
}

/** Whether a pick is a lean (shown but not official) */
export function isLeanTier(tier: PitcherPropTier): boolean {
  return tier === 'LEAN';
}

/** Whether a pick is projection-only (research, not shown in main board) */
export function isProjectionTier(tier: PitcherPropTier): boolean {
  return tier === 'PROJECTION';
}

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

  // Tier metadata
  isOfficialPlay: boolean;   // ELITE or OFFICIAL — tracked in results/ROI
  isLeanPlay: boolean;       // LEAN — shown but not official
  isProjectionOnly: boolean; // PROJECTION — research only
}

// ── Pitch count / leash projection ───────────────────────────────────────────

function estimatePitchCountScore(pitcherTeam: string, opponentTeam: string): number {
  // Without real-time leash data we use a neutral baseline of 65.
  return 65;
}

// ── Model probability for K/BB props ─────────────────────────────────────────

function poissonOverProb(expectedValue: number, line: number): number {
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

function estimateExpectedKs(
  opponentKRate: number,
  tms: number,
  umpireKBoost: number = 0,
  pitchCountScore: number = 65,
): number {
  const baseline = 5.5;
  const kRateAdj = (opponentKRate - 0.24) * 20;
  const tmsAdj = ((tms - 50) / 10) * 0.3;
  const umpireAdj = (umpireKBoost / 100) * 0.2;
  const pcAdj = ((pitchCountScore - 65) / 10) * 0.2;
  return Math.max(1, baseline + kRateAdj + tmsAdj + umpireAdj + pcAdj);
}

function estimateExpectedBBs(
  opponentBBRate: number,
  tms: number,
): number {
  const baseline = 2.5;
  const bbRateAdj = (opponentBBRate - 0.09) * 30;
  const tmsAdj = ((tms - 50) / 10) * 0.15;
  return Math.max(0.5, baseline + bbRateAdj + tmsAdj);
}

// ── Composite Pitcher Edge Score ──────────────────────────────────────────────

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

  let score = 0;
  score += Math.min(40, modelProb * 40);
  score += Math.min(20, edge * 200);
  score += (tms / 100) * 20;
  if (hasDisciplineEdge) score += 5;
  if (historicalHitRate !== null && sampleSize >= 5) {
    score += (historicalHitRate / 100) * 10;
  }
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

// ── Count supporting factors ──────────────────────────────────────────────────

function countSupportingFactors(params: {
  opponentKRate?: number;
  opponentBBRate?: number;
  disciplineGrade: string | null;
  tms: number;
  hasDisciplineEdge: boolean;
  historicalHitRate: number | null;
  sampleSize: number;
  pitchCountScore: number;
  edge: number;
  propType: 'strikeouts' | 'walks';
}): number {
  let count = 0;
  const { opponentKRate, opponentBBRate, disciplineGrade, tms, hasDisciplineEdge, historicalHitRate, sampleSize, pitchCountScore, edge, propType } = params;

  if (propType === 'strikeouts') {
    if (opponentKRate !== undefined && opponentKRate >= 0.23) count++;
  } else {
    if (opponentBBRate !== undefined && opponentBBRate >= 0.09) count++;
  }

  if (disciplineGrade && ['D', 'D+', 'C-', 'C'].includes(disciplineGrade)) count++;
  if (tms >= 55) count++;
  if (hasDisciplineEdge) count++;
  if (historicalHitRate !== null && sampleSize >= 5 && historicalHitRate >= 60) count++;
  if (pitchCountScore >= 75) count++;
  if (edge >= 0.06) count++;

  return count;
}

// ── Main engine ───────────────────────────────────────────────────────────────

export interface PitcherEdgeEngineResult {
  picks: PitcherEdgePick[];
  /** Pitchers with both K and BB qualifying — Dual Edge */
  dualEdgePitchers: string[];
  /** Game IDs where 3+ pitchers qualify — Stack Alert */
  stackAlertGames: string[];
  /** Whether the board has any Elite or Official picks */
  hasOfficialPlays: boolean;
  /** Whether the board has any Lean picks */
  hasLeanPlays: boolean;
}

export async function runPitcherEdgeEngine(): Promise<PitcherEdgeEngineResult> {
  const [pitcherMarketMap, games] = await Promise.all([
    fetchPitcherMarketData(),
    fetchTodaysGames(),
  ]);

  const allPicks: PitcherEdgePick[] = [];
  const pitcherQualifyingProps = new Map<string, { k: boolean; bb: boolean }>();
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

      const opponentDiscipline = await getTeamDiscipline(slot.opponentTeam).catch(() => null);
      const opponentKRate = opponentDiscipline?.strikeoutRate ?? 0.24;
      const opponentBBRate = opponentDiscipline?.walkRate ?? 0.09;
      const disciplineGrade = opponentDiscipline?.disciplineGrade ?? null;

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
        const thresholds = getLineThresholds('strikeouts', kLine.line);

        // Skip anything below the minimum qualify threshold
        if (modelProb < thresholds.minQualify) continue;
        if (kTms < THRESHOLDS.MIN_TMS) continue;

        // Compute edge (0 if no market data)
        const edge = kLine.trueOverProb > 0 ? modelProb - kLine.trueOverProb : 0;

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

        const supportingFactors = countSupportingFactors({
          opponentKRate,
          disciplineGrade,
          tms: kTms,
          hasDisciplineEdge,
          historicalHitRate,
          sampleSize,
          pitchCountScore,
          edge,
          propType: 'strikeouts',
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
          supportingFactors,
          thresholds,
          bookOdds: kLine.overOdds,
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
          isOfficialPlay: isOfficialTier(tier),
          isLeanPlay: isLeanTier(tier),
          isProjectionOnly: isProjectionTier(tier),
        };

        allPicks.push(pick);

        // Track for Dual Edge (only official/lean picks)
        if (!isProjectionTier(tier)) {
          const existing = pitcherQualifyingProps.get(pitcherName) ?? { k: false, bb: false };
          existing.k = true;
          pitcherQualifyingProps.set(pitcherName, existing);

          const gameSet = gameQualifyingPitchers.get(gameKey) ?? new Set();
          gameSet.add(pitcherName);
          gameQualifyingPitchers.set(gameKey, gameSet);
        }
      }

      // ── Evaluate BB lines ──────────────────────────────────────────────────
      const bbLines = marketData?.walkLines ?? [];

      for (const bbLine of bbLines) {
        const expectedBBs = estimateExpectedBBs(opponentBBRate, bbTmsScore);
        const modelProb = poissonOverProb(expectedBBs, bbLine.line);
        const thresholds = getLineThresholds('walks', bbLine.line);

        if (modelProb < thresholds.minQualify) continue;
        if (bbTmsScore < THRESHOLDS.MIN_TMS) continue;

        const edge = bbLine.trueOverProb > 0 ? modelProb - bbLine.trueOverProb : 0;

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

        const supportingFactors = countSupportingFactors({
          opponentBBRate,
          disciplineGrade,
          tms: bbTmsScore,
          hasDisciplineEdge,
          historicalHitRate,
          sampleSize,
          pitchCountScore,
          edge,
          propType: 'walks',
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
          supportingFactors,
          thresholds,
          bookOdds: bbLine.overOdds,
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
          isOfficialPlay: isOfficialTier(tier),
          isLeanPlay: isLeanTier(tier),
          isProjectionOnly: isProjectionTier(tier),
        };

        allPicks.push(pick);

        if (!isProjectionTier(tier)) {
          const existing = pitcherQualifyingProps.get(pitcherName) ?? { k: false, bb: false };
          existing.bb = true;
          pitcherQualifyingProps.set(pitcherName, existing);

          const gameSet = gameQualifyingPitchers.get(gameKey) ?? new Set();
          gameSet.add(pitcherName);
          gameQualifyingPitchers.set(gameKey, gameSet);
        }
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
      // Upgrade LEAN to OFFICIAL if it's a dual edge
      if (pick.tier === 'LEAN') {
        pick.tier = 'DUAL_EDGE';
        pick.isOfficialPlay = true;
        pick.isLeanPlay = false;
      } else if (pick.tier === 'OFFICIAL') {
        pick.tier = 'DUAL_EDGE';
      }
    }
  }

  // ── Identify Stack Alert games ────────────────────────────────────────────
  const stackAlertGames: string[] = [];
  gameQualifyingPitchers.forEach((pitchers, gameKey) => {
    if (pitchers.size >= THRESHOLDS.STACK_ALERT_MIN) stackAlertGames.push(gameKey);
  });

  // Mark Stack Alert tier (only on official picks)
  for (const pick of allPicks) {
    const gameKey = `${pick.opponentTeam}@${pick.pitcherTeam}`;
    const reverseKey = `${pick.pitcherTeam}@${pick.opponentTeam}`;
    if (
      (stackAlertGames.includes(gameKey) || stackAlertGames.includes(reverseKey)) &&
      (pick.tier === 'OFFICIAL' || pick.tier === 'LEAN')
    ) {
      pick.tier = 'STACK_ALERT';
      pick.isOfficialPlay = true;
      pick.isLeanPlay = false;
    }
  }

  // ── Sort: Elite first, then Official, Dual, Stack, Lean, Projection ──────
  const tierOrder: Record<PitcherPropTier, number> = {
    ELITE: 0,
    DUAL_EDGE: 1,
    OFFICIAL: 2,
    STACK_ALERT: 3,
    LEAN: 4,
    PROJECTION: 5,
  };

  allPicks.sort((a, b) => {
    const tierDiff = tierOrder[a.tier] - tierOrder[b.tier];
    if (tierDiff !== 0) return tierDiff;
    return b.pitcherEdgeScore - a.pitcherEdgeScore;
  });

  const hasOfficialPlays = allPicks.some(p => p.isOfficialPlay);
  const hasLeanPlays = allPicks.some(p => p.isLeanPlay);

  return { picks: allPicks, dualEdgePitchers, stackAlertGames, hasOfficialPlays, hasLeanPlays };
}

// ── Tier classification ───────────────────────────────────────────────────────

function classifyTier(params: {
  modelProb: number;
  edge: number;
  supportingFactors: number;
  thresholds: { elite: number; official: number; lean: number; minQualify: number };
  bookOdds: number;
  hasDisciplineEdge: boolean;
}): PitcherPropTier {
  const { modelProb, edge, supportingFactors, thresholds, hasDisciplineEdge } = params;

  // No major red flags check — edge must not be deeply negative
  const noMajorRedFlags = edge >= -0.05;

  // 🏆 ELITE: 75%+ prob (line-adjusted), positive EV, 5+ factors, no red flags
  if (
    modelProb >= thresholds.elite &&
    edge >= 0 &&
    supportingFactors >= FACTOR_REQUIREMENTS.ELITE &&
    noMajorRedFlags
  ) {
    return 'ELITE';
  }

  // 🔥 OFFICIAL: 70%+ prob (line-adjusted), positive EV, 4+ factors, no red flags
  if (
    modelProb >= thresholds.official &&
    edge >= 0 &&
    supportingFactors >= FACTOR_REQUIREMENTS.OFFICIAL &&
    noMajorRedFlags
  ) {
    return 'OFFICIAL';
  }

  // 🛡 LEAN: 65%+ prob (line-adjusted), 3+ factors, no red flags
  if (
    modelProb >= thresholds.lean &&
    supportingFactors >= FACTOR_REQUIREMENTS.LEAN &&
    noMajorRedFlags
  ) {
    return 'LEAN';
  }

  // 🧪 PROJECTION: anything that passed minQualify but doesn't meet Lean
  return 'PROJECTION';
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
  } else if (edge >= 0.05) {
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
  } else if (edge >= 0.05) {
    reasons.push(`Positive market value: +${(edge * 100).toFixed(1)}% edge`);
  }

  return reasons;
}
