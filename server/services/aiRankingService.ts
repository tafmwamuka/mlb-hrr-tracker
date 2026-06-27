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
 * VS Gate (vsGrade):
 *   Grade 10 → +15 pts boost on final score
 *   Grade 9  → +10 pts boost
 *   Grade 8  → +5  pts boost
 *   Grade 7  → neutral (0)
 *   Grade ≤6 → -10 pts penalty
 *   Only auto-exclude when ALL 4 negatives stack:
 *     vsGrade ≤6 AND batting 7th+ AND team implied <4.0 AND poor day/night split
 *
 * Quality Gate:
 *   ≥85  → Elite Play  (tier = "elite")  — max 4
 *   75-84 → Strong Play (tier = "strong") — max 6
 *   Total cap: 10 picks (4 Elite + 6 Strong)
 *   70-74 → Watchlist only — hidden from UI
 *   <70   → Hidden
 *   If none ≥75, show "No official HRR play today"
 *
 * S1 — Predictive Contact Upgrade:
 *   Rolling contact metrics from Statcast (xwOBA, Hard-Hit%, Exit Velo, Barrel%, Contact%)
 *   Replace raw recent form with quality-of-contact signals to reduce short-term luck overreaction.
 *   When Statcast data available: blend rolling metrics (60%) + OBP (40%) for Factor 3.
 *   Factor 10 (Hard Contact) uses barrelPercentile + hardHitPercentile blend.
 *
 * S2 — Projected PA Engine:
 *   Projected plate appearances per game based on lineup spot + team implied runs.
 *   Leadoff ≈ 5.1 PA → 9-hole ≈ 3.7 PA. Adjusted by team implied runs (higher O/U = more PA).
 *   PA projection replaces raw batting position weight in Factor 2.
 *
 * Day/Night Split Sample-Size Protection:
 *   Under 50 PA: reduce split weight by 50%
 *   Under 30 PA: use as informational only (10% weight)
 *   Under 20 PA: ignore completely (0% weight)
 *
 * Auto-Fail Rules (pick excluded regardless of score):
 *   - Team game total < 3.5 (very low-scoring environment)
 *   - Batting 9th with team total < 4.5
 *   - VS Gate kProb ≥ 30% (high strikeout risk from BP data)
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
// BallparkMatchup kept as a legacy type for backward compat (ballparkMatchupService removed in Phase AC)
type BallparkMatchup = { batter: string; kProb?: number | null; hrProb?: number | null };
import { getBullpenFatigueScore, type BullpenFatigue } from "./bullpenFatigueService";
import { analyzeValue } from "./valueEngine";

