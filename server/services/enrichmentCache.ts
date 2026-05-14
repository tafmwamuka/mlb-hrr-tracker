/**
 * Enrichment Cache
 * Shared in-memory cache for expensive external data fetches.
 * Deduplicates in-flight requests so all three pick procedures
 * (getTopPicks, getComprehensivePicks, getHRRPicks) share the same
 * fetched data instead of tripling the MLB API load.
 *
 * Cache TTL: 15 minutes (data doesn't change mid-session)
 *
 * Cold-cache strategy:
 * - On first request, return IMMEDIATELY with neutral/empty data
 * - Populate the real data in the background (async, non-blocking)
 * - Subsequent requests within the TTL get the real cached data
 * - This prevents the first page load from timing out due to ~500 MLB API calls
 *
 * Data sources:
 * - MLB Stats API matchup scores (hrtargets-style: ERA + park factor + barrel% + hard-hit%)
 * - Odds API game totals (Vegas O/U lines)
 * - MLB Stats API day/night splits per player
 * - MLB Stats API streak data per player
 * - Pybaseball Statcast data (xwOBA, barrel%, exit velocity) — cached 6h separately
 */

import { batchGetDayNightSplits, type PlayerDayNightSplits } from "./dayNightSplitService";
import { batchGetPlayerStreaks, type PlayerStreakData } from "./mlbStreakService";
import { batchComputeMatchupScores } from "./mlbMatchupService";
import { fetchGameTotals } from "./gameTotalsService";
import { getStatcastData, lookupStatcastPlayer, type StatcastCache } from "./pybaseballService";
import type { GameTotal } from "./gameTotalsService";

const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const FETCH_TIMEOUT = 6_000; // 6 seconds hard timeout per enrichment source

export interface EnrichmentData {
  vsGradeMap: Map<string, number>;
  gameTotalsMap: Map<string, GameTotal>;
  dayNightSplitsMap: Map<number, PlayerDayNightSplits>;
  mlbStreakMap: Map<number, PlayerStreakData>;
  statcastCache: StatcastCache;
  fetchedAt: number;
  isWarm: boolean; // true = real data, false = neutral placeholder
}

interface PlayerRef {
  playerId: number;
  playerName: string;
  team: string;
  gameTime?: string | null;
  pitcherId?: number | null;
  pitcherHand?: string | null;
}

// Shared cache entry
let cachedEnrichment: EnrichmentData | null = null;

// Background warming in progress
let warmingInProgress = false;

/**
 * Wraps a promise with a hard timeout.
 * On timeout, returns the fallback value instead of throwing.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/**
 * Build a neutral/empty enrichment data object for immediate return.
 */
function buildNeutralEnrichment(): EnrichmentData {
  return {
    vsGradeMap: new Map<string, number>(),
    gameTotalsMap: new Map<string, GameTotal>(),
    dayNightSplitsMap: new Map<number, PlayerDayNightSplits>(),
    mlbStreakMap: new Map<number, PlayerStreakData>(),
    statcastCache: {
      data: new Map(),
      byId: new Map(),
      fetchedAt: Date.now(),
      year: new Date().getFullYear(),
    },
    fetchedAt: 0, // 0 = never fetched, will trigger background warm
    isWarm: false,
  };
}

/**
 * Populate the enrichment cache in the background.
 * Does not block the caller — fires and forgets.
 */
