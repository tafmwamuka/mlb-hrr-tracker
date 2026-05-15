/**
 * AI Ranking Service — Phase R Redesign
 *
 * New 10-factor scoring model (total = 100%):
 *   Team Implied Runs   16%  — game O/U environment (high-scoring games = more HRR)
 *   Lineup Spot         15%  — batting order position (cleanup > leadoff for HRR)
 *   OBP / xwOBA         14%  — on-base + expected contact quality (Statcast xwOBA percentile)
 *   Pitcher Weakness    14%  — ERA-based pitcher vulnerability
 *   Recent Form         10%  — last 5-7 game hit/run/RBI rates (MLB game logs)
 *   Day/Night Split      8%  — player performance by game time slot
 *   Park + Weather       8%  — park factor + temperature/wind conditions
 *   Bullpen Weakness     6%  — proxy: pitcher ERA + confidence (no separate bullpen feed)
 *   Platoon Advantage    5%  — batter vs pitcher handedness advantage
 *   Hard Contact/Barrel  4%  — Statcast barrel% percentile
 *
 * BallparkPal (vsGrade):
 *   Grade 10 → +15 pts boost on final score
 *   Grade 9  → +10 pts boost
 *   Grade 8  → +5  pts boost
 *   Grade 7  → neutral (0)
 *   Grade ≤6 → -10 pts penalty
 *   Only auto-exclude when ALL 4 negatives stack:
 *     vsGrade ≤6 AND batting 7th+ AND team implied <4.0 AND poor day/night split
 *
 * Quality Gate:
 *   ≥85  → Elite Play  (tier = "elite")
 *   78-84 → Strong Play (tier = "strong")
 *   70-77 → Watchlist only — hidden from UI
 *   <70   → Hidden
 *   Max 10 picks returned; if none ≥78, show "No official HRR play today"
 *
 * Auto-Fail Rules (pick excluded regardless of score):
 *   - Team game total < 3.5 (very low-scoring environment)
 *   - Batting 9th with team total < 4.5
 *   - BallparkPal kProb ≥ 30% (high strikeout risk from BP data)
 *
 * Soft Penalties (applied to score before quality gate):
 *   - Batting 7th or lower: -3 pts
 *   - Wind blowing in (headwind): -4 pts
 *   - Cold weather (<50°F): -5 pts
 *   - Poor recent form (cold streak): -5 pts
 *   - High K matchup (kProb ≥ 22%): -3 pts
 */

import type { PlayerDayNightSplits } from "./dayNightSplitService";
import type { PlayerStreakData } from "./mlbStreakService";
import { calculateHandednessAdvantage, calculateWeatherImpact } from "./advancedDataService";
import type { GameTotal } from "./gameTotalsService";
import { getGameTotalScoreForTeam } from "./gameTotalsService";
import { lookupStatcastPlayer, type StatcastCache } from "./pybaseballService";
import type { BallparkMatchup } from "./ballparkMatchupService";

export interface PlayerData {
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
    id?: number | null;       // MLB pitcher ID (for mlbMatchupService)
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

export type PickGrade = 'elite' | 'strong' | 'watchlist';

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
  // Phase R: structured reasons and risk flags
  reasons: string[];           // "WHY THIS PLAY QUALIFIES" bullet points
  riskFlags: string[];         // "RISK FLAGS" bullet points
  grade: PickGrade;            // 'elite' | 'strong' | 'watchlist'
  bpBoost: number;             // BallparkPal boost/penalty applied (+15 to -10)
  factorBreakdown: {
    teamImpliedRuns: number;   // Game O/U environment (0-100)
    lineupSpot: number;        // Batting position weight (0-100)
    obpXwOBA: number;          // OBP + xwOBA quality (0-100)
    pitcherWeakness: number;   // Pitcher ERA vulnerability (0-100)
    recentForm: number;        // Last 5-7 game form (0-100)
    dayNightSplit: number;     // Day/night split score (0-100)
    parkWeather: number;       // Park factor + weather (0-100)
    bullpenWeakness: number;   // Bullpen proxy score (0-100)
    platoonAdvantage: number;  // Handedness advantage (0-100)
    hardContactBarrel: number; // Barrel% percentile (0-100)
    // Legacy fields kept for backward compat
    rc?: number;
    playerStats?: number;
    parkFactors?: number;
    hrTargets?: number;
    pitcherMatchup?: number;
    battingPosition?: number;
    dayNightSplit_?: number;
    streakBonus?: number;
    statcast?: number;
    gameTotal?: number;
  };
  // VS / BallparkPal data
  vsGrade?: number; // 0-10 normalized vsGrade
  gameTotalOU?: number | null; // Vegas over/under line (e.g. 9.5)
  gameTotalScore?: number; // Normalized 0-100 game environment score
  overallScore: number; // Final weighted score (0-100, after BP boost)
  baseScore: number;    // Score before BP boost/penalty
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
    last5Games?: Array<{ date: string; hits: number; runs: number; rbi: number; atBats: number; homeRuns: number }>;
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
  primePosition?: boolean; // True when 3+ of 4 data-driven factors are favorable
  primePositionFactors?: {
    platoonAdvantage: boolean;
    pitcherMatchup: boolean;
    battingPositionStrong: boolean;
    dayNightFavorable: boolean;
    favorableCount: number;
  };
}

