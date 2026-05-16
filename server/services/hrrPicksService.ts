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
import { analyzeValue } from './valueEngine';
// Phase AP: getMockSavantData removed — barrel threat check now uses real statcastCache
import { generateHRRProjections } from './hrrService';
import { poissonOverProbability, calculateAlternateLines, findFairLine, calculateEdge, getPickQuality } from './poissonModel';
import { getAdaptedLineupData } from './lineupAdapter';
import { getDataDate } from './mlbLineupService';
import { getEnrichmentData, pollForWarmEnrichment } from './enrichmentCache';

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
  ballparkReasoning: string;
  rcScore: number;
  parkFactor: number;
  lineSource: string;
  bookOdds: string | null;
  bookOddsProvider: string | null;
  bookImpliedProb: number | null;
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
const PICKS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let picksCache: { result: HRRPicksResult; ts: number; slateDate: string } | null = null;

export function invalidatePicksCache() {
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
  // Phase AQ calibration: STRONG threshold lowered from 7.0→6.0 (confirmed) and 5.5→5.0 (projected)
  // Previous thresholds were too strict: only 2/269 players qualified as STRONG (0.7% pass rate)
  // New thresholds: ~8-12% of players qualify as STRONG, ~15-20% as MODERATE
  const STRONG_THRESHOLD = isProjectedLineup ? 5.0 : 6.0;
  const MODERATE_THRESHOLD = isProjectedLineup ? 3.5 : 4.5;
  if (isProjectedLineup) {
    console.log(`[HRRPicks] Projected lineups — VS gate thresholds lowered (STRONG>=${STRONG_THRESHOLD}, MOD>=${MODERATE_THRESHOLD})`);
  }

  const gatedMatchups = vsGradeMap.size > 0
    ? matchups.filter((m: any) => {
        const vsScore = vsGradeMap.get(m.playerName) ?? null;
        if (vsScore === null) return false;
        if (vsScore >= STRONG_THRESHOLD) return true;
        if (vsScore >= MODERATE_THRESHOLD) {
          const playerData = players.get(m.playerId);
          const batterHand = playerData?.handedness ?? 'R';
          const pitcherHand = m.pitcher?.handedness ?? 'R';
          const hasPlatoonAdvantage = batterHand !== pitcherHand;
          const pitcherERA = m.pitcher?.era ?? null;
          const pitcherIsVulnerable = pitcherERA !== null ? pitcherERA >= 4.50 : false;
          const savantEntry = savantMap.get(m.playerName);
          const isBarrelThreat = savantEntry ? savantEntry.barrelPct >= 8.0 : false;
          return hasPlatoonAdvantage || pitcherIsVulnerable || isBarrelThreat;
        }
        return false;
      })
    : matchups;

  console.log(`[HRRPicks] VS Gate (internal mlbMatchup, STRONG>=${STRONG_THRESHOLD}, MOD>=${MODERATE_THRESHOLD}): ${matchups.length} → ${gatedMatchups.length} matchups passed`);

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
    const pickQuality = getPickQuality(edge);
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
  // ── Money Picks selection: pure relative ranking, NO probability thresholds ──
  const MAX_MONEY_PICKS = 8;
  const MIN_MONEY_PICKS = 5;

  const withRecommendedLine = enrichedPicks.map((pick: any) => {
    // Use the model's fair line directly — no probability threshold needed
    const recommendedLine = pick.fairLine ?? pick.hrrLine ?? 1.5;
    const recommendedProb = pick.overProbability ?? 55;
    return { ...pick, recommendedLine, recommendedProb };
  });

  // Take top picks by score — between MIN and MAX, or all if fewer than MAX
  const targetCount = Math.min(
    Math.max(withRecommendedLine.length, MIN_MONEY_PICKS),
    MAX_MONEY_PICKS
  );
  const moneyPicksRaw = withRecommendedLine.slice(0, targetCount);

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
        }
      }
    } catch (err) {
      console.warn('[HRRPicks] Odds API fetch failed, using model odds:', err);
    }
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
