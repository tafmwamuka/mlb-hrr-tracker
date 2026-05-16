/**
 * Enrichment Cache
 * Shared in-memory cache for expensive external data fetches.
 * Deduplicates in-flight requests so all pick procedures share the same
 * fetched data instead of tripling the MLB API load.
 *
 * Cache TTL: 30 minutes (data doesn't change mid-session)
 *
 * Cold-cache strategy:
 * - On first request, return IMMEDIATELY with neutral/empty data
 * - Populate the real data in the background (async, non-blocking)
 * - Subsequent requests within the TTL get the real cached data
 * - This prevents the first page load from timing out due to ~500 MLB API calls
 *
 * Data sources (in priority order):
 * 1. MLB Stats API matchup scores (hrtargets-style) — pitcher ERA, platoon splits, park factor
 *    Combined with Statcast barrel%/hard-hit% for power grading
 * 2. Pybaseball Statcast data (xwOBA, barrel%, exit velocity) — cached 6h separately
 * 3. MLB Stats API day/night splits per player
 * 4. MLB Stats API streak data per player
 * 5. Odds API game totals
 */

import { batchGetDayNightSplits, type PlayerDayNightSplits } from "./dayNightSplitService";
import { batchGetPlayerStreaks, type PlayerStreakData } from "./mlbStreakService";
import { batchComputeMatchupScores } from "./mlbMatchupService";
import { fetchGameTotals } from "./gameTotalsService";
import { getStatcastData, lookupStatcastPlayer, type StatcastCache } from "./pybaseballService";
import type { GameTotal } from "./gameTotalsService";
import { getBullpenFatigue, type BullpenFatigue } from "./bullpenFatigueService";

const CACHE_TTL = 45 * 60 * 1000; // 45 minutes — Phase AN: extended to reduce cold-cache frequency
const FETCH_TIMEOUT = 12_000; // 12 seconds

export interface EnrichmentData {
  vsGradeMap: Map<string, number>;          // player name → 0-10 VS score (primary gate)
  gameTotalsMap: Map<string, GameTotal>;
  dayNightSplitsMap: Map<number, PlayerDayNightSplits>;
  mlbStreakMap: Map<number, PlayerStreakData>;
  statcastCache: StatcastCache;
  bullpenFatigueMap: Map<number, BullpenFatigue>;
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
  opponentTeamId?: number | null; // MLB team ID of the opposing (pitching) team
}

// Shared cache entry
let cachedEnrichment: EnrichmentData | null = null;

// Background warming in progress
let warmingInProgress = false;

// Track the ET date when the cache was last warmed (for midnight rollover)
let cacheDataDate: string | null = null;

/**
 * Get the active slate date in Eastern Time.
 * After 5 AM ET, returns today's date.
 * Before 5 AM ET, returns yesterday's date (overnight window).
 */
