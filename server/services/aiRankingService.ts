/**
 * AI Ranking Service
 * Integrates all data sources to create comprehensive AI picks
 * Factors: RC, player stats, park factors, HR Targets, pitcher matchup, batting position,
 *          day/night splits, theLAB edge/streak, dynamic count (quality over quantity)
 */

import type { PlayerDayNightSplits } from "./dayNightSplitService";
import type { TheLabPlayerData } from "./theLabService";
import type { PlayerStreakData } from "./mlbStreakService";

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
  gameTime?: string; // ISO string of game start time
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
    dayNightSplit?: number; // Day/night split score (0-100)
    streakBonus?: number; // Streak/hot hand bonus (0-100)
    theLabEdge?: number; // theLAB edge score (0-100)
  };
  overallScore: number; // Weighted average (0-100)
  // Day/night split data
  dayNightSplit?: {
    gameTimeType: 'day' | 'night';
    splitAvg: number;
    splitOPS: number;
    splitHits: number;
    splitGames: number;
    splitBoost: number; // +/- vs season avg (percentage points)
    favorable: boolean;
  };
  // Streak/hot hand data
  streakInfo?: {
    isOnStreak: boolean;
    streakLength: number; // consecutive games with hit
    streakType: 'hot' | 'cold' | 'neutral';
    last5HitRate: number; // 0-100
    last10HitRate: number; // 0-100
    trendDirection: 'up' | 'down' | 'stable';
    streakLabel?: string; // e.g. "🔥 HOT (5-game hit streak)"
  };
  // theLAB edge data
  theLabEdge?: {
    edgeScore: number; // 0-100
    strongHitCandidate: boolean;
    last5HitRate: number;
    odds?: string; // e.g. "-115"
    provider?: string; // e.g. "DraftKings"
    line?: number;
  };
  // Odds data
  odds?: {
    line: number;
    overOdds?: string; // e.g. "-115"
    impliedProbability?: number; // 0-100
    provider?: string;
    edge?: number; // model edge vs book (percentage points)
  };
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
 * Determine if a game time is day or night
 * Day games: before 5pm local time
 */
function getGameTimeType(gameTime?: string): 'day' | 'night' {
  if (!gameTime) return 'night'; // Default to night if unknown
  const hour = new Date(gameTime).getUTCHours();
  // Adjust for ET (UTC-4 or UTC-5): day games typically start before 5pm ET
  // 5pm ET = 21:00 or 22:00 UTC
  const etHour = (hour - 4 + 24) % 24; // Approximate ET
  return etHour < 17 ? 'day' : 'night';
}

/**
 * Calculate day/night split score (0-100)
 * Returns a score and boost based on how well the player performs in this game's time slot
 */
function calculateDayNightScore(
  splits: PlayerDayNightSplits | null,
  gameTimeType: 'day' | 'night',
  seasonAvg: number
): { score: number; boost: number; favorable: boolean; splitAvg: number; splitOPS: number; splitHits: number; splitGames: number } {
  if (!splits) {
    return { score: 50, boost: 0, favorable: false, splitAvg: seasonAvg, splitOPS: 0, splitHits: 0, splitGames: 0 };
  }

  const split = gameTimeType === 'day' ? splits.day : splits.night;
  if (!split || split.gamesPlayed < 5) {
    // Not enough data — neutral
    return { score: 50, boost: 0, favorable: false, splitAvg: seasonAvg, splitOPS: 0, splitHits: 0, splitGames: split?.gamesPlayed || 0 };
  }

  // How much better/worse is the player in this time slot vs season avg?
  const splitAvgNum = parseFloat(split.avg) || 0;
  const boost = seasonAvg > 0 ? ((splitAvgNum - seasonAvg) / seasonAvg) * 100 : 0;
  const favorable = boost > 5; // 5%+ better = favorable

  // Score: base 50, +/- based on boost magnitude
  const score = Math.min(100, Math.max(0, 50 + boost * 1.5));

  return {
    score,
    boost: Math.round(boost),
    favorable,
    splitAvg: splitAvgNum,
    splitOPS: parseFloat(split.ops) || 0,
    splitHits: split.hits,
    splitGames: split.gamesPlayed,
  };
}

