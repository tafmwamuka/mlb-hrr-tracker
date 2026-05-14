/**
 * Pybaseball Statcast Service
 * Calls the Python fetch_statcast.py script to get real Baseball Savant data.
 * Data: xwOBA, xBA, xSLG, barrel%, exit velocity, hard hit%, sprint speed percentiles.
 * Cache: 6 hours (data updates once per day on Baseball Savant).
 */

import { spawn } from "child_process";
import path from "path";

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
}

export interface StatcastCache {
  data: Map<string, StatcastPlayer>; // keyed by lowercase player name
  byId: Map<number, StatcastPlayer>; // keyed by MLB player ID
  fetchedAt: number;
  year: number;
}

let cache: StatcastCache | null = null;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
let inFlightPromise: Promise<StatcastCache> | null = null;

const SCRIPT_PATH = path.resolve(
  process.cwd(),
  "server/scripts/fetch_statcast.py"
);

async function fetchStatcastData(year: number): Promise<StatcastCache> {
  return new Promise((resolve, reject) => {
    // Unset PYTHONHOME/PYTHONPATH to avoid uv Python 3.13 env contamination
    const cleanEnv = { ...process.env };
    delete cleanEnv.PYTHONHOME;
    delete cleanEnv.PYTHONPATH;
    const python = spawn("/usr/bin/python3.11", [SCRIPT_PATH, String(year)], {
      timeout: 120_000, // 2 minutes max
      env: cleanEnv,
    });

    let stdout = "";
    let stderr = "";

    python.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    python.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    python.on("close", (code) => {
      if (stderr) {
        console.warn("[Statcast] Python stderr:", stderr.slice(0, 500));
      }
      if (code !== 0 || !stdout.trim()) {
        reject(new Error(`fetch_statcast.py exited with code ${code}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        const byName = new Map<string, StatcastPlayer>();
        const byId = new Map<number, StatcastPlayer>();
        for (const p of parsed.players as StatcastPlayer[]) {
          byName.set(p.playerName.toLowerCase(), p);
          // Also index by last name only for fuzzy matching
          const lastName = p.playerName.split(" ").slice(-1)[0].toLowerCase();
          if (!byName.has(lastName)) byName.set(lastName, p);
          byId.set(p.playerId, p);
        }
        console.log(`[Statcast] Loaded ${parsed.count} players for ${year}`);
        resolve({
          data: byName,
          byId,
          fetchedAt: Date.now(),
          year,
        });
      } catch (e) {
        reject(new Error(`Failed to parse statcast JSON: ${e}`));
      }
    });

    python.on("error", reject);
  });
}

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

  inFlightPromise = fetchStatcastData(targetYear)
    .then((result) => {
      cache = result;
      inFlightPromise = null;
      return result;
    })
    .catch((err) => {
      console.error("[Statcast] Fetch failed:", err.message);
      inFlightPromise = null;
      // Return empty cache on failure so the rest of the pipeline continues
      return {
        data: new Map<string, StatcastPlayer>(),
        byId: new Map<number, StatcastPlayer>(),
        fetchedAt: Date.now(),
        year: targetYear,
      };
    });

  return inFlightPromise;
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
