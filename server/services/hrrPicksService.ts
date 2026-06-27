/**
 * Shared HRR Picks Service
 * Extracts the full getHRRPicks pipeline so that both the Money Picks tab
 * and the Results tab always show identical plays.
 *
 * This is the single source of truth for:
 *   - VS gate (mlbMatchupService — pitcher ERA/platoon/Statcast, 0-10 scale)
 *   - 10-factor matrix scoring (rankAIPicks)
 *   - HRR Poisson projections (generateHRRProjections)
 *   - Alternate line calculation + quality gate (75%+ overProb)
 *
 * Usage:
 *   import { getEnrichedMoneyPicks } from '../services/hrrPicksService';
 *   const { moneyPicks, allMatrixPicks, dataDate } = await getEnrichedMoneyPicks();
 */

import { rankAIPicks, getMockHRTargets, getMockParkFactors } from './aiRankingService';
import { fetchOddsForPicks, americanToImpliedProbability, removeVig } from './oddsApiService';
import { analyzeValue, calcEV, probToAmericanOdds, getValueTier } from './valueEngine';
// Phase AP: getMockSavantData removed — barrel threat check now uses real statcastCache
import { generateHRRProjections } from './hrrService';
import { poissonOverProbability, calculateAlternateLines, findFairLine, calculateEdge, getPickQuality } from './poissonModel';
import { passesQualityGate, rankByPQS } from './playQualityScore';
import { getAdaptedLineupData } from './lineupAdapter';
import { getDataDate } from './mlbLineupService';
import { getEnrichmentData, pollForWarmEnrichment } from './enrichmentCache';

// ─── Phase BK: Alt Line Optimization ─────────────────────────────────────────

/**
 * Per-line evaluation result for the alt line table.
 * Each available HRR line (O 0.5, O 1.5, O 2.5, etc.) gets its own evaluation.
 */
export interface LineEvaluation {
  line: number;          // e.g. 1.5
  bookOdds: number | null;      // American odds from sportsbook (null = not available)
  bookImpliedProb: number | null; // Vig-free implied probability (0-100)
  modelProb: number;    // Poisson model probability (0-100)
  historicalHitRate: number | null; // % of last 5 games where player cleared this line (0-100)
  historicalHitRateLong: number | null; // % of all available games (up to 7) where player cleared this line
  edge: number | null;  // modelProb - bookImpliedProb (percentage points; null if no book odds)
  ev: number | null;    // Expected value % (null if no book odds)
  consistencyScore: number | null; // 0-100: composite of model + history agreement
  riskGrade: 'LOW' | 'MEDIUM' | 'HIGH' | 'LONGSHOT'; // risk classification
  lineType: 'SAFE LINE' | 'VALUE LINE' | 'AGGRESSIVE LINE' | 'LONGSHOT LINE' | 'PARLAY ONLY';
  verdict: 'BEST SAFE LINE' | 'GOOD VALUE' | 'HIGHER RISK' | 'LONGSHOT' | 'OVERPRICED' | 'NO ODDS' | 'BEST LINE' | 'PARLAY ONLY';
  isRecommended: boolean; // true for the single best-line pick
}

/**
 * Select the best playable HRR line for a player.
 *
 * Phase BM: Multi-factor scoring:
 *  1. Must have positive EV (edge > 0) — never recommend negative-EV even if safer
 *  2. Composite score: 40% model probability + 30% historical hit rate + 20% EV + 10% consistency
 *  3. Historical hit rate is computed from last5Games (HRR = hits+runs+rbi per game)
 *  4. Consistency score = agreement between model probability and historical hit rate
 *  5. Tiebreak: prefer lower line (safer) when composite scores are within 3 points
 *
 * Returns the recommended line + full per-line evaluation table.
 */
