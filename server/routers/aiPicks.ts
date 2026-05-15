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
import { findMatchupForPlayer } from "../services/ballparkMatchupService";
import { getEnrichmentData } from "../services/enrichmentCache";

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

// ─── BallparkPal real data helpers ──────────────────────────────────────────

/**
 * Build MatchupData objects from ballparkpal starters.
 * Used when official lineups haven't been posted yet (pre-11am ET).
 * Creates synthetic matchup entries from ballparkpal's starter list so
 * all three pick procedures can generate picks using real vsGrade/RC/HR% data.
 */
function buildMatchupsFromBallparkPal(
  ballparkMatchups: import('../services/ballparkMatchupService').BallparkMatchup[]
): { matchups: import('../services/lineupAdapter').MatchupData[], playerDataMap: Map<number, import('../services/aiRankingService').PlayerData> } {
  // Only use starters with meaningful RC (>= 5)
  const starters = ballparkMatchups.filter(bp => bp.starter && bp.rc >= 5);
  if (starters.length === 0) return { matchups: [], playerDataMap: new Map() };

  const matchups: import('../services/lineupAdapter').MatchupData[] = [];
  const playerDataMap = new Map<number, import('../services/aiRankingService').PlayerData>();

  // Use a synthetic playerId based on index (negative to avoid collision with real IDs)
  starters.forEach((bp, idx) => {
    const syntheticId = -(idx + 1);
    const avgEst = 0.250;
    const obpEst = 0.320;
    const slgEst = 0.400;

    matchups.push({
      playerId: syntheticId,
      playerName: bp.batter,
      team: bp.team,
      position: 'DH',
      battingPosition: 5, // middle of order default
      pitcher: {
        id: null,
        name: bp.pitcher,
        team: '',
        handedness: (bp.throws as 'R' | 'L') || 'R',
        era: 4.00,
      },
      rc: bp.rc,
      confidence: 70,
      gameTime: undefined,
    });

    playerDataMap.set(syntheticId, {
      playerId: syntheticId,
      name: bp.batter,
      team: bp.team,
      position: 'DH',
      battingPosition: 5,
      handedness: (bp.bats as 'R' | 'L' | 'S') || 'R',
      stats: {
        hits: 30,
        runs: 20,
        rbi: 20,
        slg: slgEst,
        avg: avgEst,
        obp: obpEst,
        power: slgEst - avgEst,
      },
      recentForm: {
        last15Games: { hits: 15, runs: 10, rbi: 10, avg: avgEst },
        trend: 'neutral',
      },
    });
  });

  return { matchups, playerDataMap };
}

/**
 * Build a real HR Targets map from ballparkpal hrProb values.
 * Converts hrProb (0-100 %) to grade + threatScore for the ranking matrix.
 * Grade scale: A+ (>=5.5%), A (>=4.5%), B+ (>=3.5%), B (>=2.5%), C+ (>=1.5%), C (>=0.5%), D (<0.5%)
 */
function buildRealHRTargetsMap(
  playerNames: string[],
  ballparkMatchups: import('../services/ballparkMatchupService').BallparkMatchup[]
): Map<string, { grade: string; hrProbability: number; threatScore: number }> {
  const map = new Map<string, { grade: string; hrProbability: number; threatScore: number }>();
  if (ballparkMatchups.length === 0) return map;

  for (const name of playerNames) {
    const bpMatch = findMatchupForPlayer(name, '', ballparkMatchups);
    if (!bpMatch) continue;
    const hrProb = bpMatch.hrProb; // e.g. 4.5 = 4.5%
    let grade: string;
    if (hrProb >= 5.5) grade = 'A+';
    else if (hrProb >= 4.5) grade = 'A';
    else if (hrProb >= 3.5) grade = 'B+';
    else if (hrProb >= 2.5) grade = 'B';
    else if (hrProb >= 1.5) grade = 'C+';
    else if (hrProb >= 0.5) grade = 'C';
    else grade = 'D';
    // threatScore: normalize hrProb to 0-100 (cap at 8% = 100)
    const threatScore = Math.min(100, Math.round((hrProb / 8) * 100));
    map.set(name, { grade, hrProbability: Math.round(hrProb * 10), threatScore });
  }
  return map;
}

