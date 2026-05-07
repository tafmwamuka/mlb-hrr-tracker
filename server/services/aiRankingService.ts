/**
 * AI Ranking Service
 * Integrates all data sources to create comprehensive AI picks
 * Factors: RC, player stats, park factors, HR Targets, pitcher matchup, batting position
 */

interface PlayerData {
  playerId: number;
  name: string;
  team: string;
  position: string;
  battingPosition: number; // 1-9 in lineup
  handedness: 'R' | 'L' | 'S'; // Right, Left, Switch
  stats: {
    hits: number;
    runs: number;
    rbi: number;
    slg: number;
    avg: number;
    obp: number;
    power: number; // ISO (Isolated Power)
  };
  recentForm?: {
    last15Games: {
      hits: number;
      runs: number;
      rbi: number;
      avg: number;
    };
    trend: 'hot' | 'cold' | 'neutral'; // Based on last 15 vs season
  };
}

interface MatchupData {
  playerId: number;
  playerName: string;
  team: string;
  position: string;
  battingPosition: number;
  pitcher: {
    name: string;
    team: string;
    handedness: 'R' | 'L'; // RHP or LHP
    era: number;
    workload?: number; // Recent innings pitched
  };
  rc: number; // Runs Created from ballpark.com
  confidence: number; // 0-100
  platoonSplit?: {
    vsRHP: number; // Avg vs RHP
    vsLHP: number; // Avg vs LHP
  };
  weather?: {
    temperature: number; // Fahrenheit
    windSpeed: number; // MPH
    windDirection: string; // N, S, E, W, etc.
  };
}

interface HRTargetData {
  grade: string; // A+, A, B+, B, C+, C, D
  hrProbability: number; // 0-100
  threatScore: number; // Composite score
}

export interface AIPick {
  rank: number;
  playerId: number;
  playerName: string;
  team: string;
  position: string;
  battingPosition: number;
  pitcher: string;
  pitcherTeam: string; // Opposing pitcher's team (for game identification)
  statType: 'hits' | 'runs' | 'rbi' | 'slg';
  prediction: "over";
  line: number;
  confidence: number;
  statConfidence: { hits: number; runs: number; rbi: number; slg: number };
  reasoning: string;
  ballparkReasoning?: string; // Explicit ballpark-based reasoning
  factorBreakdown: {
    rc: number; // Runs Created score (0-100)
    playerStats: number; // Historical stats score (0-100)
    parkFactors: number; // Park factor score (0-100)
    hrTargets: number; // HR Targets grade score (0-100)
    pitcherMatchup: number; // Pitcher weakness score (0-100)
    battingPosition: number; // Position weighting (0-100)
  };
  overallScore: number; // Weighted average (0-100)
  // Savant metrics (combined source)
  savantMetrics?: {
    xwOBA: number;
    hardHitPct: number;
    exitVelocity: number;
    barrelPct: number;
    kPct: number;
    bbPct: number;
    xBA: number;
    xSLG: number;
    sprintSpeed: number;
    savantScore: number; // Combined Savant score (0-100)
    savantFactors: string[]; // Reasoning factors from Savant data
  };
  combinedScore?: number; // Ballpark RC + Savant combined score
}

/**
 * Calculate batting position weight
 * Higher weight for middle of lineup (4-6)
 */
function getBattingPositionWeight(position: number): number {
  const weights: Record<number, number> = {
    1: 60, // Lead-off
    2: 70, // 2-hole
    3: 80, // 3-hole
    4: 100, // Cleanup (max)
    5: 95, // 5-hole
    6: 90, // 6-hole
    7: 75, // 7-hole
    8: 65, // 8-hole
    9: 50, // Pitcher spot
  };
  return weights[position] || 50;
}

/**
 * Convert HR Targets grade to score (0-100)
 */
function gradeToScore(grade: string): number {
  const gradeScores: Record<string, number> = {
    "A+": 100,
    A: 95,
    "B+": 85,
    B: 75,
    "C+": 65,
    C: 55,
    D: 40,
  };
  return gradeScores[grade] || 50;
}

/**
 * Calculate RC score (0-100)
 * RC ranges from 0-50+ typically
 */
function rcToScore(rc: number): number {
  return Math.min(100, (rc / 40) * 100);
}

/**
 * Calculate player stats score (0-100)
 * Based on batting average, slugging %, power
 */