export function selectBestLine(
  lambda: number,                          // Poisson lambda (expected HRR)
  sbAlternateLines: Array<{ line: number; overOdds: number; underOdds?: number; impliedOverProb?: number }>,
  featuredLine: number | null,
  featuredOverOdds: number | null,
  last5Games?: Array<{ hits: number; runs: number; rbi: number }>, // Phase BM: player game log
): { recommendedLine: number; recommendedProb: number; bestLineVerdict: string; bestLineReason: string; lineEvaluations: LineEvaluation[] } {

  // Build the candidate set from sportsbook lines (only use lines actually available)
  const candidateLines: Array<{ line: number; overOdds: number }> = [];

  // Add featured line if available
  if (featuredLine !== null && featuredOverOdds !== null) {
    candidateLines.push({ line: featuredLine, overOdds: featuredOverOdds });
  }

  // Add alternate lines (deduplicate)
  for (const alt of sbAlternateLines) {
    if (!candidateLines.some(c => c.line === alt.line)) {
      candidateLines.push({ line: alt.line, overOdds: alt.overOdds });
    }
  }

  // Phase BM: Pre-compute historical hit rates per line from last5Games
  // HRR per game = hits + runs + rbi; hit rate at line X = % of games where HRR > X
  const hrrGames: number[] = (last5Games ?? []).map((g: { hits: number; runs: number; rbi: number }) => g.hits + g.runs + g.rbi);
  function calcHistoricalHitRate(line: number, games: number[]): number | null {
    if (games.length === 0) return null;
    const cleared = games.filter(hrr => hrr > line).length;
    return Math.round((cleared / games.length) * 100);
  }

  // If no sportsbook lines available, fall back to model fair line
  if (candidateLines.length === 0) {
    const fairLine = findFairLine(lambda);
    const modelProb = Math.round(poissonOverProbability(fairLine, lambda) * 100);
    const historicalHitRate = calcHistoricalHitRate(fairLine, hrrGames);
    return {
      recommendedLine: fairLine,
      recommendedProb: modelProb,
      bestLineVerdict: 'MODEL LINE',
      bestLineReason: 'No sportsbook odds available — using model fair line.',
      lineEvaluations: [{
        line: fairLine,
        bookOdds: null,
        bookImpliedProb: null,
        modelProb,
        historicalHitRate,
        historicalHitRateLong: historicalHitRate,
        edge: null,
        ev: null,
        consistencyScore: null,
        riskGrade: modelProb >= 75 ? 'LOW' : modelProb >= 55 ? 'MEDIUM' : modelProb >= 35 ? 'HIGH' : 'LONGSHOT',
        lineType: modelProb >= 75 ? 'SAFE LINE' : modelProb >= 55 ? 'VALUE LINE' : modelProb >= 35 ? 'AGGRESSIVE LINE' : 'LONGSHOT LINE',
        verdict: 'NO ODDS',
        isRecommended: true,
      }],
    };
  }
  // Phase BM: Evaluate every candidate line with multi-factor scoring
  const evaluations: LineEvaluation[] = candidateLines
    .sort((a, b) => a.line - b.line) // ascending: 0.5, 1.5, 2.5 ...
    .map(({ line, overOdds }) => {
      const modelProbFrac = poissonOverProbability(line, lambda);
      const modelProb = Math.round(modelProbFrac * 100);
      // Vig-free book implied probability
      const rawImplied = americanToImpliedProbability(overOdds); // 0-1
      const vigFreeImplied = Math.round((rawImplied / 1.045) * 1000) / 10; // 0-100
      const edge = Math.round((modelProb - vigFreeImplied) * 10) / 10;
      const ev = calcEV(modelProb, overOdds);
      // Phase BM: Historical hit rate at this line
      const historicalHitRate = calcHistoricalHitRate(line, hrrGames);
      const historicalHitRateLong = historicalHitRate;
      // Phase BM: Consistency score - how well model and history agree (0-100)
      const consistencyScore = historicalHitRate !== null
        ? Math.round(Math.max(0, 100 - Math.abs(modelProb - historicalHitRate) * 1.5))
        : null;
      // Phase BM: Effective probability blends model + history for risk grading
      const effectiveProb = historicalHitRate !== null
        ? Math.round(modelProb * 0.6 + historicalHitRate * 0.4)
        : modelProb;
      const riskGrade: LineEvaluation['riskGrade'] =
        effectiveProb >= 75 ? 'LOW' :
        effectiveProb >= 55 ? 'MEDIUM' :
        effectiveProb >= 35 ? 'HIGH' : 'LONGSHOT';
      // Integration Patch: PARLAY ONLY rule — odds worse than -300 are not suitable
      // as standalone single bets. Mark them as PARLAY ONLY regardless of edge/score.
      const isParlayOnly = overOdds < -300;

      const lineType: LineEvaluation['lineType'] =
        isParlayOnly ? 'PARLAY ONLY' :
        effectiveProb >= 75 ? 'SAFE LINE' :
        effectiveProb >= 55 ? 'VALUE LINE' :
        effectiveProb >= 35 ? 'AGGRESSIVE LINE' : 'LONGSHOT LINE';
      const verdict: LineEvaluation['verdict'] =
        isParlayOnly ? 'PARLAY ONLY' :
        edge <= 0 ? 'OVERPRICED' :
        effectiveProb >= 75 ? 'BEST SAFE LINE' :
        effectiveProb >= 55 ? 'GOOD VALUE' :
        effectiveProb >= 35 ? 'HIGHER RISK' : 'LONGSHOT';
      return {
        line,
        bookOdds: overOdds,
        bookImpliedProb: vigFreeImplied,
        modelProb,
        historicalHitRate,
        historicalHitRateLong,
        edge,
        ev,
        consistencyScore,
        riskGrade,
        lineType,
        verdict,
        isRecommended: false,
      };
    });
  // Phase BM: Multi-factor composite scoring for best-line selection
  // Composite = 40% model prob + 30% historical hit rate + 20% EV (normalized) + 10% consistency
  // Must have positive EV - never recommend negative-EV even if safer
  function compositeScore(e: LineEvaluation): number {
    const modelScore = e.modelProb;
    const histScore = e.historicalHitRate ?? e.modelProb;
    const evNorm = Math.min(100, Math.max(0, ((e.ev ?? 0) + 10) * 5));
    const consistScore = e.consistencyScore ?? 50;
    return modelScore * 0.40 + histScore * 0.30 + evNorm * 0.20 + consistScore * 0.10;
  }
  // Integration Patch: PARLAY ONLY lines (odds < -300) are excluded from single-bet
  // recommendation entirely. Only lines with odds between -300 and +500 qualify.
  const singleBetEligible = evaluations.filter(e =>
    e.verdict !== 'PARLAY ONLY' &&
    (e.bookOdds === null || (e.bookOdds >= -300 && e.bookOdds <= 500))
  );
  const positiveEvLines = singleBetEligible.filter(e => (e.edge ?? 0) > 0);
  let bestEval: LineEvaluation | null = null;
  if (positiveEvLines.length > 0) {
    // Sort by composite score desc; tiebreak: prefer lower line (safer)
    positiveEvLines.sort((a, b) => {
      const scoreDiff = compositeScore(b) - compositeScore(a);
      if (Math.abs(scoreDiff) >= 3) return scoreDiff;
      return a.line - b.line;
    });
    bestEval = positiveEvLines[0];
  } else if (singleBetEligible.length > 0) {
    // No positive-EV lines among eligible — fall back to highest composite score (eligible only)
    const sorted = [...singleBetEligible].sort((a, b) => compositeScore(b) - compositeScore(a));
    bestEval = sorted[0] ?? null;
  } else {
    // All lines are PARLAY ONLY — no single-bet recommendation
    bestEval = null;
  }

  // Mark the recommended line and assign final verdicts.
  // PARLAY ONLY lines can never be isRecommended (already excluded from bestEval).
  const finalEvaluations: LineEvaluation[] = evaluations.map(e => {
    // PARLAY ONLY lines keep their verdict and are never recommended as single bets
    if (e.verdict === 'PARLAY ONLY') return { ...e, isRecommended: false };
    const isRecommended = bestEval !== null && e.line === bestEval.line;
    const verdict: LineEvaluation['verdict'] =
      isRecommended ? 'BEST LINE' :
      (e.edge ?? 0) <= 0 ? 'OVERPRICED' :
      e.modelProb >= 75 ? 'BEST SAFE LINE' :
      e.modelProb >= 55 ? 'GOOD VALUE' :
      e.modelProb >= 35 ? 'HIGHER RISK' : 'LONGSHOT';
    return { ...e, isRecommended, verdict };
  });

  const recommendedLine = bestEval?.line ?? (featuredLine ?? findFairLine(lambda));
  const recommendedProb = bestEval?.modelProb ?? Math.round(poissonOverProbability(recommendedLine, lambda) * 100);

  // Build human-readable reason
  let bestLineReason = 'Highest probability line with positive value.';
  if (!bestEval) {
    bestLineReason = 'All available lines are priced worse than -300 — suitable for parlays only.';
  } else if (bestEval) {
    if ((bestEval.edge ?? 0) <= 0) {
      bestLineReason = 'No positive-value line available — showing safest option.';
    } else if (bestEval.riskGrade === 'LOW') {
      bestLineReason = `High-probability line (${bestEval.modelProb}% model) with +${bestEval.edge}% edge.`;
    } else if (bestEval.riskGrade === 'MEDIUM') {
      bestLineReason = `Best balance of probability (${bestEval.modelProb}%) and value (+${bestEval.edge}% edge).`;
    } else {
      bestLineReason = `Higher-risk line (${bestEval.modelProb}%) offers best EV (+${bestEval.ev?.toFixed(1)}%).`;
    }
  }

  // If bestEval is null, all lines were PARLAY ONLY
  const bestLineVerdict = bestEval?.verdict ?? (singleBetEligible.length === 0 && evaluations.length > 0 ? 'PARLAY ONLY' : 'NO ODDS');

  return { recommendedLine, recommendedProb, bestLineVerdict, bestLineReason, lineEvaluations: finalEvaluations };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface EnrichedMoneyPick {
  playerId: number;
  playerName: string;
  team: string;
  pitcher: string;
  pitcherTeam: string;
  battingPosition: number;
  expectedHits: number;
  expectedRuns: number;
  expectedRBI: number;
  expectedTotal: number;
  reasoning: string;
  // ballparkReasoning and rcScore removed (Phase AZ — BallparkPal blocked, RC removed)
  parkFactor: number;
  lineSource: string;
  bookOdds: string | null;
  bookOddsProvider: string | null;
  bookImpliedProb: number | null;
  /** Best available over odds across all sportsbooks */
  bestAvailableOdds?: number | null;
  bestAvailableBook?: string | null;
  /** Opening line odds (first seen today) */
  openingOdds?: number | null;
  overProbability: number;
  edge: number;
  pickQuality: string;
  alternateLines: Array<{ line: number; overProb: number; underProb: number }>;
  fairLine: number;
  expectedTotal2: number;
  hrrLine: number;
  overallScore: number;
  baseScore?: number;
  bpBoost?: number;
  grade?: string;
  reasons?: string[];
  riskFlags?: string[];
  vsGrade?: number;
  gameTotalOU?: number | null;
  primePosition?: boolean;
  primePositionFactors?: any;
  isBestBet?: boolean;
  leanTier?: boolean;
  streakInfo?: any;
  dayNightSplit?: any;
  savantMetrics?: any;
  // Qualifying line (75%+)
  recommendedLine: number;
  recommendedProb: number;
  // Phase BK: Alt line optimization
  lineEvaluations?: LineEvaluation[];
  bestLineVerdict?: string;
  bestLineReason?: string;
  // Phase BY: Money Pick Alternatives (display-only, never affects record)
  pickAlternatives?: PickAlternative[];
}

// ─── Money Pick Alternatives ────────────────────────────────────────────────
// Generated per-pick after sportsbook odds are available.
// These are DISPLAY-ONLY and never affect official record, hit rate, or ROI.

export type AlternativeTier = 'SAFER' | 'BETTER_VALUE' | 'CEILING' | 'NONE';

export interface PickAlternative {
  tier: AlternativeTier;
  /** Human-readable label for the market, e.g. "O0.5 HRR" or "O1.5 HRR" */
  marketLabel: string;
  /** American odds from sportsbook */
  bookOdds: number;
  /** Model true probability (0-100) */
  trueProb: number;
  /** Sportsbook implied probability (0-100, vig-included) */
  impliedProb: number;
  /** Edge = trueProb - vigFreeImplied */
  edge: number;
  /** Fair American odds from model */
  fairOdds: number;
  /** Expected value % */
  ev: number;
  /** Why this alternative qualifies */
  reason: string;
}

export interface EnrichmentStatus {
  lineups: 'ok' | 'pending' | 'failed';
  odds: 'ok' | 'partial' | 'pending' | 'failed';
  statcast: 'ok' | 'partial' | 'failed';
  streaks: 'ok' | 'partial' | 'failed';
  dayNight: 'ok' | 'partial' | 'failed';
  bullpen: 'ok' | 'partial' | 'failed';
  isPartialEnrichment: boolean;
  lastUpdated: string;
}

export interface HRRPicksResult {
  moneyPicks: EnrichedMoneyPick[];
  allMatrixPicks: any[];
  dataDate: string;
  lineupSource: string;
  hasOddsData: boolean;
  lineupsPending: boolean;
  slateDate: string;
  isStaleSlate: boolean;
  firstPitchTime: string | null;
  enrichmentStatus: EnrichmentStatus;
  topCandidates: any[]; // top 3 near-miss picks even when no official picks qualify
  emptySlateReasons: string[]; // why no official picks qualified
  bestAvailableScore: number | null;
}

// ─── Picks-level in-memory cache ────────────────────────────────────────────
// Avoids re-running the full pipeline (VS gate + matrix scoring + Poisson) on
// every request. TTL is 5 minutes; invalidated automatically when a game starts.
const PICKS_CACHE_TTL = 15 * 60 * 1000; // 15 minutes — extended to reduce cycling (Phase BA)
let picksCache: { result: HRRPicksResult; ts: number; slateDate: string } | null = null;

// Phase BQ: Hard-lock flag — once set, the board is permanently frozen for the day.
// No new official pull can overwrite it. Resets at midnight ET.
let boardHardLocked = false;
let boardHardLockedDate = '';

export function isBoardHardLocked(): boolean {
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const todayET = `${nowET.getFullYear()}-${String(nowET.getMonth() + 1).padStart(2, '0')}-${String(nowET.getDate()).padStart(2, '0')}`;
  // Reset lock at midnight ET (new day) or if Force Refresh cleared it
  if (boardHardLockedDate !== todayET) {
    boardHardLocked = false;
    boardHardLockedDate = '';
  }
  return boardHardLocked;
}

/** Clear the hard lock (called by Force Refresh) */
export function clearHardLock(): void {
  boardHardLocked = false;
  boardHardLockedDate = '';
  console.log('[HRRPicks] Hard lock cleared by Force Refresh');
}

export function setHardLock(slateDate: string): void {
  boardHardLocked = true;
  boardHardLockedDate = slateDate;
  console.log(`[HRRPicks] HARD LOCK set for ${slateDate} — board is permanently frozen`);
}

export function invalidatePicksCache() {
  // Phase BQ: Never bust the cache if the board is hard-locked
  if (isBoardHardLocked()) {
    console.log('[HRRPicks] Cache bust skipped — board is hard-locked');
    return;
  }
  picksCache = null;
  console.log('[HRRPicks] Cache invalidated');
}

/** Alias used by scheduled tasks to trigger a fresh board build on next request */
export const bustPicksCache = invalidatePicksCache;

/**
 * Run the full HRR picks pipeline and return enriched money picks.
 * This is the single source of truth — both getHRRPicks and getTodayResults call this.
 * Results are cached for 5 minutes to avoid redundant pipeline runs.
 */
export async function getEnrichedMoneyPicks(): Promise<HRRPicksResult> {
  // Serve from cache if fresh and same slate date
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const todaySlate = `${nowET.getFullYear()}-${String(nowET.getMonth() + 1).padStart(2, '0')}-${String(nowET.getDate()).padStart(2, '0')}`;
  if (picksCache && picksCache.slateDate === todaySlate && Date.now() - picksCache.ts < PICKS_CACHE_TTL) {
    // Phase AX: No cache-bust for game start — picks stay permanently
    {
      console.log(`[HRRPicks] Serving from cache (age: ${Math.round((Date.now() - picksCache.ts) / 1000)}s)`);
      return picksCache.result;
    }
  }

  const lineupData = await getAdaptedLineupData();
  const dataDate = await getDataDate();

  // Phase AQ: wait up to 25s for enrichment cache to warm before scoring
  // Prevents cold-cache runs where vsGradeMap is empty and all scores default to neutral
  const wasWarm = await pollForWarmEnrichment(25_000);
  if (!wasWarm) {
    console.warn('[HRRPicks] Enrichment cache not warm after 25s — proceeding with neutral data');
  } else {
    console.log('[HRRPicks] Enrichment cache warm — proceeding with real data');
  }

  const enrichment = await getEnrichmentData(
    lineupData.matchups.map(m => ({
      playerId: m.playerId,
      playerName: m.playerName,
      team: m.team,
      gameTime: m.gameTime,
      pitcherId: m.pitcher.id ?? null,
      pitcherHand: m.pitcher.handedness ?? null,
    }))
  ).catch(() => ({
    vsGradeMap: new Map<string, number>(),
    gameTotalsMap: new Map(),
    dayNightSplitsMap: new Map(),
    mlbStreakMap: new Map(),
    statcastCache: { data: new Map(), byId: new Map(), pitchers: new Map(), fetchedAt: Date.now(), year: new Date().getFullYear() },
    bullpenFatigueMap: new Map(),
    fetchedAt: Date.now(),
    isWarm: false,
  }));

  const { vsGradeMap, gameTotalsMap, dayNightSplitsMap, mlbStreakMap, statcastCache, bullpenFatigueMap } = enrichment as any;

  const matchups = lineupData.matchups;
  const players = lineupData.playerDataMap;

  const now = new Date();
  const todayET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const todayETDate = `${todayET.getFullYear()}-${String(todayET.getMonth() + 1).padStart(2, '0')}-${String(todayET.getDate()).padStart(2, '0')}`;
  const isStaleSlate = dataDate !== todayETDate && todayET.getHours() >= 5;

  // Build enrichment status
  const enrichmentStatus: EnrichmentStatus = {
    lineups: matchups.length > 0 ? 'ok' : 'pending',
    odds: (enrichment as any).isWarm ? 'ok' : 'partial',
    statcast: (enrichment as any).statcastCache?.data?.size > 0 ? 'ok' : 'partial',
    streaks: (enrichment as any).mlbStreakMap?.size > 0 ? 'ok' : 'partial',
    dayNight: (enrichment as any).dayNightSplitsMap?.size > 0 ? 'ok' : 'partial',
    bullpen: (enrichment as any).bullpenFatigueMap?.size > 0 ? 'ok' : 'partial',
    isPartialEnrichment: !(enrichment as any).isWarm,
    lastUpdated: new Date().toISOString(),
  };

  if (matchups.length === 0) {
    return {
      moneyPicks: [],
      allMatrixPicks: [],
      dataDate,
      lineupSource: lineupData.lineupSource,
      hasOddsData: false,
      lineupsPending: true,
      slateDate: todayETDate,
      isStaleSlate,
      firstPitchTime: null,
      enrichmentStatus: { ...enrichmentStatus, lineups: 'pending' },
      topCandidates: [],
      emptySlateReasons: ['Lineups not yet posted for today\'s slate.'],
      bestAvailableScore: null,
    };
  }

  const parkFactors = getMockParkFactors();

  // Phase AP: Build barrel threat map from REAL statcastCache (no mock data)
  // statcastCache is a StatcastCache object with a .data Map keyed by playerId
  const savantMap = new Map<string, { xwOBA: number; hardHitPct: number; exitVelocity: number; barrelPct: number }>();
  const statcastData = (statcastCache as any)?.data;
  if (statcastData && statcastData.size > 0) {
    for (const [, entry] of statcastData) {
      const playerName = (entry as any).player_name ?? (entry as any).playerName;
      if (playerName) {
        savantMap.set(playerName, {
          xwOBA: (entry as any).xwoba ?? 0,
          hardHitPct: (entry as any).hard_hit_percent ?? 0,
          exitVelocity: (entry as any).launch_speed ?? 0,
          barrelPct: (entry as any).barrel_batted_rate ?? 0,
        });
      }
    }
  }

  // VS gate: always use mlbMatchupService scores (0-10 scale)
  // STRONG >= 7.0, MODERATE >= 5.5 (with secondary signals), < 5.5 excluded
  // For projected lineups, lower thresholds to avoid empty slates from incomplete pitcher data
  const isProjectedLineup = (lineupData.lineupSource as string) !== 'confirmed';
  // Phase BB: VS gate thresholds further relaxed so more players reach the quality gate.
  // The quality gate (Elite/Strong/Lean tiers) is the real filter — VS gate is a coarse pre-filter.
  // STRONG: passes immediately. MODERATE: passes with any one secondary signal.
  // Confirmed lineups now use same thresholds as projected (5.0/3.5) to avoid under-staffed boards.
  const STRONG_THRESHOLD = 5.0;   // was 6.0 confirmed / 5.0 projected
  const MODERATE_THRESHOLD = 3.5; // was 4.5 confirmed / 3.5 projected
  if (isProjectedLineup) {
    console.log(`[HRRPicks] Projected lineups — VS gate thresholds lowered (STRONG>=${STRONG_THRESHOLD}, MOD>=${MODERATE_THRESHOLD})`);
  }

  // Phase CN fix: stricter VS gate skip condition.
  // Previously skipped when vsGradeMap was empty OR all neutral — meaning every player passed with no matchup filtering.
  // Now: only skip if BOTH empty AND very few matchups (data truly unavailable).
  const allNeutral = vsGradeMap.size > 0 && Array.from(vsGradeMap.values()).every(v => v === 5.0);
  const skipVsGate = vsGradeMap.size === 0 && matchups.length < 5; // much stricter skip condition

  const gatedMatchups = skipVsGate
    ? matchups
    : matchups.filter((m: any) => {
        const vsScore = vsGradeMap.get(m.playerName) ?? null;
        if (vsScore === null) return true; // no entry = neutral, let through
        if (vsScore >= STRONG_THRESHOLD) return true;
        if (vsScore >= MODERATE_THRESHOLD) {
          // Phase BB: MODERATE players pass with any one positive signal, or if no data available
          const playerData = players.get(m.playerId);
          const batterHand = playerData?.handedness ?? 'R';
          const pitcherHand = m.pitcher?.handedness ?? 'R';
          const hasPlatoonAdvantage = batterHand !== pitcherHand;
          const pitcherERA = m.pitcher?.era ?? null;
          const pitcherIsVulnerable = pitcherERA !== null ? pitcherERA >= 4.00 : true; // default true when no ERA data
          const savantEntry = savantMap.get(m.playerName);
          const isBarrelThreat = savantEntry ? savantEntry.barrelPct >= 6.0 : false; // lowered from 8.0
          // Also pass players batting 1-5 in lineup (prime scoring spots)
          const isPrimeLineupSpot = m.battingPosition !== undefined && m.battingPosition <= 5;
          return hasPlatoonAdvantage || pitcherIsVulnerable || isBarrelThreat || isPrimeLineupSpot;
        }
        return false;
      });

  console.log(`[HRRPicks] VS Gate (STRONG>=${STRONG_THRESHOLD}, MOD>=${MODERATE_THRESHOLD}, skip=${skipVsGate}): ${matchups.length} → ${gatedMatchups.length} matchups passed`);

  const hrTargetsMap = getMockHRTargets();

  const matrixPicks = rankAIPicks(
    gatedMatchups,
    players,
    hrTargetsMap,
    parkFactors,
    dayNightSplitsMap,
    mlbStreakMap,
    vsGradeMap,
    gameTotalsMap,
    statcastCache,
    undefined,  // ballparkMatchups (legacy, unused)
    bullpenFatigueMap ?? new Map(),
    undefined,  // edgeScoreMap
    lineupData.lineupSource  // lower thresholds for projected lineups
  );

  const matrixPlayerNames = new Set(matrixPicks.map((p: any) => p.playerName));
  const matrixGatedMatchups = gatedMatchups.filter((m: any) => matrixPlayerNames.has(m.playerName));

  const projections = generateHRRProjections(
    matrixGatedMatchups,
    players,
    parkFactors,
    savantMap,
    dayNightSplitsMap,
    mlbStreakMap
  );

  const enrichedPicks = projections.map((proj: any) => {
    const matrixPick = matrixPicks.find((p: any) => p.playerName === proj.playerName);
    const lambda = proj.expectedTotal;
    const activeLine = proj.hrrLine;
    const modelOverProb = poissonOverProbability(activeLine, lambda);
    const bookImpliedProb = 0.5;
    const edge = calculateEdge(modelOverProb, bookImpliedProb);
    const pickQuality = getPickQuality(edge, modelOverProb);
    const alternates = calculateAlternateLines(lambda, 5.5);
    const fairLine = findFairLine(lambda);

    // Attach streak info from mlbStreakMap
    const streakRaw = mlbStreakMap.get(proj.playerId);
    const streakInfo = streakRaw ? {
      isOnStreak: streakRaw.streakLength !== 0,
      streakLength: Math.abs(streakRaw.streakLength),
      streakType: streakRaw.trendDirection === 'HOT' ? 'hot' as const
        : streakRaw.trendDirection === 'COLD' ? 'cold' as const
        : 'neutral' as const,
      last5HitRate: streakRaw.last5HitRate,
      trendDirection: streakRaw.trendDirection === 'HOT' ? 'up' as const
        : streakRaw.trendDirection === 'COLD' ? 'down' as const
        : 'stable' as const,
      last5Games: streakRaw.last5Games ?? [],
    } : null;

    // Attach day/night split from dayNightSplitsMap
    const dnRaw = dayNightSplitsMap.get(proj.playerId);
    const gameTimeType = proj.gameTime
      ? (new Date(proj.gameTime).getUTCHours() >= 22 ? 'night' as const : 'day' as const)
      : 'night' as const;
    const splitData = dnRaw ? (gameTimeType === 'day' ? dnRaw.day : dnRaw.night) : null;
    const splitBoost = dnRaw?.splitBoost ?? 0;
    const dayNightSplit = splitData ? {
      gameTimeType,
      splitAvg: parseFloat(splitData.avg ?? '0') || splitData.hitRate,
      splitBoost,
      favorable: splitBoost > 0.02,
    } : null;

    // Derive model-based American odds as fallback display
    const probFrac = Math.min(0.99, Math.max(0.01, modelOverProb));
    const americanOdds = probFrac >= 0.5
      ? `-${Math.round((probFrac / (1 - probFrac)) * 100)}`
      : `+${Math.round(((1 - probFrac) / probFrac) * 100)}`;

    return {
      ...proj,
      hrrLine: activeLine,
      lineSource: 'model' as const,
      overallScore: matrixPick?.overallScore ?? proj.hrrConfidence,
      baseScore: matrixPick?.baseScore,
      factorBreakdown: matrixPick?.factorBreakdown,
      vsGrade: matrixPick?.vsGrade,
      gameTotalOU: matrixPick?.gameTotalOU,
      primePosition: matrixPick?.primePosition,
      primePositionFactors: matrixPick?.primePositionFactors,
      reasons: matrixPick?.reasons ?? [],
      riskFlags: matrixPick?.riskFlags ?? [],
      grade: matrixPick?.grade ?? 'strong',
      bpBoost: matrixPick?.bpBoost ?? 0,
      isBestBet: matrixPick?.isBestBet ?? false,
      leanTier: matrixPick?.leanTier ?? false,
      overProbability: Math.round(modelOverProb * 100),
      edge: Math.round(edge * 100),
      pickQuality,
      bookOdds: americanOdds,
      bookOddsProvider: 'model' as const,
      bookImpliedProb: Math.round(modelOverProb * 100),
      streakInfo,
      dayNightSplit,
      alternateLines: alternates.map((alt: any) => ({
        line: alt.line,
        overProb: Math.round(alt.overProb * 100),
        underProb: Math.round(alt.underProb * 100),
      })),
      fairLine,
      expectedTotal: Math.round(lambda * 10) / 10,
    };
  });

  // Sort by matrix score
  enrichedPicks.sort((a: any, b: any) => {
    const scoreDiff = ((b.overallScore ?? 0) - (a.overallScore ?? 0));
    if (Math.abs(scoreDiff) > 3) return scoreDiff;
    const qualityOrder: Record<string, number> = { strong: 4, moderate: 3, lean: 2, avoid: 1 };
    const qDiff = (qualityOrder[b.pickQuality] ?? 0) - (qualityOrder[a.pickQuality] ?? 0);
    if (qDiff !== 0) return qDiff;
    return b.overProbability - a.overProbability;
  });

  // Phase AX: No pre-game gate — all picks kept regardless of game start time.
  // ── Money Picks selection: quality gate first, then cap ──
  const MAX_MONEY_PICKS = 6;   // Phase CN: quality over quantity — max 6 official picks
  const MIN_MONEY_PICKS = 0;   // Phase CN: NEVER force picks — 0 picks is valid

  // Phase BK: Use selectBestLine to pick the optimal line per player.
  // At this point we only have model-derived alternateLines (no sportsbook odds yet).
  // We do a preliminary best-line pass here; a second pass runs after the odds fetch.
  const withRecommendedLine = enrichedPicks.map((pick: any) => {
    const lambda = pick.expectedTotal ?? 1.5;
    // Model-only alternateLines (no book odds yet — will be enriched after odds fetch)
    const modelAltLines = (pick.alternateLines ?? []).map((al: any) => ({
      line: al.line,
      overOdds: al.overOdds ?? null, // may be null at this stage
    })).filter((al: any) => al.overOdds !== null);
    const { recommendedLine, recommendedProb, bestLineVerdict, bestLineReason, lineEvaluations } =
      selectBestLine(lambda, modelAltLines, null, null, pick.last5Games ?? []);
    return { ...pick, recommendedLine, recommendedProb, bestLineVerdict, bestLineReason, lineEvaluations };
  });

  // Integration Patch: PQS filter — only picks with probability >= 60% qualify.
  // passesQualityGate checks Poisson prob + matrix score + optional odds/history.
  const qualifiedPicks = withRecommendedLine.filter((p: any) =>
    passesQualityGate(
      p.overProbability ?? p.recommendedProb ?? 50,
      p.overallScore ?? 60,
      p.bookOdds ?? null,
      p.historicalHitRate ?? null,
      p.last5Games?.length ?? 0
    )
  );

  // If no picks qualify, show top 3 lean picks instead of forcing bad picks
  const picksToShow = qualifiedPicks.length > 0
    ? qualifiedPicks
    : withRecommendedLine.filter((p: any) => (p.overProbability ?? 0) >= 50).slice(0, 3);

  const targetCount = Math.min(picksToShow.length, MAX_MONEY_PICKS);
  const moneyPicksRaw = picksToShow.slice(0, targetCount);

  const moneyPicks: EnrichedMoneyPick[] = moneyPicksRaw.map((pick: any) => ({
    ...pick,
  } as EnrichedMoneyPick));

  // Targeted Odds API fetch: only call for events containing our final picks
  let hasOddsData = false;
  if (moneyPicks.length > 0) {
    try {
      const oddsMap = await fetchOddsForPicks(
        moneyPicks.map((p: any) => ({ playerName: p.playerName, team: p.team }))
      );
      if (oddsMap.size > 0) {
        hasOddsData = true;
        for (const pick of moneyPicks as any[]) {
          const oddsData = oddsMap.get(pick.playerName);
          if (!oddsData) continue;

          const featuredLine = oddsData.featuredLine;
          const featuredOverOdds = oddsData.featuredOverOdds;
          const featuredUnderOdds = oddsData.featuredUnderOdds;

          if (featuredLine !== null && featuredOverOdds !== null) {
            const overProb = americanToImpliedProbability(featuredOverOdds);
            const underProb = featuredUnderOdds ? americanToImpliedProbability(featuredUnderOdds) : 1 - overProb;
            const { trueOver } = removeVig(overProb, underProb);
            pick.bookOdds = featuredOverOdds > 0 ? `+${featuredOverOdds}` : `${featuredOverOdds}`;
            pick.bookOddsProvider = oddsData.bookmaker;
            pick.bookImpliedProb = Math.round(trueOver * 100);
            pick.lineSource = 'sportsbook';
          } else if (featuredOverOdds !== null) {
            pick.bookOdds = featuredOverOdds > 0 ? `+${featuredOverOdds}` : `${featuredOverOdds}`;
            pick.bookOddsProvider = oddsData.bookmaker;
          }
          // Pass through best available odds across all books
          if (oddsData.bestOverOdds) {
            pick.bestAvailableOdds = oddsData.bestOverOdds.odds;
            pick.bestAvailableBook = oddsData.bestOverOdds.bookmaker;
          }
          // Opening odds: use the featured odds from the first book in allFeaturedBooks
          // (the first entry is the earliest-seen book, proxy for opening line)
          if (oddsData.allFeaturedBooks && oddsData.allFeaturedBooks.length > 0) {
            const firstBook = oddsData.allFeaturedBooks[0];
            if (!pick.openingOdds) pick.openingOdds = firstBook.overOdds;
          }
          // Phase BK fix: merge sportsbook alternateLines onto pick so selectBestLine
          // can evaluate ALL available lines with real book odds (not just the featured line)
          if (oddsData.alternateLines && oddsData.alternateLines.length > 0) {
            // Build a map of existing model-only alternateLines keyed by line value
            const existingMap = new Map<number, any>();
            for (const al of (pick.alternateLines ?? [])) {
              existingMap.set(al.line, al);
            }
            // Merge sportsbook alternateLines — add overOdds to existing entries or create new ones
            for (const sbAlt of oddsData.alternateLines) {
              const existing = existingMap.get(sbAlt.line);
              if (existing) {
                existing.overOdds = sbAlt.overOdds;
                existing.underOdds = sbAlt.underOdds;
                existing.sbImpliedOverProb = sbAlt.impliedOverProb;
              } else {
                // Line exists in sportsbook but not in model — add it
                const modelProb = Math.round(poissonOverProbability(sbAlt.line, pick.expectedTotal ?? 1.5) * 100);
                existingMap.set(sbAlt.line, {
                  line: sbAlt.line,
                  overProb: modelProb,
                  underProb: 100 - modelProb,
                  overOdds: sbAlt.overOdds,
                  underOdds: sbAlt.underOdds,
                  sbImpliedOverProb: sbAlt.impliedOverProb,
                });
              }
            }
            // Replace pick.alternateLines with the merged set, sorted ascending by line
            pick.alternateLines = Array.from(existingMap.values()).sort((a: any, b: any) => a.line - b.line);
          }
        }
      }
    } catch (err) {
      console.warn('[HRRPicks] Odds API fetch failed, using model odds:', err);
    }
  }

  // Phase BK: Second-pass best-line selection now that sportsbook odds are available
  for (const pick of moneyPicks as any[]) {
    const lambda = pick.expectedTotal ?? 1.5;
    const oddsKey = pick.playerName;
    // Rebuild sportsbook alternateLines from the raw oddsData if available
    // (pick.alternateLines at this point may still be model-only; we re-run with real odds)
    const sbAltLines: Array<{ line: number; overOdds: number }> = [];
    // The pick.alternateLines may have been enriched with overOdds by the odds loop above
    for (const al of (pick.alternateLines ?? [])) {
      if (al.overOdds != null) sbAltLines.push({ line: al.line, overOdds: al.overOdds });
    }
    const featuredLine = pick.hrrLine ?? null;
    const featuredOverOdds = pick.bookOdds
      ? parseInt(String(pick.bookOdds).replace(/[^0-9+-]/g, ''), 10)
      : null;
    const finalFeaturedOverOdds = isNaN(featuredOverOdds as number) ? null : featuredOverOdds;
    if (pick.playerName && pick.playerName.toLowerCase().includes('baldwin')) {
      console.log(`[BK-DEBUG] ${pick.playerName}: lambda=${lambda}, featuredLine=${featuredLine}, featuredOverOdds=${finalFeaturedOverOdds}, sbAltLines=${JSON.stringify(sbAltLines)}`);
    }
    const { recommendedLine, recommendedProb, bestLineVerdict, bestLineReason, lineEvaluations } =
      selectBestLine(lambda, sbAltLines, featuredLine, finalFeaturedOverOdds, pick.last5Games ?? []);
    if (pick.playerName && pick.playerName.toLowerCase().includes('baldwin')) {
      console.log(`[BK-DEBUG] ${pick.playerName}: recommendedLine=${recommendedLine}, verdict=${bestLineVerdict}, reason=${bestLineReason}`);
    }
    pick.recommendedLine = recommendedLine;
    pick.recommendedProb = recommendedProb;
    pick.bestLineVerdict = bestLineVerdict;
    pick.bestLineReason = bestLineReason;
    pick.lineEvaluations = lineEvaluations;
  }

  // Phase AW: Enrich money picks with value analysis (EV, fair odds, value tier, mispricing)
  for (const pick of moneyPicks as any[]) {
    const rawBookOdds = pick.bookOdds;
    const numericOdds = typeof rawBookOdds === 'number'
      ? rawBookOdds
      : typeof rawBookOdds === 'string'
        ? parseInt(rawBookOdds.replace(/[^0-9+-]/g, ''), 10)
        : null;
    if (numericOdds !== null && !isNaN(numericOdds)) {
      const trueProb = Math.round(35 + ((pick.overallScore ?? 60) / 100) * 50);
      const altLines = (pick.alternateLines ?? []).map((al: any) => ({
        line: al.line,
        overOdds: al.overOdds ?? numericOdds,
      }));
      pick.valueAnalysis = analyzeValue(trueProb, numericOdds, altLines);
    }
  }

  // Phase BY: Generate Money Pick Alternatives for each official pick
  // These are DISPLAY-ONLY and never affect official record, hit rate, or ROI.
  for (const pick of moneyPicks as any[]) {
    const officialLine = pick.recommendedLine ?? pick.hrrLine ?? 0.5;
    const lambda = pick.expectedTotal ?? 1.5;
    const overallScore = pick.overallScore ?? 60;

    // Candidate alternate HRR lines from sportsbook (exclude the official line)
    const candidates: Array<{ line: number; overOdds: number; modelProb: number }> = [];
    for (const al of (pick.alternateLines ?? [])) {
      if (al.line === officialLine) continue; // skip the official pick's own line
      if (al.overOdds == null) continue;       // skip lines without sportsbook odds
      const modelProb = Math.round(poissonOverProbability(al.line, lambda) * 100);
      candidates.push({ line: al.line, overOdds: al.overOdds, modelProb });
    }

    const alternatives: PickAlternative[] = [];

    // For each candidate, compute value metrics and classify into a tier
    for (const cand of candidates) {
      const { overOdds, modelProb } = cand;
      const impliedProb = Math.round(americanToImpliedProbability(overOdds) * 1000) / 10;
      const vigFreeImplied = Math.round((impliedProb / 1.045) * 10) / 10;
      const edge = Math.round((modelProb - vigFreeImplied) * 10) / 10;
      const fairOdds = probToAmericanOdds(modelProb);
      const ev = calcEV(modelProb, overOdds);
      const tier = getValueTier(overOdds, edge, modelProb);
      if (tier === 'PASS') continue; // skip negative-EV or non-qualifying lines

      const altTier: AlternativeTier =
        tier === 'SAFE_VALUE' ? 'SAFER' :
        tier === 'BALANCED_VALUE' ? 'BETTER_VALUE' :
        tier === 'CEILING_PLAY' ? 'CEILING' : 'NONE';

      const oddsStr = overOdds > 0 ? `+${overOdds}` : `${overOdds}`;
      const reason =
        altTier === 'SAFER'
          ? `Higher-probability path at ${oddsStr} with ${modelProb}% model hit rate — prioritizes consistency over payout.`
          : altTier === 'BETTER_VALUE'
          ? `Strong EV play at ${oddsStr} — model edge of +${edge}% with ${modelProb}% hit probability.`
          : `Aggressive ladder at ${oddsStr} — ${modelProb}% hit probability with +${edge}% edge over the book.`;

      alternatives.push({
        tier: altTier,
        marketLabel: `O${cand.line} HRR`,
        bookOdds: overOdds,
        trueProb: modelProb,
        impliedProb,
        edge,
        fairOdds,
        ev,
        reason,
      });
    }

    // Keep at most one per tier (best edge within each tier)
    const best: Record<string, PickAlternative> = {};
    for (const alt of alternatives) {
      const existing = best[alt.tier];
      if (!existing || alt.edge > existing.edge) {
        best[alt.tier] = alt;
      }
    }

    const finalAlts = Object.values(best);
    pick.pickAlternatives = finalAlts.length > 0 ? finalAlts : [{ tier: 'NONE' as AlternativeTier, marketLabel: '', bookOdds: 0, trueProb: 0, impliedProb: 0, edge: 0, fairOdds: 0, ev: 0, reason: '' }];
  }

  // Compute topCandidates: top 3 picks from enrichedPicks that did NOT make moneyPicks (near-misses)
  const moneyPickNames = new Set(moneyPicks.map((p: any) => p.playerName));
  const topCandidates = enrichedPicks
    .filter((p: any) => !moneyPickNames.has(p.playerName))
    .slice(0, 3);

  // Compute bestAvailableScore from all enriched picks
  const bestAvailableScore = enrichedPicks.length > 0 ? (enrichedPicks[0]?.overallScore ?? null) : null;

  // Compute emptySlateReasons when no money picks qualified
  const emptySlateReasons: string[] = [];
  if (moneyPicks.length === 0) {
    if (enrichedPicks.length === 0) {
      emptySlateReasons.push('No matchups passed the VS quality gate today.');
    } else {
      const topScore = enrichedPicks[0]?.overallScore ?? 0;
      if (topScore < 55) {
        emptySlateReasons.push(`Best available score is ${topScore.toFixed(1)} — all players scored below minimum quality level.`);
      } else if (topScore < 75) {
        emptySlateReasons.push(`Top candidate scored ${topScore.toFixed(1)} — lean tier picks available.`);
      }
      const highPitcherCount = matrixPicks.filter((p: any) => (p.factors?.pitcherWeakness ?? 0) < 3).length;
      if (highPitcherCount > matrixPicks.length * 0.6) {
        emptySlateReasons.push('Strong pitching matchups across the slate are suppressing scores.');
      }
      const lowOUCount = matrixPicks.filter((p: any) => (p.gameTotalOU ?? 9) < 8).length;
      if (lowOUCount > matrixPicks.length * 0.5) {
        emptySlateReasons.push('Low game totals (under 8 runs) limiting offensive upside.');
      }
      if (emptySlateReasons.length === 0) {
        emptySlateReasons.push('No pre-game picks available on the current slate.');
      }
    }
  }

  // Update enrichmentStatus with final odds availability
  const finalEnrichmentStatus: EnrichmentStatus = {
    ...enrichmentStatus,
    odds: hasOddsData ? 'ok' : (enrichmentStatus.odds === 'ok' ? 'partial' : enrichmentStatus.odds),
  };

  const result: HRRPicksResult = {
    moneyPicks,
    allMatrixPicks: matrixPicks,
    dataDate,
    lineupSource: lineupData.lineupSource,
    hasOddsData,
    lineupsPending: false,
    slateDate: todayETDate,
    isStaleSlate,
    firstPitchTime: null,
    enrichmentStatus: finalEnrichmentStatus,
    topCandidates,
    emptySlateReasons,
    bestAvailableScore,
  };

  picksCache = { result, ts: Date.now(), slateDate: todayETDate };
  console.log(`[HRRPicks] Cache updated: ${moneyPicks.length} money picks, ${matrixPicks.length} matrix picks`);

  return result;
}
