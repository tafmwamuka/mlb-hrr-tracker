/**
 * AI Picks Router
 * Comprehensive AI picks using all data sources
 */

import { router, publicProcedure } from "../_core/trpc";
import { rankAIPicks, getMockHRTargets, getMockParkFactors } from "../services/aiRankingService";
import type { AIPick } from "../services/aiRankingService";

// Mock player data with batting position
const MOCK_PLAYERS = new Map([
  [660271, {
    playerId: 660271,
    name: "Aaron Judge",
    team: "NYY",
    position: "RF",
    battingPosition: 4,
    handedness: 'R' as const,
    stats: {
      hits: 45,
      runs: 38,
      rbi: 92,
      slg: 0.520,
      avg: 0.285,
      obp: 0.380,
      power: 0.185,
    },
    recentForm: {
      last15Games: {
        hits: 18,
        runs: 15,
        rbi: 38,
        avg: 0.310,
      },
      trend: 'hot' as const,
    },
  }],
  [592450, {
    playerId: 592450,
    name: "Juan Soto",
    team: "NYM",
    position: "LF",
    battingPosition: 3,
    handedness: 'L' as const,
    stats: {
      hits: 52,
      runs: 41,
      rbi: 88,
      slg: 0.545,
      avg: 0.310,
      obp: 0.420,
      power: 0.195,
    },
    recentForm: {
      last15Games: {
        hits: 20,
        runs: 17,
        rbi: 35,
        avg: 0.325,
      },
      trend: 'hot' as const,
    },
  }],
  [608070, {
    playerId: 608070,
    name: "B. Buxton",
    team: "MIN",
    position: "CF",
    battingPosition: 2,
    handedness: 'R' as const,
    stats: {
      hits: 38,
      runs: 35,
      rbi: 72,
      slg: 0.480,
      avg: 0.275,
      obp: 0.360,
      power: 0.165,
    },
  }],
  [543807, {
    playerId: 543807,
    name: "B. Bichette",
    team: "BOS",
    position: "DH",
    battingPosition: 5,
    stats: {
      hits: 48,
      runs: 36,
      rbi: 85,
      slg: 0.510,
      avg: 0.295,
      obp: 0.375,
      power: 0.180,
    },
  }],
  [502671, {
    playerId: 502671,
    name: "J. Wood",
    team: "WAS",
    position: "LF",
    battingPosition: 3,
    stats: {
      hits: 42,
      runs: 33,
      rbi: 78,
      slg: 0.495,
      avg: 0.280,
      obp: 0.365,
      power: 0.170,
    },
  }],
  [592885, {
    playerId: 592885,
    name: "J. Soto",
    team: "NYM",
    position: "LF",
    battingPosition: 3,
    stats: {
      hits: 52,
      runs: 41,
      rbi: 88,
      slg: 0.545,
      avg: 0.310,
      obp: 0.420,
      power: 0.195,
    },
  }],
  [605141, {
    playerId: 605141,
    name: "C. Raleigh",
    team: "SEA",
    position: "C",
    battingPosition: 6,
    stats: {
      hits: 35,
      runs: 28,
      rbi: 65,
      slg: 0.450,
      avg: 0.260,
      obp: 0.340,
      power: 0.155,
    },
  }],
  [571970, {
    playerId: 571970,
    name: "S. Ohtani",
    team: "LAD",
    position: "DH",
    battingPosition: 2,
    stats: {
      hits: 50,
      runs: 42,
      rbi: 90,
      slg: 0.535,
      avg: 0.305,
      obp: 0.410,
      power: 0.190,
    },
  }],
  [502671, {
    playerId: 502671,
    name: "R. Refsnyder",
    team: "SEA",
    position: "2B",
    battingPosition: 7,
    stats: {
      hits: 40,
      runs: 30,
      rbi: 68,
      slg: 0.420,
      avg: 0.270,
      obp: 0.350,
      power: 0.140,
    },
  }],
  [543807, {
    playerId: 543807,
    name: "M. Garver",
    team: "SEA",
    position: "C",
    battingPosition: 8,
    stats: {
      hits: 36,
      runs: 26,
      rbi: 62,
      slg: 0.440,
      avg: 0.265,
      obp: 0.345,
      power: 0.150,
    },
  }],
]);

