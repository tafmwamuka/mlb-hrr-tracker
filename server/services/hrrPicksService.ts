/**
 * Shared HRR Picks Service
 * Extracts the full getHRRPicks pipeline so that both the Money Picks tab
 * and the Results tab always show identical plays.
 *
 * This is the single source of truth for:
 *   - VS gate (BallparkPal or mlbMatchup thresholds)
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
import { getMockSavantData } from './savantService';
import { generateHRRProjections } from './hrrService';
import { poissonOverProbability, calculateAlternateLines, findFairLine, calculateEdge, getPickQuality } from './poissonModel';
import { getAdaptedLineupData } from './lineupAdapter';
import { getDataDate } from './mlbLineupService';
import { findMatchupForPlayer } from './ballparkMatchupService';
import { getEnrichmentData } from './enrichmentCache';
import type { BallparkMatchup } from './ballparkMatchupService';

// ─── Local helpers (mirrors aiPicks.ts) ──────────────────────────────────────

function buildMatchupsFromBallparkPal(ballparkMatchups: BallparkMatchup[]) {
  const matchups: any[] = [];
  const playerDataMap = new Map<number, any>();

  const starters = ballparkMatchups.filter(bp =>
    bp.batter && bp.batter.trim().length > 0 && bp.rc > 0
  );

  starters.forEach((bp, idx) => {
    const syntheticId = -(idx + 1);
    const avgEst = 0.250;
    const obpEst = 0.320;
    const slgEst = 0.400;

    matchups.push({
      playerId: syntheticId,
      playerName: bp.batter,
      team: bp.team,
      position: 'DH',
      battingPosition: 5,
      pitcher: {
        id: null,
        name: bp.pitcher,
        team: '',
        handedness: (bp.throws as 'R' | 'L') || 'R',
        era: 4.00,
      },
      rc: bp.rc,
      confidence: 70,
      gameTime: undefined,
    });

    playerDataMap.set(syntheticId, {
      playerId: syntheticId,
      name: bp.batter,
      team: bp.team,
      position: 'DH',
      battingPosition: 5,
      handedness: (bp.bats as 'R' | 'L' | 'S') || 'R',
      stats: {
        hits: 30, runs: 20, rbi: 20,
        slg: slgEst, avg: avgEst, obp: obpEst, power: slgEst - avgEst,
      },
      recentForm: {
        last15Games: { hits: 15, runs: 10, rbi: 10, avg: avgEst },
        trend: 'neutral',
      },
    });
  });

  return { matchups, playerDataMap };
}

function buildRealHRTargetsMap(
  playerNames: string[],
  ballparkMatchups: BallparkMatchup[]
): Map<string, { grade: string; hrProbability: number; threatScore: number }> {
  const map = new Map<string, { grade: string; hrProbability: number; threatScore: number }>();
  if (ballparkMatchups.length === 0) return map;

  for (const name of playerNames) {
    const bpMatch = findMatchupForPlayer(name, '', ballparkMatchups);
    if (!bpMatch) continue;
    const hrProb = bpMatch.hrProb;
    let grade: string;
    if (hrProb >= 5.5) grade = 'A+';
    else if (hrProb >= 4.5) grade = 'A';
    else if (hrProb >= 3.5) grade = 'B+';
    else if (hrProb >= 2.5) grade = 'B';
    else if (hrProb >= 1.5) grade = 'C+';
    else if (hrProb >= 0.5) grade = 'C';
    else grade = 'D';
    const threatScore = Math.min(100, Math.round((hrProb / 8) * 100));
    map.set(name, { grade, hrProbability: Math.round(hrProb * 10), threatScore });
  }
  return map;
}

function enrichMatchupsWithBallparkRC<T extends { playerName: string; team: string; rc: number }>(
  matchups: T[],
  ballparkMatchups: BallparkMatchup[]
): T[] {
  if (ballparkMatchups.length === 0) return matchups;
  return matchups.map(m => {
    const bpMatch = findMatchupForPlayer(m.playerName, m.team, ballparkMatchups);
    if (!bpMatch) return m;
    return { ...m, rc: bpMatch.rc };
  });
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
  ballparkReasoning: string;
  rcScore: number;
  parkFactor: number;
  lineSource: string;
  bookOdds: null;
  bookOddsProvider: null;
  bookImpliedProb: null;
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
}

// ─── Picks-level in-memory cache ────────────────────────────────────────────
// Avoids re-running the full pipeline (VS gate + matrix scoring + Poisson) on
// every request. TTL is 5 minutes; invalidated automatically at midnight ET.
const PICKS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let picksCache: { result: HRRPicksResult; ts: number; slateDate: string } | null = null;

export function invalidatePicksCache() {
  picksCache = null;
  console.log('[HRRPicks] Cache invalidated');
}

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
    console.log(`[HRRPicks] Serving from cache (age: ${Math.round((Date.now() - picksCache.ts) / 1000)}s)`);
    return picksCache.result;
  }
  const lineupData = await getAdaptedLineupData();
  const dataDate = await getDataDate();

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
    statcastCache: { data: new Map(), byId: new Map(), fetchedAt: Date.now(), year: new Date().getFullYear() },
    ballparkMatchups: [] as BallparkMatchup[],
    fetchedAt: Date.now(),
    isWarm: false,
  }));

  const { vsGradeMap, gameTotalsMap, dayNightSplitsMap, mlbStreakMap, statcastCache, ballparkMatchups: bpMatchups, bullpenFatigueMap } = enrichment as any;

  let matchups = lineupData.matchups;
  let players = lineupData.playerDataMap;

  if (matchups.length < 50 && bpMatchups.length > 0) {
    const bpData = buildMatchupsFromBallparkPal(bpMatchups);
    if (bpData.matchups.length > 0) {
      const realNames = new Set(matchups.map((m: any) => m.playerName));
      const bpOnly = bpData.matchups.filter((m: any) => !realNames.has(m.playerName));
      matchups = [...matchups, ...bpOnly];
      for (const [id, pd] of Array.from(bpData.playerDataMap.entries())) {
        if (!players.has(id)) players.set(id, pd);
      }
    }
  }

  const now = new Date();
  const todayET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const todayETDate = `${todayET.getFullYear()}-${String(todayET.getMonth() + 1).padStart(2, '0')}-${String(todayET.getDate()).padStart(2, '0')}`;
  const isStaleSlate = dataDate !== todayETDate && todayET.getHours() >= 5;

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
    };
  }

  const parkFactors = getMockParkFactors();

  // Build Savant map
  const savantGames = getMockSavantData();
  const savantMap = new Map<string, { xwOBA: number; hardHitPct: number; exitVelocity: number; barrelPct: number }>();
  for (const game of savantGames) {
    for (const hitter of [...game.homeHitters, ...game.awayHitters]) {
      savantMap.set(hitter.name, {
        xwOBA: hitter.xwOBA,
        hardHitPct: hitter.hardHitPct,
        exitVelocity: hitter.exitVelocity,
        barrelPct: hitter.barrelPct,
      });
    }
  }

  // VS gate (same as getHRRPicks)
  const hasBallparkPalData = bpMatchups.length > 0;
  const STRONG_THRESHOLD = hasBallparkPalData ? 9.5 : 7.0;
  const MODERATE_THRESHOLD = hasBallparkPalData ? 8.5 : 5.5;

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

  const hrTargetsMap = bpMatchups.length > 0
    ? buildRealHRTargetsMap(gatedMatchups.map((m: any) => m.playerName), bpMatchups)
    : getMockHRTargets();

  const enrichedGatedMatchups = enrichMatchupsWithBallparkRC(gatedMatchups, bpMatchups);

  const matrixPicks = rankAIPicks(
    enrichedGatedMatchups,
    players,
    hrTargetsMap,
    parkFactors,
    dayNightSplitsMap,
    mlbStreakMap,
    vsGradeMap,
    gameTotalsMap,
    statcastCache,
    hasBallparkPalData,
    bpMatchups,
    bullpenFatigueMap ?? new Map()
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
    // American odds: if prob >= 50% → -(prob/(1-prob)*100), else +((1-prob)/prob*100)
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
      // Odds: model-derived American odds (no sportsbook integration)
      bookOdds: americanOdds,
      bookOddsProvider: 'model' as const,
      bookImpliedProb: Math.round(modelOverProb * 100),
      // Streak + day/night from enrichment cache
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

  // Filter to money picks: at least one alternate line at 75%+
  const moneyPicks: EnrichedMoneyPick[] = enrichedPicks
    .map((pick: any) => {
      const qualifyingLines = (pick.alternateLines || [])
        .filter((a: any) => a.overProb >= 75)
        .sort((a: any, b: any) => b.line - a.line);
      if (qualifyingLines.length === 0) return null;
      const recommended = qualifyingLines[0];
      return {
        ...pick,
        recommendedLine: recommended.line,
        recommendedProb: recommended.overProb,
      } as EnrichedMoneyPick;
    })
    .filter((p: any): p is EnrichedMoneyPick => p !== null);

  // Targeted Odds API fetch: only call for events containing our final picks
  // This uses ~1-3 API calls instead of 28+ (one per game)
  let hasOddsData = false;
  if (moneyPicks.length > 0) {
    try {
      const oddsMap = await fetchOddsForPicks(
        moneyPicks.map((p: any) => ({ playerName: p.playerName, team: p.team }))
      );
      if (oddsMap.size > 0) {
        hasOddsData = true;
        // Overlay real sportsbook odds onto each money pick
        for (const pick of moneyPicks as any[]) {
          const oddsData = oddsMap.get(pick.playerName);
          if (!oddsData) continue;

          // Use featured HRR line if available, else best individual stat line
          const featuredLine = oddsData.featuredLine;
          const featuredOverOdds = oddsData.featuredOverOdds;
          const featuredUnderOdds = oddsData.featuredUnderOdds;

          if (featuredLine !== null && featuredOverOdds !== null) {
            // Real sportsbook HRR line
            const overProb = americanToImpliedProbability(featuredOverOdds);
            const underProb = featuredUnderOdds ? americanToImpliedProbability(featuredUnderOdds) : 1 - overProb;
            const { trueOver } = removeVig(overProb, underProb);
            pick.bookOdds = featuredOverOdds > 0 ? `+${featuredOverOdds}` : `${featuredOverOdds}`;
            pick.bookOddsProvider = oddsData.bookmaker;
            pick.bookImpliedProb = Math.round(trueOver * 100);
            pick.lineSource = 'sportsbook';
          } else if (featuredOverOdds !== null) {
            // Individual stat odds as fallback
            pick.bookOdds = featuredOverOdds > 0 ? `+${featuredOverOdds}` : `${featuredOverOdds}`;
            pick.bookOddsProvider = oddsData.bookmaker;
          }
        }
      }
    } catch (err) {
      console.warn('[HRRPicks] Odds API fetch failed, using model odds:', err);
    }
  }

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
  };

  // Store in picks cache
  picksCache = { result, ts: Date.now(), slateDate: todayETDate };
  console.log(`[HRRPicks] Cache updated: ${moneyPicks.length} money picks, ${matrixPicks.length} matrix picks`);

  return result;
}
