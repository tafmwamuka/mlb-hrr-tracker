import { publicProcedure, router } from "../_core/trpc";

/**
 * Ballpark router — handles fetching batter vs pitcher matchup data from ballpark.com
 * Returns park-adjusted stats ranked by RC (Runs Created)
 */

interface RawMatchup {
  batter: {
    name: string;
    id: string;
    team: string;
    handedness: string;
  };
  pitcher: {
    name: string;
    id: string;
    team: string;
  };
  matchup: {
    vs: string; // e.g., "RHP" or "LHP"
  };
  stats: {
    rc: number; // Runs Created
    hr: number; // Home Runs
    xb: number; // Extra Base Hits
    oneB: number; // Singles
    bb: number; // Walks
    k: number; // Strikeouts
  };
  confidence: number; // 0-100
}

interface MatchupPlay extends RawMatchup {
  rank: number; // 1-10 ranking
}

/**
 * Mock data for today's matchups
 * In production, this would call the actual ballpark.com API
 * For now, we provide realistic mock data that will be ranked by RC
 */
const MOCK_MATCHUPS: RawMatchup[] = [
  {
    batter: { name: "B. Buxton", id: "621439", team: "MIN", handedness: "R" },
    pitcher: { name: "Mikolas", id: "571912", team: "STL" },
    matchup: { vs: "RHP" },
    stats: { rc: 37, hr: 6.9, xb: 6.8, oneB: 12, bb: 6.1, k: 21 },
    confidence: 92,
  },
  {
    batter: { name: "B. Bichette", id: "621439", team: "NYM", handedness: "R" },
    pitcher: { name: "Lorenzen", id: "571912", team: "LAA" },
    matchup: { vs: "RHP" },
    stats: { rc: 31, hr: 1.9, xb: 9.1, oneB: 20, bb: 7.5, k: 11 },
    confidence: 88,
  },
  {
    batter: { name: "J. Wood", id: "621439", team: "WAS", handedness: "L" },
    pitcher: { name: "Ober", id: "571912", team: "MIN" },
    matchup: { vs: "RHP" },
    stats: { rc: 29, hr: 5.2, xb: 4.8, oneB: 13, bb: 13, k: 27 },
    confidence: 85,
  },
  {
    batter: { name: "J. Soto", id: "621439", team: "NYM", handedness: "L" },
    pitcher: { name: "Lorenzen", id: "571912", team: "LAA" },
    matchup: { vs: "RHP" },
    stats: { rc: 25, hr: 4.7, xb: 7.1, oneB: 15, bb: 16, k: 14 },
    confidence: 82,
  },
  {
    batter: { name: "C. Raleigh", id: "621439", team: "SEA", handedness: "S" },
    pitcher: { name: "Perez", id: "571912", team: "KC" },
    matchup: { vs: "LHP" },
    stats: { rc: 22, hr: 4.8, xb: 4.9, oneB: 9.2, bb: 18, k: 25 },
    confidence: 79,
  },
  {
    batter: { name: "R. Refsnyder", id: "621439", team: "SEA", handedness: "R" },
    pitcher: { name: "Perez", id: "571912", team: "KC" },
    matchup: { vs: "LHP" },
    stats: { rc: 22, hr: 3.9, xb: 5.1, oneB: 13, bb: 17, k: 18 },
    confidence: 76,
  },
  {
    batter: { name: "M. Garver", id: "621439", team: "SEA", handedness: "R" },
    pitcher: { name: "Perez", id: "571912", team: "KC" },
    matchup: { vs: "LHP" },
    stats: { rc: 21, hr: 3.7, xb: 5.1, oneB: 12, bb: 16, k: 23 },
    confidence: 73,
  },
  {
    batter: { name: "S. Ohtani", id: "621439", team: "LAD", handedness: "L" },
    pitcher: { name: "McCullers Jr.", id: "571912", team: "HOU" },
    matchup: { vs: "RHP" },
    stats: { rc: 18, hr: 5.4, xb: 4.8, oneB: 15, bb: 19, k: 25 },
    confidence: 70,
  },
  {
    batter: { name: "F. Tatis Jr.", id: "621439", team: "SD", handedness: "R" },
    pitcher: { name: "Houser", id: "571912", team: "MIL" },
    matchup: { vs: "RHP" },
    stats: { rc: 15, hr: 1.8, xb: 6.6, oneB: 19, bb: 9.3, k: 15 },
    confidence: 67,
  },
  {
    batter: { name: "J. Bell", id: "621439", team: "MIN", handedness: "R" },
    pitcher: { name: "Mikolas", id: "571912", team: "STL" },
    matchup: { vs: "RHP" },
    stats: { rc: 15, hr: 5.2, xb: 5.4, oneB: 15, bb: 7.2, k: 15 },
    confidence: 64,
  },
];

/**
 * Rank matchups by RC (Runs Created) in descending order
 * Returns top 10 with rank numbers assigned
 */
function rankMatchupsByRC(matchups: RawMatchup[]): MatchupPlay[] {
  return matchups
    .sort((a, b) => b.stats.rc - a.stats.rc)
    .slice(0, 10)
    .map((matchup, index) => ({
      ...matchup,
      rank: index + 1,
    }));
}

/**
 * Fetch today's matchups from ballpark.com API
 * In production, this would make a real API call
 */
async function fetchTodayMatchups(): Promise<MatchupPlay[]> {
  try {
    // TODO: Replace with real ballpark.com API call
    // const response = await fetch('https://www.ballpark.com/api/matchups/today');
    // const data = await response.json();
    // return rankMatchupsByRC(data.matchups);

    // For now, use mock data ranked by RC
    return rankMatchupsByRC(MOCK_MATCHUPS);
  } catch (error) {
    console.error("Error fetching ballpark matchups:", error);
    return [];
  }
}

export const ballparkRouter = router({
  /**
   * Get today's top batter vs pitcher matchups ranked by RC
   */
  getTodayMatchups: publicProcedure.query(async () => {
    return fetchTodayMatchups();
  }),

  /**
   * Get matchups for a specific game
   */
  getGameMatchups: publicProcedure
    .input((val: any) => {
      if (typeof val === "string") {
        return val;
      }
      throw new Error("Invalid game ID");
    })
    .query(async ({ input }) => {
      // In production, fetch matchups for specific game
      const allMatchups = await fetchTodayMatchups();
      return allMatchups;
    }),
});