function playerStatsToScore(stats: PlayerData["stats"]): number {
  const avgScore = Math.min(100, (stats.avg / 0.350) * 100);
  const slgScore = Math.min(100, (stats.slg / 0.500) * 100);
  const powerScore = Math.min(100, (stats.power / 0.200) * 100);

  return (avgScore * 0.3 + slgScore * 0.4 + powerScore * 0.3);
}

/**
 * Calculate park factor score (0-100)
 * Parks with higher HR rates get higher scores
 */
function parkFactorToScore(parkFactor: number): number {
  // Park factor typically ranges from 0.8 to 1.2
  // 1.0 = neutral, >1.0 = hitter friendly
  return Math.min(100, ((parkFactor - 0.8) / 0.4) * 100);
}

/**
 * Calculate pitcher matchup score (0-100)
 * Based on pitcher weakness and zone overlap
 */
function pitcherMatchupToScore(confidence: number): number {
  return confidence; // Already 0-100 from ballpark.com
}

/**
 * Rank AI picks using comprehensive algorithm
 */
export function rankAIPicks(
  matchups: MatchupData[],
  playerDataMap: Map<number, PlayerData>,
  hrTargetsMap: Map<string, HRTargetData>,
  parkFactors: Map<string, number>
): AIPick[] {
  const picks = matchups
    .map((matchup) => {
      const playerData = playerDataMap.get(matchup.playerId);
      const hrTargets = hrTargetsMap.get(matchup.playerName);
      const parkFactor = parkFactors.get(matchup.team) || 1.0;

      if (!playerData) return null;

      // Calculate factor scores
      const rcScore = rcToScore(matchup.rc);
      const playerStatsScore = playerStatsToScore(playerData.stats);
      const parkFactorScore = parkFactorToScore(parkFactor);
      const pitcherMatchupScore = pitcherMatchupToScore(matchup.confidence);
      const battingPositionScore = getBattingPositionWeight(matchup.battingPosition);
      const hrTargetsScore = hrTargets ? gradeToScore(hrTargets.grade) : 50;

      // Calculate weighted overall score
      const overallScore =
        rcScore * 0.20 +
        playerStatsScore * 0.20 +
        parkFactorScore * 0.15 +
        hrTargetsScore * 0.20 +
        pitcherMatchupScore * 0.15 +
        battingPositionScore * 0.10;

      // Generate reasoning
      const reasons: string[] = [];
      if (rcScore > 80) reasons.push("High RC vs this pitcher");
      if (playerStatsScore > 80) reasons.push("Strong season stats");
      if (parkFactorScore > 70) reasons.push("Hitter-friendly park");
      if (hrTargetsScore > 85) reasons.push("Top HR threat");
      if (pitcherMatchupScore > 75) reasons.push("Favorable matchup");
      if (battingPositionScore > 85) reasons.push("High in lineup");

      const reasoning = reasons.join(" • ");

      // Build ballpark-specific reasoning
      const parkFactorValue = parkFactorScore > 70 ? "hitter-friendly" : parkFactorScore < 50 ? "pitcher-friendly" : "neutral";
      const ballparkReasoning = `Playing at ${parkFactorValue} park. RC ranking: ${Math.round(matchup.rc)}/100. ${matchup.weather ? `Weather: ${matchup.weather.temperature}°F, ${matchup.weather.windSpeed}mph ${matchup.weather.windDirection}` : ""}`;

      // Determine best stat type based on player data (H/R/RBI only - no Slg %)
      const stats = playerData.stats;
      const statScores = {
        hits: (stats.hits / 50) * 100,
        runs: (stats.runs / 40) * 100,
        rbi: (stats.rbi / 80) * 100,
      };
      const bestStat = Object.entries(statScores).reduce((a, b) => (a[1] > b[1] ? a : b))[0] as 'hits' | 'runs' | 'rbi';

      // Calculate realistic prop line based on season average and park factor
      // Standard MLB prop lines are typically: Hits 3.5, Runs 2.5, RBI 3.5
      const calculateRealisticLine = (stat: 'hits' | 'runs' | 'rbi', value: number, parkFactor: number): number => {
        // Calculate per-game average from season totals
        // Assuming ~40 games played so far in season (early-mid season)
        const gamesPlayed = 40;
        const perGameAvg = value / gamesPlayed;
        
        // Real sportsbook lines are set slightly below the player's average
        // to create balanced action. Common lines:
        // Hits: 0.5, 1.5, 2.5 (most players 1.5)
        // Runs: 0.5, 1.5 (most players 0.5)
        // RBI: 0.5, 1.5 (most players 0.5)
        let line: number;
        
        if (stat === 'hits') {
          // Avg hits per game: ~1.0-1.5 for good hitters
          if (perGameAvg >= 1.5) line = 1.5;
          else if (perGameAvg >= 1.0) line = 1.5;
          else line = 0.5;
        } else if (stat === 'runs') {
          // Avg runs per game: ~0.5-0.8 for good hitters
          if (perGameAvg >= 0.9) line = 1.5;
          else line = 0.5;
        } else {
          // RBI: Avg per game ~0.5-0.7 for good hitters, elite ~0.8+
          if (perGameAvg >= 0.9) line = 1.5;
          else line = 0.5;
        }
        
        // Park factor can bump up the line for hitter-friendly parks
        if (parkFactor > 1.1 && line === 0.5) {
          line = 1.5;
        }
        
        return line;
      };

      const adjustedParkFactor = parkFactorScore / 100;
      const line = calculateRealisticLine(bestStat, stats[bestStat], adjustedParkFactor);

      return {
        rank: 0,
        playerId: matchup.playerId,
        playerName: matchup.playerName,
        team: matchup.team,
        position: matchup.position,
        battingPosition: matchup.battingPosition,
        pitcher: matchup.pitcher.name,
        pitcherTeam: matchup.pitcher.team,
        statType: bestStat as 'hits' | 'runs' | 'rbi' | 'slg',
        statConfidence: {
          hits: Math.round(Math.min(100, (stats.hits / 50) * 100 * (overallScore / 100))),
          runs: Math.round(Math.min(100, (stats.runs / 40) * 100 * (overallScore / 100))),
          rbi: Math.round(Math.min(100, (stats.rbi / 80) * 100 * (overallScore / 100))),
          slg: Math.round(Math.min(100, (stats.slg / 0.500) * 100 * (overallScore / 100))),
        },
        prediction: "over" as const,
        line,
        confidence: Math.round(overallScore),
        reasoning,
        ballparkReasoning,
        factorBreakdown: {
          rc: Math.round(rcScore),
          playerStats: Math.round(playerStatsScore),
          parkFactors: Math.round(parkFactorScore),
          hrTargets: Math.round(hrTargetsScore),
          pitcherMatchup: Math.round(pitcherMatchupScore),
          battingPosition: Math.round(battingPositionScore),
        },
        overallScore: Math.round(overallScore),
      } as AIPick;
    })
    .filter((pick): pick is AIPick => pick !== null)
    .sort((a, b) => b.overallScore - a.overallScore)
    .map((pick, index) => ({
      ...pick,
      rank: index + 1,
    }))
    .slice(0, 20); // Top 20 picks for All Plays variety

  return picks;
}

