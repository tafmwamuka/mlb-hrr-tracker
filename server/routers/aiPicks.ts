/**
 * AI Picks Router
 * Comprehensive AI picks using all data sources
 */

import { router, publicProcedure } from "../_core/trpc";
import { rankAIPicks, getMockHRTargets, getMockParkFactors } from "../services/aiRankingService";
import type { AIPick } from "../services/aiRankingService";
import { batchGetDayNightSplits } from "../services/dayNightSplitService";
import { batchGetTheLabData } from "../services/theLabService";
import { batchGetPlayerStreaks } from "../services/mlbStreakService";
import { getMockSavantData, calculateCombinedScore, type SavantHitter, type SavantPitcher } from "../services/savantService";
import { generateHRRProjections } from "../services/hrrService";
import { fetchHRRMarketData, getBestHRRLine, americanToImpliedProbability, removeVig } from "../services/oddsApiService";
import { poissonOverProbability, calculateAlternateLines, findFairLine, calculateEdge, getPickQuality } from "../services/poissonModel";
import { getAdaptedLineupData, getGamesForUI } from "../services/lineupAdapter";
import { getDataDate, type MLBGame } from "../services/mlbLineupService";
import { getVSGatedPool, findMatchupForPlayer } from "../services/ballparkMatchupService";
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
    
    // Combined score: 50% ballpark RC + 50% Savant
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
      if (lineupData.matchups.length === 0) {
        return {
          success: true,
          picks: [],
          lineupsPending: true,
          dataDate,
          timestamp: new Date(),
        };
      }
      const matchups = lineupData.matchups;
      const players = lineupData.playerDataMap;

      // Fetch VS gate data + game totals + enrichment data in parallel
      const season = new Date().getFullYear();
      const oddsApiKey = process.env.ODDS_API_KEY;
      const [vsGateResult, dayNightSplitsMap, theLabDataMap, mlbStreakMap] = await Promise.all([
        getVSGatedPool().catch(() => ({ pool: [], gameTotals: new Map(), allMatchups: [] })),
        batchGetDayNightSplits(
          matchups.map(m => ({ playerId: m.playerId, gameTimeUtc: m.gameTime })),
          'hits',
          season
        ).catch(() => new Map()),
        batchGetTheLabData(
          matchups.map(m => ({ playerName: m.playerName, teamAbbr: m.team, statType: 'hits' as const })),
          dataDate
        ).catch(() => new Map()),
        batchGetPlayerStreaks(
          matchups.map(m => ({ playerId: m.playerId, playerName: m.playerName })),
          season
        ).catch(() => new Map()),
      ]);

      // Build VS grade map: playerName -> vsGrade
      const vsGradeMap = new Map<string, number>();
      for (const m of vsGateResult.allMatchups) {
        if (m.vsGrade !== undefined) vsGradeMap.set(m.batter, m.vsGrade);
      }

      // Fetch game totals (Odds API primary, RC aggregate fallback)
      const gameTotalsMap = await fetchGameTotals(oddsApiKey, vsGateResult.allMatchups).catch(() => new Map());

      const allPicks = rankAIPicks(
        matchups,
        players,
        getMockHRTargets(),
        getMockParkFactors(),
        dayNightSplitsMap,
        theLabDataMap,
        mlbStreakMap,
        vsGradeMap,
        gameTotalsMap
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
        .slice(0, 5)
        .map((pick, idx) => ({ ...pick, rank: idx + 1 }));
      
      return {
        success: true,
        picks: topPicks,
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
      if (lineupData.matchups.length === 0) {
        return {
          success: true,
          picks: [],
          lineupsPending: true,
          dataDate,
          timestamp: new Date(),
        };
      }
      const matchups = lineupData.matchups;
      const players = lineupData.playerDataMap;

      // Fetch VS gate data + game totals + enrichment data in parallel (non-blocking)
      const season = new Date().getFullYear();
      const oddsApiKey = process.env.ODDS_API_KEY;
      const [vsGateResult, dayNightSplitsMap, theLabDataMap, mlbStreakMap] = await Promise.all([
        getVSGatedPool().catch(() => ({ pool: [], gameTotals: new Map(), allMatchups: [] })),
        batchGetDayNightSplits(
          matchups.map(m => ({ playerId: m.playerId, gameTimeUtc: m.gameTime })),
          'hits',
          season
        ).catch(() => new Map()),
        batchGetTheLabData(
          matchups.map(m => ({ playerName: m.playerName, teamAbbr: m.team, statType: 'hits' as const })),
          dataDate
        ).catch(() => new Map()),
        batchGetPlayerStreaks(
          matchups.map(m => ({ playerId: m.playerId, playerName: m.playerName }))
        ).catch(() => new Map()),
      ]);

      // Build VS grade map: playerName -> vsGrade
      const vsGradeMap = new Map<string, number>();
      for (const m of vsGateResult.allMatchups) {
        if (m.vsGrade !== undefined) vsGradeMap.set(m.batter, m.vsGrade);
      }

      // Fetch game totals (Odds API primary, RC aggregate fallback)
      const gameTotalsMap = await fetchGameTotals(oddsApiKey, vsGateResult.allMatchups).catch(() => new Map());

      const picks = rankAIPicks(
        matchups,
        players,
        getMockHRTargets(),
        getMockParkFactors(),
        dayNightSplitsMap,
        theLabDataMap,
        mlbStreakMap,
        vsGradeMap,
        gameTotalsMap
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
      if (lineupData.matchups.length === 0) {
        return {
          success: true,
          picks: [],
          lineupsPending: true,
          dataDate,
          timestamp: new Date(),
          hasOddsData: false,
        };
      }
      const matchups = lineupData.matchups;
      const players = lineupData.playerDataMap;

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
      
      // Fetch VS gate data + enrichment data in parallel
      const season = new Date().getFullYear();
      const oddsApiKey = process.env.ODDS_API_KEY;
      const [vsGateResult, dayNightSplitsMap, theLabDataMap, mlbStreakMap] = await Promise.all([
        getVSGatedPool().catch(() => ({ pool: [], gameTotals: new Map(), allMatchups: [] })),
        batchGetDayNightSplits(
          matchups.map(m => ({ playerId: m.playerId, gameTimeUtc: m.gameTime })),
          'hits',
          season
        ).catch(() => new Map()),
        batchGetTheLabData(
          matchups.map(m => ({ playerName: m.playerName, teamAbbr: m.team, statType: 'hits' as const })),
          dataDate
        ).catch(() => new Map()),
        batchGetPlayerStreaks(
          matchups.map(m => ({ playerId: m.playerId, playerName: m.playerName }))
        ).catch(() => new Map()),
      ]);

      // Build VS grade map for HRR gate filtering
      const vsGradeMap = new Map<string, number>();
      for (const m of vsGateResult.allMatchups) {
        if (m.vsGrade !== undefined) vsGradeMap.set(m.batter, m.vsGrade);
      }

      // Fetch game totals (Odds API primary, RC aggregate fallback)
      const gameTotalsMap = await fetchGameTotals(oddsApiKey, vsGateResult.allMatchups).catch(() => new Map());

      // Filter matchups through VS gate before HRR projections
      // VS=10: always included; VS=9: included (all go through scoring matrix)
      // If no VS data available, use all matchups (graceful degradation)
      const gatedMatchups = vsGradeMap.size > 0
        ? matchups.filter(m => {
            const vsGrade = vsGradeMap.get(m.playerName) ?? vsGradeMap.get(m.playerName.split(' ').pop() || '') ?? null;
            if (vsGrade === null) return true; // No data: include
            return vsGrade >= 9; // Only VS=9+ for HRR
          })
        : matchups;

      console.log(`[HRR] VS Gate: ${matchups.length} → ${gatedMatchups.length} matchups passed`);

      // Generate HRR projections using real player stats + splits + streak
      const projections = generateHRRProjections(
        gatedMatchups,
        players,
        parkFactors,
        savantMap,
        dayNightSplitsMap,
        theLabDataMap,
        mlbStreakMap
      );

      // Enrich projections with Poisson probabilities.
      // Odds come from theLAB mismatch board (already in theLabDataMap per player).
      // The Odds API is no longer used (credits exhausted).
      const enrichedPicks = projections.map((proj) => {
        // Lambda = expected HRR total per game (from our model)
        const lambda = proj.expectedTotal;
        const activeLine = proj.hrrLine;

        // Pull theLAB odds for this player if available
        const theLabData = theLabDataMap.get(proj.playerName);
        const theLabOdds = theLabData?.odds ?? null;
        const theLabOddsProvider = theLabData?.oddsProvider ?? null;

        // Calculate Poisson probability of going OVER the active line
        const modelOverProb = poissonOverProbability(activeLine, lambda);

        // Edge vs implied probability from theLAB odds (if available)
        let bookImpliedProb = 0.5;
        if (theLabOdds !== null) {
          bookImpliedProb = americanToImpliedProbability(theLabOdds);
        }
        const edge = calculateEdge(modelOverProb, bookImpliedProb);
        const pickQuality = getPickQuality(edge);

        // Generate alternate lines with probabilities
        const alternates = calculateAlternateLines(lambda, 5.5);

        // Find the fair line (closest to 50/50)
        const fairLine = findFairLine(lambda);

        return {
          ...proj,
          hrrLine: activeLine,
          lineSource: theLabOdds !== null ? "thelab" as const : "model" as const,
          // Poisson-based probabilities
          overProbability: Math.round(modelOverProb * 100),
          // Edge vs book
          edge: Math.round(edge * 100), // as percentage points
          pickQuality,
          bookOdds: theLabOdds,
          bookOddsProvider: theLabOddsProvider,
          bookImpliedProb: theLabOdds !== null ? Math.round(bookImpliedProb * 100) : null,
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

      // Re-sort by: picks with edge > 0 first, then by overProbability
      enrichedPicks.sort((a, b) => {
        // Primary: pick quality (strong > moderate > lean > avoid)
        const qualityOrder: Record<string, number> = { strong: 4, moderate: 3, lean: 2, avoid: 1 };
        const qDiff = (qualityOrder[b.pickQuality] ?? 0) - (qualityOrder[a.pickQuality] ?? 0);
        if (qDiff !== 0) return qDiff;
        // Secondary: over probability
        return b.overProbability - a.overProbability;
      });

      return {
        success: true,
        picks: enrichedPicks,
        dataDate,
        timestamp: new Date(),
        hasOddsData: enrichedPicks.some(p => p.bookOdds !== null),
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
   * Get today's games with lineups for game cards UI
   * Returns real MLB schedule data with batting orders and probable pitchers
   */
  getTodaysGames: publicProcedure.query(async () => {
    try {
      const games = await getGamesForUI();
      const dataDate = await getDataDate();
      return {
        success: true,
        games,
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
