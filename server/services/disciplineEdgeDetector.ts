/**
 * Discipline Edge Detector
 *
 * Fires the 💎 DISCIPLINE EDGE badge when three signals align:
 *   1. Team Discipline Profile  — opponent ranks high for the prop type
 *   2. Historical Data          — pitcher has a strong track record vs this team profile
 *   3. Market Pricing           — the line is priced at fair value or better
 *
 * Also computes the Auto-Boost adjustment (±0-5%) applied to pitcher prop probabilities.
 */

import { computeTeamMatchupScore, getTeamDiscipline, type TeamMatchupScore } from "./teamDisciplineService";
import { getHistoricalAdjustment } from "./pitcherLearningEngine";

// ── Types ──────────────────────────────────────────────────────────────────────
export interface PitcherPropInput {
  pitcherName: string;
  pitcherId?: number;
  pitcherTeam: string;
  opponentTeam: string;
  pitcherHand: "L" | "R" | "S";
  propType: "strikeouts" | "walks" | "outs" | "innings" | "hits_allowed" | "earned_runs";
  bookOdds: number;          // American odds e.g. -115
  modelProbability: number;  // 0-1 (e.g. 0.62 = 62%)
  line: number;              // sportsbook line e.g. 6.5
  parkFactor?: number;
  weatherScore?: number;
  umpireKRate?: number;
  opponentRecentForm?: number;
}

export interface DisciplineEdgeResult {
  hasDisciplineEdge: boolean;
  edgeReason: string | null;
  edgeStrength: "Strong" | "Moderate" | "Weak" | null;
  tms: TeamMatchupScore;
  autoBoostBps: number;       // basis points applied to model probability (±500 max)
  boostedProbability: number; // model probability after boost (0-1)
  signals: {
    teamProfileSignal: boolean;
    historicalSignal: boolean;
    marketSignal: boolean;
  };
  historicalAdjustment: {
    sampleSize: number;
    hitRate: number | null;
    avgBoostBps: number;
  };
}

// ── American odds to implied probability ──────────────────────────────────────
function americanToImplied(odds: number): number {
  if (odds < 0) return (-odds) / (-odds + 100);
  return 100 / (odds + 100);
}

// ── Compute vig-free implied probability ─────────────────────────────────────
function vigFreeImplied(overOdds: number, underOdds: number): number {
  const overImplied = americanToImplied(overOdds);
  const underImplied = americanToImplied(underOdds);
  const total = overImplied + underImplied;
  return overImplied / total; // vig-free over probability
}

// ── Main edge detection ────────────────────────────────────────────────────────
export async function detectDisciplineEdge(input: PitcherPropInput): Promise<DisciplineEdgeResult> {
  const {
    pitcherName,
    pitcherId,
    opponentTeam,
    pitcherHand,
    propType,
    bookOdds,
    modelProbability,
    line,
    parkFactor,
    weatherScore,
    umpireKRate,
    opponentRecentForm,
  } = input;

  // ── Step 1: Compute TMS ───────────────────────────────────────────────────
  const tms = await computeTeamMatchupScore({
    opponentTeam,
    pitcherHand,
    propType,
    parkFactor,
    weatherScore,
    umpireKRate,
    opponentRecentForm,
  });

  // ── Step 2: Team profile signal ───────────────────────────────────────────
  // Fires when TMS >= 75 and the relevant tendency score is in the top tier
  const teamProfileSignal = tms.tms >= 75 && (
    (propType === "strikeouts" && tms.strikeoutTendencyScore >= 65) ||
    (propType === "walks" && tms.walkTendencyScore >= 65) ||
    (["outs", "innings"].includes(propType) && tms.tms >= 80)
  );

  // ── Step 3: Historical signal ─────────────────────────────────────────────
  const historical = await getHistoricalAdjustment(pitcherName, opponentTeam, propType, pitcherHand);
  // Historical signal fires when we have 5+ samples and hit rate >= 60%
  const historicalSignal = historical.sampleSize >= 5 && (historical.hitRate ?? 0) >= 0.60;

  // ── Step 4: Market signal ─────────────────────────────────────────────────
  // Market signal fires when model probability exceeds implied probability by >= 5%
  const impliedProb = americanToImplied(bookOdds);
  const modelEdge = modelProbability - impliedProb;
  const marketSignal = modelEdge >= 0.05;

  // ── Step 5: Determine edge ────────────────────────────────────────────────
  const signalCount = [teamProfileSignal, historicalSignal, marketSignal].filter(Boolean).length;

  let hasDisciplineEdge = false;
  let edgeStrength: DisciplineEdgeResult["edgeStrength"] = null;
  let edgeReason: string | null = null;

  if (signalCount === 3) {
    hasDisciplineEdge = true;
    edgeStrength = "Strong";
    edgeReason = `All 3 signals aligned: ${opponentTeam} team profile (TMS ${tms.tms}), historical edge, and market value`;
  } else if (signalCount === 2 && teamProfileSignal) {
    hasDisciplineEdge = true;
    edgeStrength = "Moderate";
    const otherSignal = historicalSignal ? "historical track record" : "market pricing";
    edgeReason = `Team profile (TMS ${tms.tms}) + ${otherSignal} aligned for ${propType}`;
  } else if (tms.hasDisciplineEdge && tms.tms >= 80) {
    // TMS alone can fire a Weak edge for very high-scoring matchups
    hasDisciplineEdge = true;
    edgeStrength = "Weak";
    edgeReason = tms.disciplineEdgeReason;
  }

  // ── Step 6: Auto-boost calculation ───────────────────────────────────────
  // Base boost from team tendency
  let autoBoostBps = 0;

  if (propType === "strikeouts") {
    autoBoostBps = tms.strikeoutBoostBps;
  } else if (propType === "walks") {
    autoBoostBps = tms.walkBoostBps;
  }

  // Add historical adjustment (capped contribution)
  if (historical.sampleSize >= 3) {
    autoBoostBps += Math.min(200, Math.max(-200, historical.avgBoostBps));
  }

  // Edge strength multiplier
  if (edgeStrength === "Strong") autoBoostBps = Math.round(autoBoostBps * 1.2);
  else if (edgeStrength === "Moderate") autoBoostBps = Math.round(autoBoostBps * 1.0);
  else if (!hasDisciplineEdge) autoBoostBps = Math.round(autoBoostBps * 0.5);

  // Hard cap at ±500 bps (5%)
  autoBoostBps = Math.min(500, Math.max(-500, autoBoostBps));

  // Apply boost to model probability
  const boostedProbability = Math.min(0.97, Math.max(0.03, modelProbability + autoBoostBps / 10000));

  return {
    hasDisciplineEdge,
    edgeReason,
    edgeStrength,
    tms,
    autoBoostBps,
    boostedProbability,
    signals: {
      teamProfileSignal,
      historicalSignal,
      marketSignal,
    },
    historicalAdjustment: {
      sampleSize: historical.sampleSize,
      hitRate: historical.hitRate,
      avgBoostBps: historical.avgBoostBps,
    },
  };
}

// ── Batch evaluate multiple pitcher props ─────────────────────────────────────
export async function evaluatePitcherProps(props: PitcherPropInput[]): Promise<Map<string, DisciplineEdgeResult>> {
  const results = new Map<string, DisciplineEdgeResult>();
  await Promise.allSettled(
    props.map(async (p) => {
      try {
        const key = `${p.pitcherName}_${p.propType}`;
        const result = await detectDisciplineEdge(p);
        results.set(key, result);
      } catch (e) {
        console.warn(`[DisciplineEdge] Failed for ${p.pitcherName}:`, e);
      }
    })
  );
  return results;
}
