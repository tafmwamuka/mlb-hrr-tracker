/**
 * pitcherPicksFilter.ts
 *
 * Post-processing filter applied to the raw output of runPitcherEdgeEngine()
 * before picks are returned by the discipline router.
 *
 * Solves:
 *  1. Deduplication — one pick per pitcher (best prop only)
 *  2. Hard cap — max 8 official picks on the board
 *  3. Fair odds sanity check — Fair worse than -500 = model outlier → archive
 *  4. Lean picks hidden by default (returned separately, not in main list)
 *  5. Minimum odds cap — book odds worse than -400 = PARLAY ONLY tag
 *
 * Usage in discipline.ts router (getPitcherEdgePicks):
 *
 *   import { filterPitcherPicks } from '../services/pitcherPicksFilter';
 *   const result = await runPitcherEdgeEngine();
 *   const filtered = filterPitcherPicks(result.picks, result.rejectedPlays);
 *   return { ...filtered, generatedAt: new Date().toISOString() };
 */

// ─── Types (mirrors what runPitcherEdgeEngine returns) ───────────────────────

interface RawPick {
  pitcherName: string;
  pitcherTeam: string;
  opponentTeam: string;
  pitcherHand: string;
  gameTime: string;
  propType: 'strikeouts' | 'walks';
  line: number;
  bookOdds: number;
  fairOdds: number;
  modelProbability: number;   // 0-1 scale
  impliedProbability: number; // 0-1 scale
  edge: number;               // 0-1 scale
  pitcherEdgeScore: number;
  tms: number;
  tier: string;
  hasDisciplineEdge: boolean;
  isDualEdge: boolean;
  qualifyingReasons: string[];
  riskFlags: string[];
  disciplineGrade: string | null;
  opponentKRate: number | null;
  opponentBBRate: number | null;
  historicalHitRate: number | null;
  sampleSize: number;
  isOfficialPlay: boolean;
  isLeanPlay: boolean;
  isProjectionOnly: boolean;
  hasMarketData: boolean;
  pricingPenaltyTier?: string;
  pricingPenaltyLabel?: string;
  isUltraJuiced?: boolean;
  adjustedEdgeScore?: number;
  actionabilityScore?: number;
  playCategory?: string;
}

interface RawRejectedPlay {
  pitcherName: string;
  pitcherTeam: string;
  opponentTeam: string;
  propType: string;
  line: number;
  modelProbability: number;
  requiredThreshold: number;
  rejectionReasons: string[];
  rejectionSummary: string;
  supportingFactors: number;
  requiredFactors: number;
  hasMarketData: boolean;
  edge: number | null;
}

export interface FilteredPicks {
  // Main board — shown by default
  officialPicks: RawPick[];      // max 8, deduped, sane fair odds
  leanPicks: RawPick[];          // hidden by default, shown on request
  parlayOnlyPicks: RawPick[];    // odds > -400, parlay only
  modelOutliers: RawPick[];      // fair odds worse than -500 — research archive

  // Metadata
  dualEdgePitchers: string[];
  stackAlertGames: string[];
  hasOfficialPlays: boolean;
  hasLeanPlays: boolean;

  // Rejected plays (unchanged)
  rejectedPlays: RawRejectedPlay[];