/**
 * Enrich matchups with real ballparkpal RC values.
 * If a player is found in ballparkpal, replace the estimated RC with the real value.
 */
function enrichMatchupsWithBallparkRC<T extends { playerName: string; team: string; rc: number }>(
  matchups: T[],
  ballparkMatchups: import('../services/ballparkMatchupService').BallparkMatchup[]
): T[] {
  if (ballparkMatchups.length === 0) return matchups;
  return matchups.map(m => {
    const bpMatch = findMatchupForPlayer(m.playerName, m.team, ballparkMatchups);
    if (!bpMatch) return m;
    return { ...m, rc: bpMatch.rc };
  });
}

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

      // Get enrichment data early so we can use ballparkpal starters as fallback
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
        ballparkMatchups: [] as import('../services/ballparkMatchupService').BallparkMatchup[],
        fetchedAt: Date.now(),
        isWarm: false,
      }));
      const { vsGradeMap, gameTotalsMap, dayNightSplitsMap, mlbStreakMap, statcastCache, ballparkMatchups, bullpenFatigueMap } = enrichment as any;

      // If official lineup is sparse (<50 players) but ballparkpal has starters, use ballparkpal
      let matchups = lineupData.matchups;
      let players = lineupData.playerDataMap;
      let lineupsPending = false;

      if (matchups.length < 50 && ballparkMatchups.length > 0) {
        const bpData = buildMatchupsFromBallparkPal(ballparkMatchups);
        if (bpData.matchups.length > 0) {
          // Merge: real lineup players take priority, supplement with ballparkpal starters
          const realNames = new Set(matchups.map(m => m.playerName));
          const bpOnly = bpData.matchups.filter(m => !realNames.has(m.playerName));
          matchups = [...matchups, ...bpOnly];
          for (const [id, pd] of Array.from(bpData.playerDataMap.entries())) {
            if (!players.has(id)) players.set(id, pd);
          }
          lineupsPending = matchups.length < 50; // still pending if very few players
        }
      }

      if (matchups.length === 0) {
        return {
          success: true,
          picks: [],
          lineupsPending: true,
          dataDate,
          timestamp: new Date(),
        };
      }

      // Use real ballparkpal HR% data if available, fall back to mock
      const hrTargetsMap = ballparkMatchups.length > 0
        ? buildRealHRTargetsMap(matchups.map(m => m.playerName), ballparkMatchups)
        : getMockHRTargets();

      // Enrich matchup RC values with real ballparkpal RC
      const enrichedMatchups = enrichMatchupsWithBallparkRC(matchups, ballparkMatchups);

      const allPicks = rankAIPicks(
        enrichedMatchups,
        players,
        hrTargetsMap,
        getMockParkFactors(),
        dayNightSplitsMap,
        mlbStreakMap,
        vsGradeMap,
        gameTotalsMap,
        statcastCache,
        ballparkMatchups.length > 0, // hasBallparkPalData
        ballparkMatchups, // raw BP matchups for kProb/hrProb
        bullpenFatigueMap ?? new Map() // S3: bullpen fatigue
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

      // Get enrichment data early so we can use ballparkpal starters as fallback
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
        ballparkMatchups: [] as import('../services/ballparkMatchupService').BallparkMatchup[],
        fetchedAt: Date.now(),
        isWarm: false,
      }));
      const { vsGradeMap, gameTotalsMap, dayNightSplitsMap, mlbStreakMap, statcastCache: statcastCache2, ballparkMatchups: bpMatchups2, bullpenFatigueMap: bullpenFatigueMap2 } = enrichment2 as any;

      // If official lineup is sparse (<50 players) but ballparkpal has starters, supplement
      let matchups = lineupData.matchups;
      let players = lineupData.playerDataMap;

      if (matchups.length < 50 && bpMatchups2.length > 0) {
        const bpData2 = buildMatchupsFromBallparkPal(bpMatchups2);
        if (bpData2.matchups.length > 0) {
          const realNames2 = new Set(matchups.map(m => m.playerName));
          const bpOnly2 = bpData2.matchups.filter(m => !realNames2.has(m.playerName));
          matchups = [...matchups, ...bpOnly2];
          for (const [id, pd] of Array.from(bpData2.playerDataMap.entries())) {
            if (!players.has(id)) players.set(id, pd);
          }
        }
      }

      if (matchups.length === 0) {
        return {
          success: true,
          picks: [],
          lineupsPending: true,
          dataDate,
          timestamp: new Date(),
        };
      }

      // Use real ballparkpal HR% data if available, fall back to mock
      const hrTargetsMap2 = bpMatchups2.length > 0
        ? buildRealHRTargetsMap(matchups.map(m => m.playerName), bpMatchups2)
        : getMockHRTargets();

      // Enrich matchup RC values with real ballparkpal RC
      const enrichedMatchups2 = enrichMatchupsWithBallparkRC(matchups, bpMatchups2);

      const picks = rankAIPicks(
        enrichedMatchups2,
        players,
        hrTargetsMap2,
        getMockParkFactors(),
        dayNightSplitsMap,
        mlbStreakMap,
        vsGradeMap,
        gameTotalsMap,
        statcastCache2,
        bpMatchups2.length > 0, // hasBallparkPalData
        bpMatchups2, // raw BP matchups for kProb/hrProb
        bullpenFatigueMap2 ?? new Map() // S3: bullpen fatigue
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

      // Get enrichment data early so we can use ballparkpal starters as fallback
      const enrichment3 = await getEnrichmentData(
        lineupData.matchups.map(m => ({ playerId: m.playerId, playerName: m.playerName, team: m.team, gameTime: m.gameTime, pitcherId: m.pitcher.id ?? null, pitcherHand: m.pitcher.handedness ?? null }))
      ).catch(() => ({
        vsGradeMap: new Map<string, number>(),
        gameTotalsMap: new Map(),
        dayNightSplitsMap: new Map(),
        mlbStreakMap: new Map(),
        statcastCache: { data: new Map(), byId: new Map(), fetchedAt: Date.now(), year: new Date().getFullYear() },
        ballparkMatchups: [] as import('../services/ballparkMatchupService').BallparkMatchup[],
        fetchedAt: Date.now(),
        isWarm: false,
      }));
      const { vsGradeMap, gameTotalsMap: _gameTotalsMap3, dayNightSplitsMap, mlbStreakMap, statcastCache: statcastCache3, ballparkMatchups: bpMatchups3, bullpenFatigueMap: bullpenFatigueMap3 } = enrichment3 as any;

      // If official lineup is sparse (<50 players) but ballparkpal has starters, supplement
      let matchups = lineupData.matchups;
      let players = lineupData.playerDataMap;

      if (matchups.length < 50 && bpMatchups3.length > 0) {
        const bpData3 = buildMatchupsFromBallparkPal(bpMatchups3);
        if (bpData3.matchups.length > 0) {
          const realNames3 = new Set(matchups.map(m => m.playerName));
          const bpOnly3 = bpData3.matchups.filter(m => !realNames3.has(m.playerName));
          matchups = [...matchups, ...bpOnly3];
          for (const [id, pd] of Array.from(bpData3.playerDataMap.entries())) {
            if (!players.has(id)) players.set(id, pd);
          }
        }
      }

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
      // Adaptive two-stage VS gate (same logic as rankAIPicks):
      //   hasBallparkPalData=true  (real ballparkpal): STRONG>=9.5, MODERATE>=8.5
      //   hasBallparkPalData=false (mlbMatchupService fallback): STRONG>=7.0, MODERATE>=5.5
      const hrrHasBallparkPalData = bpMatchups3.length > 0;
      const HRR_STRONG_THRESHOLD = hrrHasBallparkPalData ? 9.5 : 7.0;
      const HRR_MODERATE_THRESHOLD = hrrHasBallparkPalData ? 8.5 : 5.5;
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

      console.log(`[HRR] VS Gate (${hrrHasBallparkPalData ? 'ballparkpal' : 'mlbMatchup'} mode, STRONG>=${HRR_STRONG_THRESHOLD}, MOD>=${HRR_MODERATE_THRESHOLD}): ${matchups.length} → ${gatedMatchups.length} matchups passed`);

      // ── STAGE 1: Run the 10-factor scoring matrix on all VS-gated players ──────
      // Every pick on every tab must pass through rankAIPicks first.
      const { gameTotalsMap } = enrichment3;

      // Use real ballparkpal HR% data if available, fall back to mock
      const hrTargetsMap3 = bpMatchups3.length > 0
        ? buildRealHRTargetsMap(gatedMatchups.map(m => m.playerName), bpMatchups3)
        : getMockHRTargets();

      // Enrich matchup RC values with real ballparkpal RC
      const enrichedGatedMatchups = enrichMatchupsWithBallparkRC(gatedMatchups, bpMatchups3);

      const matrixPicks = rankAIPicks(
        enrichedGatedMatchups,
        players,
        hrTargetsMap3,
        parkFactors,
        dayNightSplitsMap,
        mlbStreakMap,
        vsGradeMap,
        gameTotalsMap,
        statcastCache3,
        bpMatchups3.length > 0, // hasBallparkPalData
        bpMatchups3, // raw BP matchups for kProb/hrProb
        bullpenFatigueMap3 ?? new Map() // S3: bullpen fatigue
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

      return {
        success: true,
        picks: enrichedPicks,
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
        ballparkMatchups: [] as import('../services/ballparkMatchupService').BallparkMatchup[],
        fetchedAt: Date.now(),
        isWarm: false,
      }));
      const { vsGradeMap, gameTotalsMap, dayNightSplitsMap, mlbStreakMap, statcastCache, ballparkMatchups, bullpenFatigueMap } = enrichment as any;

      let matchups = lineupData.matchups;
      let players = lineupData.playerDataMap;

      if (matchups.length < 50 && ballparkMatchups.length > 0) {
        const bpData = buildMatchupsFromBallparkPal(ballparkMatchups);
        if (bpData.matchups.length > 0) {
          const realNames = new Set(matchups.map((m: any) => m.playerName));
          const bpOnly = bpData.matchups.filter((m: any) => !realNames.has(m.playerName));
          matchups = [...matchups, ...bpOnly];
          for (const [id, pd] of Array.from(bpData.playerDataMap.entries())) {
            if (!players.has(id)) players.set(id, pd);
          }
        }
      }

      if (matchups.length === 0) {
        return { success: true, candidates: [], dataDate, timestamp: new Date(), totalCandidates: 0 };
      }

      const hrTargetsMap = ballparkMatchups.length > 0
        ? buildRealHRTargetsMap(matchups.map((m: any) => m.playerName), ballparkMatchups)
        : getMockHRTargets();

      const enrichedMatchups = enrichMatchupsWithBallparkRC(matchups, ballparkMatchups);

      // Run the full scoring model — rankAIPicks applies the quality gate internally.
      // We need ALL scored candidates, so we call the scoring logic directly.
      // rankAIPicks returns only quality-gated picks; to get all candidates we
      // call it and also capture the full unsorted list by temporarily lowering
      // the threshold to 0 via a separate call.
      // Strategy: call rankAIPicks with all data, it returns quality-gated picks.
      // For the full matrix we want ALL scored players (even those below 75).
      // We expose the full scored list by running the same pipeline but returning
      // all picks sorted by score before the quality gate.
      const allScoredPicks = rankAIPicks(
        enrichedMatchups,
        players,
        hrTargetsMap,
        getMockParkFactors(),
        dayNightSplitsMap,
        mlbStreakMap,
        vsGradeMap,
        gameTotalsMap,
        statcastCache,
        ballparkMatchups.length > 0,
        ballparkMatchups,
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
        ballparkPalActive: ballparkMatchups.length > 0,
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