export interface PlayerData {
  playerId: number;
  name: string;
  team: string;
  position: string;
  battingPosition: number; // 1-9 in lineup
  handedness: 'R' | 'L' | 'S'; // Right, Left, Switch
  gamesPlayed?: number; // Real games played (used for per-game normalization)
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
  rc: number; // Runs Created (Diamond Edge model)
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
  // S3/S5: Team identifiers for bullpen fatigue and correlation engine
  opponentTeamId?: number;   // MLB team ID for the opposing pitcher's team
  gamePk?: number;           // MLB game ID for correlation grouping
  isHome?: boolean;          // True if batter is playing at home
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
  // Phase R: structured reasons and risk flags
  reasons: string[];           // "WHY THIS PLAY QUALIFIES" bullet points
  riskFlags: string[];         // "RISK FLAGS" bullet points
  grade: PickGrade;            // 'elite' | 'strong' | 'watchlist'
  bpBoost: number;             // VS Gate boost/penalty applied (+15 to -10)
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
    // Legacy fields kept for backward compat (rc/hrTargets removed Phase AZ)
    playerStats?: number;
    parkFactors?: number;
    pitcherMatchup?: number;
    battingPosition?: number;
    dayNightSplit_?: number;
    streakBonus?: number;
    statcast?: number;
    gameTotal?: number;
  };
  // S2: Projected plate appearances
  projectedPA?: number; // Projected PA this game (e.g. 4.8 for 3-hole)
  // VS Gate data
  vsGrade?: number; // 0-10 normalized vsGrade
  vsGateData?: {
    batterXwOBA?: number;        // batter's Statcast xwOBA (e.g. 0.360)
    pitcherXwOBAAgainst?: number; // pitcher's xwOBA-against (e.g. 0.290)
    xwOBADelta?: number;          // batter - pitcher (positive = batter edge)
    tier?: string;                // 'STRONG' | 'MODERATE' | 'BAD'
    score?: number;               // raw 0-10 vs gate score
  };
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
  isBestBet?: boolean;    // True when no official plays qualify but this is the top slate pick
  leanTier?: boolean;     // True when score is 68-73 (Lean/B tier — informational only)
  primePosition?: boolean; // True when 3+ of 4 data-driven factors are favorable
  primePositionFactors?: {
    platoonAdvantage: boolean;
    pitcherMatchup: boolean;
    battingPositionStrong: boolean;
    dayNightFavorable: boolean;
    favorableCount: number;
  };
  // Phase AW: Value Intelligence System
  valueAnalysis?: {
    trueProb: number;          // Model probability (0-100)
    impliedProb: number;       // Sportsbook implied prob (0-100, vig-included)
    vigFreeImpliedProb: number; // Vig-removed implied prob (0-100)
    edge: number;              // trueProb - vigFreeImpliedProb (pct points)
    ev: number;                // Expected Value %
    fairOdds: number;          // Fair American odds from model
    bookOdds: number;          // Sportsbook American odds
    valueTier: string;         // SAFE_VALUE | BALANCED_VALUE | CEILING_PLAY | PASS
    valueTag: string;          // BEST VALUE | MISPRICED | ELITE EDGE | BETTER VALUE | MONITORING | PASS
    isMispriced: boolean;
    altLineIsBetter: boolean;
    bestAltLine?: {
      line: number;
      overOdds: number;
      impliedProb: number;
      edge: number;
      ev: number;
    };
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
  // Park factor: 1.30 = 100, 1.00 = 60, 0.80 = 20 (wider range prevents ceiling effect)
  // Old formula (0.40 range) caused COL=1.20 to hit 100/100 — unfair ceiling
  const parkScore = Math.min(100, Math.max(0, ((parkFactor - 0.80) / 0.50) * 100));

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
 * S2 — Projected Plate Appearances per game
 * Based on lineup spot + team implied runs environment.
 * Leadoff ≈ 5.1 PA, 9-hole ≈ 3.7 PA. Adjusted by O/U (higher total = more PA opportunity).
 */
function getProjectedPA(battingPosition: number, gameTotalOU: number | null): number {
  // Base PA by lineup spot (MLB averages)
  const basePA: Record<number, number> = {
    1: 5.1, 2: 4.9, 3: 4.8, 4: 4.6, 5: 4.4,
    6: 4.2, 7: 4.0, 8: 3.8, 9: 3.7,
  };
  const pa = basePA[battingPosition] ?? 4.0;

  // Adjust by game total: neutral = 8.5, each 0.5 above/below = ±0.05 PA
  if (gameTotalOU !== null) {
    const ouDelta = (gameTotalOU - 8.5) / 0.5;
    return Math.max(3.0, Math.min(6.0, pa + ouDelta * 0.05));
  }
  return pa;
}

/**
 * S2 — Convert projected PA to a 0-100 score for Factor 2 (Lineup Spot)
 * More PA = more HRR opportunities. Normalized: 5.1 PA = 100, 3.7 PA = 45.
 */
function projectedPAToScore(projectedPA: number): number {
  // Linear scale: 3.7 PA → 45, 5.1 PA → 100
  return Math.min(100, Math.max(0, ((projectedPA - 3.7) / (5.1 - 3.7)) * 55 + 45));
}

/**
 * S1 — Rolling contact quality score (0-100)
 * Uses Statcast rolling metrics to reduce overreaction to short-term luck.
 * Blends xwOBA percentile (40%), Hard-Hit% percentile (25%), Exit Velo percentile (20%), Barrel% percentile (15%).
 */
function calculateRollingContactScore(
  xwOBAPercentile: number | null,
  hardHitPercentile: number | null,
  exitVeloPercentile: number | null,
  barrelPercentile: number | null
): number {
  const xw = xwOBAPercentile ?? 50;
  const hh = hardHitPercentile ?? 50;
  const ev = exitVeloPercentile ?? 50;
  const bp = barrelPercentile ?? 50;
  return Math.round(xw * 0.40 + hh * 0.25 + ev * 0.20 + bp * 0.15);
}

/**
 * Calculate day/night split score (0-100) with S-phase sample-size protection.
 * Under 50 PA: reduce split weight by 50%
 * Under 30 PA: use as informational only (10% weight)
 * Under 20 PA: ignore completely (0% weight)
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

  // S-phase: estimate PA from games played (avg ~4 PA/game)
  const estimatedPA = split.gamesPlayed * 4;

  const splitAvgNum = parseFloat(split.avg) || 0;
  const rawBoost = seasonAvg > 0 ? ((splitAvgNum - seasonAvg) / seasonAvg) * 100 : 0;

  // Sample-size protection: reduce weight based on PA count
  let sampleWeight: number;
  if (estimatedPA < 20) {
    // Under 20 PA: ignore completely — return neutral
    return { score: 50, boost: 0, favorable: false, splitAvg: splitAvgNum, splitOPS: parseFloat(split.ops) || 0, splitHits: split.hits, splitGames: split.gamesPlayed };
  } else if (estimatedPA < 30) {
    sampleWeight = 0.10; // 10% weight — informational only
  } else if (estimatedPA < 50) {
    sampleWeight = 0.50; // 50% weight — reduced
  } else {
    sampleWeight = 1.00; // Full weight
  }

  const adjustedBoost = rawBoost * sampleWeight;
  const favorable = adjustedBoost > 5;
  const score = Math.min(100, Math.max(0, 50 + adjustedBoost * 1.5));

  return {
    score,
    boost: Math.round(adjustedBoost),
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
 * Calculate VS Gate boost/penalty from vsGrade (0-10 normalized scale)
 * Phase W calibration: reduced influence so BP doesn't act as a hidden hard gate.
 * Grade 10 → +12, Grade 9 → +8, Grade 8 → +4, Grade 7 → 0, Grade 6 → -4, Grade ≤5 → -6
 */
function calculateBPBoost(vsGrade: number | null): number {
  if (vsGrade === null) return 0; // No data = neutral
  if (vsGrade >= 9.0) return 15;  // Grade 9-10: elite matchup
  if (vsGrade >= 7.5) return 10;  // Grade 7.5-9: strong matchup
  if (vsGrade >= 6.0) return 5;   // Grade 6-7.5: good matchup
  if (vsGrade >= 4.5) return 0;   // Grade 4.5-6: neutral
  if (vsGrade >= 3.0) return -3;  // Grade 3-4.5: slightly unfavorable
  return -6;                       // Grade < 3: clearly bad matchup
}

/**
 * Determine pick grade tier from final score
 * Phase CN calibration: Elite=85+, Strong=78-84, Lean=72-77, hidden below 72
 */
function getPickGrade(score: number): PickGrade {
  if (score >= 85) return 'elite';    // raised from 83 — only truly exceptional picks
  if (score >= 78) return 'strong';   // raised from 74 — meaningful quality signal
  if (score >= 72) return 'watchlist'; // lean tier only
  return 'watchlist';
}

// ─── Main ranking function ────────────────────────────────────────────────────

/**
 * Rank AI picks using the Phase R/S scoring model.
 *
 * VS Gate is a BOOST/PENALTY on the final score, not a hard gate.
 * The only hard exclusion is when ALL 4 negatives are present simultaneously.
 *
 * S3: Real bullpen fatigue replaces ERA-proxy for Factor 8.
 * S4: theLAB edge score applied as a post-scoring boost.
 * S5: Correlation cap — max 3 picks per game, max 4 per team.
 *
   * Quality gate: 4 Elite (83+) + 6 Strong (74-82) + 3 Lean (68-73) = max 13 picks.
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
  // Raw matchups for kProb, hrProb access (legacy — kept for type compat, always empty now)
  ballparkMatchups?: BallparkMatchup[],
  // S3: Bullpen fatigue map (opponentTeamId -> BullpenFatigue)
  bullpenFatigueMap?: Map<number, BullpenFatigue>,
  // S4: theLAB edge scores (playerName -> edgeScore 0-100)
  edgeScoreMap?: Map<string, number>,
  // Lineup source: 'confirmed' | 'projected' | 'mixed' — lowers thresholds for projected lineups
  lineupSource?: string
): AIPick[] {

      // ── Auto-exclude: only when ALL 4 negatives stack ─────────────────────────
  // Internal VS gate: boost/penalty based on Diamond Edge matchup score.
  const picks = matchups
    .map((matchup) => {
      const playerData = playerDataMap.get(matchup.playerId);
      const hrTargets = hrTargetsMap.get(matchup.playerName);
      const parkFactor = parkFactors.get(matchup.team) || 1.0;

      if (!playerData) return null;

      // ── VS grade (internal Diamond Edge matchup score) ─────────────────
      const vsGrade = vsGradeMap?.get(matchup.playerName) ?? null;

      // ── Game Total (O/U) environment ──────────────────────────────────────
      const gameTotalData = gameTotalsMap ? getGameTotalScoreForTeam(matchup.team, gameTotalsMap) : null;
      const gameTotalScore = gameTotalData?.score ?? 50;
      const gameTotalOU = gameTotalData?.overUnder ?? null;

      // ── Statcast data ─────────────────────────────────────────────────────
      const statcastPlayer = statcastCache
        ? (statcastCache.byId.get(matchup.playerId) ?? lookupStatcastPlayer(statcastCache, matchup.playerName))
        : null;

      // kProb: from ballparkMatchups if provided (legacy), otherwise null
      const bpMatchup = (ballparkMatchups ?? []).find(bp =>
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

      // Rule 3: kProb ≥ 30% (very high strikeout risk)
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

      // ── Factor 2: Lineup Spot / Projected PA (15%) — S2 upgrade ─────────
      // S2: Use projected PA model instead of raw batting position weight
      const projectedPA = getProjectedPA(matchup.battingPosition, gameTotalOU);
      const lineupSpotScore = projectedPAToScore(projectedPA);

      // ── Factor 3: OBP / xwOBA (14%) — S1 upgrade ─────────────────────────
      // S1: blend OBP with rolling contact quality (xwOBA + Hard-Hit + Exit Velo)
      const xwOBAPercentile = statcastPlayer?.xwOBAPercentile ?? null;
      const hardHitPercentile = statcastPlayer?.hardHitPercentile ?? null;
      const exitVeloPercentile = statcastPlayer?.exitVeloPercentile ?? null;
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

        // ── Factor 8: Bullpen Weakness (6%) — S3 upgrade ─────────────────
      // S3: Use real bullpen fatigue data if available, else fall back to ERA proxy
      let bullpenWeaknessScore: number;
      if (bullpenFatigueMap && matchup.opponentTeamId) {
        const fatigue = getBullpenFatigueScore(matchup.opponentTeamId, bullpenFatigueMap);
        bullpenWeaknessScore = fatigue.score; // 0-100: higher = more tired = scoring opportunity
      } else {
        bullpenWeaknessScore = calculateBullpenWeaknessScore(
          matchup.pitcher.era,
          matchup.confidence
        );
      }

      // ── Factor 9: Platoon Advantage (5%) ─────────────────────────────────
      const platoonScore = calculateHandednessAdvantage(
        playerData.handedness,
        matchup.pitcher.handedness,
        matchup.platoonSplit
      );

      // ── Factor 10: Hard Contact / Barrel (4%) — S1 upgrade ──────────────
      // S1: Use rolling contact quality blend (barrel + hard-hit + exit velo)
      const barrelPercentile = statcastPlayer?.barrelPercentile ?? 50;
      const hardContactScore = calculateRollingContactScore(
        xwOBAPercentile,
        hardHitPercentile,
        exitVeloPercentile,
        barrelPercentile
      );

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

      // ── Matchup Grade boost/penalty (Diamond Edge VS gate) ─────────────
      const bpBoost = calculateBPBoost(vsGrade);

      // ── S4: Edge-based boost (theLAB edge score) ──────────────────────────
      // theLAB edge score: 0-100. Edge > 60 = strong value, > 80 = elite value.
      // Boost: edge 80+ = +8, edge 60-79 = +4, edge 40-59 = 0, edge < 40 = -3
      const edgeScore = edgeScoreMap?.get(matchup.playerName) ?? null;
      let edgeBoost = 0;
      if (edgeScore !== null) {
        if (edgeScore >= 80) edgeBoost = 8;
        else if (edgeScore >= 60) edgeBoost = 4;
        else if (edgeScore < 40) edgeBoost = -3;
      }

      // ── Soft penalties (Phase W: reduced severity) ───────────────────────
      let softPenalty = 0;
      // Lineup position: graduated penalty (7th=-2, 8th=-3, 9th=-5 only with weak env)
      if (matchup.battingPosition === 7) softPenalty -= 2;
      else if (matchup.battingPosition === 8) softPenalty -= 3;
      else if (matchup.battingPosition >= 9) {
        // 9th spot: -5 only when combined with weak game environment
        const weakEnv = gameTotalOU !== null && gameTotalOU < 7.5;
        softPenalty -= weakEnv ? 5 : 2;
      }
      // Weather: max -4 total (cold=-2, wind-in=-2)
      if (matchup.weather) {
        const wd = matchup.weather.windDirection.toLowerCase();
        const isHeadwind = wd.includes('in') || wd === 'n' || wd === 'ne' || wd === 'nw';
        if (isHeadwind && matchup.weather.windSpeed > 10) softPenalty -= 2;
        if (matchup.weather.temperature < 50) softPenalty -= 2;
      }
      // Cold streak: reduced from -5 to -3
      if (recentFormResult.streakType === 'cold') softPenalty -= 3;
      // Strikeout risk: -2 to -4 (no large double-digit penalties)
      if (kProb !== null && kProb >= 28) softPenalty -= 4;
      else if (kProb !== null && kProb >= 22) softPenalty -= 2;

        // ── Final score (S4: include edge boost) ──────────────────────────────
      const overallScore = Math.min(100, Math.max(0, Math.round(baseScore + bpBoost + softPenalty + edgeBoost)));

      // Phase AQ: per-player score debug logging — helps trace why one player dominates
      console.log(`[rankAIPicks] SCORE ${matchup.playerName} (${matchup.team} bat${matchup.battingPosition}): overall=${overallScore} base=${Math.round(baseScore)} bpBoost=${Math.round(bpBoost)} penalty=${Math.round(softPenalty)} | teamImplied=${Math.round(teamImpliedScore)} lineup=${Math.round(lineupSpotScore)} obpXwOBA=${Math.round(obpXwOBAScore)} pitcher=${Math.round(pitcherWeaknessScore)} form=${Math.round(recentFormScore)} dayNight=${Math.round(dayNightScore)} park=${Math.round(parkWeatherScore)} bullpen=${Math.round(bullpenWeaknessScore)} platoon=${Math.round(platoonScore)} barrel=${Math.round(hardContactScore)} vsGrade=${vsGrade !== null ? Math.round(vsGrade * 10) / 10 : 'null'} GP=${playerData.gamesPlayed ?? 40}`);

      // ── Build reasons (WHY THIS PLAY QUALIFIES) ───────────────────────────
      const reasons: string[] = [];
      if (vsGrade !== null && vsGrade >= 9.5) reasons.push(`Elite matchup grade (VS ${Math.round(vsGrade)}/10 — xwOBA + ERA edge)`);
      else if (vsGrade !== null && vsGrade >= 8.5) reasons.push(`Strong matchup grade (VS ${Math.round(vsGrade)}/10)`);
      else if (vsGrade !== null && vsGrade >= 7.5) reasons.push(`Favorable matchup grade (VS ${Math.round(vsGrade)}/10)`);
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
      if (bpBoost > 0) reasons.push(`Matchup grade boost: +${bpBoost} pts (favorable VS score)`);

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
      if (bpBoost < 0) riskFlags.push(`Matchup grade penalty: ${bpBoost} pts (poor VS score)`);
      if (gameTotalOU !== null && gameTotalOU < 7.0) riskFlags.push(`Low game total (O/U ${gameTotalOU}) — limited scoring`);

      // ── Legacy reasoning string ───────────────────────────────────────────
      const reasoning = reasons.slice(0, 3).join(" • ") || "Solid matchup";
      const parkFactorValue = parkFactor > 1.05 ? "hitter-friendly" : parkFactor < 0.95 ? "pitcher-friendly" : "neutral";
      const ouStr = gameTotalOU !== null ? ` Game O/U: ${gameTotalOU}.` : "";
      const ballparkReasoning = `Playing at ${parkFactorValue} park.${ouStr} ${matchup.weather ? `Weather: ${matchup.weather.temperature}°F, ${matchup.weather.windSpeed}mph ${matchup.weather.windDirection}` : ''}`;
      // ── Best stat type ────────────────────────────────────────────────────
      const stats = playerData.stats;
      // Phase AO: use real gamesPlayed for per-game normalization (was hardcoded 40)
      const gamesPlayed = playerData.gamesPlayed && playerData.gamesPlayed >= 5 ? playerData.gamesPlayed : 40;
      // Normalize to per-game rates for fair comparison across players with different GP
      const hitsPerGame = stats.hits / gamesPlayed;
      const runsPerGame = stats.runs / gamesPlayed;
      const rbiPerGame = stats.rbi / gamesPlayed;
      // MLB season benchmarks: ~0.9 H/G, ~0.55 R/G, ~0.55 RBI/G for average hitter
      const STAT_PRIORITY_BONUS = { hits: 0.10, runs: 0.05, rbi: 0 };
      const statScores = {
        hits: hitsPerGame + STAT_PRIORITY_BONUS.hits,
        runs: runsPerGame + STAT_PRIORITY_BONUS.runs,
        rbi: rbiPerGame + STAT_PRIORITY_BONUS.rbi,
      };
      const bestStat = Object.entries(statScores).reduce((a, b) => (a[1] > b[1] ? a : b))[0] as 'hits' | 'runs' | 'rbi';

      // ── Prop line ─────────────────────────────────────────────────────────
      // Phase CN fix: set line at realistic level player can clear ~60% of the time.
      // Never use 1.5 for players averaging <1.3/game — they'll miss >50% naturally.
      const perGameAvg = statScores[bestStat];
      const line = perGameAvg >= 1.3 ? 1.5 : 0.5;

      // ── Pick grade ────────────────────────────────────────────────────
      const grade = getPickGrade(overallScore);
      const leanTier = overallScore >= 72 && overallScore < 78;

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
          // Phase AO: normalize by real gamesPlayed (MLB avg: 0.9 H/G, 0.55 R/G, 0.55 RBI/G)
          hits: Math.round(Math.min(100, (hitsPerGame / 0.9) * 100 * (overallScore / 100))),
          runs: Math.round(Math.min(100, (runsPerGame / 0.55) * 100 * (overallScore / 100))),
          rbi: Math.round(Math.min(100, (rbiPerGame / 0.55) * 100 * (overallScore / 100))),
          slg: Math.round(Math.min(100, (stats.slg / 0.500) * 100 * (overallScore / 100))),
        },
        prediction: "over" as const,
        line,
        confidence: overallScore,
        reasoning,
        reasons,
        riskFlags,
        grade,
        bpBoost,
        baseScore: Math.round(baseScore),
        overallScore,
        leanTier,
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
          // Legacy aliases (rc/hrTargets removed Phase AZ)
          playerStats: Math.round(Math.min(100, (hitsPerGame / 0.9) * 100)),
          parkFactors: Math.round(Math.min(100, ((parkFactor - 0.8) / 0.5) * 100)),
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

      // Attach projected PA (S2)
      pick.projectedPA = Math.round(projectedPA * 10) / 10;

      // Attach S4 edge score
      if (edgeScore !== null) {
        if (!pick.odds) pick.odds = { line: pick.line };
        pick.odds.edge = edgeScore;
      }

      // Attach S3 bullpen fatigue label as risk flag or reason
      if (bullpenFatigueMap && matchup.opponentTeamId) {
        const fatigue = getBullpenFatigueScore(matchup.opponentTeamId, bullpenFatigueMap);
        if (fatigue.score >= 75) {
          pick.reasons.push(`Exhausted bullpen (${fatigue.label} — ${fatigue.score}/100 fatigue)`);
        } else if (fatigue.score >= 50) {
          pick.reasons.push(`Tired bullpen (${fatigue.label} — ${fatigue.score}/100 fatigue)`);
        } else if (fatigue.score <= 20) {
          pick.riskFlags.push(`Fresh bullpen — limited late-game scoring opportunity`);
        }
      }

      // Attach VS Gate xwOBA data for tooltip display
      const statcastBatter = statcastCache?.data?.get(matchup.playerName.toLowerCase());
      const pitcherId = matchup.pitcher?.id;
      const statcastPitcher = (pitcherId && statcastCache?.pitchers) ? statcastCache.pitchers.get(pitcherId) : undefined;
      if (statcastBatter || statcastPitcher || vsGrade !== null) {
        const batterXwOBAraw = statcastBatter?.xwOBA ?? undefined;
        const pitcherXwOBAraw = statcastPitcher?.xwOBAAgainst ?? undefined;
        const xwOBADelta = batterXwOBAraw !== undefined && pitcherXwOBAraw !== undefined
          ? Math.round((batterXwOBAraw - pitcherXwOBAraw) * 1000) / 1000
          : undefined;
        const tier = vsGrade !== null
          ? (vsGrade >= 7.5 ? 'STRONG' : vsGrade >= 5.5 ? 'MODERATE' : 'BAD')
          : undefined;
        pick.vsGateData = {
          batterXwOBA: batterXwOBAraw !== undefined ? Math.round(batterXwOBAraw * 1000) / 1000 : undefined,
          pitcherXwOBAAgainst: pitcherXwOBAraw !== undefined ? Math.round(pitcherXwOBAraw * 1000) / 1000 : undefined,
          xwOBADelta,
          tier,
          score: vsGrade !== null ? Math.round(vsGrade * 10) / 10 : undefined,
        };
      }

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

      // Phase AW: Attach value analysis (EV, fair odds, value tier, mispricing)
      // Use the pick's book odds if available, else skip
      const bookOddsForValue = pick.odds?.overOdds
        ? parseInt(String(pick.odds.overOdds).replace(/[^0-9+-]/g, ''), 10)
        : null;
      if (bookOddsForValue !== null && !isNaN(bookOddsForValue)) {
        // True probability: use overallScore as a proxy (scaled to 35-85% range)
        // Higher score → higher true probability
        const trueProb = Math.round(35 + (overallScore / 100) * 50);
        // Alt lines: no direct access to hrrMarketData here, pass empty array
        // (alt lines are enriched later in hrrPicksService when HRRMarketData is available)
        pick.valueAnalysis = analyzeValue(trueProb, bookOddsForValue, []);
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

  // ── Quality gate: expanded tiers with guaranteed minimum ──
  // Phase AR: Lowered thresholds so more players qualify across all tiers.
  // Guaranteed minimum: if fewer than 5 picks qualify, fill from top scorers.
  // For projected lineups, lower thresholds by 8 pts.
  const isProjected = lineupSource === 'projected' || lineupSource === 'mixed';
  const THRESHOLD_REDUCTION = isProjected ? 8 : 0;
  const ELITE_THRESHOLD = 78 - THRESHOLD_REDUCTION;   // 70 for projected, 78 for confirmed
  const STRONG_THRESHOLD = 68 - THRESHOLD_REDUCTION;  // 60 for projected, 68 for confirmed
  const LEAN_THRESHOLD = 50 - THRESHOLD_REDUCTION;    // 42 for projected, 50 for confirmed (lowered from 55 to include more good picks)
  if (isProjected) {
    console.log(`[rankAIPicks] Projected lineups detected — thresholds lowered by ${THRESHOLD_REDUCTION} pts (Elite≥${ELITE_THRESHOLD}, Strong≥${STRONG_THRESHOLD}, Lean≥${LEAN_THRESHOLD})`);
  }
  const MAX_ELITE = 5;   // raised from 4
  const MAX_STRONG = 8;   // raised from 6
  const MAX_LEAN = 8;     // raised from 6 — more lean picks when slate is deep
  const GUARANTEED_MIN = 5; // always surface at least this many picks

  // S5: Correlation cap — prevent over-stacking same game or same team
  // Max 4 picks per game (gamePk), max 5 picks per team (raised to allow more good picks)
  const MAX_PER_GAME = 4;
  const MAX_PER_TEAM = 5;

  function applyCorrelationCap(candidates: AIPick[], maxCount: number): AIPick[] {
    const gameCount = new Map<number, number>();
    const teamCount = new Map<string, number>();
    const result: AIPick[] = [];

    for (const pick of candidates) {
      const gamePk = (pick as any)._gamePk as number | undefined;
      const team = pick.team;

      const gc = gamePk ? (gameCount.get(gamePk) ?? 0) : 0;
      const tc = teamCount.get(team) ?? 0;

      if (gc >= MAX_PER_GAME || tc >= MAX_PER_TEAM) continue;

      result.push(pick);
      if (gamePk) gameCount.set(gamePk, gc + 1);
      teamCount.set(team, tc + 1);

      if (result.length >= maxCount) break;
    }
    return result;
  }

  // Attach gamePk to each pick for correlation tracking
  const picksWithGamePk = picks.map((pick, i) => ({
    ...pick,
    _gamePk: matchups.find(m => m.playerId === pick.playerId)?.gamePk,
  }));

  const eliteCandidates = picksWithGamePk.filter(p => p.overallScore >= ELITE_THRESHOLD);
  const strongCandidates = picksWithGamePk.filter(p => p.overallScore >= STRONG_THRESHOLD && p.overallScore < ELITE_THRESHOLD);
  const leanCandidates = picksWithGamePk.filter(p => p.overallScore >= LEAN_THRESHOLD && p.overallScore < STRONG_THRESHOLD);

  const elitePicks = applyCorrelationCap(eliteCandidates, MAX_ELITE);
  const strongPicks = applyCorrelationCap(strongCandidates, MAX_STRONG);
  const leanPicks = applyCorrelationCap(leanCandidates, MAX_LEAN);

  const qualityPicks = [...elitePicks, ...strongPicks, ...leanPicks].map((pick, index) => ({
    ...pick,
    rank: index + 1,
  }));

  console.log(`[rankAIPicks] Quality gate: ${picks.length} scored → ${elitePicks.length} Elite (≥${ELITE_THRESHOLD}) + ${strongPicks.length} Strong (≥${STRONG_THRESHOLD}) + ${leanPicks.length} Lean (≥${LEAN_THRESHOLD}) = ${qualityPicks.length} picks`);

  // ── Guaranteed minimum: always return at least GUARANTEED_MIN picks ────────────────────────────────────
  // If fewer than GUARANTEED_MIN picks passed the quality gate, fill from the
  // top-scoring remaining candidates (no threshold, pure relative ranking).
  // This ensures the site always shows 5-8 picks regardless of slate strength.
  if (qualityPicks.length < GUARANTEED_MIN && picks.length > 0) {
    const qualityPickIds = new Set(qualityPicks.map(p => p.playerId));
    const remaining = picksWithGamePk
      .filter(p => !qualityPickIds.has(p.playerId))
      .slice(0, GUARANTEED_MIN - qualityPicks.length)
      .map(p => ({ ...p, leanTier: true, isFilledPick: true })); // tag as projection-only fills
    const filledPicks = [...qualityPicks, ...remaining].map((pick, index) => ({
      ...pick,
      rank: index + 1,
    }));
    console.log(`[rankAIPicks] Guaranteed minimum: filled ${remaining.length} picks from top scorers → total ${filledPicks.length}`);
    return filledPicks;
  }

  return qualityPicks;
}

/**
 * Phase AP: getMockHRTargets returns an empty Map.
 * Hardcoded player grades were removed to eliminate scoring bias.
 * HR target grades are derived from real Statcast barrel/xwOBA data via statcastCache.
 */
export function getMockHRTargets(): Map<string, HRTargetData> {
  return new Map<string, HRTargetData>();
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
