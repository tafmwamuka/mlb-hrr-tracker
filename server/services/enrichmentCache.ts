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
 * Data sources (in priority order):
 * 1. BallparkPal vsGrade (-10 to +10) — PRIMARY VS signal, normalized to 0-10 scale
 *    Also provides: real RC, HR%, XB%, 1B% per player
 * 2. MLB Stats API matchup scores (hrtargets-style fallback if ballparkpal unavailable)
 * 3. Pybaseball Statcast data (xwOBA, barrel%, exit velocity) — cached 6h separately
 * 4. MLB Stats API day/night splits per player
 * 5. MLB Stats API streak data per player
 * 6. Odds API / RC-based game totals
 */

import { batchGetDayNightSplits, type PlayerDayNightSplits } from "./dayNightSplitService";
import { batchGetPlayerStreaks, type PlayerStreakData } from "./mlbStreakService";
import { batchComputeMatchupScores } from "./mlbMatchupService";
import { fetchGameTotals } from "./gameTotalsService";
import { getStatcastData, lookupStatcastPlayer, type StatcastCache } from "./pybaseballService";
import {
  fetchMatchupDataPublic,
  findMatchupForPlayer,
  computeGameTotalsFromMatchups,
  type BallparkMatchup,
} from "./ballparkMatchupService";
import type { GameTotal } from "./gameTotalsService";

const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const FETCH_TIMEOUT = 6_000; // 6 seconds hard timeout per enrichment source

