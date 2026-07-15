/**
 * hitterQualityScore.ts — LAYER 4 (replaces OBP/xwOBA + HRD factors)
 *
 * HQS = ( Contact 0.40 + Quality 0.35 + Power 0.25 ) shrunk by BBE confidence
 *
 *   Contact (40%): K% inverted (60%) + Whiff% inverted (40%)
 *     — for over-0.5 lines, low-K hitters put more balls in play per game
 *       = consistency. Effective global K% weight ≈ 6.7% (0.28×0.40×0.60).
 *   Quality (35%): HH% (35%) + SweetSpot% (35%) + wOBA (30%)
 *     — EV dropped per collinearity (HH% and Barrel% are EV-derived);
 *       its weight redistributed to SweetSpot.
 *   Power (25%): ISO (60%) + Barrel% (40%)
 *
 *   BBE confidence multiplier — NOT a scored metric. Shrinks HQS toward 50
 *   on thin samples so 28.6% barrel on 7 BBE can never outrank 15% on 60 BBE.
 *
 * Location: server/services/hitterQualityScore.ts
 * Depends on: Phase 1 robustStatcastLookup (deploy Phase 1 first, same session)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HitterStatline {
  kPct?: number | null;            // e.g. 21.5 (raw rate) OR 0-100 percentile if preNormalized=true
  whiffPct?: number | null;        // e.g. 24.0 (raw rate) OR 0-100 percentile if preNormalized=true
  hardHitPct?: number | null;      // e.g. 44.5
  sweetSpotPct?: number | null;    // e.g. 34.0
  woba?: number | null;            // e.g. 0.352 (xwOBA acceptable)
  iso?: number | null;             // e.g. 0.185 (raw ISO) OR 0-100 percentile if preNormalized=true
  barrelPct?: number | null;       // e.g. 11.2
  bbe?: number | null;             // balls in play in the window
  /**
   * Phase BN: When true, kPct/whiffPct/iso are already 0-100 percentile scores
   * (higher = better for all three) and should NOT be run through the raw-rate
   * normalization ranges. Set by pybaseballService when data comes from
   * statcast_batter_percentile_ranks instead of raw FanGraphs rates.
   */
  preNormalized?: boolean;
}

export interface HQSResult {
  hqs: number;                     // 0-100, post-confidence
  hqsRaw: number;                  // 0-100, pre-confidence
  bbeConfidence: number;           // 0-1 multiplier applied
  components: {
    contact: number;               // 0-100
    quality: number;
    power: number;
  };
  sub: Record<string, number | null>;  // every input's normalized score, for factorBreakdown
  dataQuality: 'full' | 'partial' | 'none';
  flags: string[];                 // explanation-ready notes
}

// ─── League normalization ranges (2024-2026) ─────────────────────────────────

const R = {
  kPct: { lo: 32, hi: 12 },          // inverted: 32% K → 0, 12% → 100
  whiffPct: { lo: 36, hi: 16 },      // inverted
  hardHitPct: { lo: 28, hi: 52 },
  sweetSpotPct: { lo: 26, hi: 40 },
  woba: { lo: 0.280, hi: 0.400 },
  iso: { lo: 0.090, hi: 0.260 },
  barrelPct: { lo: 3, hi: 16 },
};

// BBE target for full confidence — pass 60 for season windows, 25 for L10-L15
const DEFAULT_BBE_TARGET = 60;

const norm = (v: number, lo: number, hi: number) =>
  Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));

// ─── Main ─────────────────────────────────────────────────────────────────────