async function warmCacheInBackground(players: PlayerRef[]): Promise<void> {
  if (warmingInProgress) return;
  warmingInProgress = true;

  try {
    const season = new Date().getFullYear();
    const oddsApiKey = process.env.ODDS_API_KEY;

    // Stage 1: Fetch Statcast, day/night splits, and streaks in parallel
    const [statcastCache, dayNightSplitsMap, mlbStreakMap] = await Promise.all([
      withTimeout(
        getStatcastData(season),
        30_000,
        {
          data: new Map<string, import('./pybaseballService').StatcastPlayer>(),
          byId: new Map<number, import('./pybaseballService').StatcastPlayer>(),
          fetchedAt: Date.now(),
          year: season,
        } as StatcastCache
      ),
      withTimeout(
        batchGetDayNightSplits(
          players.map(p => ({ playerId: p.playerId, gameTimeUtc: p.gameTime })),
          'hits',
          season
        ),
        FETCH_TIMEOUT,
        new Map<number, PlayerDayNightSplits>()
      ),
      withTimeout(
        batchGetPlayerStreaks(players.map(p => ({ playerId: p.playerId, playerName: p.playerName }))),
        FETCH_TIMEOUT,
        new Map<number, PlayerStreakData>()
      ),
    ]);

    // Stage 2: Compute hrtargets-style matchup scores with Statcast + streak enrichment
    const enrichedPlayers = players.map(p => {
      const statcast = lookupStatcastPlayer(statcastCache, p.playerName);
      const streak = mlbStreakMap.get(p.playerId);

      // Streak bonus: +5 if hot streak, -4 if cold (mirrors hrtargets mq() function)
      let streakBonus = 0;
      if (streak) {
        if (streak.trendDirection === 'HOT') streakBonus = 5;
        else if (streak.trendDirection === 'COLD') streakBonus = -4;
      }

      return {
        playerId: p.playerId,
        playerName: p.playerName,
        pitcherId: p.pitcherId ?? null,
        pitcherHand: p.pitcherHand ?? null,
        barrelPct: statcast?.barrelPct ?? null,
        hardHitPct: statcast?.hardHitPct ?? null,
        seasonHr: null,
        streakBonus,
      };
    });

    const mlbMatchupScores = await withTimeout(
      batchComputeMatchupScores(enrichedPlayers, season),
      60_000, // 60s timeout for background warming — no rush
      new Map<string, number>()
    );

    // Stage 3: Fetch game totals
    const teamMatchups = players.map(p => ({
      batter: p.playerName,
      team: p.team,
      vsGrade: mlbMatchupScores.get(p.playerName) ?? 5,
    }));

    const gameTotalsMap = await withTimeout(
      fetchGameTotals(oddsApiKey, teamMatchups),
      FETCH_TIMEOUT,
      new Map<string, GameTotal>()
    );

    cachedEnrichment = {
      vsGradeMap: mlbMatchupScores,
      gameTotalsMap,
      dayNightSplitsMap,
      mlbStreakMap,
      statcastCache,
      fetchedAt: Date.now(),
      isWarm: true,
    };

    const allScores = Array.from(mlbMatchupScores.values());
    console.log(`[EnrichmentCache] Background warm complete. ` +
      `${mlbMatchupScores.size} matchup scores, ` +
      `STRONG(>=7): ${allScores.filter(v => v >= 7).length}, ` +
      `MODERATE(5.5-7): ${allScores.filter(v => v >= 5.5 && v < 7).length}`);
  } catch (err) {
    console.error('[EnrichmentCache] Background warm failed:', err);
  } finally {
    warmingInProgress = false;
  }
}

/**
 * Fetch all enrichment data for a set of players.
 * Results are cached for 15 minutes and shared across all callers.
 *
 * On cold cache: returns neutral data immediately and warms the cache in background.
 * On warm cache: returns cached data instantly.
 */
export async function getEnrichmentData(players: PlayerRef[]): Promise<EnrichmentData> {
  // Return cached data if fresh and warm
  if (cachedEnrichment && cachedEnrichment.isWarm && Date.now() - cachedEnrichment.fetchedAt < CACHE_TTL) {
    return cachedEnrichment;
  }

  // If cache is stale or cold, start background warming and return neutral immediately
  // This ensures the first page load is fast even if MLB API is slow
  warmCacheInBackground(players).catch(err => {
    console.error('[EnrichmentCache] Background warm error:', err);
  });

  // If we have stale-but-warm data, return it while re-warming
  if (cachedEnrichment && cachedEnrichment.isWarm) {
    return cachedEnrichment;
  }

  // Truly cold cache: return neutral data immediately
  // The background warm will populate the cache for subsequent requests
  return buildNeutralEnrichment();
}

/**
 * Invalidate the enrichment cache (e.g., after a scheduled refresh).
 */
export function invalidateEnrichmentCache(): void {
  cachedEnrichment = null;
  warmingInProgress = false;
}