// ─── Scoring helpers ──────────────────────────────────────────────────────────

/**
 * Batting position weight (0-100) — optimized for HRR (Hits+Runs+RBI)
 * Cleanup/3-4-5 get the most run-scoring opportunities
 */
function getBattingPositionWeight(position: number): number {
  const weights: Record<number, number> = {
    1: 72,  // Lead-off: high OBP, good runs, fewer RBI
    2: 78,  // 2-hole: good contact, run-scoring
    3: 88,  // 3-hole: high avg, RBI opportunities
    4: 100, // Cleanup: max RBI + run potential
    5: 95,  // 5-hole: strong RBI spot
    6: 85,  // 6-hole: decent RBI
    7: 68,  // 7-hole: lower run/RBI opportunities
    8: 55,  // 8-hole: limited opportunities
    9: 45,  // 9-hole (or pitcher): minimal HRR potential
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
 */
function rcToScore(rc: number): number {
  return Math.min(100, (rc / 40) * 100);
}

/**
 * Calculate OBP/xwOBA score (0-100)
 * Combines OBP (on-base ability) with Statcast xwOBA percentile
 */
function calculateOBPxwOBAScore(
  stats: PlayerData["stats"],
  xwOBAPercentile: number | null
): number {
  // OBP score: .400 OBP = 100, .300 = 75, .250 = 62
  const obpScore = Math.min(100, (stats.obp / 0.400) * 100);

  if (xwOBAPercentile !== null) {
    // Blend OBP (40%) + xwOBA percentile (60%) when Statcast available
    return obpScore * 0.40 + xwOBAPercentile * 0.60;
  }

  // Fallback: OBP only, supplement with avg/slg
  const avgScore = Math.min(100, (stats.avg / 0.320) * 100);
  return obpScore * 0.60 + avgScore * 0.40;
}

/**
 * Calculate pitcher weakness score (0-100) — primary pitcher factor
 * ERA-based: high ERA = high score (vulnerable pitcher = good for HRR)
 */
function calculatePitcherWeaknessScore(era: number, confidence: number): number {
  // ERA score: 6.00+ ERA = 100, 4.50 = 75, 3.50 = 50, 2.50 = 25
  const eraScore = Math.min(100, Math.max(0, ((era - 2.0) / 4.0) * 100));
  // Blend ERA (70%) with matchup confidence (30%)
  return eraScore * 0.70 + confidence * 0.30;
}

/**
 * Calculate bullpen weakness proxy (0-100)
 * No direct bullpen data — proxy using pitcher ERA + confidence
 * Higher ERA starter = likely weaker bullpen too
 */
function calculateBullpenWeaknessScore(era: number, confidence: number): number {
  // Simpler proxy: if starter ERA is high, bullpen likely also weak
  const eraProxy = Math.min(100, Math.max(0, ((era - 2.5) / 3.5) * 100));
  return eraProxy * 0.60 + confidence * 0.40;
}

/**
 * Calculate park + weather combined score (0-100)
 * Park factor (60%) + weather conditions (40%)
 */
function calculateParkWeatherScore(
  parkFactor: number,
  weather?: { temperature: number; windSpeed: number; windDirection: string }
): number {
  // Park factor: 1.20 = 100, 1.00 = 50, 0.80 = 0
  const parkScore = Math.min(100, Math.max(0, ((parkFactor - 0.80) / 0.40) * 100));

  if (!weather) return parkScore;

  const weatherScore = calculateWeatherImpact(weather);
  return parkScore * 0.60 + weatherScore * 0.40;
}

/**
 * Determine if a game time is day or night
 */
function getGameTimeType(gameTime?: string): 'day' | 'night' {
  if (!gameTime) return 'night';
  const hour = new Date(gameTime).getUTCHours();
  const etHour = (hour - 4 + 24) % 24;
  return etHour < 17 ? 'day' : 'night';
}

/**
 * Calculate day/night split score (0-100)
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
    return { score: 50, boost: 0, favorable: false, splitAvg: seasonAvg, splitOPS: 0, splitHits: 0, splitGames: split?.gamesPlayed || 0 };
  }

  const splitAvgNum = parseFloat(split.avg) || 0;
  const boost = seasonAvg > 0 ? ((splitAvgNum - seasonAvg) / seasonAvg) * 100 : 0;
  const favorable = boost > 5;
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
 * Calculate recent form score (0-100) from MLB game log data
 */
function calculateRecentFormScore(
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

/**
 * Calculate BallparkPal boost/penalty from vsGrade (0-10 normalized scale)
 * Grade 10 → +15, Grade 9 → +10, Grade 8 → +5, Grade 7 → 0, Grade ≤6 → -10
 */
function calculateBPBoost(vsGrade: number | null): number {
  if (vsGrade === null) return 0; // No data = neutral
  if (vsGrade >= 9.5) return 15;  // Grade 10
  if (vsGrade >= 8.5) return 10;  // Grade 9
  if (vsGrade >= 7.5) return 5;   // Grade 8
  if (vsGrade >= 6.5) return 0;   // Grade 7
  return -10;                      // Grade 6 or below
}

/**
 * Determine pick grade tier from final score
 */
function getPickGrade(score: number): PickGrade {
  if (score >= 85) return 'elite';
  if (score >= 78) return 'strong';
  return 'watchlist';
}

// ─── Main ranking function ────────────────────────────────────────────────────

/**
 * Rank AI picks using the Phase R 10-factor scoring model.
 *
 * BallparkPal is now a BOOST/PENALTY on the final score, not a hard gate.
 * The only hard exclusion is when ALL 4 negatives stack simultaneously.
 *
 * Quality gate: ≥78 to appear in UI (max 10 picks), ≥85 = Elite tier.
 */
export function rankAIPicks(
  matchups: MatchupData[],
  playerDataMap: Map<number, PlayerData>,
  hrTargetsMap: Map<string, HRTargetData>,
  parkFactors: Map<string, number>,
  // Enrichment data
  dayNightSplitsMap?: Map<number, PlayerDayNightSplits>,
  mlbStreakMap?: Map<number, PlayerStreakData>,
  // VS data: map from playerName -> vsGrade (0-10 scale)
  vsGradeMap?: Map<string, number>,
  // Game Totals: map from teamAbbr -> GameTotal
  gameTotalsMap?: Map<string, GameTotal>,
  // Statcast data from pybaseball
  statcastCache?: StatcastCache,
  // Whether vsGradeMap is from real ballparkpal data (true) or mlbMatchupService fallback (false)
  hasBallparkPalData?: boolean,
  // Raw BallparkPal matchups for kProb, hrProb access
  ballparkMatchups?: BallparkMatchup[]
): AIPick[] {

  // ── Auto-exclude: only when ALL 4 negatives stack ─────────────────────────
  // This replaces the old hard VS gate. BallparkPal is now a boost/penalty.
  const picks = matchups
    .map((matchup) => {
      const playerData = playerDataMap.get(matchup.playerId);
      const hrTargets = hrTargetsMap.get(matchup.playerName);
      const parkFactor = parkFactors.get(matchup.team) || 1.0;

      if (!playerData) return null;

      // ── VS grade (BallparkPal or fallback) ───────────────────────────────
      const vsGrade = vsGradeMap?.get(matchup.playerName) ?? null;

      // ── Game Total (O/U) environment ──────────────────────────────────────
      const gameTotalData = gameTotalsMap ? getGameTotalScoreForTeam(matchup.team, gameTotalsMap) : null;
      const gameTotalScore = gameTotalData?.score ?? 50;
      const gameTotalOU = gameTotalData?.overUnder ?? null;

      // ── Statcast data ─────────────────────────────────────────────────────
      const statcastPlayer = statcastCache
        ? (statcastCache.byId.get(matchup.playerId) ?? lookupStatcastPlayer(statcastCache, matchup.playerName))
        : null;

      // ── BallparkPal raw matchup (for kProb, hrProb) ───────────────────────
      const bpMatchup = ballparkMatchups?.find(bp =>
        bp.batter.toLowerCase() === matchup.playerName.toLowerCase() ||
        bp.batter.toLowerCase().includes(matchup.playerName.split(' ').pop()?.toLowerCase() || '')
      ) ?? null;
      const kProb = bpMatchup?.kProb ?? null;

      // ── Auto-fail rules ───────────────────────────────────────────────────
      // Rule 1: Team game total < 3.5 (very low-scoring environment)
      if (gameTotalOU !== null && gameTotalOU < 3.5) {
        console.log(`[rankAIPicks] Auto-fail ${matchup.playerName}: game total ${gameTotalOU} < 3.5`);
        return null;
      }

      // Rule 2: Batting 9th with team total < 4.5
      if (matchup.battingPosition === 9 && gameTotalOU !== null && gameTotalOU < 4.5) {
        console.log(`[rankAIPicks] Auto-fail ${matchup.playerName}: batting 9th with game total ${gameTotalOU}`);
        return null;
      }

      // Rule 3: BallparkPal kProb ≥ 30% (very high strikeout risk)
      if (kProb !== null && kProb >= 30) {
        console.log(`[rankAIPicks] Auto-fail ${matchup.playerName}: kProb ${kProb}% ≥ 30%`);
        return null;
      }

      // ── 4-negative stack exclusion (replaces old VS hard gate) ───────────
      // Only exclude when ALL 4 negatives are present simultaneously
      const vsGradeLow = vsGrade !== null && vsGrade <= 6.0;
      const battingLow = matchup.battingPosition >= 7;
      const teamImpliedLow = gameTotalOU !== null && gameTotalOU < 4.0;
      const dayNightSplitsForPlayer = dayNightSplitsMap?.get(matchup.playerId) ?? null;
      const gameTimeType = getGameTimeType(matchup.gameTime);
      const dayNightResult = calculateDayNightScore(dayNightSplitsForPlayer, gameTimeType, playerData.stats.avg);
      const poorDayNight = !dayNightResult.favorable && dayNightResult.score < 40;

      if (vsGradeLow && battingLow && teamImpliedLow && poorDayNight) {
        console.log(`[rankAIPicks] 4-negative stack exclusion: ${matchup.playerName} (vsGrade=${vsGrade}, pos=${matchup.battingPosition}, OU=${gameTotalOU}, dayNight=${dayNightResult.score})`);
        return null;
      }

      // ── Factor 1: Team Implied Runs (16%) ─────────────────────────────────
      // gameTotalScore is already 0-100 normalized
      const teamImpliedScore = gameTotalScore;

      // ── Factor 2: Lineup Spot (15%) ───────────────────────────────────────
      const lineupSpotScore = getBattingPositionWeight(matchup.battingPosition);

      // ── Factor 3: OBP / xwOBA (14%) ──────────────────────────────────────
      const xwOBAPercentile = statcastPlayer?.xwOBAPercentile ?? null;
      const obpXwOBAScore = calculateOBPxwOBAScore(playerData.stats, xwOBAPercentile);

      // ── Factor 4: Pitcher Weakness (14%) ─────────────────────────────────
      const pitcherWeaknessScore = calculatePitcherWeaknessScore(
        matchup.pitcher.era,
        matchup.confidence
      );

      // ── Factor 5: Recent Form (10%) ───────────────────────────────────────
      const mlbStreak = mlbStreakMap?.get(matchup.playerId) ?? null;
      const recentFormResult = calculateRecentFormScore(mlbStreak);
      const recentFormScore = recentFormResult.score;

      // ── Factor 6: Day/Night Split (8%) ────────────────────────────────────
      const dayNightScore = dayNightResult.score;

      // ── Factor 7: Park + Weather (8%) ─────────────────────────────────────
      const parkWeatherScore = calculateParkWeatherScore(parkFactor, matchup.weather);

      // ── Factor 8: Bullpen Weakness (6%) ──────────────────────────────────
      const bullpenWeaknessScore = calculateBullpenWeaknessScore(
        matchup.pitcher.era,
        matchup.confidence
      );

      // ── Factor 9: Platoon Advantage (5%) ─────────────────────────────────
      const platoonScore = calculateHandednessAdvantage(
        playerData.handedness,
        matchup.pitcher.handedness,
        matchup.platoonSplit
      );

      // ── Factor 10: Hard Contact / Barrel (4%) ────────────────────────────
      const barrelPercentile = statcastPlayer?.barrelPercentile ?? 50;
      const hardContactScore = barrelPercentile;

      // ── Weighted base score (0-100) ───────────────────────────────────────
      const baseScore =
        teamImpliedScore   * 0.16 +   // Team Implied Runs
        lineupSpotScore    * 0.15 +   // Lineup Spot
        obpXwOBAScore      * 0.14 +   // OBP / xwOBA
        pitcherWeaknessScore * 0.14 + // Pitcher Weakness
        recentFormScore    * 0.10 +   // Recent Form
        dayNightScore      * 0.08 +   // Day/Night Split
        parkWeatherScore   * 0.08 +   // Park + Weather
        bullpenWeaknessScore * 0.06 + // Bullpen Weakness
        platoonScore       * 0.05 +   // Platoon Advantage
        hardContactScore   * 0.04;    // Hard Contact/Barrel

      // ── BallparkPal boost/penalty ─────────────────────────────────────────
      const bpBoost = calculateBPBoost(vsGrade);

      // ── Soft penalties ────────────────────────────────────────────────────
      let softPenalty = 0;
      if (matchup.battingPosition >= 7) softPenalty -= 3;
      if (matchup.weather) {
        const wd = matchup.weather.windDirection.toLowerCase();
        const isHeadwind = wd.includes('in') || wd === 'n' || wd === 'ne' || wd === 'nw';
        if (isHeadwind && matchup.weather.windSpeed > 10) softPenalty -= 4;
        if (matchup.weather.temperature < 50) softPenalty -= 5;
      }
      if (recentFormResult.streakType === 'cold') softPenalty -= 5;
      if (kProb !== null && kProb >= 22) softPenalty -= 3;

      // ── Final score ───────────────────────────────────────────────────────
      const overallScore = Math.min(100, Math.max(0, Math.round(baseScore + bpBoost + softPenalty)));

      // ── Build reasons (WHY THIS PLAY QUALIFIES) ───────────────────────────
      const reasons: string[] = [];
      if (vsGrade !== null && vsGrade >= 9.5) reasons.push(`Elite BallparkPal matchup (Grade ${Math.round(vsGrade)}/10)`);
      else if (vsGrade !== null && vsGrade >= 8.5) reasons.push(`Strong BallparkPal matchup (Grade ${Math.round(vsGrade)}/10)`);
      else if (vsGrade !== null && vsGrade >= 7.5) reasons.push(`Favorable BallparkPal matchup (Grade ${Math.round(vsGrade)}/10)`);
      if (gameTotalOU !== null && gameTotalOU >= 9.5) reasons.push(`High-scoring game environment (O/U ${gameTotalOU})`);
      else if (gameTotalOU !== null && gameTotalOU >= 8.5) reasons.push(`Above-average game total (O/U ${gameTotalOU})`);
      if (matchup.battingPosition <= 3) reasons.push(`Top of lineup (#${matchup.battingPosition} — high run-scoring opportunity)`);
      else if (matchup.battingPosition <= 5) reasons.push(`Heart of lineup (#${matchup.battingPosition} — prime RBI spot)`);
      if (obpXwOBAScore >= 75) reasons.push(`Strong contact quality (OBP ${playerData.stats.obp.toFixed(3)}${xwOBAPercentile !== null ? `, xwOBA ${xwOBAPercentile}th pctile` : ''})`);
      if (pitcherWeaknessScore >= 70) reasons.push(`Vulnerable starter (ERA ${matchup.pitcher.era.toFixed(2)})`);
      if (recentFormResult.streakType === 'hot') reasons.push(`Hot recent form (${recentFormResult.last5HitRate}% hit rate last 5)`);
      if (dayNightResult.favorable) reasons.push(`Strong ${gameTimeType} performer (+${dayNightResult.boost}% vs season avg)`);
      if (parkFactor >= 1.05) reasons.push(`Hitter-friendly park (factor ${parkFactor.toFixed(2)})`);
      if (platoonScore >= 60) reasons.push(`Platoon advantage vs ${matchup.pitcher.handedness}HP`);
      if (barrelPercentile >= 70) reasons.push(`Elite barrel% (${barrelPercentile}th percentile)`);
      if (bpBoost > 0) reasons.push(`BallparkPal boost: +${bpBoost} pts`);

      // ── Build risk flags ──────────────────────────────────────────────────
      const riskFlags: string[] = [];
      if (kProb !== null && kProb >= 22) riskFlags.push(`Strikeout risk: ${kProb.toFixed(1)}% K probability`);
      if (matchup.battingPosition >= 7) riskFlags.push(`Lower lineup spot (#${matchup.battingPosition}) — fewer RBI opportunities`);
      if (matchup.weather && matchup.weather.temperature < 55) riskFlags.push(`Cold weather (${matchup.weather.temperature}°F) — suppresses offense`);
      if (matchup.weather) {
        const wd = matchup.weather.windDirection.toLowerCase();
        const isHeadwind = wd.includes('in') || wd === 'n' || wd === 'ne' || wd === 'nw';
        if (isHeadwind && matchup.weather.windSpeed > 10) riskFlags.push(`Wind blowing in (${matchup.weather.windSpeed}mph ${matchup.weather.windDirection})`);
      }
      if (recentFormResult.streakType === 'cold') riskFlags.push(`Cold streak — ${recentFormResult.last5HitRate}% hit rate last 5 games`);
      if (bpBoost < 0) riskFlags.push(`BallparkPal penalty: ${bpBoost} pts (poor matchup grade)`);
      if (gameTotalOU !== null && gameTotalOU < 7.0) riskFlags.push(`Low game total (O/U ${gameTotalOU}) — limited scoring`);

      // ── Legacy reasoning string ───────────────────────────────────────────
      const reasoning = reasons.slice(0, 3).join(" • ") || "Solid matchup";
      const parkFactorValue = parkFactor > 1.05 ? "hitter-friendly" : parkFactor < 0.95 ? "pitcher-friendly" : "neutral";
      const ouStr = gameTotalOU !== null ? ` Game O/U: ${gameTotalOU}.` : "";
      const ballparkReasoning = `Playing at ${parkFactorValue} park.${ouStr} ${matchup.weather ? `Weather: ${matchup.weather.temperature}°F, ${matchup.weather.windSpeed}mph ${matchup.weather.windDirection}` : ""}`;

      // ── Best stat type ────────────────────────────────────────────────────
      const stats = playerData.stats;
      const STAT_PRIORITY_BONUS = { hits: 25, runs: 10, rbi: 0 };
      const statScores = {
        hits: (stats.hits / 50) * 100 + STAT_PRIORITY_BONUS.hits,
        runs: (stats.runs / 40) * 100 + STAT_PRIORITY_BONUS.runs,
        rbi: (stats.rbi / 80) * 100 + STAT_PRIORITY_BONUS.rbi,
      };
      const bestStat = Object.entries(statScores).reduce((a, b) => (a[1] > b[1] ? a : b))[0] as 'hits' | 'runs' | 'rbi';

      // ── Prop line ─────────────────────────────────────────────────────────
      const gamesPlayed = 40;
      const perGameAvg = stats[bestStat] / gamesPlayed;
      const line = perGameAvg >= 1.0 ? 1.5 : 0.5;

      // ── Pick grade ────────────────────────────────────────────────────────
      const grade = getPickGrade(overallScore);

      // ── Prime position (legacy: 3+ of 4 factors favorable) ───────────────
      const platoonSplit = matchup.platoonSplit;
      const platoonAdvantage = platoonSplit
        ? (() => {
            const relevantAvg = matchup.pitcher.handedness === 'R' ? platoonSplit.vsRHP : platoonSplit.vsLHP;
            return relevantAvg - playerData.stats.avg >= 0.015;
          })()
        : platoonScore >= 55;
      const pitcherMatchupFavorable = pitcherWeaknessScore >= 65;
      const battingPositionStrong = lineupSpotScore >= 65;
      const dayNightFavorable = dayNightResult.favorable;
      const primeFactors = [platoonAdvantage, pitcherMatchupFavorable, battingPositionStrong, dayNightFavorable];
      const favorableCount = primeFactors.filter(Boolean).length;

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
        confidence: overallScore,
        reasoning,
        ballparkReasoning,
        reasons,
        riskFlags,
        grade,
        bpBoost,
        baseScore: Math.round(baseScore),
        overallScore,
        vsGrade: vsGrade ?? undefined,
        gameTotalOU,
        gameTotalScore: Math.round(gameTotalScore),
        factorBreakdown: {
          teamImpliedRuns: Math.round(teamImpliedScore),
          lineupSpot: Math.round(lineupSpotScore),
          obpXwOBA: Math.round(obpXwOBAScore),
          pitcherWeakness: Math.round(pitcherWeaknessScore),
          recentForm: Math.round(recentFormScore),
          dayNightSplit: Math.round(dayNightScore),
          parkWeather: Math.round(parkWeatherScore),
          bullpenWeakness: Math.round(bullpenWeaknessScore),
          platoonAdvantage: Math.round(platoonScore),
          hardContactBarrel: Math.round(hardContactScore),
          // Legacy aliases for backward compat
          rc: Math.round(rcToScore(matchup.rc)),
          playerStats: Math.round(Math.min(100, (stats.avg / 0.350) * 100)),
          parkFactors: Math.round(Math.min(100, ((parkFactor - 0.8) / 0.4) * 100)),
          hrTargets: hrTargets ? gradeToScore(hrTargets.grade) : 50,
          pitcherMatchup: Math.round(pitcherWeaknessScore),
          battingPosition: Math.round(lineupSpotScore),
          streakBonus: Math.round(recentFormScore),
          statcast: statcastPlayer ? Math.round(
            (statcastPlayer.xwOBAPercentile ?? 50) * 0.40 +
            (statcastPlayer.barrelPercentile ?? 50) * 0.25 +
            (statcastPlayer.hardHitPercentile ?? 50) * 0.20 +
            (statcastPlayer.exitVeloPercentile ?? 50) * 0.15
          ) : 50,
          gameTotal: Math.round(gameTotalScore),
        },
        primePosition: favorableCount >= 3,
        primePositionFactors: {
          platoonAdvantage,
          pitcherMatchup: pitcherMatchupFavorable,
          battingPositionStrong,
          dayNightFavorable,
          favorableCount,
        },
      };

      // Attach day/night split info
      pick.dayNightSplit = {
        gameTimeType,
        splitAvg: dayNightResult.splitAvg,
        splitOPS: dayNightResult.splitOPS,
        splitHits: dayNightResult.splitHits,
        splitGames: dayNightResult.splitGames,
        splitBoost: dayNightResult.boost,
        favorable: dayNightResult.favorable,
      };

      // Attach streak info
      const streakLabel = mlbStreak?.hasRealData ? (mlbStreak.streakLabel ?? "") : "";
      pick.streakInfo = {
        isOnStreak: recentFormResult.isOnStreak,
        streakLength: recentFormResult.streakLength,
        streakType: recentFormResult.streakType,
        last5HitRate: recentFormResult.last5HitRate,
        last10HitRate: recentFormResult.last10HitRate,
        trendDirection: recentFormResult.trendDirection,
        streakLabel,
        last5Games: mlbStreak?.last5Games ?? [],
      };

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

  // ── Quality gate: 78+ to appear in UI, max 10 picks ──────────────────────
  // 85+ = Elite, 78-84 = Strong, below 78 = hidden
  // If none qualify, return empty array (UI shows "No official HRR play today")
  const QUALITY_THRESHOLD = 78;
  const MAX_PICKS = 10;

  const qualityPicks = picks
    .filter(p => p.overallScore >= QUALITY_THRESHOLD)
    .slice(0, MAX_PICKS);

  console.log(`[rankAIPicks] Quality gate (>= ${QUALITY_THRESHOLD}, max ${MAX_PICKS}): ${picks.length} scored → ${qualityPicks.length} picks`);
  console.log(`[rankAIPicks] Grade breakdown: Elite (85+): ${qualityPicks.filter(p => p.grade === 'elite').length}, Strong (78-84): ${qualityPicks.filter(p => p.grade === 'strong').length}`);

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
  data.set("TB", 0.96);  // Tropicana Field
  data.set("CHW", 0.96); // Guaranteed Rate Field
  data.set("KC", 0.96);  // Kauffman Stadium
  data.set("PIT", 0.96); // PNC Park
  // Pitcher-friendly parks
  data.set("NYM", 0.95); // Citi Field
  data.set("ARI", 0.95); // Chase Field
  data.set("LAA", 0.94); // Angel Stadium
  data.set("OAK", 0.94); // Oakland Coliseum
  data.set("SD", 0.93);  // Petco Park
  data.set("SF", 0.92);  // Oracle Park
  return data;
}
