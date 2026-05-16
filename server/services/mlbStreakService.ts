/**
 * MLB Streak Service (Free — MLB Stats API)
 * Fetches each player's last 7 games from the official MLB Stats API
 * and calculates real HOT/COLD/NEUTRAL streaks based on H/R/RBI performance.
 *
 * No API key required. Replaces theLAB momentum data as a free bridge
 * until a paid provider (SportsGameOdds, SportsDataIO) is set up.
 */

const MLB_API_BASE = "https://statsapi.mlb.com/api/v1";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlayerGameLogEntry {
  date: string;
  hits: number;
  runs: number;
  rbi: number;
  atBats: number;
  homeRuns: number;
}

export interface PlayerStreakData {
  playerId: number;
  last5Games: PlayerGameLogEntry[];
  last5HitRate: number;       // 0–100: % of last 5 games with ≥1 hit
  last5RunRate: number;       // 0–100: % of last 5 games with ≥1 run
  last5RbiRate: number;       // 0–100: % of last 5 games with ≥1 RBI
  last5AvgHits: number;       // avg hits per game (last 5)
  last5AvgRuns: number;
  last5AvgRbi: number;
  streakLength: number;       // +N = consecutive games with hit, -N = without
  trendDirection: "HOT" | "COLD" | "NEUTRAL";
  streakLabel: string;        // e.g. "🔥 HOT (5-game hit streak)"
  streakBoost: number;        // -0.12 to +0.12 for scoring
  hasRealData: boolean;
}

// ─── Cache (30 min TTL) ───────────────────────────────────────────────────────

const streakCache = new Map<number, { data: PlayerStreakData; ts: number }>();
const STREAK_TTL = 30 * 60 * 1000;

// ─── Core fetch ───────────────────────────────────────────────────────────────

async function fetchPlayerGameLog(playerId: number, attempt = 0): Promise<PlayerGameLogEntry[]> {
  const season = new Date().getFullYear();
  const url = `${MLB_API_BASE}/people/${playerId}/stats?stats=gameLog&season=${season}&group=hitting`;

  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(5000), // Phase AN: fail fast (was 15s)
    });
    if (!res.ok) return [];

    const json = await res.json() as any;
    const splits: any[] = json.stats?.[0]?.splits ?? [];

    // Return the last 7 games (most recent first after reverse)
    return splits
      .slice(-7)
      .reverse()
      .map((s: any) => ({
        date: s.date ?? "",
        hits: s.stat?.hits ?? 0,
        runs: s.stat?.runs ?? 0,
        rbi: s.stat?.rbi ?? 0,
        atBats: s.stat?.atBats ?? 0,
        homeRuns: s.stat?.homeRuns ?? 0,
      }));
  } catch (err: any) {
    // Retry up to 2 times on transient network errors (TLS/ECONNRESET)
    const isTransient = err?.cause?.code === 'ECONNRESET' ||
      err?.cause?.message?.includes('TLS') ||
      err?.cause?.message?.includes('socket');
    if (isTransient && attempt < 2) {
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      return fetchPlayerGameLog(playerId, attempt + 1);
    }
    return [];
  }
}

// ─── Streak calculation ───────────────────────────────────────────────────────

function calcStreakLength(games: PlayerGameLogEntry[], statType: "hits" | "runs" | "rbi"): number {
  if (games.length === 0) return 0;
  let streak = 0;
  // Walk from most recent game outward
  for (const g of games) {
    const val = statType === "hits" ? g.hits : statType === "runs" ? g.runs : g.rbi;
    if (val > 0) {
      if (streak >= 0) streak++;
      else break; // switch from negative to positive — stop
    } else {
      if (streak <= 0) streak--;
      else break; // switch from positive to negative — stop
    }
  }
  return streak;
}

function calcStreakBoost(streakLength: number, trend: "HOT" | "COLD" | "NEUTRAL"): number {
  if (trend === "HOT") {
    if (streakLength >= 7) return 0.12;
    if (streakLength >= 5) return 0.09;
    if (streakLength >= 3) return 0.06;
    return 0.03;
  }
  if (trend === "COLD") {
    if (streakLength <= -7) return -0.12;
    if (streakLength <= -5) return -0.09;
    if (streakLength <= -3) return -0.06;
    return -0.03;
  }
  return 0;
}