/**
 * Calculate streak/hot hand score (0-100)
 * Players on a streak get a bonus; cold players get a penalty
 * Uses theLAB data when available, falls back to real MLB game log streak
 */
function calculateStreakScore(
  theLabData: TheLabPlayerData | null,
  mlbStreak?: PlayerStreakData | null
): {
  score: number;
  isOnStreak: boolean;
  streakLength: number;
  streakType: 'hot' | 'cold' | 'neutral';
  last5HitRate: number;
  last10HitRate: number;
  trendDirection: 'up' | 'down' | 'stable';
} {
  // No theLAB data — try MLB game log streak as free fallback
  if (!theLabData || !theLabData.hasRealData) {
    if (mlbStreak && mlbStreak.hasRealData) {
      const last5 = mlbStreak.last5HitRate;
      const streakLen = mlbStreak.streakLength;
      const trend = mlbStreak.trendDirection;
      let streakType: 'hot' | 'cold' | 'neutral' = 'neutral';
      if (last5 >= 70 || streakLen >= 3 || trend === 'HOT') streakType = 'hot';
      else if ((last5 <= 30 && (streakLen <= -3 || trend === 'COLD')) || streakLen <= -5) streakType = 'cold';
      let score = 50;
      score += (last5 - 50) * 0.8;
      if (streakLen >= 3) score += 10;
      if (streakLen <= -3) score -= 10;
      if (trend === 'HOT') score += 5;
      if (trend === 'COLD') score -= 5;
      const trendDirection = trend === 'HOT' ? 'up' : trend === 'COLD' ? 'down' : 'stable';
      return {
        score: Math.min(100, Math.max(0, Math.round(score))),
        isOnStreak: streakLen >= 3,
        streakLength: Math.abs(streakLen),
        streakType,
        last5HitRate: Math.round(last5),
        last10HitRate: Math.round(last5),
        trendDirection,
      };
    }
    return { score: 50, isOnStreak: false, streakLength: 0, streakType: 'neutral', last5HitRate: 50, last10HitRate: 50, trendDirection: 'stable' };
  }

  // last5HitRate is null when theLAB has the player but no hit rate data — treat as neutral (50)
  const last5 = theLabData.last5HitRate ?? 50;
  const streakLen = theLabData.streakLength ?? 0;
  const trend = theLabData.trendDirection ?? 'NEUTRAL'; // HOT | COLD | NEUTRAL

  // Streak type: only mark cold if we have real evidence (not just missing data)
  // Require BOTH a low hit rate AND a cold trend OR negative streak to mark cold
  let streakType: 'hot' | 'cold' | 'neutral' = 'neutral';
  if (last5 >= 70 || streakLen >= 3 || trend === 'HOT') {
    streakType = 'hot';
  } else if ((last5 <= 30 && (streakLen <= -3 || trend === 'COLD')) || (streakLen <= -5) || (trend === 'COLD' && streakLen <= -3)) {
    // Only cold if multiple signals agree — prevents false cold from single weak signal
    streakType = 'cold';
  }

  // Score: base 50, boosted by last5 hit rate and streak
  let score = 50;
  if (theLabData.last5HitRate !== null) {
    score += (last5 - 50) * 0.8; // last5 hit rate carries most weight (only when real data)
  }
  if (streakLen >= 3) score += 10; // hot streak bonus
  if (streakLen <= -3) score -= 10; // cold streak penalty
  if (trend === 'HOT') score += 5;
  if (trend === 'COLD') score -= 5;

  // Map HOT/COLD/NEUTRAL to up/down/stable for frontend
  const trendDirection = trend === 'HOT' ? 'up' : trend === 'COLD' ? 'down' : 'stable';

  return {
    score: Math.min(100, Math.max(0, Math.round(score))),
    isOnStreak: streakLen >= 3,
    streakLength: Math.abs(streakLen),
    streakType,
    last5HitRate: Math.round(last5),
    last10HitRate: Math.round(last5), // use last5 as proxy since theLabData only has last5
    trendDirection,
  };
}