function getETDate(): string {
  const now = new Date();
  const etDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  if (etDate.getHours() < 5) {
    etDate.setDate(etDate.getDate() - 1);
  }
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
      pitchers: new Map(),
      fetchedAt: Date.now(),
      year: new Date().getFullYear(),
    },
    bullpenFatigueMap: new Map<number, BullpenFatigue>(),
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

    // Stage 2: Build VS grade map using MLB Stats API + Statcast
    // Uses hrtargets-style scoring: pitcher ERA/WHIP/platoon + Statcast barrel%/hard-hit% + xwOBA delta
    const enrichedPlayers = players.map(p => {
      const statcast = lookupStatcastPlayer(statcastCache, p.playerName);
      const streak = mlbStreakMap.get(p.playerId);
      let streakBonus = 0;
      if (streak) {
        if (streak.trendDirection === 'HOT') streakBonus = 5;
        else if (streak.trendDirection === 'COLD') streakBonus = -4;
      }
      // xwOBA VS gate: look up pitcher xwOBA-against from Statcast pitcher cache
      const pitcherStatcast = p.pitcherId ? statcastCache.pitchers.get(p.pitcherId) : undefined;
      return {
        playerId: p.playerId,
        playerName: p.playerName,
        pitcherId: p.pitcherId ?? null,
        pitcherHand: p.pitcherHand ?? null,
        barrelPct: statcast?.barrelPct ?? null,
        hardHitPct: statcast?.hardHitPct ?? null,
        seasonHr: null,
        streakBonus,
        // Phase AC: xwOBA delta for VS gate upgrade
        batterXwOBA: statcast?.xwOBA ?? null,
        pitcherXwOBAAgainst: pitcherStatcast?.xwOBAAgainst ?? null,
      };
    });

    const vsGradeMap = await withTimeout(
      batchComputeMatchupScores(enrichedPlayers, season),
      60_000,
      new Map<string, number>()
    );

    const vsScores = Array.from(vsGradeMap.values());
    console.log(`[EnrichmentCache] Internal VS grades loaded: ${vsGradeMap.size} players. ` +
      `STRONG(>=7): ${vsScores.filter(v => v >= 7).length}, ` +
      `MODERATE(5.5-7): ${vsScores.filter(v => v >= 5.5 && v < 7).length}, ` +
      `BAD(<5.5): ${vsScores.filter(v => v < 5.5).length}`);

    // Stage 3: Fetch game totals from Odds API
    const teamMatchups = players.map(p => ({
      batter: p.playerName,
      team: p.team,
      vsGrade: vsGradeMap.get(p.playerName) ?? 5,
    }));
    const gameTotalsMap = await withTimeout(
      fetchGameTotals(oddsApiKey, teamMatchups),
      FETCH_TIMEOUT,
      new Map<string, GameTotal>()
    );

    // Stage 4: Fetch bullpen fatigue — only for today's opponent (pitching) teams
    // This reduces API calls from ~90 (30 teams × 3 days) to ~45 (15 games × 3 days)
    const ALL_TEAM_IDS: Record<number, string> = {
      133: 'OAK', 134: 'PIT', 135: 'SD',  136: 'SEA', 137: 'SF',  138: 'STL',
      139: 'TB',  140: 'TEX', 141: 'TOR', 142: 'MIN', 143: 'PHI', 144: 'ATL',
      145: 'CWS', 146: 'MIA', 147: 'NYY', 158: 'MIL', 108: 'LAA', 109: 'ARI',
      110: 'BAL', 111: 'BOS', 112: 'CHC', 113: 'CIN', 114: 'CLE', 115: 'COL',
      116: 'DET', 117: 'HOU', 118: 'KC',  119: 'LAD', 120: 'WSH', 121: 'NYM',
    };
    // Extract unique opponent team IDs from today's matchups
    const opponentTeamIds = Array.from(new Set(
      players.map(p => p.opponentTeamId).filter((id): id is number => !!id)
    ));
    // Fall back to all 30 if no opponent IDs available (e.g. startup before lineups)
    const teamsToFetch = opponentTeamIds.length > 0
      ? opponentTeamIds.map(id => ({ teamId: id, teamAbbr: ALL_TEAM_IDS[id] ?? String(id) }))
      : Object.entries(ALL_TEAM_IDS).map(([id, abbr]) => ({ teamId: Number(id), teamAbbr: abbr }));

    console.log(`[EnrichmentCache] Fetching bullpen fatigue for ${teamsToFetch.length} opponent teams (${opponentTeamIds.length > 0 ? 'targeted' : 'all-30 fallback'})`);

    const bullpenFatigueMap = await withTimeout(
      getBullpenFatigue(teamsToFetch),
      20_000,
      new Map<number, BullpenFatigue>()
    );

    cachedEnrichment = {
      vsGradeMap,
      gameTotalsMap,
      dayNightSplitsMap,
      mlbStreakMap,
      statcastCache,
      bullpenFatigueMap,
      fetchedAt: Date.now(),
      isWarm: true,
    };
    cacheDataDate = getETDate();

    console.log(`[EnrichmentCache] Background warm complete. ` +
      `VS: ${vsGradeMap.size} players, ` +
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
 * Results are cached for 30 minutes and shared across all callers.
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
  warmCacheInBackground(players).catch(err => {
    console.error('[EnrichmentCache] Background warm error:', err);
  });

  // If we have stale-but-warm data, return it while re-warming
  if (cachedEnrichment && cachedEnrichment.isWarm) {
    return cachedEnrichment;
  }

  // Truly cold cache: return neutral data immediately
  return buildNeutralEnrichment();
}

/**
 * Warm the enrichment cache on server startup using today's MLB lineup players.
 * This ensures the first user request gets real data instead of neutral placeholders.
 * Called once from server startup — does not block startup.
 */
export async function warmEnrichmentCacheOnStartup(): Promise<void> {
  try {
    const { getAdaptedLineupData } = await import('./lineupAdapter');
    const lineupData = await getAdaptedLineupData();
    const players: PlayerRef[] = lineupData.matchups.map((m: import('./lineupAdapter').MatchupData) => ({
      playerId: m.playerId,
      playerName: m.playerName,
      team: m.team,
      gameTime: m.gameTime,
      pitcherId: m.pitcher?.id ?? null,
      pitcherHand: m.pitcher?.handedness ?? null,
      opponentTeamId: m.opponentTeamId ?? null,
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

/**
 * Check if the enrichment cache is currently warm (has real data).
 */
export function isEnrichmentWarm(): boolean {
  return !!(cachedEnrichment && cachedEnrichment.isWarm);
}

/**
 * Wait up to maxWaitMs for the enrichment cache to become warm.
 * Polls every 500ms. Returns true if warm, false if timed out.
 * Phase AQ: prevents cold-cache scoring runs on server startup.
 */
export async function pollForWarmEnrichment(maxWaitMs = 25_000): Promise<boolean> {
  if (isEnrichmentWarm()) return true;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 500));
    if (isEnrichmentWarm()) return true;
  }
  return false;
}
