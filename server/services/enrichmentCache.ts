/**
 * Enrichment Cache
 * Shared in-memory cache for expensive external data fetches.
 * Deduplicates in-flight requests so all three pick procedures
 * (getTopPicks, getComprehensivePicks, getHRRPicks) share the same
 * fetched data instead of tripling the MLB API load.
 *
 * Cache TTL: 15 minutes (data doesn't change mid-session)
 * Hard timeout: 6 seconds per fetch (never block the page)
 */

import { batchGetDayNightSplits, type PlayerDayNightSplits } from "./dayNightSplitService";
import { batchGetTheLabData, type TheLabPlayerData } from "./theLabService";
import { batchGetPlayerStreaks, type PlayerStreakData } from "./mlbStreakService";
import { getVSGatedPool } from "./ballparkMatchupService";
import { fetchGameTotals } from "./gameTotalsService";
import type { GameTotal } from "./gameTotalsService";

const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const FETCH_TIMEOUT = 6_000; // 6 seconds hard timeout per enrichment source

interface EnrichmentData {
  vsGradeMap: Map<string, number>;
  gameTotalsMap: Map<string, GameTotal>;
  dayNightSplitsMap: Map<number, PlayerDayNightSplits>;
  theLabDataMap: Map<string, TheLabPlayerData>;
  mlbStreakMap: Map<number, PlayerStreakData>;
  fetchedAt: number;
}

interface PlayerRef {
  playerId: number;
  playerName: string;
  team: string;
  gameTime?: string | null;
}

// Shared cache entry
let cachedEnrichment: EnrichmentData | null = null;

// In-flight promise deduplication — prevents stampede on cold cache
let inFlightPromise: Promise<EnrichmentData> | null = null;

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
 * Fetch all enrichment data for a set of players.
 * Results are cached for 15 minutes and shared across all callers.
 */
export async function getEnrichmentData(players: PlayerRef[]): Promise<EnrichmentData> {
  // Return cached data if fresh
  if (cachedEnrichment && Date.now() - cachedEnrichment.fetchedAt < CACHE_TTL) {
    return cachedEnrichment;
  }

  // Deduplicate in-flight requests — if another caller is already fetching, wait for it
  if (inFlightPromise) {
    return inFlightPromise;
  }

  inFlightPromise = (async (): Promise<EnrichmentData> => {
    const season = new Date().getFullYear();
    const oddsApiKey = process.env.ODDS_API_KEY;

    // Fetch all enrichment sources in parallel with hard timeouts
    const [vsGateResult, dayNightSplitsMap, theLabDataMap, mlbStreakMap] = await Promise.all([
      withTimeout(
        getVSGatedPool(),
        FETCH_TIMEOUT,
        { pool: [], gameTotals: new Map(), allMatchups: [] }
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
        batchGetTheLabData(
          players.map(p => ({ playerName: p.playerName, teamAbbr: p.team, statType: 'hits' as const })),
          new Date().toISOString().split('T')[0]
        ),
        FETCH_TIMEOUT,
        new Map<string, TheLabPlayerData>()
      ),
      withTimeout(
        batchGetPlayerStreaks(players.map(p => ({ playerId: p.playerId, playerName: p.playerName }))),
        FETCH_TIMEOUT,
        new Map<number, PlayerStreakData>()
      ),
    ]);

    // Build VS grade map
    const vsGradeMap = new Map<string, number>();
    for (const m of vsGateResult.allMatchups) {
      if (m.vsGrade !== undefined) vsGradeMap.set(m.batter, m.vsGrade);
    }

    // Fetch game totals with timeout
    const gameTotalsMap = await withTimeout(
      fetchGameTotals(oddsApiKey, vsGateResult.allMatchups),
      FETCH_TIMEOUT,
      new Map<string, GameTotal>()
    );

    const result: EnrichmentData = {
      vsGradeMap,
      gameTotalsMap,
      dayNightSplitsMap,
      theLabDataMap,
      mlbStreakMap,
      fetchedAt: Date.now(),
    };

    cachedEnrichment = result;
    inFlightPromise = null;
    return result;
  })();

  // If the in-flight fetch itself errors, clear it so the next call retries
  inFlightPromise.catch(() => {
    inFlightPromise = null;
  });

  return inFlightPromise;
}

/**
 * Invalidate the enrichment cache (e.g., after a scheduled refresh).
 */
export function invalidateEnrichmentCache(): void {
  cachedEnrichment = null;
  inFlightPromise = null;
}
