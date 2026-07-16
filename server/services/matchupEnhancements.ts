/**
 * matchupEnhancements.ts — PHASE 3 (deploy alongside contactQualityIndex)
 *
 * Two matchup-level upgrades from the Barrel Report process:
 *
 *  1. BARREL MATCHUP — batter barrel ability × pitcher barrel vulnerability.
 *     The video's core thesis: don't rate hitters and pitchers separately,
 *     rate the FIT. Both inputs already exist post-Phase-1.
 *
 *  2. HANDEDNESS SPLITS — pitcher xwOBA-against split by batter hand (vl/vr).
 *     The achievable middle step toward pitch-type matchup fit. One MLB API
 *     call per pitcher; aggregate ERA hides massive L/R differences.
 *
 * Location: server/services/matchupEnhancements.ts
 * Integrates into: mlbMatchupVSGate.ts (computeVSGate)
 * HARD DEPENDENCY: Phase 1 robustStatcastLookup fix (barrel data must be real)
 */

// ─── 1. BARREL MATCHUP ────────────────────────────────────────────────────────

export interface BarrelMatchupResult {
  score: number;                 // 0-10, plugs into VS gate weighting
  isDamageMatchup: boolean;      // both sides top-third → explanation flag
  batterBarrelPct: number | null;
  pitcherBarrelAllowedPct: number | null;
  explanationBullet: string | null;   // feeds Explanation Engine directly
}

/**
 * League context (2024-2026):
 *   Batter barrel%:          2% weak → 18% elite
 *   Pitcher barrel% allowed: 5% suppressor → 13% leaky
 */
export function computeBarrelMatchup(
  batterBarrelPct: number | null | undefined,
  pitcherBarrelAllowedPct: number | null | undefined,
): BarrelMatchupResult {
  // Missing either side → neutral, never punish absent data
  if (batterBarrelPct == null || pitcherBarrelAllowedPct == null) {
    return { score: 5.0, isDamageMatchup: false, batterBarrelPct: batterBarrelPct ?? null, pitcherBarrelAllowedPct: pitcherBarrelAllowedPct ?? null, explanationBullet: null };
  }

  // Normalize each side 0-1
  const batterN = Math.max(0, Math.min(1, (batterBarrelPct - 2) / 16));        // 2→0, 18→1
  const pitcherN = Math.max(0, Math.min(1, (pitcherBarrelAllowedPct - 5) / 8)); // 5→0, 13→1

  // Geometric mean — BOTH sides must contribute. A barrel hitter vs a
  // suppressor scores low; a weak hitter vs a leaky pitcher scores low.
  // Only hitter-can × pitcher-allows scores high. That's the fit.
  const fit = Math.sqrt(batterN * pitcherN);
  const score = Math.round(fit * 100) / 10; // 0-10

  const isDamageMatchup = batterN >= 0.60 && pitcherN >= 0.60;

  const explanationBullet = isDamageMatchup
    ? `Barrel-on-barrel matchup — ${batterBarrelPct.toFixed(1)}% barrel hitter vs a pitcher allowing ${pitcherBarrelAllowedPct.toFixed(1)}% barrels`
    : score <= 2.5 && batterN >= 0.5
    ? `Barrel threat neutralized — pitcher suppresses barrels (${pitcherBarrelAllowedPct.toFixed(1)}% allowed)`
    : null;

  return { score, isDamageMatchup, batterBarrelPct, pitcherBarrelAllowedPct, explanationBullet };
}

// ─── 2. HANDEDNESS SPLITS ─────────────────────────────────────────────────────

const MLB_API = 'https://statsapi.mlb.com/api/v1';

export interface PitcherHandSplits {
  pitcherId: number;
  vsLeft: { xwoba: number | null; obpAgainst: number | null; sample: number };
  vsRight: { xwoba: number | null; obpAgainst: number | null; sample: number };
  splitGap: number | null;       // |vsL − vsR| OBP-against gap; ≥.040 = exploitable
  weakSide: 'L' | 'R' | null;    // which batter hand hits him harder
}

// Cache — one fetch per pitcher per day
const splitsCache = new Map<number, { data: PitcherHandSplits; ts: number }>();
const SPLITS_TTL = 6 * 60 * 60 * 1000;

