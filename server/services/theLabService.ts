/**
 * TheLAB (heisenbets.com) Integration Service
 * Fetches mismatch board data and player momentum/streak data
 * Uses authenticated session via stored credentials
 */

interface TheLabMismatchItem {
  playerId: number;
  playerName: string;
  position: string;
  teamAbbr: string;
  opponentAbbr: string;
  gameId: number;
  gameLabel: string;
  gameDate: string;
  propType: "HITS" | "RUNS" | "RBIS" | "HOME_RUNS" | "TOTAL_BASES";
  line: number;
  odds: number; // American odds e.g. -164, +120
  provider: string;
  edgeScore: number; // 0-100
  opponentScore: number; // 0-100, higher = weaker opponent
  hitMismatchScore: number;
  hitMismatchSignal: "Balanced" | "Favorable" | "Strong";
  strongHitCandidate: boolean;
  lineupSpot: number;
  lineupScore: number;
  marketProbabilityPct: number;
  last5Avg: number;
  seasonAvg: number;
  last5HitRate: number; // 0-100
  seasonHitRate: number; // 0-100
  projected: number;
  valueEdge: number;
  weatherSummary: string;
}

interface TheLabMomentumItem {
  playerId: number;
  statCategory: "hits" | "runs" | "rbis" | "home_runs";
  last5Avg: string;
  last10Avg: string;
  last20Avg: string;
  seasonAvg: string;
  trendDirection: "HOT" | "COLD" | "NEUTRAL";
  streakLength: number; // positive = consecutive hits, negative = consecutive misses
  zScore: string;
  percentChange: string;
  gamesPlayed: number;
}

export interface TheLabPlayerData {
  mismatch: TheLabMismatchItem | null;
  momentum: TheLabMomentumItem | null;
  edgeScore: number;
  last5HitRate: number;
  streakLength: number;
  trendDirection: "HOT" | "COLD" | "NEUTRAL";
  streakBoost: number; // -0.12 to +0.12
  streakLabel: string;
  odds: number | null; // American odds from theLAB
  oddsProvider: string | null;
  strongHitCandidate: boolean;
}

// Cache for 10 minutes
const mismatchCache = new Map<string, { data: TheLabMismatchItem[]; ts: number }>();
const momentumCache = new Map<number, { data: TheLabMomentumItem[]; ts: number }>();
const MISMATCH_TTL = 10 * 60 * 1000;
const MOMENTUM_TTL = 30 * 60 * 1000;

let theLabSession: string | null = null;
let sessionExpiry = 0;

async function getTheLabSession(): Promise<string | null> {
  if (theLabSession && Date.now() < sessionExpiry) return theLabSession;

  try {
    // Login to theLAB
    const loginRes = await fetch("https://thelab.heisenbets.com/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "tafmwamuka@gmail.com",
        password: "980791Taf!",
      }),
    });

    if (!loginRes.ok) {
      console.warn("[TheLAB] Login failed:", loginRes.status);
      return null;
    }

    // Extract session cookie
    const setCookie = loginRes.headers.get("set-cookie");
    if (setCookie) {
      theLabSession = setCookie;
      sessionExpiry = Date.now() + 23 * 60 * 60 * 1000; // 23 hours
      return theLabSession;
    }

    // Try JSON response for token
    const body = await loginRes.json().catch(() => null);
    if (body?.token) {
      theLabSession = `Bearer ${body.token}`;
      sessionExpiry = Date.now() + 23 * 60 * 60 * 1000;
      return theLabSession;
    }

    return null;
  } catch (err) {
    console.warn("[TheLAB] Session error:", err);
    return null;
  }
}

async function fetchMismatchBoard(date: string, propType: "hits" | "runs" | "rbis"): Promise<TheLabMismatchItem[]> {
  const cacheKey = `${date}-${propType}`;
  const cached = mismatchCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < MISMATCH_TTL) return cached.data;

  try {
    const session = await getTheLabSession();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (session) {
      if (session.startsWith("Bearer ")) {
        headers["Authorization"] = session;
      } else {
        headers["Cookie"] = session;
      }
    }

    const res = await fetch(
      `https://thelab.heisenbets.com/api/cheat-sheets/mismatches?league=MLB&date=${date}`,
      { headers }
    );

    if (!res.ok) {
      console.warn("[TheLAB] Mismatch board fetch failed:", res.status);
      return [];
    }

    const data = await res.json();
    const tabKey = propType === "hits" ? "hits" : propType === "runs" ? "runs" : "rbis";
    const tab = data?.tabs?.find((t: any) => t.key === tabKey);
    const items: TheLabMismatchItem[] = (tab?.items ?? []).map((item: any) => ({
      playerId: item.playerId,
      playerName: item.playerName,
      position: item.position,
      teamAbbr: item.teamAbbr,
      opponentAbbr: item.opponentAbbr,
      gameId: item.gameId,
      gameLabel: item.gameLabel,
      gameDate: item.gameDate,
      propType: item.propType,
      line: item.line,
      odds: item.odds,
      provider: item.provider,
      edgeScore: item.edgeScore ?? 0,
      opponentScore: item.opponentScore ?? 0,
      hitMismatchScore: item.hitMismatchScore ?? 0,
      hitMismatchSignal: item.hitMismatchSignal ?? "Balanced",
      strongHitCandidate: item.strongHitCandidate ?? false,
      lineupSpot: item.lineupSpot ?? 9,
      lineupScore: item.lineupScore ?? 50,
      marketProbabilityPct: item.marketProbabilityPct ?? 50,
      last5Avg: item.last5Avg ?? 0,
      seasonAvg: item.seasonAvg ?? 0,
      last5HitRate: item.last5HitRate ?? 0,
      seasonHitRate: item.seasonHitRate ?? 0,
      projected: item.projected ?? 0,
      valueEdge: item.valueEdge ?? 0,
      weatherSummary: item.weatherSummary ?? "",
    }));

    mismatchCache.set(cacheKey, { data: items, ts: Date.now() });
    return items;
  } catch (err) {
    console.warn("[TheLAB] Mismatch fetch error:", err);
    return [];
  }
}