/**
 * Mock HR Targets data for development
 */
export function getMockHRTargets(): Map<string, HRTargetData> {
  const data = new Map<string, HRTargetData>();
  data.set("Juan Soto", { grade: "A+", hrProbability: 92, threatScore: 95 });
  data.set("Aaron Judge", { grade: "A+", hrProbability: 90, threatScore: 94 });
  data.set("B. Buxton", { grade: "A", hrProbability: 85, threatScore: 88 });
  data.set("J. Soto", { grade: "A+", hrProbability: 92, threatScore: 95 });
  data.set("C. Raleigh", { grade: "B+", hrProbability: 78, threatScore: 80 });
  return data;
}

/**
 * Mock park factors
 */
export function getMockParkFactors(): Map<string, number> {
  const factors = new Map<string, number>();
  factors.set("NYY", 1.15); // Yankee Stadium - hitter friendly
  factors.set("BOS", 1.12); // Fenway - hitter friendly
  factors.set("TB", 0.88); // Tropicana - pitcher friendly
  factors.set("KC", 0.95); // Kauffman - neutral
  factors.set("MIN", 1.05); // Target Field - slightly hitter friendly
  factors.set("CWS", 0.92); // Guaranteed Rate - pitcher friendly
  factors.set("DET", 1.08); // Comerica - hitter friendly
  factors.set("SEA", 0.90); // T-Mobile - pitcher friendly
  factors.set("LAA", 1.02); // Angel Stadium - neutral
  factors.set("OAK", 0.93); // Oakland Coliseum - pitcher friendly
  return factors;
}