// Mock matchup data
const MOCK_MATCHUPS = [
  {
    playerId: 660271,
    playerName: "Aaron Judge",
    team: "NYY",
    position: "RF",
    battingPosition: 4,
    pitcher: { name: "Framber Valdez", team: "HOU" },
    rc: 38,
    confidence: 88,
  },
  {
    playerId: 592450,
    playerName: "Juan Soto",
    team: "NYM",
    position: "LF",
    battingPosition: 3,
    pitcher: { name: "Kevin Gausman", team: "TOR" },
    rc: 42,
    confidence: 92,
  },
  {
    playerId: 608070,
    playerName: "B. Buxton",
    team: "MIN",
    position: "CF",
    battingPosition: 2,
    pitcher: { name: "Drew Rasmussen", team: "TB" },
    rc: 35,
    confidence: 82,
  },
  {
    playerId: 543807,
    playerName: "B. Bichette",
    team: "BOS",
    position: "DH",
    battingPosition: 5,
    pitcher: { name: "Luis Severino", team: "NYY" },
    rc: 40,
    confidence: 85,
  },
  {
    playerId: 502671,
    playerName: "J. Wood",
    team: "WAS",
    position: "LF",
    battingPosition: 3,
    pitcher: { name: "Aaron Nola", team: "PHI" },
    rc: 33,
    confidence: 78,
  },
  {
    playerId: 592885,
    playerName: "J. Soto",
    team: "NYM",
    position: "LF",
    battingPosition: 3,
    pitcher: { name: "Max Scherzer", team: "NYM" },
    rc: 36,
    confidence: 80,
  },
  {
    playerId: 605141,
    playerName: "C. Raleigh",
    team: "SEA",
    position: "C",
    battingPosition: 6,
    pitcher: { name: "Logan Gilbert", team: "SEA" },
    rc: 28,
    confidence: 72,
  },
  {
    playerId: 571970,
    playerName: "S. Ohtani",
    team: "LAD",
    position: "DH",
    battingPosition: 2,
    pitcher: { name: "Clayton Kershaw", team: "LAD" },
    rc: 41,
    confidence: 89,
  },
  {
    playerId: 502671,
    playerName: "R. Refsnyder",
    team: "SEA",
    position: "2B",
    battingPosition: 7,
    pitcher: { name: "Sonny Gray", team: "STL" },
    rc: 26,
    confidence: 68,
  },
  {
    playerId: 543807,
    playerName: "M. Garver",
    team: "SEA",
    position: "C",
    battingPosition: 8,
    pitcher: { name: "Camilo Doval", team: "SF" },
    rc: 24,
    confidence: 65,
  },
];

export const aiPicksRouter = router({
  /**
   * Get comprehensive AI picks for today
   * Uses all data sources: RC, player stats, park factors, HR Targets, pitcher matchup, batting position
   */
  getComprehensivePicks: publicProcedure.query(async () => {
    try {
      const picks = rankAIPicks(
        MOCK_MATCHUPS,
        MOCK_PLAYERS,
        getMockHRTargets(),
        getMockParkFactors()
      );

      return {
        success: true,
        picks,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error("Error generating AI picks:", error);
      return {
        success: false,
        picks: [],
        error: "Failed to generate AI picks",
        timestamp: new Date(),
      };
    }
  }),

  /**
   * Get AI picks for a specific game
   */
  getGamePicks: publicProcedure
    .input((input: unknown) => {
      if (typeof input !== "string") throw new Error("Game ID must be a string");
      return input;
    })
    .query(async ({ input: gameId }) => {
      try {
        // Filter matchups for this game
        const gameMatchups = MOCK_MATCHUPS.slice(0, 3); // Mock: return first 3

        const picks = rankAIPicks(
          gameMatchups,
          MOCK_PLAYERS,
          getMockHRTargets(),
          getMockParkFactors()
        );

        return {
          success: true,
          gameId,
          picks,
          timestamp: new Date(),
        };
      } catch (error) {
        console.error("Error generating game picks:", error);
        return {
          success: false,
          gameId,
          picks: [],
          error: "Failed to generate game picks",
          timestamp: new Date(),
        };
      }
    }),
});