export async function fetchPitcherHandSplits(
  pitcherId: number,
  season = new Date().getFullYear(),
): Promise<PitcherHandSplits> {
  const cached = splitsCache.get(pitcherId);
  if (cached && Date.now() - cached.ts < SPLITS_TTL) return cached.data;

  const empty: PitcherHandSplits = {
    pitcherId,
    vsLeft: { xwoba: null, obpAgainst: null, sample: 0 },
    vsRight: { xwoba: null, obpAgainst: null, sample: 0 },
    splitGap: null,
    weakSide: null,
  };

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(
      `${MLB_API}/people/${pitcherId}/stats?stats=statSplits&group=pitching&season=${season}&sitCodes=vl,vr`,
      { signal: ctrl.signal },
    );
    clearTimeout(t);
    if (!res.ok) return empty;

    const data = await res.json();
    const splits: any[] = data?.stats?.[0]?.splits ?? [];
    const out = { ...empty };

    for (const s of splits) {
      const obp = parseFloat(s.stat?.obp ?? '');
      const bf = s.stat?.battersFaced ?? 0;
      const side = s.split?.code === 'vl'
        ? out.vsLeft
        : s.split?.code === 'vr' ? out.vsRight : null;
      if (side) {
        side.obpAgainst = isNaN(obp) ? null : obp;
        side.sample = bf;
      }
    }

    if (out.vsLeft.obpAgainst != null && out.vsRight.obpAgainst != null &&
        out.vsLeft.sample >= 40 && out.vsRight.sample >= 40) {   // min sample guard
      out.splitGap = Math.round(Math.abs(out.vsLeft.obpAgainst - out.vsRight.obpAgainst) * 1000) / 1000;
      out.weakSide = out.vsLeft.obpAgainst > out.vsRight.obpAgainst ? 'L' : 'R';
    }

    splitsCache.set(pitcherId, { data: out, ts: Date.now() });
    return out;
  } catch {
    return empty;
  }
}

export interface HandSplitMatchupResult {
  score: number;                 // 0-10
  onWeakSide: boolean;
  explanationBullet: string | null;
}

/** Score the batter's hand against the pitcher's actual splits (not aggregate ERA) */
export function computeHandSplitMatchup(
  batterHand: 'L' | 'R' | 'S',
  splits: PitcherHandSplits,
): HandSplitMatchupResult {
  if (splits.splitGap === null || splits.weakSide === null) {
    return { score: 5.0, onWeakSide: false, explanationBullet: null };
  }

  // Switch hitters always take the weak side
  const effectiveHand: 'L' | 'R' = batterHand === 'S' ? splits.weakSide : batterHand;
  const onWeakSide = effectiveHand === splits.weakSide;
  const relevantOBP = effectiveHand === 'L' ? splits.vsLeft.obpAgainst! : splits.vsRight.obpAgainst!;

  // Base score from the OBP-against the batter actually faces:
  // .280 → 2, .330 → 5, .390 → 9
  let score = Math.max(0, Math.min(10, ((relevantOBP - 0.260) / 0.140) * 10));

  // Big exploitable gap on the weak side → bonus
  if (onWeakSide && splits.splitGap >= 0.040) score = Math.min(10, score + 1.5);

  const explanationBullet =
    onWeakSide && splits.splitGap >= 0.040
      ? `Attacking the split — pitcher allows ${relevantOBP.toFixed(3)} OBP vs ${effectiveHand}HB (${(splits.splitGap * 1000).toFixed(0)}-pt gap vs other side)`
      : !onWeakSide && splits.splitGap >= 0.050
      ? `Wrong side of a big split — pitcher is much tougher on ${effectiveHand}HB`
      : null;

  return { score: Math.round(score * 10) / 10, onWeakSide, explanationBullet };
}

/*
 * ═══ INTEGRATION into mlbMatchupVSGate.ts (computeVSGate) ═══
 *
 * 1. Add imports:
 *      import { computeBarrelMatchup, fetchPitcherHandSplits, computeHandSplitMatchup } from './matchupEnhancements';
 *
 * 2. Inside computeVSGate, after the existing component scores:
 *      const barrel = computeBarrelMatchup(
 *        enrichedBatter.barrelPct ?? null,
 *        fullPitcher.barrelPctAllowed ?? null,
 *      );
 *      const handSplits = await fetchPitcherHandSplits(pitcher.playerId);
 *      const handMatch = computeHandSplitMatchup(enrichedBatter.hand ?? 'R', handSplits);
 *
 * 3. Reweight the VS score (replaces the current 5-component blend):
 *      const score =
 *        xwobaDeltaScore    * 0.24 +   // was 0.30
 *        handMatch.score    * 0.16 +   // NEW — replaces generic platoon (was 0.20)
 *        pitcherVulnScore   * 0.22 +   // was 0.25
 *        batterContactScore * 0.13 +   // was 0.15
 *        barrel.score       * 0.15 +   // NEW — the fit multiplication
 *        parkScore          * 0.10;    // unchanged
 *
 * 4. Push explanation bullets into reasoning:
 *      if (barrel.explanationBullet) reasoning.push(barrel.explanationBullet);
 *      if (handMatch.explanationBullet) reasoning.push(handMatch.explanationBullet);
 *
 * 5. Damage-matchup flag rides along for the UI:
 *      return { ...result, isDamageMatchup: barrel.isDamageMatchup };
 *
 * NOTE: these weights are launch values. Phase 2 backtest reweights on evidence
 * (Principle 5). If barrel matchup shows r < 0.04 after 200 picks, it gets cut —
 * same rules as everything else.
 */