export function calculateHQS(
  s: HitterStatline | null | undefined,
  bbeTarget: number = DEFAULT_BBE_TARGET,
): HQSResult {
  const neutral: HQSResult = {
    hqs: 50, hqsRaw: 50, bbeConfidence: 0,
    components: { contact: 50, quality: 50, power: 50 },
    sub: {}, dataQuality: 'none', flags: ['No Statcast data — neutral HQS'],
  };
  if (!s) return neutral;

  // Phase BN: kPct/whiffPct/iso may be pre-normalized 0-100 percentile scores
  // (higher = better for all three) when data comes from percentile_ranks.
  // In that case, skip the raw-rate normalization ranges and use the value directly.
  const pn = s.preNormalized === true;
  const sub: Record<string, number | null> = {
    kPct:       s.kPct      != null ? (pn ? Math.max(0, Math.min(100, s.kPct))      : norm(s.kPct, R.kPct.lo, R.kPct.hi))           : null,
    whiffPct:   s.whiffPct  != null ? (pn ? Math.max(0, Math.min(100, s.whiffPct))  : norm(s.whiffPct, R.whiffPct.lo, R.whiffPct.hi)) : null,
    hardHitPct: s.hardHitPct  != null ? norm(s.hardHitPct,  R.hardHitPct.lo,  R.hardHitPct.hi)  : null,
    sweetSpotPct: s.sweetSpotPct != null ? norm(s.sweetSpotPct, R.sweetSpotPct.lo, R.sweetSpotPct.hi) : null,
    woba:       s.woba      != null ? norm(s.woba,      R.woba.lo,      R.woba.hi)       : null,
    iso:        s.iso       != null ? (pn ? Math.max(0, Math.min(100, s.iso))        : norm(s.iso, R.iso.lo, R.iso.hi))               : null,
    barrelPct:  s.barrelPct != null ? norm(s.barrelPct, R.barrelPct.lo, R.barrelPct.hi) : null,
  };

  // Component builder — reweights over AVAILABLE inputs only (missing ≠ 50 drag)
  const blend = (parts: Array<[number | null, number]>): number | null => {
    const avail = parts.filter(([v]) => v !== null) as Array<[number, number]>;
    if (!avail.length) return null;
    const wSum = avail.reduce((a, [, w]) => a + w, 0);
    return avail.reduce((a, [v, w]) => a + v * (w / wSum), 0);
  };

  const contact = blend([[sub.kPct, 0.60], [sub.whiffPct, 0.40]]);
  const quality = blend([[sub.hardHitPct, 0.35], [sub.sweetSpotPct, 0.35], [sub.woba, 0.30]]);
  const power = blend([[sub.iso, 0.60], [sub.barrelPct, 0.40]]);

  const top = blend([[contact, 0.40], [quality, 0.35], [power, 0.25]]);
  if (top === null) return neutral;
  const hqsRaw = Math.round(top);

  // ── BBE confidence multiplier — shrink toward 50, never toward 0 ──
  // Phase BN fix: when BBE is entirely unavailable (null/undefined), use 0.75 neutral
  // confidence instead of 0 — a flat 50 from a null BBE is not meaningful signal.
  const bbe = s.bbe ?? null;
  const bbeConfidence = bbe === null
    ? 0.75  // BBE unavailable — default to moderate confidence, not zero
    : Math.round(Math.sqrt(Math.min(1, bbe / bbeTarget)) * 100) / 100;
  const hqs = Math.round(50 + (hqsRaw - 50) * bbeConfidence);

  const present = Object.values(sub).filter(v => v !== null).length;
  const dataQuality: HQSResult['dataQuality'] =
    present >= 6 && bbeConfidence >= 0.8 ? 'full'
    : present >= 3 ? 'partial' : 'none';

  const flags: string[] = [];
  if (bbe === null)
    flags.push(`BBE unavailable — confidence defaulted to 0.75 (score ${hqsRaw}→${hqs})`);
  else if (bbeConfidence < 0.7 && Math.abs(hqsRaw - 50) > 15)
    flags.push(`Score shrunk ${hqsRaw}→${hqs} — only ${bbe} BBE (need ${bbeTarget} for full confidence)`);
  if ((contact ?? 50) >= 70 && (quality ?? 50) >= 70)
    flags.push(`Contact + quality both elite — high-floor HRR profile`);
  if (sub.kPct !== null && sub.kPct >= 75)
    flags.push(`Low strikeout rate (${s.kPct?.toFixed(1)}%) — more balls in play per game`);

  return {
    hqs, hqsRaw, bbeConfidence,
    components: {
      contact: Math.round(contact ?? 50),
      quality: Math.round(quality ?? 50),
      power: Math.round(power ?? 50),
    },
    sub, dataQuality, flags,
  };
}

// ─── PropFinder profile badges (HRR PRIME / HRR SOLID) ───────────────────────
// Same thresholds as the PropFinder highlight profiles, computed from Statcast
// so the badge appears without a manual export.

export function getHRRProfileBadge(s: HitterStatline): 'HRR_PRIME' | 'HRR_SOLID' | null {
  const ok = (v: number | null | undefined, min: number) => v != null && v >= min;
  const okMax = (v: number | null | undefined, max: number) => v != null && v <= max;

  if (
    ok(s.bbe, 10) && ok(s.woba, 0.360) && ok(s.hardHitPct, 42) &&
    ok(s.sweetSpotPct, 32) && ok(s.iso, 0.15) &&
    okMax(s.kPct, 22) && okMax(s.whiffPct, 25)
  ) return 'HRR_PRIME';

  if (
    ok(s.bbe, 8) && ok(s.woba, 0.330) && ok(s.hardHitPct, 38) &&
    ok(s.sweetSpotPct, 30) && ok(s.iso, 0.12) && okMax(s.kPct, 25)
  ) return 'HRR_SOLID';

  return null;
}

/*
 * ═══ BACKTEST PLAN FOR LAYER 4 WEIGHTS (Phase 2) ═══
 *
 * Log into factorBreakdown at lock time (saveLockedPick):
 *   hqs, hqsRaw, bbeConfidence, hqsContact, hqsQuality, hqsPower,
 *   hqsKPct (normalized), hrrProfile ('PRIME'|'SOLID'|null)
 *
 * Hypotheses to test at 50 picks (provisional) / 200 picks (act):
 *   H1  hqs correlates with hits (point-biserial r ≥ 0.08 expected)
 *   H2  K% DIRECTION — Taf's consistency thesis: among picks with equal
 *       quality scores, do low-K hitters hit over-0.5 lines more often?
 *       If r(kPct-inverted) < 0.02 → cut contact weight 40→25.
 *       If r ≥ 0.06 → thesis confirmed, hold or raise.
 *   H3  BBE multiplier value — compare hit rate of full-confidence (≥0.9)
 *       vs shrunk (<0.7) picks. Shrunk picks should NOT underperform
 *       (if they do, the multiplier isn't shrinking enough → square it).
 *   H4  Component grid — offline, rescore all logged picks under
 *       {contact/quality/power} ∈ {50/30/20, 40/35/25, 30/40/30, 25/45/30}
 *       and pick the set maximizing hit-rate separation. backtestService
 *       already stores everything needed; this is a pure re-computation.
 *   H5  PRIME/SOLID badges — do badge-holders outperform the board?
 *       If PRIME hit rate ≥ board+7pts → surface badge tier in PQS.
 */
