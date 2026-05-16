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

const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
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
    // Uses hrtargets-style scoring: pitcher ERA/WHIP/platoon + Statcast barrel%/hard-hit%
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

    // Stage 4: Fetch bullpen fatigue for all 30 MLB teams
    const MLB_TEAM_IDS = [
      { teamId: 133, teamAbbr: 'OAK' }, { teamId: 134, teamAbbr: 'PIT' },
      { teamId: 135, teamAbbr: 'SD' },  { teamId: 136, teamAbbr: 'SEA' },
      { teamId: 137, teamAbbr: 'SF' },  { teamId: 138, teamAbbr: 'STL' },
      { teamId: 139, teamAbbr: 'TB' },  { teamId: 140, teamAbbr: 'TEX' },
      { teamId: 141, teamAbbr: 'TOR' }, { teamId: 142, teamAbbr: 'MIN' },
      { teamId: 143, teamAbbr: 'PHI' }, { teamId: 144, teamAbbr: 'ATL' },
      { teamId: 145, teamAbbr: 'CWS' }, { teamId: 146, teamAbbr: 'MIA' },
      { teamId: 147, teamAbbr: 'NYY' }, { teamId: 158, teamAbbr: 'MIL' },
      { teamId: 108, teamAbbr: 'LAA' }, { teamId: 109, teamAbbr: 'ARI' },
      { teamId: 110, teamAbbr: 'BAL' }, { teamId: 111, teamAbbr: 'BOS' },
      { teamId: 112, teamAbbr: 'CHC' }, { teamId: 113, teamAbbr: 'CIN' },
      { teamId: 114, teamAbbr: 'CLE' }, { teamId: 115, teamAbbr: 'COL' },
      { teamId: 116, teamAbbr: 'DET' }, { teamId: 117, teamAbbr: 'HOU' },
      { teamId: 118, teamAbbr: 'KC' },  { teamId: 119, teamAbbr: 'LAD' },
      { teamId: 120, teamAbbr: 'WSH' }, { teamId: 121, teamAbbr: 'NYM' },
    ];

    const bullpenFatigueMap = await withTimeout(
      getBullpenFatigue(MLB_TEAM_IDS),
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
