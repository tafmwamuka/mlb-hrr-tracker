/**
 * AI Picks Router
 * Comprehensive AI picks using all data sources
 */

import { router, publicProcedure } from "../_core/trpc";
import { rankAIPicks, getMockHRTargets, getMockParkFactors } from "../services/aiRankingService";
import type { AIPick } from "../services/aiRankingService";
import { getMockSavantData, calculateCombinedScore, type SavantHitter, type SavantPitcher } from "../services/savantService";
import { generateHRRProjections } from "../services/hrrService";
import { americanToImpliedProbability } from "../services/oddsApiService";
import { poissonOverProbability, calculateAlternateLines, findFairLine, calculateEdge, getPickQuality } from "../services/poissonModel";
import { getAdaptedLineupData, getGamesForUI } from "../services/lineupAdapter";
import { getDataDate, type MLBGame } from "../services/mlbLineupService";
import { getEnrichmentData } from "../services/enrichmentCache";
import { fetchGameTotals } from "../services/gameTotalsService";

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
      hits: 42,
      runs: 30,
      rbi: 32,
      slg: 0.580,
      avg: 0.275,
      obp: 0.380,
      power: 0.185,
    },
    recentForm: {
      last15Games: {
        hits: 16,
        runs: 12,
        rbi: 14,
        avg: 0.295,
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
      hits: 48,
      runs: 32,
      rbi: 28,
      slg: 0.545,
      avg: 0.310,
      obp: 0.420,
      power: 0.195,
    },
    recentForm: {
      last15Games: {
        hits: 19,
        runs: 13,
        rbi: 11,
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
      runs: 24,
      rbi: 22,
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
    handedness: 'R' as const,
    stats: {
      hits: 44,
      runs: 22,
      rbi: 26,
      slg: 0.470,
      avg: 0.280,
      obp: 0.340,
      power: 0.160,
    },
  }],
  [665742, {
    playerId: 665742,
    name: "J. Wood",
    team: "WAS",
    position: "LF",
    battingPosition: 3,
    handedness: 'L' as const,
    stats: {
      hits: 40,
      runs: 24,
      rbi: 25,
      slg: 0.495,
      avg: 0.280,
      obp: 0.365,
      power: 0.170,
    },
  }],
  [592885, {
    playerId: 592885,
    name: "M. Betts",
    team: "LAD",
    position: "SS",
    battingPosition: 1,
    handedness: 'R' as const,
    stats: {
      hits: 46,
      runs: 30,
      rbi: 24,
      slg: 0.530,
      avg: 0.295,
      obp: 0.385,
      power: 0.185,
    },
  }],
  [605141, {
    playerId: 605141,
    name: "C. Raleigh",
    team: "SEA",
    position: "C",
    battingPosition: 6,
    handedness: 'R' as const,
    stats: {
      hits: 32,
      runs: 18,
      rbi: 24,
      slg: 0.450,
      avg: 0.240,
      obp: 0.320,
      power: 0.155,
    },
  }],
  [571970, {
    playerId: 571970,
    name: "S. Ohtani",
    team: "LAD",
    position: "DH",
    battingPosition: 2,
    handedness: 'L' as const,
    stats: {
      hits: 48,
      runs: 34,
      rbi: 30,
      slg: 0.580,
      avg: 0.305,
      obp: 0.400,
      power: 0.210,
    },
  }],
  [668939, {
    playerId: 668939,
    name: "R. Acuna Jr.",
    team: "ATL",
    position: "RF",
    battingPosition: 1,
    handedness: 'R' as const,
    stats: {
      hits: 44,
      runs: 30,
      rbi: 20,
      slg: 0.500,
      avg: 0.285,
      obp: 0.380,
      power: 0.175,
    },
  }],
  [665487, {
    playerId: 665487,
    name: "M. Olson",
    team: "ATL",
    position: "1B",
    battingPosition: 4,
    handedness: 'L' as const,
    stats: {
      hits: 38,
      runs: 24,
      rbi: 30,
      slg: 0.510,
      avg: 0.260,
      obp: 0.355,
      power: 0.180,
    },
  }],
  [665489, {
    playerId: 665489,
    name: "K. Tucker",
    team: "HOU",
    position: "LF",
    battingPosition: 3,
    handedness: 'L' as const,
    stats: {
      hits: 44,
      runs: 26,
      rbi: 28,
      slg: 0.500,
      avg: 0.290,
      obp: 0.370,
      power: 0.175,
    },
  }],
  [665862, {
    playerId: 665862,
    name: "C. Carroll",
    team: "ARI",
    position: "CF",
    battingPosition: 1,
    handedness: 'L' as const,
    stats: {
      hits: 42,
      runs: 28,
      rbi: 18,
      slg: 0.440,
      avg: 0.280,
      obp: 0.355,
      power: 0.140,
    },
  }],
  [665750, {
    playerId: 665750,
    name: "G. Henderson",
    team: "BAL",
    position: "SS",
    battingPosition: 2,
    handedness: 'R' as const,
    stats: {
      hits: 45,
      runs: 28,
      rbi: 26,
      slg: 0.515,
      avg: 0.290,
      obp: 0.370,
      power: 0.180,
    },
  }],
  [665861, {
    playerId: 665861,
    name: "E. De La Cruz",
    team: "CIN",
    position: "SS",
    battingPosition: 3,
    handedness: 'R' as const,
    stats: {
      hits: 40,
      runs: 26,
      rbi: 22,
      slg: 0.490,
      avg: 0.265,
      obp: 0.330,
      power: 0.175,
    },
  }],
  [664023, {
    playerId: 664023,
    name: "T. Turner",
    team: "PHI",
    position: "SS",
    battingPosition: 1,
    handedness: 'R' as const,
    stats: {
      hits: 46,
      runs: 26,
      rbi: 20,
      slg: 0.450,
      avg: 0.285,
      obp: 0.340,
      power: 0.145,
    },
  }],
  [663728, {
    playerId: 663728,
    name: "A. Rutschman",
    team: "BAL",
    position: "C",
    battingPosition: 3,
    handedness: 'S' as const,
    stats: {
      hits: 40,
      runs: 24,
      rbi: 26,
      slg: 0.470,
      avg: 0.270,
      obp: 0.365,
      power: 0.160,
    },
  }],
  [666971, {
    playerId: 666971,
    name: "W. Smith",
    team: "LAD",
    position: "C",
    battingPosition: 5,
    handedness: 'R' as const,
    stats: {
      hits: 38,
      runs: 22,
      rbi: 26,
      slg: 0.490,
      avg: 0.270,
      obp: 0.355,
      power: 0.170,
    },
  }],
  [670541, {
    playerId: 670541,
    name: "B. Witt Jr.",
    team: "KC",
    position: "SS",
    battingPosition: 2,
    handedness: 'R' as const,
    stats: {
      hits: 50,
      runs: 30,
      rbi: 24,
      slg: 0.510,
      avg: 0.310,
      obp: 0.350,
      power: 0.170,
    },
  }],
  [682998, {
    playerId: 682998,
    name: "J. Jung",
    team: "TEX",
    position: "3B",
    battingPosition: 4,
    handedness: 'R' as const,
    stats: {
      hits: 40,
      runs: 22,
      rbi: 28,
      slg: 0.480,
      avg: 0.270,
      obp: 0.345,
      power: 0.165,
    },
  }],
  [677594, {
    playerId: 677594,
    name: "J. Rodriguez",
    team: "SEA",
    position: "CF",
    battingPosition: 3,
    handedness: 'R' as const,
    stats: {
      hits: 42,
      runs: 24,
      rbi: 26,
      slg: 0.495,
      avg: 0.275,
      obp: 0.340,
      power: 0.170,
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
    pitcher: { name: "Framber Valdez", team: "HOU", handedness: "L" as const, era: 3.01 },
    rc: 38,
    confidence: 88,
  },
  {
    playerId: 592450,
    playerName: "Juan Soto",
    team: "NYM",
    position: "LF",
    battingPosition: 3,
    pitcher: { name: "Kevin Gausman", team: "TOR", handedness: "R" as const, era: 3.25 },
    rc: 42,
    confidence: 92,
  },
  {
    playerId: 608070,
    playerName: "B. Buxton",
    team: "MIN",
    position: "CF",
    battingPosition: 2,
    pitcher: { name: "Drew Rasmussen", team: "TB", handedness: "R" as const, era: 3.89 },
    rc: 35,
    confidence: 82,
  },
  {
    playerId: 543807,
    playerName: "B. Bichette",
    team: "BOS",
    position: "DH",
    battingPosition: 5,
    pitcher: { name: "Gerrit Cole", team: "NYY", handedness: "R" as const, era: 3.41 },
    rc: 40,
    confidence: 85,
  },
  {
    playerId: 665742,
    playerName: "J. Wood",
    team: "WAS",
    position: "LF",
    battingPosition: 3,
    pitcher: { name: "Camilo Doval", team: "SF", handedness: "R" as const, era: 3.55 },
    rc: 33,
    confidence: 78,
  },
  {
    playerId: 592885,
    playerName: "M. Betts",
    team: "LAD",
    position: "SS",
    battingPosition: 1,
    pitcher: { name: "Max Scherzer", team: "NYM", handedness: "R" as const, era: 3.42 },
    rc: 36,
    confidence: 80,
  },
  {
    playerId: 605141,
    playerName: "C. Raleigh",
    team: "SEA",
    position: "C",
    battingPosition: 6,
    pitcher: { name: "Pablo Lopez", team: "MIN", handedness: "R" as const, era: 3.71 },
    rc: 28,
    confidence: 72,
  },
  {
    playerId: 571970,
    playerName: "S. Ohtani",
    team: "LAD",
    position: "DH",
    battingPosition: 2,
    pitcher: { name: "Zac Gallen", team: "ARI", handedness: "R" as const, era: 3.65 },
    rc: 41,
    confidence: 89,
  },
  {
    playerId: 668939,
    playerName: "R. Acuna Jr.",
    team: "ATL",
    position: "RF",
    battingPosition: 1,
    pitcher: { name: "Sonny Gray", team: "STL", handedness: "R" as const, era: 3.68 },
    rc: 37,
    confidence: 84,
  },
  {
    playerId: 665487,
    playerName: "M. Olson",
    team: "ATL",
    position: "1B",
    battingPosition: 4,
    pitcher: { name: "Blake Snell", team: "SF", handedness: "L" as const, era: 3.12 },
    rc: 34,
    confidence: 79,
  },
  {
    playerId: 665489,
    playerName: "K. Tucker",
    team: "HOU",
    position: "LF",
    battingPosition: 3,
    pitcher: { name: "Zack Wheeler", team: "PHI", handedness: "R" as const, era: 2.98 },
    rc: 32,
    confidence: 76,
  },
  {
    playerId: 665862,
    playerName: "C. Carroll",
    team: "ARI",
    position: "CF",
    battingPosition: 1,
    pitcher: { name: "Yu Darvish", team: "SD", handedness: "R" as const, era: 3.45 },
    rc: 30,
    confidence: 73,
  },
  {
    playerId: 665750,
    playerName: "G. Henderson",
    team: "BAL",
    position: "SS",
    battingPosition: 2,
    pitcher: { name: "Nestor Cortes", team: "NYY", handedness: "L" as const, era: 3.62 },
    rc: 35,
    confidence: 81,
  },
  {
    playerId: 665861,
    playerName: "E. De La Cruz",
    team: "CIN",
    position: "SS",
    battingPosition: 3,
    pitcher: { name: "Miles Mikolas", team: "STL", handedness: "R" as const, era: 4.01 },
    rc: 29,
    confidence: 70,
  },
  {
    playerId: 664023,
    playerName: "T. Turner",
    team: "PHI",
    position: "SS",
    battingPosition: 1,
    pitcher: { name: "Marcus Stroman", team: "NYM", handedness: "R" as const, era: 3.78 },
    rc: 31,
    confidence: 74,
  },
  {
    playerId: 663728,
    playerName: "A. Rutschman",
    team: "BAL",
    position: "C",
    battingPosition: 3,
    pitcher: { name: "Tarik Skubal", team: "DET", handedness: "L" as const, era: 2.85 },
    rc: 36,
    confidence: 82,
  },
  {
    playerId: 666971,
    playerName: "W. Smith",
    team: "LAD",
    position: "C",
    battingPosition: 5,
    pitcher: { name: "Merrill Kelly", team: "ARI", handedness: "R" as const, era: 3.52 },
    rc: 33,
    confidence: 77,
  },
  {
    playerId: 670541,
    playerName: "B. Witt Jr.",
    team: "KC",
    position: "SS",
    battingPosition: 2,
    pitcher: { name: "Joe Ryan", team: "MIN", handedness: "R" as const, era: 3.45 },
    rc: 39,
    confidence: 86,
  },
  {
    playerId: 682998,
    playerName: "J. Jung",
    team: "TEX",
    position: "3B",
    battingPosition: 4,
    pitcher: { name: "Luis Castillo", team: "SEA", handedness: "R" as const, era: 3.38 },
    rc: 30,
    confidence: 72,
  },
  {
    playerId: 677594,
    playerName: "J. Rodriguez",
    team: "SEA",
    position: "CF",
    battingPosition: 3,
    pitcher: { name: "Shane Bieber", team: "CLE", handedness: "R" as const, era: 3.22 },
    rc: 34,
    confidence: 78,
  },
];

// Map player names to Savant data for enrichment
function findSavantHitter(playerName: string, savantGames: ReturnType<typeof getMockSavantData>): { hitter: SavantHitter; pitcher: SavantPitcher | null } | null {
  for (const game of savantGames) {
    // Check home hitters (facing away pitcher)
    const homeHitter = game.homeHitters.find(h => 
      h.name.toLowerCase().includes(playerName.toLowerCase().split(' ').pop() || '') ||
      playerName.toLowerCase().includes(h.name.toLowerCase().split(' ').pop() || '')
    );
    if (homeHitter) return { hitter: homeHitter, pitcher: game.awayPitcher };
    
    // Check away hitters (facing home pitcher)
    const awayHitter = game.awayHitters.find(h => 
      h.name.toLowerCase().includes(playerName.toLowerCase().split(' ').pop() || '') ||
      playerName.toLowerCase().includes(h.name.toLowerCase().split(' ').pop() || '')
    );
    if (awayHitter) return { hitter: awayHitter, pitcher: game.homePitcher };
  }
  return null;
}

// Enrich picks with Savant data
function enrichPicksWithSavant(picks: AIPick[]): AIPick[] {
  const savantGames = getMockSavantData();
  
  return picks.map(pick => {
    const savantMatch = findSavantHitter(pick.playerName, savantGames);
    if (!savantMatch) return pick;
    
    const { hitter, pitcher } = savantMatch;
    const { score: savantScore, factors: savantFactors } = calculateCombinedScore(
      hitter, pitcher, pick.statType === 'slg' ? 'rbi' : pick.statType
    );
    
    // Combined score: 50% Diamond Edge model score + 50% Baseball Savant xwOBA/barrel metrics
    const combinedScore = Math.round((pick.overallScore * 0.5) + (savantScore * 0.5));
    
    return {
      ...pick,
      confidence: Math.min(98, Math.max(pick.confidence, combinedScore)),
      savantMetrics: {
        xwOBA: hitter.xwOBA,
        hardHitPct: hitter.hardHitPct,
        exitVelocity: hitter.exitVelocity,
        barrelPct: hitter.barrelPct,
        kPct: hitter.kPct,
        bbPct: hitter.bbPct,
        xBA: hitter.xBA,
        xSLG: hitter.xSLG,
        sprintSpeed: hitter.sprintSpeed,
        savantScore,
        savantFactors,
      },
      combinedScore,
    };
  });
}

// ─── Pick Stability System ───────────────────────────────────────────────────
// Retains picks that previously qualified for up to 30 minutes even if the
// enrichment cache temporarily returns cold/neutral data.
// Score buffer: if a pick drops ≤5 pts below threshold, keep it with a status label.
interface LockedPick {
  playerName: string;
  team: string;
  qualifiedAt: number;          // timestamp when first qualified
  lastScore: number;            // last known overallScore
  lastRecommendedLine: number;  // last known recommended line
  lastRecommendedProb: number;  // last known recommended probability
  lineupSource: 'confirmed' | 'projected';
}

const PICK_LOCK_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
const SCORE_BUFFER = 5;                       // allow 5-pt drop before removing
const lockedPicksStore = new Map<string, LockedPick>();

function cleanExpiredLocks(nowMs: number) {
  for (const [key, lp] of Array.from(lockedPicksStore.entries())) {
    if (nowMs - lp.qualifiedAt > PICK_LOCK_WINDOW_MS) {
      lockedPicksStore.delete(key);
    }
  }
}

export const aiPicksRouter = router({
  /**
   * Get TOP 5 picks - independently scored using combined Savant + Ballpark data
   * These may differ from All Plays since they use different scoring weights
   */
  getTopPicks: publicProcedure.query(async () => {
    try {
      // Only use real lineup data - no mock fallback
      const lineupData = await getAdaptedLineupData();
      const dataDate = await getDataDate();

      // Get enrichment data early (lineup + Statcast + VS grades + bullpen)
      const enrichment = await getEnrichmentData(
        lineupData.matchups.map(m => ({
          playerId: m.playerId,
          playerName: m.playerName,
          team: m.team,
          gameTime: m.gameTime,
          pitcherId: m.pitcher.id ?? null,
          pitcherHand: m.pitcher.handedness ?? null,
        }))
      ).catch(() => ({
        vsGradeMap: new Map<string, number>(),
        gameTotalsMap: new Map(),
        dayNightSplitsMap: new Map(),
        mlbStreakMap: new Map(),
        statcastCache: { data: new Map(), byId: new Map(), fetchedAt: Date.now(), year: new Date().getFullYear() },
        bullpenFatigueMap: new Map(),
        fetchedAt: Date.now(),
        isWarm: false,
      }));
      const { vsGradeMap, gameTotalsMap, dayNightSplitsMap, mlbStreakMap, statcastCache, bullpenFatigueMap } = enrichment as any;

      const matchups = lineupData.matchups;
      const players = lineupData.playerDataMap;

      if (matchups.length === 0) {
        return {
          success: true,
          picks: [],
          lineupsPending: true,
          dataDate,
          timestamp: new Date(),
        };
      }

      const hrTargetsMap = getMockHRTargets();

      const allPicks = rankAIPicks(
        matchups,
        players,
        hrTargetsMap,
        getMockParkFactors(),
        dayNightSplitsMap,
        mlbStreakMap,
        vsGradeMap,
        gameTotalsMap,
        statcastCache,
        undefined, // ballparkMatchups (legacy)
        bullpenFatigueMap ?? new Map(),
        undefined, // edgeScoreMap
        lineupData.lineupSource // lower thresholds for projected lineups
      );
      
      // Enrich with Savant data
      const enrichedPicks = enrichPicksWithSavant(allPicks);
      
      // Re-sort by combinedScore (Savant + Ballpark) for top picks
      // Stat priority tiebreaker: Hits > Runs > RBI (RBI is riskiest)
      const STAT_SORT_PRIORITY: Record<string, number> = { hits: 3, runs: 2, rbi: 1, slg: 0 };
      const topPicks = [...enrichedPicks]
        .sort((a, b) => {
          const scoreDiff = (b.combinedScore || b.overallScore) - (a.combinedScore || a.overallScore);
          if (Math.abs(scoreDiff) < 3) {
            // Within 3 points, prefer by stat priority
            return (STAT_SORT_PRIORITY[b.statType] || 0) - (STAT_SORT_PRIORITY[a.statType] || 0);
          }
          return scoreDiff;
        })
        .slice(0, 10)
        .map((pick, idx) => ({ ...pick, rank: idx + 1 }));
      
      return {
        success: true,
        picks: topPicks,
        lineupSource: lineupData.lineupSource,
        dataDate,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error("Error generating top picks:", error);
      const fallbackDate = await getDataDate();
      return {
        success: false,
        picks: [],
        dataDate: fallbackDate,
        error: "Failed to generate top picks",
        timestamp: new Date(),
      };
    }
  }),

  /**
   * Get comprehensive AI picks for today (All Plays - 15-20 picks)
   * Uses all data sources: RC, player stats, park factors, HR Targets, pitcher matchup, batting position + Savant
   */
  getComprehensivePicks: publicProcedure.query(async () => {
    try {
      // Only use real lineup data - no mock fallback
      const lineupData = await getAdaptedLineupData();
      const dataDate = await getDataDate();

      // Get enrichment data early (lineup + Statcast + VS grades + bullpen)
      const enrichment2 = await getEnrichmentData(
        lineupData.matchups.map(m => ({
          playerId: m.playerId,
          playerName: m.playerName,
          team: m.team,
          gameTime: m.gameTime,
          pitcherId: m.pitcher.id ?? null,
          pitcherHand: m.pitcher.handedness ?? null,
        }))
      ).catch(() => ({
        vsGradeMap: new Map<string, number>(),
        gameTotalsMap: new Map(),
        dayNightSplitsMap: new Map(),
        mlbStreakMap: new Map(),
        statcastCache: { data: new Map(), byId: new Map(), fetchedAt: Date.now(), year: new Date().getFullYear() },
        bullpenFatigueMap: new Map(),
        fetchedAt: Date.now(),
        isWarm: false,
      }));
      const { vsGradeMap, gameTotalsMap, dayNightSplitsMap, mlbStreakMap, statcastCache: statcastCache2, bullpenFatigueMap: bullpenFatigueMap2 } = enrichment2 as any;

      const matchups = lineupData.matchups;
      const players = lineupData.playerDataMap;

      if (matchups.length === 0) {
        return {
          success: true,
          picks: [],
          lineupsPending: true,
          dataDate,
          timestamp: new Date(),
        };
      }

      const hrTargetsMap2 = getMockHRTargets();

      const picks = rankAIPicks(
        matchups,
        players,
        hrTargetsMap2,
        getMockParkFactors(),
        dayNightSplitsMap,
        mlbStreakMap,
        vsGradeMap,
        gameTotalsMap,
        statcastCache2,
        undefined, // ballparkMatchups (legacy)
        bullpenFatigueMap2 ?? new Map(),
        undefined, // edgeScoreMap
        lineupData.lineupSource // lower thresholds for projected lineups
      );
      
      // Enrich all picks with Savant data
      const enrichedPicks = enrichPicksWithSavant(picks);
      
      // Re-sort with stat priority tiebreaker: Hits > Runs > RBI (RBI is riskiest)
      const STAT_SORT_PRIORITY_ALL: Record<string, number> = { hits: 3, runs: 2, rbi: 1, slg: 0 };
      const sortedPicks = [...enrichedPicks]
        .sort((a, b) => {
          const scoreDiff = (b.combinedScore || b.overallScore) - (a.combinedScore || a.overallScore);
          if (Math.abs(scoreDiff) < 3) {
            return (STAT_SORT_PRIORITY_ALL[b.statType] || 0) - (STAT_SORT_PRIORITY_ALL[a.statType] || 0);
          }
          return scoreDiff;
        })
        .map((pick, idx) => ({ ...pick, rank: idx + 1 }));

      return {
        success: true,
        picks: sortedPicks,
        lineupSource: lineupData.lineupSource,
        dataDate,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error("Error generating AI picks:", error);
      const fallbackDate = await getDataDate();
      return {
        success: false,
        picks: [],
        dataDate: fallbackDate,
        error: "Failed to generate AI picks",
        timestamp: new Date(),
      };
    }
  }),

  /**
   * Get HRR Combined Props - dedicated endpoint with real stat-based calculations
   * Uses per-game averages from season stats, park factors, batting position, and recent form
   * Ranked by HRR-specific probability (not general AI pick order)
   */
  getHRRPicks: publicProcedure.query(async () => {
    try {
      // Only use real lineup data - no mock fallback
      const lineupData = await getAdaptedLineupData();
      const dataDate = await getDataDate();

      // Get enrichment data early (lineup + Statcast + VS grades + bullpen)
      const enrichment3 = await getEnrichmentData(
        lineupData.matchups.map(m => ({ playerId: m.playerId, playerName: m.playerName, team: m.team, gameTime: m.gameTime, pitcherId: m.pitcher.id ?? null, pitcherHand: m.pitcher.handedness ?? null }))
      ).catch(() => ({
        vsGradeMap: new Map<string, number>(),
        gameTotalsMap: new Map(),
        dayNightSplitsMap: new Map(),
        mlbStreakMap: new Map(),
        statcastCache: { data: new Map(), byId: new Map(), fetchedAt: Date.now(), year: new Date().getFullYear() },
        bullpenFatigueMap: new Map(),
        fetchedAt: Date.now(),
        isWarm: false,
      }));
      const { vsGradeMap, gameTotalsMap: _gameTotalsMap3, dayNightSplitsMap, mlbStreakMap, statcastCache: statcastCache3, bullpenFatigueMap: bullpenFatigueMap3 } = enrichment3 as any;

      const matchups = lineupData.matchups;
      const players = lineupData.playerDataMap;

      if (matchups.length === 0) {
        return {
          success: true,
          picks: [],
          lineupsPending: true,
          dataDate,
          timestamp: new Date(),
          hasOddsData: false,
        };
      }

      // Get park factors
      const parkFactors = getMockParkFactors();
      
      // Build Savant data map for enrichment
      const savantGames = getMockSavantData();
      const savantMap = new Map<string, { xwOBA: number; hardHitPct: number; exitVelocity: number; barrelPct: number }>();
      for (const game of savantGames) {
        for (const hitter of [...game.homeHitters, ...game.awayHitters]) {
          savantMap.set(hitter.name, {
            xwOBA: hitter.xwOBA,
            hardHitPct: hitter.hardHitPct,
            exitVelocity: hitter.exitVelocity,
            barrelPct: hitter.barrelPct,
          });
        }
      }

      // Filter matchups through VS gate before HRR projections
      // Internal mlbMatchupService scores: STRONG>=7.0, MODERATE>=5.5
      const HRR_STRONG_THRESHOLD = 7.0;
      const HRR_MODERATE_THRESHOLD = 5.5;
      const gatedMatchups = vsGradeMap.size > 0
        ? matchups.filter(m => {
            const vsScore = vsGradeMap.get(m.playerName) ?? null;
            if (vsScore === null) return false; // Exclude if no entry
            if (vsScore >= HRR_STRONG_THRESHOLD) return true; // STRONG: always in
            if (vsScore >= HRR_MODERATE_THRESHOLD) {
              // MODERATE: enter only with good matchup context
              const playerData = players.get(m.playerId);
              const batterHand = playerData?.handedness ?? 'R';
              const pitcherHand = m.pitcher?.handedness ?? 'R';
              const hasPlatoonAdvantage = batterHand !== pitcherHand;
              const pitcherERA = m.pitcher?.era ?? null;
              const pitcherIsVulnerable = pitcherERA !== null ? pitcherERA >= 4.50 : false;
              const savantEntry = savantMap.get(m.playerName);
              const isBarrelThreat = savantEntry ? savantEntry.barrelPct >= 8.0 : false;
              return hasPlatoonAdvantage || pitcherIsVulnerable || isBarrelThreat;
            }
            return false; // Below MODERATE_THRESHOLD: excluded
          })
        : matchups;

      console.log(`[HRR] VS Gate (internal mlbMatchup, STRONG>=${HRR_STRONG_THRESHOLD}, MOD>=${HRR_MODERATE_THRESHOLD}): ${matchups.length} → ${gatedMatchups.length} matchups passed`);

      // ── STAGE 1: Run the 10-factor scoring matrix on all VS-gated players ──────
      // Every pick on every tab must pass through rankAIPicks first.
      const { gameTotalsMap } = enrichment3;

      const hrTargetsMap3 = getMockHRTargets();

      const matrixPicks = rankAIPicks(
        gatedMatchups,
        players,
        hrTargetsMap3,
        parkFactors,
        dayNightSplitsMap,
        mlbStreakMap,
        vsGradeMap,
        gameTotalsMap,
        statcastCache3,
        undefined, // ballparkMatchups (legacy)
        bullpenFatigueMap3 ?? new Map()
      );

      console.log(`[HRR] Matrix scored: ${matrixPicks.length} picks`);

      // ── STAGE 2: Generate HRR projections for matrix-ranked players ───────────
      // Use the matrix-ranked player list to drive HRR projections.
      // This ensures the same VS gate + matrix ranking applies to HRR/Money Picks.
      const matrixPlayerNames = new Set(matrixPicks.map(p => p.playerName));
      const matrixGatedMatchups = gatedMatchups.filter(m => matrixPlayerNames.has(m.playerName));

      const projections = generateHRRProjections(
        matrixGatedMatchups,
        players,
        parkFactors,
        savantMap,
        dayNightSplitsMap,
        mlbStreakMap
      );

      // ── STAGE 3: Enrich with Poisson probabilities + matrix scores ────────────
      const enrichedPicks = projections.map((proj) => {
        // Find the corresponding matrix pick for this player
        const matrixPick = matrixPicks.find(p => p.playerName === proj.playerName);

        // Lambda = expected HRR total per game (from our model)
        const lambda = proj.expectedTotal;
        const activeLine = proj.hrrLine;

        // Calculate Poisson probability of going OVER the active line
        const modelOverProb = poissonOverProbability(activeLine, lambda);

        // No book odds — use model probability only
        const bookImpliedProb = 0.5;
        const edge = calculateEdge(modelOverProb, bookImpliedProb);
        const pickQuality = getPickQuality(edge);

        // Generate alternate lines with probabilities
        const alternates = calculateAlternateLines(lambda, 5.5);

        // Find the fair line (closest to 50/50)
        const fairLine = findFairLine(lambda);

        return {
          ...proj,
          hrrLine: activeLine,
          lineSource: "model" as const,
          // Matrix scores (from 10-factor scoring pipeline)
          overallScore: matrixPick?.overallScore ?? proj.hrrConfidence,
          baseScore: matrixPick?.baseScore,
          factorBreakdown: matrixPick?.factorBreakdown,
          vsGrade: matrixPick?.vsGrade,
          gameTotalOU: matrixPick?.gameTotalOU,
          primePosition: matrixPick?.primePosition,
          primePositionFactors: matrixPick?.primePositionFactors,
          // Phase R: structured reasons, risk flags, grade, BP boost
          reasons: matrixPick?.reasons ?? [],
          riskFlags: matrixPick?.riskFlags ?? [],
          grade: matrixPick?.grade ?? 'strong',
          bpBoost: matrixPick?.bpBoost ?? 0,
          // Poisson-based probabilities
          overProbability: Math.round(modelOverProb * 100),
          // Edge vs book
          edge: Math.round(edge * 100), // as percentage points
          pickQuality,
          bookOdds: null,
          bookOddsProvider: null,
          bookImpliedProb: null,
          // Alternate lines
          alternateLines: alternates.map(alt => ({
            line: alt.line,
            overProb: Math.round(alt.overProb * 100),
            underProb: Math.round(alt.underProb * 100),
          })),
          fairLine,
          // Expected value (lambda)
          expectedTotal: Math.round(lambda * 10) / 10,
        };
      });

      // ── STAGE 3b: Pre-game gate — drop picks for games already started ─────────
      const nowMs3 = Date.now();
      const GRACE_MS3 = 5 * 60 * 1000;
      const preGamePicks3 = enrichedPicks.filter((pick: any) => {
        if (!pick.gameTime) return true;
        const gameStartMs = new Date(pick.gameTime).getTime();
        return nowMs3 < gameStartMs + GRACE_MS3;
      });

      // ── STAGE 3c: Money picks filter — at least one alternate line at 75%+ ──────
      const qualifyingPicks3 = preGamePicks3
        .map((pick: any) => {
          const qualifyingLines = (pick.alternateLines || [])
            .filter((a: any) => a.overProb >= 75)
            .sort((a: any, b: any) => b.line - a.line);
          if (qualifyingLines.length === 0) return null;
          const recommended = qualifyingLines[0];
          return {
            ...pick,
            recommendedLine: recommended.line,
            recommendedProb: recommended.overProb,
          };
        })
        .filter((p: any): p is NonNullable<typeof p> => p !== null);

      // ── STAGE 3d: Pick Stability — apply lock window + score buffer ───────────
      cleanExpiredLocks(nowMs3);
      const currentLineupSource = lineupData.lineupSource;

      // Register/update all currently qualifying picks in the lock store
      for (const pick of qualifyingPicks3 as any[]) {
        const existing = lockedPicksStore.get(pick.playerName);
        lockedPicksStore.set(pick.playerName, {
          playerName: pick.playerName,
          team: pick.team,
          qualifiedAt: existing?.qualifiedAt ?? nowMs3,
          lastScore: pick.overallScore ?? 0,
          lastRecommendedLine: pick.recommendedLine,
          lastRecommendedProb: pick.recommendedProb,
          lineupSource: currentLineupSource,
        });
      }

      // Determine which previously-locked picks should still be shown
      const qualifyingNames3 = new Set(qualifyingPicks3.map((p: any) => p.playerName));
      const retainedPicks: any[] = [];
      for (const [, lp] of Array.from(lockedPicksStore.entries())) {
        if (qualifyingNames3.has(lp.playerName)) continue; // already in current picks
        if (nowMs3 - lp.qualifiedAt > PICK_LOCK_WINDOW_MS) continue; // expired
        // Find the current enriched pick for this player (may have dropped below threshold)
        const currentPick = preGamePicks3.find((p: any) => p.playerName === lp.playerName);
        if (!currentPick) continue;
        const currentScore = (currentPick as any).overallScore ?? 0;
        // Score buffer: retain if drop is within 5 pts
        if (lp.lastScore - currentScore <= SCORE_BUFFER) {
          retainedPicks.push({
            ...(currentPick as any),
            recommendedLine: lp.lastRecommendedLine,
            recommendedProb: lp.lastRecommendedProb,
            pickStatus: 'confidence_reduced' as const,
          });
        }
      }

      // Merge current qualifying picks + retained picks
      const moneyPicks3 = [
        ...qualifyingPicks3.map((p: any) => ({
          ...p,
          pickStatus: currentLineupSource === 'confirmed' ? 'confirmed' as const : 'preliminary' as const,
          lastUpdated: new Date().toISOString(),
        })),
        ...retainedPicks.map((p: any) => ({
          ...p,
          lastUpdated: new Date().toISOString(),
        })),
      ];

      // ── STAGE 4: Sort by matrix score first, then Poisson quality ────────────
      // Primary sort: matrix overallScore (same ranking as All Plays / Top Plays)
      // Secondary sort: Poisson pick quality + over probability
      enrichedPicks.sort((a, b) => {
        const scoreDiff = ((b.overallScore ?? 0) - (a.overallScore ?? 0));
        if (Math.abs(scoreDiff) > 3) return scoreDiff;
        // Within 3 points, prefer by Poisson quality
        const qualityOrder: Record<string, number> = { strong: 4, moderate: 3, lean: 2, avoid: 1 };
        const qDiff = (qualityOrder[b.pickQuality] ?? 0) - (qualityOrder[a.pickQuality] ?? 0);
        if (qDiff !== 0) return qDiff;
        return b.overProbability - a.overProbability;
      });

      // Build slate metadata for UI display
      const now = new Date();
      const todayET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const todayETDate = `${todayET.getFullYear()}-${String(todayET.getMonth() + 1).padStart(2, '0')}-${String(todayET.getDate()).padStart(2, '0')}`;
      const isStaleSlate = dataDate !== todayETDate && todayET.getHours() >= 5;

      // Find first pitch time from games
      const games3 = await getGamesForUI();
      const upcomingGames = games3.filter(g => g.status === 'Preview' || g.status === 'Scheduled');
      // Use gameDate (ISO) for firstPitchTime so the frontend can parse it correctly
      const firstPitchTime = upcomingGames.length > 0
        ? upcomingGames.sort((a, b) => new Date(a.gameDate).getTime() - new Date(b.gameDate).getTime())[0]?.gameDate ?? null
        : null;
      const confirmedCount = games3.filter(g => g.lineupSource === 'confirmed').length;
      const projectedCount = games3.filter(g => g.lineupSource === 'projected').length;

      // Compute enrichment status
      const enrichmentStatus = {
        lineups: (matchups.length > 0 ? 'ok' : 'pending') as 'ok' | 'pending' | 'failed',
        odds: ((enrichment3 as any).isWarm ? 'ok' : 'partial') as 'ok' | 'partial' | 'pending' | 'failed',
        statcast: ((enrichment3 as any).statcastCache?.data?.size > 0 ? 'ok' : 'partial') as 'ok' | 'partial' | 'failed',
        streaks: ((enrichment3 as any).mlbStreakMap?.size > 0 ? 'ok' : 'partial') as 'ok' | 'partial' | 'failed',
        dayNight: ((enrichment3 as any).dayNightSplitsMap?.size > 0 ? 'ok' : 'partial') as 'ok' | 'partial' | 'failed',
        bullpen: ((enrichment3 as any).bullpenFatigueMap?.size > 0 ? 'ok' : 'partial') as 'ok' | 'partial' | 'failed',
        isPartialEnrichment: !(enrichment3 as any).isWarm,
        lastUpdated: new Date().toISOString(),
      };

      // Compute topCandidates (top 3 near-miss picks that didn't make money picks)
      const moneyPickNames3 = new Set(moneyPicks3.map((p: any) => p.playerName));
      const topCandidates = enrichedPicks
        .filter(p => !moneyPickNames3.has(p.playerName))
        .slice(0, 3);

      // Compute bestAvailableScore
      const bestAvailableScore = enrichedPicks.length > 0 ? (enrichedPicks[0]?.overallScore ?? null) : null;

      // Compute emptySlateReasons
      const emptySlateReasons: string[] = [];
      if (moneyPicks3.length === 0) {
        if (enrichedPicks.length === 0) {
          emptySlateReasons.push('No matchups passed the VS quality gate today.');
        } else {
          const topScore = enrichedPicks[0]?.overallScore ?? 0;
          if (topScore < 68) {
            emptySlateReasons.push(`Best available score is ${topScore.toFixed(1)} — below the 68 minimum threshold.`);
          } else {
            emptySlateReasons.push(`Top candidate scored ${topScore.toFixed(1)} — no picks reached the 75%+ probability threshold.`);
          }
          const highPitcherCount = matrixPicks.filter((p: AIPick) => ((p as any).factors?.pitcherWeakness ?? 0) < 3).length;
          if (highPitcherCount > matrixPicks.length * 0.6) {
            emptySlateReasons.push('Strong pitching matchups across the slate are suppressing scores.');
          }
        }
      }

      return {
        success: true,
        picks: enrichedPicks,
        moneyPicks: moneyPicks3,
        lineupSource: lineupData.lineupSource,
        dataDate,
        timestamp: new Date(),
        hasOddsData: enrichedPicks.some(p => p.bookOdds !== null),
        // Slate metadata
        slateDate: todayETDate,
        isStaleSlate,
        firstPitchTime,
        oddsUpdatedAt: new Date(),
        confirmedGames: confirmedCount,
        projectedGames: projectedCount,
        totalGames: games3.length,
        // Phase AE: enrichment metadata
        enrichmentStatus,
        topCandidates,
        emptySlateReasons,
        bestAvailableScore,
      };
    } catch (error) {
      console.error("Error generating HRR picks:", error);
      const fallbackDate = await getDataDate();
      return {
        success: false,
        picks: [],
        dataDate: fallbackDate,
        error: "Failed to generate HRR picks",
        timestamp: new Date(),
        hasOddsData: false,
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

  /**
   * Get the full scoring matrix — all scored candidates before the quality gate.
   * Shows every player's 10-factor breakdown so you can see exactly why picks
   * were included or excluded.
   */
  getScoringMatrix: publicProcedure.query(async () => {
    try {
      const lineupData = await getAdaptedLineupData();
      const dataDate = await getDataDate();

      const enrichment = await getEnrichmentData(
        lineupData.matchups.map(m => ({
          playerId: m.playerId,
          playerName: m.playerName,
          team: m.team,
          gameTime: m.gameTime,
          pitcherId: m.pitcher.id ?? null,
          pitcherHand: m.pitcher.handedness ?? null,
        }))
      ).catch(() => ({
        vsGradeMap: new Map<string, number>(),
        gameTotalsMap: new Map(),
        dayNightSplitsMap: new Map(),
        mlbStreakMap: new Map(),
        statcastCache: { data: new Map(), byId: new Map(), fetchedAt: Date.now(), year: new Date().getFullYear() },
        bullpenFatigueMap: new Map(),
        fetchedAt: Date.now(),
        isWarm: false,
      }));
      const { vsGradeMap, gameTotalsMap, dayNightSplitsMap, mlbStreakMap, statcastCache, bullpenFatigueMap } = enrichment as any;

      const matchups = lineupData.matchups;
      const players = lineupData.playerDataMap;

      if (matchups.length === 0) {
        return { success: true, candidates: [], dataDate, timestamp: new Date(), totalCandidates: 0 };
      }

      const hrTargetsMap = getMockHRTargets();

      const allScoredPicks = rankAIPicks(
        matchups,
        players,
        hrTargetsMap,
        getMockParkFactors(),
        dayNightSplitsMap,
        mlbStreakMap,
        vsGradeMap,
        gameTotalsMap,
        statcastCache,
        undefined, // ballparkMatchups (legacy)
        bullpenFatigueMap ?? new Map()
      );

      // Build a lightweight matrix row for each pick
      const candidates = allScoredPicks.map((pick, idx) => ({
        rank: idx + 1,
        playerName: pick.playerName,
        team: pick.team,
        battingPosition: pick.battingPosition,
        pitcher: pick.pitcher,
        pitcherTeam: pick.pitcherTeam,
        overallScore: pick.overallScore,
        baseScore: pick.baseScore,
        bpBoost: pick.bpBoost,
        grade: pick.grade,
        vsGrade: pick.vsGrade ?? null,
        gameTotalOU: pick.gameTotalOU ?? null,
        projectedPA: pick.projectedPA ?? null,
        passesGate: pick.overallScore >= 75,
        factors: {
          teamImpliedRuns: pick.factorBreakdown.teamImpliedRuns,
          lineupSpot: pick.factorBreakdown.lineupSpot,
          obpXwOBA: pick.factorBreakdown.obpXwOBA,
          pitcherWeakness: pick.factorBreakdown.pitcherWeakness,
          recentForm: pick.factorBreakdown.recentForm,
          dayNightSplit: pick.factorBreakdown.dayNightSplit,
          parkWeather: pick.factorBreakdown.parkWeather,
          bullpenWeakness: pick.factorBreakdown.bullpenWeakness,
          platoonAdvantage: pick.factorBreakdown.platoonAdvantage,
          hardContactBarrel: pick.factorBreakdown.hardContactBarrel,
        },
        reasons: pick.reasons,
        riskFlags: pick.riskFlags,
      }));

      return {
        success: true,
        candidates,
        dataDate,
        timestamp: new Date(),
        totalCandidates: candidates.length,
        qualifiedCount: candidates.filter(c => c.passesGate).length,
        ballparkPalActive: false,
      };
    } catch (error) {
      console.error('Error generating scoring matrix:', error);
      const fallbackDate = await getDataDate();
      return {
        success: false,
        candidates: [],
        dataDate: fallbackDate,
        timestamp: new Date(),
        totalCandidates: 0,
        qualifiedCount: 0,
        ballparkPalActive: false,
        error: 'Failed to generate scoring matrix',
      };
    }
  }),

  /**
   * Get game log for a specific player on-demand (for expanded card view)
   * Returns last 7 games with H/R/RBI breakdown
   */
  getPlayerGameLog: publicProcedure
    .input((input: unknown) => {
      if (typeof input !== 'number') throw new Error('playerId must be a number');
      return input;
    })
    .query(async ({ input: playerId }) => {
      try {
        const { getPlayerStreak } = await import('../services/mlbStreakService');
        const streakData = await getPlayerStreak(playerId, 'hits');
        return {
          success: true,
          playerId,
          last5Games: streakData.last5Games,
          streakLength: streakData.streakLength,
          trendDirection: streakData.trendDirection,
          streakLabel: streakData.streakLabel,
          last5HitRate: streakData.last5HitRate,
          hasRealData: streakData.hasRealData,
        };
      } catch (error) {
        console.error('[getPlayerGameLog] Error:', error);
        return {
          success: false,
          playerId,
          last5Games: [],
          streakLength: 0,
          trendDirection: 'NEUTRAL' as const,
          streakLabel: '',
          last5HitRate: 0,
          hasRealData: false,
        };
      }
    }),

  /**
   * Get today's games with lineups for game cards UI
   * Returns real MLB schedule data with batting orders and probable pitchers
   */
  getTodaysGames: publicProcedure.query(async () => {
    try {
      const games = await getGamesForUI();
      const dataDate = await getDataDate();

      // Fetch game totals (O/U) from Odds API for display on game cards
      const teamMatchups = games.flatMap(g => [
        { batter: g.awayTeam.abbreviation, team: g.awayTeam.abbreviation },
        { batter: g.homeTeam.abbreviation, team: g.homeTeam.abbreviation },
      ]);
      const gameTotalsMap = await fetchGameTotals(process.env.ODDS_API_KEY, teamMatchups).catch(() => new Map());

      // Attach O/U and moneyline to each game
      const gamesWithOdds = games.map(g => {
        const awayData = gameTotalsMap.get(g.awayTeam.abbreviation);
        const homeData = gameTotalsMap.get(g.homeTeam.abbreviation);
        const overUnder = awayData?.overUnder ?? homeData?.overUnder ?? null;
        return {
          ...g,
          overUnder,
        };
      });

      return {
        success: true,
        games: gamesWithOdds,
        dataDate,
        timestamp: new Date(),
        lineupAvailable: games.some(g => g.homeLineup.length > 0 || g.awayLineup.length > 0),
      };
    } catch (error) {
      console.error("Error fetching today's games:", error);
      return {
        success: false,
        games: [] as MLBGame[],
        dataDate: new Date().toISOString().split('T')[0],
        timestamp: new Date(),
        lineupAvailable: false,
      };
    }
  }),
});