/**
 * Calculate theLAB edge score (0-100)
 */
function calculateTheLabScore(theLabData: TheLabPlayerData | null): number {
  if (!theLabData) return 50;
  const edgeScore = theLabData.edgeScore ?? 50;
  const strongHit = theLabData.strongHitCandidate ? 10 : 0;
  return Math.min(100, Math.max(0, edgeScore + strongHit));
}

/**
 * Rank AI picks using comprehensive algorithm
 * Now includes day/night splits, theLAB edge, streak detection, and dynamic count
 */
export function rankAIPicks(
  matchups: MatchupData[],
  playerDataMap: Map<number, PlayerData>,
  hrTargetsMap: Map<string, HRTargetData>,
  parkFactors: Map<string, number>,
  // New optional enrichment data
  dayNightSplitsMap?: Map<number, PlayerDayNightSplits>,
  theLabMismatchMap?: Map<string, TheLabPlayerData>,
  mlbStreakMap?: Map<number, PlayerStreakData>
): AIPick[] {
  const picks = matchups
    .map((matchup) => {
      const playerData = playerDataMap.get(matchup.playerId);
      const hrTargets = hrTargetsMap.get(matchup.playerName);
      const parkFactor = parkFactors.get(matchup.team) || 1.0;

      if (!playerData) return null;

      // ── Core factor scores ────────────────────────────────────────────────
      const rcScore = rcToScore(matchup.rc);
      const playerStatsScore = playerStatsToScore(playerData.stats);
      const parkFactorScore = parkFactorToScore(parkFactor);
      const pitcherMatchupScore = pitcherMatchupToScore(matchup.confidence);
      const battingPositionScore = getBattingPositionWeight(matchup.battingPosition);
      const hrTargetsScore = hrTargets ? gradeToScore(hrTargets.grade) : 50;

      // ── Day/night split ───────────────────────────────────────────────────
      const gameTimeType = getGameTimeType(matchup.gameTime);
      const splits: PlayerDayNightSplits | null = dayNightSplitsMap?.get(matchup.playerId) ?? null;
      const dayNightResult = calculateDayNightScore(splits, gameTimeType, playerData.stats.avg);
      const dayNightScore = dayNightResult.score;

      // ── Streak / theLAB data ──────────────────────────────────────────────
      const theLabData: TheLabPlayerData | null = theLabMismatchMap?.get(matchup.playerName) ?? null;
      // Use MLB game log streak as fallback when theLAB is unavailable
      const mlbStreak = mlbStreakMap?.get(matchup.playerId) ?? null;
      const streakResult = calculateStreakScore(theLabData, mlbStreak);
      const streakScore = streakResult.score;
      const theLabScore = calculateTheLabScore(theLabData);

      // ── Weighted overall score ────────────────────────────────────────────
      // Rebalanced weights: real-time signals (theLAB, streak, day/night) get more weight
      // Total = 1.0
      const overallScore =
        rcScore * 0.14 +           // Ballpark.com RC matchup
        playerStatsScore * 0.12 +  // Season stats (avg, slg, power)
        parkFactorScore * 0.10 +   // Park factor
        hrTargetsScore * 0.10 +    // HR Targets grade
        pitcherMatchupScore * 0.12 + // Pitcher weakness
        battingPositionScore * 0.08 + // Lineup position
        dayNightScore * 0.12 +     // Day/night split (was 0.10)
        streakScore * 0.12 +       // Streak/hot hand (was 0.08)
        theLabScore * 0.10;        // theLAB edge (was 0.05)

      // ── Reasoning ────────────────────────────────────────────────────────
      const reasons: string[] = [];
      if (rcScore > 80) reasons.push("High RC vs this pitcher");
      if (playerStatsScore > 80) reasons.push("Strong season stats");
      if (parkFactorScore > 70) reasons.push("Hitter-friendly park");
      if (hrTargetsScore > 85) reasons.push("Top HR threat");
      if (pitcherMatchupScore > 75) reasons.push("Favorable matchup");
      if (battingPositionScore > 85) reasons.push("High in lineup");
      if (dayNightResult.favorable) reasons.push(`Strong ${gameTimeType} performer (+${dayNightResult.boost}%)`);
      if (streakResult.isOnStreak) reasons.push(`On ${streakResult.streakLength}-game hit streak`);
      if (streakResult.last5HitRate >= 70) reasons.push(`${streakResult.last5HitRate}% hit rate last 5`);
      if (theLabData?.strongHitCandidate) reasons.push("theLAB strong hit candidate");

      const reasoning = reasons.join(" • ") || "Solid matchup";

      // Build ballpark-specific reasoning
      const parkFactorValue = parkFactorScore > 70 ? "hitter-friendly" : parkFactorScore < 50 ? "pitcher-friendly" : "neutral";
      const ballparkReasoning = `Playing at ${parkFactorValue} park. RC ranking: ${Math.round(matchup.rc)}/100. ${matchup.weather ? `Weather: ${matchup.weather.temperature}°F, ${matchup.weather.windSpeed}mph ${matchup.weather.windDirection}` : ""}`;

      // ── Best stat type ────────────────────────────────────────────────────
      const stats = playerData.stats;
      const STAT_PRIORITY_BONUS = { hits: 25, runs: 10, rbi: 0 };
      const statScores = {
        hits: (stats.hits / 50) * 100 + STAT_PRIORITY_BONUS.hits,
        runs: (stats.runs / 40) * 100 + STAT_PRIORITY_BONUS.runs,
        rbi: (stats.rbi / 80) * 100 + STAT_PRIORITY_BONUS.rbi,
      };
      const bestStat = Object.entries(statScores).reduce((a, b) => (a[1] > b[1] ? a : b))[0] as 'hits' | 'runs' | 'rbi';

      // ── Realistic prop line ───────────────────────────────────────────────
      const calculateRealisticLine = (stat: 'hits' | 'runs' | 'rbi', value: number, parkFactor: number): number => {
        const gamesPlayed = 40;
        const perGameAvg = value / gamesPlayed;
        let line: number;
        if (stat === 'hits') {
          line = perGameAvg >= 1.0 ? 1.5 : 0.5;
        } else if (stat === 'runs') {
          line = perGameAvg >= 0.9 ? 1.5 : 0.5;
        } else {
          line = perGameAvg >= 0.9 ? 1.5 : 0.5;
        }
        if (parkFactor > 1.1 && line === 0.5) line = 1.5;
        return line;
      };

      const adjustedParkFactor = parkFactorScore / 100;
      const line = calculateRealisticLine(bestStat, stats[bestStat], adjustedParkFactor);

      // ── Build pick object ─────────────────────────────────────────────────
      const pick: AIPick = {
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
          dayNightSplit: Math.round(dayNightScore),
          streakBonus: Math.round(streakScore),
          theLabEdge: Math.round(theLabScore),
        },
        overallScore: Math.round(overallScore),
      };

      // Attach day/night split info if available
      if (splits || dayNightResult.splitGames > 0) {
        pick.dayNightSplit = {
          gameTimeType,
          splitAvg: dayNightResult.splitAvg,
          splitOPS: dayNightResult.splitOPS,
          splitHits: dayNightResult.splitHits,
          splitGames: dayNightResult.splitGames,
          splitBoost: dayNightResult.boost,
          favorable: dayNightResult.favorable,
        };
      }

      // Attach streak info — prefer theLAB label, fall back to MLB game log label
      const streakLabel = (theLabData?.hasRealData && theLabData.streakLabel)
        ? theLabData.streakLabel
        : (mlbStreak?.hasRealData ? mlbStreak.streakLabel : "");
      pick.streakInfo = {
        isOnStreak: streakResult.isOnStreak,
        streakLength: streakResult.streakLength,
        streakType: streakResult.streakType,
        last5HitRate: streakResult.last5HitRate,
        last10HitRate: streakResult.last10HitRate,
        trendDirection: streakResult.trendDirection,
        streakLabel,
      };

      // Attach theLAB edge info
      if (theLabData) {
        const oddsStr = theLabData.odds != null ? String(theLabData.odds) : undefined;
        pick.theLabEdge = {
          edgeScore: theLabData.edgeScore ?? 50,
          strongHitCandidate: theLabData.strongHitCandidate ?? false,
          last5HitRate: theLabData.last5HitRate ?? 50,
          odds: oddsStr,
          provider: theLabData.oddsProvider ?? undefined,
          line: theLabData.mismatch?.line,
        };
        // Use theLAB odds if available
        if (oddsStr) {
          pick.odds = {
            line,
            overOdds: oddsStr,
            provider: theLabData.oddsProvider ?? undefined,
          };
        }
      }

      return pick;
    })
    .filter((pick): pick is AIPick => pick !== null)
    .sort((a, b) => {
      const scoreDiff = b.overallScore - a.overallScore;
      if (Math.abs(scoreDiff) < 3) {
        // Within 3 points, prefer by stat priority: Hits > Runs > RBI
        const STAT_PRIORITY: Record<string, number> = { hits: 3, runs: 2, rbi: 1, slg: 0 };
        return (STAT_PRIORITY[b.statType] || 0) - (STAT_PRIORITY[a.statType] || 0);
      }
      return scoreDiff;
    })
    .map((pick, index) => ({
      ...pick,
      rank: index + 1,
    }));

  // ── Dynamic count: only return picks that clear 78% threshold ──────────────────────
  // Quality over quantity — raised from 75 to 78 for better pick accuracy
  const qualityPicks = picks.filter(p => p.overallScore >= 78);

  // If fewer than 5 quality picks, include the top 5 regardless (minimum viable slate)
  if (qualityPicks.length < 5) {
    return picks.slice(0, Math.min(5, picks.length));
  }

  return qualityPicks;
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
  const data = new Map<string, number>();
  // Hitter-friendly parks
  data.set("COL", 1.20); // Coors Field
  data.set("CIN", 1.12); // Great American Ball Park
  data.set("TEX", 1.10); // Globe Life Field
  data.set("PHI", 1.08); // Citizens Bank Park
  data.set("BOS", 1.07); // Fenway Park
  data.set("NYY", 1.06); // Yankee Stadium
  data.set("CHC", 1.05); // Wrigley Field
  data.set("MIL", 1.04); // American Family Field
  data.set("BAL", 1.03); // Camden Yards
  // Neutral parks
  data.set("LAD", 1.01); // Dodger Stadium
  data.set("ATL", 1.00); // Truist Park
  data.set("HOU", 1.00); // Minute Maid Park
  data.set("STL", 0.99); // Busch Stadium
  data.set("WSH", 0.99); // Nationals Park
  data.set("TOR", 0.98); // Rogers Centre
  data.set("MIN", 0.98); // Target Field
  data.set("SEA", 0.97); // T-Mobile Park
  data.set("CLE", 0.97); // Progressive Field
  data.set("DET", 0.97); // Comerica Park
  data.set("MIA", 0.96); // LoanDepot Park
  data.set("TB", 0.96); // Tropicana Field
  data.set("CHW", 0.96); // Guaranteed Rate Field
  data.set("KC", 0.96); // Kauffman Stadium
  data.set("PIT", 0.96); // PNC Park
  // Pitcher-friendly parks
  data.set("NYM", 0.95); // Citi Field
  data.set("ARI", 0.95); // Chase Field
  data.set("LAA", 0.94); // Angel Stadium
  data.set("OAK", 0.94); // Oakland Coliseum
  data.set("SD", 0.93); // Petco Park
  data.set("SF", 0.92); // Oracle Park
  return data;
}
