/**
 * Day/Night Split Service
 * Fetches batter day/night performance splits from MLB Stats API
 * and determines which split applies based on game time
 */

interface DayNightSplit {
  gamesPlayed: number;
  avg: string;
  hits: number;
  runs: number;
  rbi: number;
  homeRuns: number;
  ops: string;
  atBats: number;
  hitRate: number; // hits per game
  runsRate: number;
  rbiRate: number;
}

export interface PlayerDayNightSplits {
  playerId: number;
  day: DayNightSplit | null;
  night: DayNightSplit | null;
  applicableSplit: "day" | "night" | "unknown";
  splitBoost: number; // -0.15 to +0.15 adjustment to probability
  splitLabel: string; // e.g. "Day: .304 AVG" or "Night: .215 AVG"
}

// Cache splits for 6 hours (they don't change intra-day)
const splitsCache = new Map<string, { data: PlayerDayNightSplits; ts: number }>();
const CACHE_TTL = 6 * 60 * 60 * 1000;

/**
 * Determine if a game is a day or night game based on UTC game time.
 * Day game = starts before 6:00 PM ET (22:00 UTC in summer / 23:00 UTC in winter)
 * We use 22:00 UTC as the cutoff (roughly 6 PM ET during MLB season)
 */
export function isNightGame(gameTimeUtc: string | null | undefined): "day" | "night" | "unknown" {
  if (!gameTimeUtc) return "unknown";
  try {
    const d = new Date(gameTimeUtc);
    const utcHour = d.getUTCHours();
    // 22:00 UTC = ~6 PM ET (EDT, UTC-4) or 5 PM ET (EST, UTC-5)
    // Games at or after 22:00 UTC are night games
    return utcHour >= 22 ? "night" : "day";
  } catch {
    return "unknown";
  }
}

async function fetchSplitsForPlayer(mlbPlayerId: number, season: number): Promise<{ day: DayNightSplit | null; night: DayNightSplit | null }> {
  try {
    const url = `https://statsapi.mlb.com/api/v1/people/${mlbPlayerId}/stats?stats=statSplits&group=hitting&season=${season}&sitCodes=d,n`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { day: null, night: null };

    const json = await res.json();
    const splits: any[] = json?.stats?.[0]?.splits ?? [];

    let day: DayNightSplit | null = null;
    let night: DayNightSplit | null = null;

    for (const s of splits) {
      const code = s?.split?.code;
      const stat = s?.stat;
      if (!stat) continue;

      const parsed: DayNightSplit = {
        gamesPlayed: stat.gamesPlayed ?? 0,
        avg: stat.avg ?? ".000",
        hits: stat.hits ?? 0,
        runs: stat.runs ?? 0,
        rbi: stat.rbi ?? 0,
        homeRuns: stat.homeRuns ?? 0,
        ops: stat.ops ?? ".000",
        atBats: stat.atBats ?? 0,
        hitRate: stat.gamesPlayed > 0 ? (stat.hits ?? 0) / stat.gamesPlayed : 0,
        runsRate: stat.gamesPlayed > 0 ? (stat.runs ?? 0) / stat.gamesPlayed : 0,
        rbiRate: stat.gamesPlayed > 0 ? (stat.rbi ?? 0) / stat.gamesPlayed : 0,
      };

      if (code === "d") day = parsed;
      else if (code === "n") night = parsed;
    }

    return { day, night };
  } catch {
    return { day: null, night: null };
  }
}

/**
 * Calculate a split boost/penalty based on how the player performs in day vs night games.
 * Compares the applicable split's hit rate to the season average rate.
 * Returns a value between -0.15 and +0.15.
 */
function calculateSplitBoost(
  applicable: DayNightSplit | null,
  other: DayNightSplit | null,
  statType: "hits" | "runs" | "rbi"
): number {
  if (!applicable || applicable.gamesPlayed < 5) return 0;

  const rateField = statType === "hits" ? "hitRate" : statType === "runs" ? "runsRate" : "rbiRate";
  const applicableRate = applicable[rateField];

  // If we have both splits, compare directly
  if (other && other.gamesPlayed >= 5) {
    const otherRate = other[rateField];
    const combined = (applicableRate * applicable.gamesPlayed + otherRate * other.gamesPlayed) /
      (applicable.gamesPlayed + other.gamesPlayed);
    if (combined === 0) return 0;
    const ratio = applicableRate / combined;
    // ratio > 1 means better in this split, < 1 means worse
    const boost = (ratio - 1) * 0.3; // scale to reasonable range
    return Math.max(-0.15, Math.min(0.15, boost));
  }

  // Only one split available — use OPS as a proxy
  const ops = parseFloat(applicable.ops) || 0;
  if (ops > 0.900) return 0.08;
  if (ops > 0.800) return 0.04;
  if (ops < 0.600) return -0.08;
  if (ops < 0.700) return -0.04;
  return 0;
}

export async function getPlayerDayNightSplits(
  mlbPlayerId: number,
  gameTimeUtc: string | null | undefined,
  statType: "hits" | "runs" | "rbi",
  season: number = new Date().getFullYear()
): Promise<PlayerDayNightSplits> {
  const cacheKey = `${mlbPlayerId}-${season}`;
  const cached = splitsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    const c = cached.data;
    // Re-calculate based on game time (might differ between calls)
    return buildResult(mlbPlayerId, c.day, c.night, gameTimeUtc, statType);
  }

  const { day, night } = await fetchSplitsForPlayer(mlbPlayerId, season);

  // Cache the raw splits
  const base: PlayerDayNightSplits = {
    playerId: mlbPlayerId,
    day,
    night,
    applicableSplit: "unknown",
    splitBoost: 0,
    splitLabel: "",
  };
  splitsCache.set(cacheKey, { data: base, ts: Date.now() });

  return buildResult(mlbPlayerId, day, night, gameTimeUtc, statType);
}

function buildResult(
  playerId: number,
  day: DayNightSplit | null,
  night: DayNightSplit | null,
  gameTimeUtc: string | null | undefined,
  statType: "hits" | "runs" | "rbi"
): PlayerDayNightSplits {
  const applicableSplit = isNightGame(gameTimeUtc);
  const applicable = applicableSplit === "day" ? day : applicableSplit === "night" ? night : null;
  const other = applicableSplit === "day" ? night : applicableSplit === "night" ? day : null;

  const splitBoost = applicable ? calculateSplitBoost(applicable, other, statType) : 0;

  let splitLabel = "";
  if (applicable && applicable.gamesPlayed >= 5) {
    const emoji = splitBoost > 0.05 ? "🌟" : splitBoost < -0.05 ? "⚠️" : "";
    splitLabel = `${applicableSplit === "day" ? "☀️ Day" : "🌙 Night"}: ${applicable.avg} AVG ${emoji}`.trim();
  }

  return {
    playerId,
    day,
    night,
    applicableSplit,
    splitBoost,
    splitLabel,
  };
}

/** Batch fetch splits for multiple players in parallel */
export async function batchGetDayNightSplits(
  players: Array<{ playerId: number; gameTimeUtc?: string | null }>,
  statType: "hits" | "runs" | "rbi",
  season?: number
): Promise<Map<number, PlayerDayNightSplits>> {
  const results = new Map<number, PlayerDayNightSplits>();
  const yr = season ?? new Date().getFullYear();

  await Promise.all(
    players.map(async (p) => {
      const splits = await getPlayerDayNightSplits(p.playerId, p.gameTimeUtc ?? null, statType, yr);
      results.set(p.playerId, splits);
    })
  );

  return results;
}