function getStreakLabel(streakLength: number, trend: "HOT" | "COLD" | "NEUTRAL", last5HitRate: number): string {
  if (trend === "HOT") {
    const abs = Math.abs(streakLength);
    if (abs >= 5) return `🔥 HOT (${abs}-game hit streak)`;
    if (abs >= 3) return `🔥 HOT (${abs}-game streak)`;
    return `🔥 HOT (${Math.round(last5HitRate)}% L5)`;
  }
  if (trend === "COLD") {
    const abs = Math.abs(streakLength);
    if (abs >= 5) return `❄️ COLD (${abs}-game hitless)`;
    if (abs >= 3) return `❄️ COLD (${abs}-game slump)`;
    return `❄️ COLD (${Math.round(last5HitRate)}% L5)`;
  }
  return `➡️ NEUTRAL (${Math.round(last5HitRate)}% L5)`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function getPlayerStreak(
  playerId: number,
  statType: "hits" | "runs" | "rbi" = "hits"
): Promise<PlayerStreakData> {
  // Check cache
  const cached = streakCache.get(playerId);
  if (cached && Date.now() - cached.ts < STREAK_TTL) return cached.data;

  const games = await fetchPlayerGameLog(playerId);

  if (games.length === 0) {
    const empty: PlayerStreakData = {
      playerId,
      last5Games: [],
      last5HitRate: 0,
      last5RunRate: 0,
      last5RbiRate: 0,
      last5AvgHits: 0,
      last5AvgRuns: 0,
      last5AvgRbi: 0,
      streakLength: 0,
      trendDirection: "NEUTRAL",
      streakLabel: "",
      streakBoost: 0,
      hasRealData: false,
    };
    return empty;
  }

  const last5 = games.slice(0, 5);

  const last5HitRate = last5.length > 0
    ? (last5.filter(g => g.hits > 0).length / last5.length) * 100
    : 0;
  const last5RunRate = last5.length > 0
    ? (last5.filter(g => g.runs > 0).length / last5.length) * 100
    : 0;
  const last5RbiRate = last5.length > 0
    ? (last5.filter(g => g.rbi > 0).length / last5.length) * 100
    : 0;

  const last5AvgHits = last5.reduce((s, g) => s + g.hits, 0) / Math.max(last5.length, 1);
  const last5AvgRuns = last5.reduce((s, g) => s + g.runs, 0) / Math.max(last5.length, 1);
  const last5AvgRbi  = last5.reduce((s, g) => s + g.rbi,  0) / Math.max(last5.length, 1);

  // Use the relevant stat type's rate for trend
  const relevantRate = statType === "runs" ? last5RunRate : statType === "rbi" ? last5RbiRate : last5HitRate;
  const streakLength = calcStreakLength(games, statType);

  let trendDirection: "HOT" | "COLD" | "NEUTRAL";
  if (relevantRate >= 70 || streakLength >= 3) {
    trendDirection = "HOT";
  } else if (relevantRate <= 30 || streakLength <= -3) {
    trendDirection = "COLD";
  } else {
    trendDirection = "NEUTRAL";
  }

  const streakBoost = calcStreakBoost(streakLength, trendDirection);
  const streakLabel = getStreakLabel(streakLength, trendDirection, relevantRate);

  const result: PlayerStreakData = {
    playerId,
    last5Games: last5,
    last5HitRate,
    last5RunRate,
    last5RbiRate,
    last5AvgHits,
    last5AvgRuns,
    last5AvgRbi,
    streakLength,
    trendDirection,
    streakLabel,
    streakBoost,
    hasRealData: true,
  };

  streakCache.set(playerId, { data: result, ts: Date.now() });
  return result;
}

/**
 * Batch fetch streak data for multiple players.
 * Returns a Map keyed by playerId.
 */
export async function batchGetPlayerStreaks(
  players: Array<{ playerId: number; playerName?: string; statType?: "hits" | "runs" | "rbi" }>,
  _season?: number // unused — MLB Stats API uses current season automatically
): Promise<Map<number, PlayerStreakData>> {
  const results = new Map<number, PlayerStreakData>();

  // Fetch in batches of 20 — MLB Stats API handles this fine and reduces sequential rounds
  const BATCH = 20;
  for (let i = 0; i < players.length; i += BATCH) {
    const batch = players.slice(i, i + BATCH);
    const fetched = await Promise.all(
      batch.map(p => getPlayerStreak(p.playerId, p.statType ?? 'hits'))
    );
    for (let j = 0; j < batch.length; j++) {
      results.set(batch[j].playerId, fetched[j]);
    }
  }

  return results;
}
