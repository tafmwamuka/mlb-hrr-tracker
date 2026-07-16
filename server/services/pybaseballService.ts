/**
 * Pybaseball Statcast Service
 * Fetches real Baseball Savant data via pure Node.js HTTP (statcastFetcher.ts).
 * Replaced Python subprocess (fetch_statcast.py) which required python3.11 in the
 * production container — a fragile dependency that silently broke on Reserved Hosting.
 * Cache: 6 hours (data updates once per day on Baseball Savant).
 */
import { fetchStatcastDataNode } from "./statcastFetcher";

export interface StatcastPlayer {
  playerId: number;
  playerName: string;
  exitVelocity: number;       // avg exit velocity (mph)
  maxExitVelocity: number;    // max exit velocity (mph)
  barrelPct: number;          // barrel % (0-100)
  barrelPA: number;           // barrels per PA (0-100)
  hardHitPct: number;         // EV95+ hard hit % (0-100)
  sweetSpotPct: number;       // sweet spot % (0-100)
  xwOBA: number | null;       // expected wOBA (e.g. 0.350)
  xBA: number | null;         // expected batting average (e.g. 0.270)
  xSLG: number | null;        // expected slugging (e.g. 0.450)
  // Percentile ranks (0-100, higher = better)
  xwOBAPercentile: number | null;
  barrelPercentile: number | null;
  exitVeloPercentile: number | null;
  hardHitPercentile: number | null;
  sprintSpeedPercentile: number | null;
  // Phase BN: HQS discipline fields from statcast_batter_percentile_ranks
  // These are 0-100 percentile scores (higher = better for all three).
  // kPct/whiffPct: higher percentile = lower raw K%/whiff% = better contact
  // iso: higher percentile = higher xISO = more power
  // bbe: raw ball-in-play count from exitvelo_barrels 'attempts' column
  kPct: number | null;
  whiffPct: number | null;
  iso: number | null;
  bbe: number | null;
  preNormalized: true;  // always true — these are percentile ranks, not raw rates
}

export interface StatcastPitcher {
  pitcherId: number;
  pitcherName: string;
  xwOBAAgainst: number;       // expected wOBA against (league avg ~0.320; lower = elite suppressor)
  xBAAgainst: number;         // expected BA against
  xSLGAgainst: number;        // expected SLG against
  pa: number;                 // plate appearances faced (sample size)
  xwOBAPercentile?: number;   // pitcher xwOBA percentile (higher = more hittable)
  barrelPercentile?: number;
  hardHitPercentile?: number;
}

export interface StatcastCache {
  data: Map<string, StatcastPlayer>; // keyed by lowercase player name
  byId: Map<number, StatcastPlayer>; // keyed by MLB player ID
  pitchers: Map<number, StatcastPitcher>; // keyed by pitcher MLB ID
  fetchedAt: number;
  year: number;
}

let cache: StatcastCache | null = null;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
let inFlightPromise: Promise<StatcastCache> | null = null;

export async function getStatcastData(year?: number): Promise<StatcastCache> {
  const targetYear = year ?? new Date().getFullYear();

  // Return valid cache
  if (
    cache &&
    cache.year === targetYear &&
    Date.now() - cache.fetchedAt < CACHE_TTL_MS
  ) {
    return cache;
  }

  // Deduplicate concurrent fetches
  if (inFlightPromise) return inFlightPromise;

  inFlightPromise = fetchStatcastDataNode(targetYear)
    .then((result: StatcastCache) => {
      cache = result;
      inFlightPromise = null;
      return result;
    })
    .catch((err: Error) => {
      console.error("[Statcast] Fetch failed:", err.message);
      inFlightPromise = null;
      // Return empty cache on failure so the rest of the pipeline continues
      const empty: StatcastCache = {
        data: new Map<string, StatcastPlayer>(),
        byId: new Map<number, StatcastPlayer>(),
        pitchers: new Map<number, StatcastPitcher>(),
        fetchedAt: Date.now(),
        year: targetYear,
      };
      return empty;
    });

  return inFlightPromise!;
}

/**
 * Look up a player by name (fuzzy: full name, then last name)
 */
export function lookupStatcastPlayer(
  statcastCache: StatcastCache,
  playerName: string
): StatcastPlayer | null {
  const lower = playerName.toLowerCase();
  if (statcastCache.data.has(lower)) return statcastCache.data.get(lower)!;
  // Try last name only
  const lastName = lower.split(" ").slice(-1)[0];
  return statcastCache.data.get(lastName) ?? null;
}

/**
 * Calculate a composite Statcast score (0-100) for use in the scoring matrix.
 * Weights: xwOBA percentile (40%), barrel percentile (25%), hard hit percentile (20%), exit velo percentile (15%)
 */
export function calculateStatcastScore(player: StatcastPlayer | null): number {
  if (!player) return 50; // neutral if no data

  const xwoba = player.xwOBAPercentile ?? 50;
  const barrel = player.barrelPercentile ?? 50;
  const hardHit = player.hardHitPercentile ?? 50;
  const exitVelo = player.exitVeloPercentile ?? 50;

  return (
    xwoba * 0.40 +
    barrel * 0.25 +
    hardHit * 0.20 +
    exitVelo * 0.15
  );
}