async function fetchPlayerMomentum(theLabPlayerId: number): Promise<TheLabMomentumItem[]> {
  const cached = momentumCache.get(theLabPlayerId);
  if (cached && Date.now() - cached.ts < MOMENTUM_TTL) return cached.data;

  try {
    const session = await getTheLabSession();
    const headers: Record<string, string> = {};
    if (session) {
      if (session.startsWith("Bearer ")) {
        headers["Authorization"] = session;
      } else {
        headers["Cookie"] = session;
      }
    }

    const res = await fetch(
      `https://thelab.heisenbets.com/api/players/${theLabPlayerId}?seasonScope=combined`,
      { headers }
    );

    if (!res.ok) return [];

    const data = await res.json();
    const momentum: TheLabMomentumItem[] = (data?.momentum ?? []).map((m: any) => ({
      playerId: theLabPlayerId,
      statCategory: m.statCategory,
      last5Avg: m.last5Avg,
      last10Avg: m.last10Avg,
      last20Avg: m.last20Avg,
      seasonAvg: m.seasonAvg,
      trendDirection: m.trendDirection ?? "NEUTRAL",
      streakLength: m.streakLength ?? 0,
      zScore: m.zScore,
      percentChange: m.percentChange,
      gamesPlayed: m.gamesPlayed ?? 0,
    }));

    momentumCache.set(theLabPlayerId, { data: momentum, ts: Date.now() });
    return momentum;
  } catch {
    return [];
  }
}

function calculateStreakBoost(streakLength: number, trendDirection: "HOT" | "COLD" | "NEUTRAL"): number {
  if (trendDirection === "HOT") {
    if (streakLength >= 7) return 0.12;
    if (streakLength >= 5) return 0.09;
    if (streakLength >= 3) return 0.06;
    return 0.03;
  }
  if (trendDirection === "COLD") {
    if (streakLength <= -7) return -0.12;
    if (streakLength <= -5) return -0.09;
    if (streakLength <= -3) return -0.06;
    return -0.03;
  }
  return 0;
}

function getStreakLabel(streakLength: number, trendDirection: "HOT" | "COLD" | "NEUTRAL"): string {
  if (trendDirection === "HOT" && streakLength >= 3) {
    return `🔥 ${streakLength}-game streak`;
  }
  if (trendDirection === "COLD" && streakLength <= -3) {
    return `❄️ Cold (${Math.abs(streakLength)} games)`;
  }
  if (trendDirection === "HOT") return "📈 Trending up";
  if (trendDirection === "COLD") return "📉 Trending down";
  return "";
}

/**
 * Get combined theLAB data for a player by their MLB player name and team
 * (theLAB uses its own player IDs, so we match by name)
 */
export async function getTheLabPlayerData(
  playerName: string,
  teamAbbr: string,
  statType: "hits" | "runs" | "rbi",
  date: string
): Promise<TheLabPlayerData> {
  const propType = statType === "rbi" ? "rbis" : statType;

  // Fetch mismatch board
  const mismatchItems = await fetchMismatchBoard(date, propType);

  // Find matching player (case-insensitive name match)
  const nameLower = playerName.toLowerCase();
  const mismatch = mismatchItems.find(
    (item) =>
      item.playerName.toLowerCase() === nameLower ||
      item.playerName.toLowerCase().includes(nameLower.split(" ").slice(-1)[0].toLowerCase())
  ) ?? null;

  // Fetch momentum if we have a theLAB player ID
  let momentum: TheLabMomentumItem | null = null;
  if (mismatch?.playerId) {
    const momentumList = await fetchPlayerMomentum(mismatch.playerId);
    const statCat = statType === "rbi" ? "rbis" : statType;
    momentum = momentumList.find((m) => m.statCategory === statCat) ?? null;
  }

  const streakLength = momentum?.streakLength ?? 0;
  const trendDirection = momentum?.trendDirection ?? "NEUTRAL";
  const streakBoost = calculateStreakBoost(streakLength, trendDirection);
  const streakLabel = getStreakLabel(streakLength, trendDirection);

  return {
    mismatch,
    momentum,
    edgeScore: mismatch?.edgeScore ?? 0,
    last5HitRate: mismatch?.last5HitRate ?? 0,
    streakLength,
    trendDirection,
    streakBoost,
    streakLabel,
    odds: mismatch?.odds ?? null,
    oddsProvider: mismatch?.provider ?? null,
    strongHitCandidate: mismatch?.strongHitCandidate ?? false,
  };
}

/**
 * Batch fetch theLAB data for multiple players
 */
export async function batchGetTheLabData(
  players: Array<{ playerName: string; teamAbbr: string; statType: "hits" | "runs" | "rbi" }>,
  date: string
): Promise<Map<string, TheLabPlayerData>> {
  const results = new Map<string, TheLabPlayerData>();

  await Promise.all(
    players.map(async (p) => {
      const data = await getTheLabPlayerData(p.playerName, p.teamAbbr, p.statType, date);
      results.set(p.playerName, data);
    })
  );

  return results;
}