export interface EnrichmentData {
  vsGradeMap: Map<string, number>;          // player name → 0-10 VS score (primary gate)
  gameTotalsMap: Map<string, GameTotal>;
  dayNightSplitsMap: Map<number, PlayerDayNightSplits>;
  mlbStreakMap: Map<number, PlayerStreakData>;
  statcastCache: StatcastCache;
  // Real ballparkpal data per player (for matrix RC and HR% factors)
  ballparkMatchups: BallparkMatchup[];       // raw ballparkpal matchup data
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

// Track the ET date when the cache was last warmed (for midnight rollover)
let cacheDataDate: string | null = null;

/**
 * Get today's date in Eastern Time (MLB operates on ET).
 */
function getETDate(): string {
  const now = new Date();
  const etDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const year = etDate.getFullYear();
  const month = String(etDate.getMonth() + 1).padStart(2, '0');
  const day = String(etDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

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
    ballparkMatchups: [],
    fetchedAt: 0, // 0 = never fetched, will trigger background warm
    isWarm: false,
  };
}

/**
 * Convert ballparkpal vsGrade (-10 to +10) to 0-10 scale for VS gate.
 * -10 → 0.0, 0 → 5.0, +10 → 10.0
 */
function bpGradeToScore(vsGrade: number): number {
  return Math.round(((vsGrade + 10) / 20) * 10 * 10) / 10;
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

    // Stage 1: Fetch BallparkPal, Statcast, day/night splits, and streaks in parallel
    const [ballparkMatchups, statcastCache, dayNightSplitsMap, mlbStreakMap] = await Promise.all([
      withTimeout(
        fetchMatchupDataPublic(),
        12_000, // 12s — plain fetch (8s) + small buffer; Puppeteer adds ~10s if needed
        [] as BallparkMatchup[]
      ),
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

    // Stage 2: Build VS grade map
    // PRIMARY: Use ballparkpal vsGrade if available (normalized to 0-10)
    // FALLBACK: Use mlbMatchupService hrtargets-style score
    let vsGradeMap: Map<string, number>;

    if (ballparkMatchups.length > 0) {
      // Build VS grade map from ALL ballparkpal matchups (not just current lineup players)
      // This handles the case where today's lineups aren't posted yet but ballparkpal
      // already has today's matchup data — all 198 starters get real vsGrades.
      vsGradeMap = new Map<string, number>();

      // Index ALL ballparkpal matchups by player name (both starters and non-starters)
      for (const bpMatch of ballparkMatchups) {
        const score = bpGradeToScore(bpMatch.vsGrade);
        // Use the first occurrence (starters take priority over bench players)
        if (!vsGradeMap.has(bpMatch.batter)) {
          vsGradeMap.set(bpMatch.batter, score);
        }
      }

      // Also ensure lineup players are mapped (handles name mismatches via findMatchupForPlayer)
      for (const player of players) {
        if (!vsGradeMap.has(player.playerName)) {
          const bpMatch = findMatchupForPlayer(player.playerName, player.team, ballparkMatchups);
          if (bpMatch) {
            vsGradeMap.set(player.playerName, bpGradeToScore(bpMatch.vsGrade));
          } else {
            vsGradeMap.set(player.playerName, 5.0); // neutral fallback
          }
        }
      }

      const bpScores = Array.from(vsGradeMap.values());
      console.log(`[EnrichmentCache] BallparkPal VS grades loaded: ${ballparkMatchups.length} matchups, ${vsGradeMap.size} players mapped. ` +
        `STRONG(>=7): ${bpScores.filter(v => v >= 7).length}, ` +
        `MODERATE(5.5-7): ${bpScores.filter(v => v >= 5.5 && v < 7).length}, ` +
        `BAD(<5.5): ${bpScores.filter(v => v < 5.5).length}`);
    } else {
      // Fallback: compute hrtargets-style scores from MLB Stats API
      console.log('[EnrichmentCache] BallparkPal unavailable, falling back to mlbMatchupService');

      const enrichedPlayers = players.map(p => {
        const statcast = lookupStatcastPlayer(statcastCache, p.playerName);
        const streak = mlbStreakMap.get(p.playerId);
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

      vsGradeMap = await withTimeout(
        batchComputeMatchupScores(enrichedPlayers, season),
        60_000,
        new Map<string, number>()
      );
    }

    // Stage 3: Fetch game totals
    // Use ballparkpal RC-based game totals if available, otherwise Odds API
    let gameTotalsMap: Map<string, GameTotal>;
    if (ballparkMatchups.length > 0) {
      gameTotalsMap = computeGameTotalsFromMatchups(ballparkMatchups);
      console.log(`[EnrichmentCache] Game totals from BallparkPal RC: ${gameTotalsMap.size} games`);
    } else {
      const teamMatchups = players.map(p => ({
        batter: p.playerName,
        team: p.team,
        vsGrade: vsGradeMap.get(p.playerName) ?? 5,
      }));
      gameTotalsMap = await withTimeout(
        fetchGameTotals(oddsApiKey, teamMatchups),
        FETCH_TIMEOUT,
        new Map<string, GameTotal>()
      );
    }

    cachedEnrichment = {
      vsGradeMap,
      gameTotalsMap,
      dayNightSplitsMap,
      mlbStreakMap,
      statcastCache,
      ballparkMatchups,
      fetchedAt: Date.now(),
      isWarm: true,
    };
    cacheDataDate = getETDate(); // Track which day this cache belongs to

    console.log(`[EnrichmentCache] Background warm complete. ` +
      `BallparkPal: ${ballparkMatchups.length > 0 ? 'YES' : 'NO (fallback)'}, ` +
      `Statcast: ${statcastCache.data.size} players, ` +
      `Streaks: ${mlbStreakMap.size}, ` +
      `DayNight: ${dayNightSplitsMap.size}`);
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
  // Invalidate cache if we've crossed midnight ET (new day)
  const todayET = getETDate();
  if (cachedEnrichment && cacheDataDate && cacheDataDate !== todayET) {
    console.log(`[EnrichmentCache] New day detected (was ${cacheDataDate}, now ${todayET}). Clearing cache.`);
    cachedEnrichment = null;
    cacheDataDate = null;
    warmingInProgress = false;
  }

  // Return cached data if fresh and warm
  if (cachedEnrichment && cachedEnrichment.isWarm && Date.now() - cachedEnrichment.fetchedAt < CACHE_TTL) {
    return cachedEnrichment;
  }

  // If cache is stale or cold, start background warming and return neutral immediately
  // This ensures the first page load is fast even if external APIs are slow
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
 * Warm the enrichment cache on server startup using today's MLB lineup players.
 * This ensures the first user request gets real data instead of neutral placeholders.
 * Called once from server startup — does not block startup.
 */
export async function warmEnrichmentCacheOnStartup(): Promise<void> {
  try {
    // Fetch today's lineup players to warm the cache
    const { getAdaptedLineupData } = await import('./lineupAdapter');
    const lineupData = await getAdaptedLineupData();
    const players: PlayerRef[] = lineupData.matchups.map((m: import('./lineupAdapter').MatchupData) => ({
      playerId: m.playerId,
      playerName: m.playerName,
      team: m.team,
      gameTime: m.gameTime,
      pitcherId: m.pitcher?.id ?? null,
      pitcherHand: m.pitcher?.handedness ?? null,
    }));
    if (players.length > 0) {
      console.log(`[EnrichmentCache] Startup warm triggered for ${players.length} players`);
      await warmCacheInBackground(players);
    } else {
      console.log('[EnrichmentCache] Startup warm skipped — no lineup players yet');
    }
  } catch (err) {
    console.error('[EnrichmentCache] Startup warm failed:', err);
  }
}

/**
 * Invalidate the enrichment cache (e.g., after a scheduled refresh or new day).
 */
export function invalidateEnrichmentCache(): void {
  cacheDataDate = null;
  cachedEnrichment = null;
  warmingInProgress = false;
}