  // Summary counts for header display
  counts: {
    official: number;
    lean: number;
    parlayOnly: number;
    outliers: number;
    total: number;
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_OFFICIAL_PICKS = 8;
const MAX_PARLAY_PICKS = 8;                // cap parlay section too
const FAIR_ODDS_OUTLIER_THRESHOLD = -500;  // fair worse than -500 = model is broken
const BOOK_ODDS_HARD_EXCLUDE = -600;       // book worse than -600 = never show, ever (-3100 Cease)
const PARLAY_ONLY_ODDS_THRESHOLD = -250;   // book worse than -250 = parlay only (tightened from -300)

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Composite score for ranking picks within the same pitcher.
 * Used to pick the BEST prop when a pitcher appears multiple times.
 * Priority: model probability > edge > TMS
 */
function pickScore(p: RawPick): number {
  const prob = p.modelProbability * 100; // 0-100
  const edgePct = p.edge * 100;          // 0-100
  const tms = p.tms;                     // 0-100

  // Weight: 50% probability, 30% edge, 20% TMS
  return (prob * 0.50) + (edgePct * 0.30) + (tms * 0.20);
}

/**
 * Check if fair odds are a model outlier.
 * When fair odds are much worse than the book, it means the model
 * assigns near-certainty to something the book prices as uncertain.
 * That's usually a calibration error, not genuine edge.
 */
function isFairOddsOutlier(pick: RawPick): boolean {
  return pick.fairOdds < FAIR_ODDS_OUTLIER_THRESHOLD;
}

/**
 * Hard exclude — book odds so extreme they should never appear anywhere.
 * e.g. Dylan Cease -3100. These are data errors or severe model miscalibration.
 */
function isHardExclude(pick: RawPick): boolean {
  return pick.bookOdds < BOOK_ODDS_HARD_EXCLUDE;
}

/**
 * Check if book odds are too expensive for a single bet.
 * -251 or worse = parlay only.
 */
function isParlayOnly(pick: RawPick): boolean {
  return pick.bookOdds < PARLAY_ONLY_ODDS_THRESHOLD;
}

// ─── Main filter ──────────────────────────────────────────────────────────────

export function filterPitcherPicks(
  rawPicks: RawPick[],
  rejectedPlays: RawRejectedPlay[] = []
): FilteredPicks {

  // ── Step 1: Hard exclude first (e.g. -3100 Cease) ────────────────────────
  // These are data errors or extreme miscalibrations — never show anywhere
  const hardExcluded: RawPick[] = [];
  const afterHardExclude: RawPick[] = [];

  for (const pick of rawPicks) {
    if (isHardExclude(pick)) {
      hardExcluded.push(pick);
      console.log(`[PitcherFilter] Hard excluded ${pick.pitcherName}: bookOdds=${pick.bookOdds}`);
    } else {
      afterHardExclude.push(pick);
    }
  }

  // ── Step 2: Separate model outliers ──────────────────────────────────────
  const outliers: RawPick[] = [];
  const sane: RawPick[] = [];

  for (const pick of afterHardExclude) {
    if (isFairOddsOutlier(pick)) {
      outliers.push({
        ...pick,
        riskFlags: [
          ...pick.riskFlags,
          `⚠️ Model outlier: fair odds ${pick.fairOdds} vs book ${pick.bookOdds} — model may be miscalibrated`,
        ],
        isProjectionOnly: true,
        playCategory: 'RESEARCH_ONLY',
      });
    } else {
      sane.push(pick);
    }
  }

  // ── Step 2: Deduplicate — one pick per pitcher (best score wins) ──────────
  const pitcherBestPick = new Map<string, RawPick>();

  for (const pick of sane) {
    const key = `${pick.pitcherName}|${pick.pitcherTeam}`;
    const existing = pitcherBestPick.get(key);

    if (!existing || pickScore(pick) > pickScore(existing)) {
      pitcherBestPick.set(key, pick);
    }
  }

  const dedupedPicks = Array.from(pitcherBestPick.values());

  // ── Step 3: Separate parlay-only, leans, and official picks ──────────────
  const parlayOnly: RawPick[] = [];
  const leans: RawPick[] = [];
  const candidates: RawPick[] = [];

  for (const pick of dedupedPicks) {
    // Leans go to their own bucket — but still apply odds checks
    if (pick.isLeanPlay && !pick.isOfficialPlay) {
      // Leans with extreme odds go to outliers
      if (pick.bookOdds < BOOK_ODDS_HARD_EXCLUDE) continue; // silently drop
      if (isParlayOnly(pick)) {
        parlayOnly.push({
          ...pick,
          pricingPenaltyTier: 'PARLAY_ONLY',
          pricingPenaltyLabel: 'Parlay Only (odds worse than -250)',
          riskFlags: [
            ...pick.riskFlags,
            `Book odds ${pick.bookOdds} too expensive for single bet — use as parlay leg only`,
          ],
        });
      } else {
        leans.push(pick);
      }
      continue;
    }

    // Parlay only — expensive odds but otherwise qualifies
    if (isParlayOnly(pick)) {
      parlayOnly.push({
        ...pick,
        pricingPenaltyTier: 'PARLAY_ONLY',
        pricingPenaltyLabel: 'Parlay Only (odds worse than -250)',
        riskFlags: [
          ...pick.riskFlags,
          `Book odds ${pick.bookOdds} too expensive for single bet — use as parlay leg only`,
        ],
      });
      continue;
    }

    candidates.push(pick);
  }

  // ── Step 4: Sort candidates and apply hard cap ────────────────────────────
  candidates.sort((a, b) => {
    // Official plays first
    if (a.isOfficialPlay !== b.isOfficialPlay) {
      return a.isOfficialPlay ? -1 : 1;
    }
    // Then by composite score
    return pickScore(b) - pickScore(a);
  });

  const officialPicks = candidates.slice(0, MAX_OFFICIAL_PICKS);
  // Sort parlay picks by model probability and cap
  parlayOnly.sort((a, b) => b.modelProbability - a.modelProbability);
  const parlayOnlyCapped = parlayOnly.slice(0, MAX_PARLAY_PICKS);

  // ── Step 5: Dual edge and stack alert detection ───────────────────────────
  // A pitcher is dual edge if they appear in BOTH K and BB categories
  // in the original raw picks (before deduplication)
  const pitcherPropCounts = new Map<string, Set<string>>();
  for (const pick of sane) {
    const key = pick.pitcherName;
    if (!pitcherPropCounts.has(key)) pitcherPropCounts.set(key, new Set());
    pitcherPropCounts.get(key)!.add(pick.propType);
  }

  const dualEdgePitchers = Array.from(pitcherPropCounts.entries())
    .filter(([, props]) => props.size >= 2)
    .map(([name]) => name);

  // Stack alert: 3+ pitchers from the same game
  const gamePitcherCounts = new Map<string, number>();
  for (const pick of officialPicks) {
    const gameKey = `${pick.pitcherTeam}|${pick.opponentTeam}`;
    gamePitcherCounts.set(gameKey, (gamePitcherCounts.get(gameKey) || 0) + 1);
  }
  const stackAlertGames = Array.from(gamePitcherCounts.entries())
    .filter(([, count]) => count >= 3)
    .map(([game]) => game);

  const counts = {
    official: officialPicks.length,
    lean: leans.length,
    parlayOnly: parlayOnlyCapped.length,
    outliers: outliers.length + hardExcluded.length,
    total: officialPicks.length + leans.length + parlayOnlyCapped.length,
  };

  return {
    officialPicks,
    leanPicks: leans,
    parlayOnlyPicks: parlayOnlyCapped,
    modelOutliers: outliers,
    dualEdgePitchers,
    stackAlertGames,
    hasOfficialPlays: officialPicks.some(p => p.isOfficialPlay),
    hasLeanPlays: leans.length > 0,
    rejectedPlays,
    counts,
  };
}
