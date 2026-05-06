import { BallparkPlayerStats } from "./ballpark";

/**
 * Prop prediction model for H/R/RBI with 80% target hit rate
 * Uses player season stats, park factors, and matchup context
 */

export interface PropPrediction {
  stat: "hits" | "runs" | "rbi";
  prediction: "over" | "under";
  line: number;
  confidence: number; // 0-100
  reasoning: string;
  expectedValue: number;
}

export interface PlayerPropModel {
  playerId: number;
  playerName: string;
  team: string;
  position: string;
  hitsPrediction: PropPrediction;
  runsPrediction: PropPrediction;
  rbiPrediction: PropPrediction;
  overallConfidence: number;
}

/**
 * Calculate season average for a stat
 */function getSeasonAverage(
  stat: number,
  gamesPlayed: number
): number {
  return gamesPlayed > 0 ? stat / gamesPlayed : 0;
}

/**
 * Apply park factor adjustment to a stat
 */
function applyParkFactor(
  stat: number,
  parkFactor: number
): number {
  // Park factor > 1.0 means favorable for that stat
  return stat * (parkFactor / 100);
}

/**
 * Calculate confidence score based on sample size and consistency
 */
function calculateConfidence(
  average: number,
  line: number,
  gamesPlayed: number,
  variance: number
): number {
  // Base confidence from games played (more games = more confidence)
  const sampleConfidence = Math.min(gamesPlayed / 162, 1) * 40; // 0-40 points

  // Confidence from how far stat is from line
  const distanceFromLine = Math.abs(average - line);
  const distanceConfidence = Math.max(0, 30 - distanceFromLine * 10); // 0-30 points

  // Confidence from low variance (consistency)
  const varianceConfidence = Math.max(0, 30 - variance * 5); // 0-30 points

  return Math.round(sampleConfidence + distanceConfidence + varianceConfidence);
}

/**
 * Generate prop prediction for a single stat
 */
function generateStatPrediction(
  stat: "hits" | "runs" | "rbi",
  playerStats: BallparkPlayerStats,
  oddsLine: number,
  gamesPlayed: number
): PropPrediction {
  const statValue = playerStats[stat];
  const parkFactor = playerStats.parkFactor[stat] || 100;

  // Calculate season average
  const seasonAverage = getSeasonAverage(statValue, gamesPlayed);

  // Apply park factor adjustment
  const adjustedAverage = applyParkFactor(seasonAverage, parkFactor);

  // Estimate variance (simplified)
  const variance = Math.sqrt(adjustedAverage) / adjustedAverage;

  // Calculate confidence
  const confidence = calculateConfidence(
    adjustedAverage,
    oddsLine,
    gamesPlayed,
    variance
  );

  // Determine prediction
  const prediction = adjustedAverage > oddsLine ? "over" : "under";

  // Calculate expected value
  const expectedValue = Math.abs(adjustedAverage - oddsLine);

  // Generate reasoning
  const reasoning = `${playerStats.playerName} averaged ${adjustedAverage.toFixed(2)} ${stat} per game (${gamesPlayed} GP). Park factor: ${parkFactor}%. Line: ${oddsLine}. Prediction: ${prediction.toUpperCase()}.`;

  return {
    stat,
    prediction,
    line: oddsLine,
    confidence,
    reasoning,
    expectedValue,
  };
}

/**
 * Generate full prop model for a player
 */
export function generatePlayerPropModel(
  playerStats: BallparkPlayerStats,
  oddsLines: {
    hits: number;
    runs: number;
    rbi: number;
  },
  gamesPlayed: number
): PlayerPropModel {
  const hitsPrediction = generateStatPrediction(
    "hits",
    playerStats,
    oddsLines.hits,
    gamesPlayed
  );
  const runsPrediction = generateStatPrediction(
    "runs",
    playerStats,
    oddsLines.runs,
    gamesPlayed
  );
  const rbiPrediction = generateStatPrediction(
    "rbi",
    playerStats,
    oddsLines.rbi,
    gamesPlayed
  );

  // Calculate overall confidence (average of three stats, weighted by expected value)
  const totalEV =
    hitsPrediction.expectedValue +
    runsPrediction.expectedValue +
    rbiPrediction.expectedValue;

  const overallConfidence = Math.round(
    (hitsPrediction.confidence * hitsPrediction.expectedValue +
      runsPrediction.confidence * runsPrediction.expectedValue +
      rbiPrediction.confidence * rbiPrediction.expectedValue) /
      (totalEV || 1)
  );

  return {
    playerId: playerStats.playerId,
    playerName: playerStats.playerName,
    team: playerStats.team,
    position: playerStats.position,
    hitsPrediction,
    runsPrediction,
    rbiPrediction,
    overallConfidence,
  };
}

/**
 * Filter predictions by confidence threshold
 */
export function filterHighConfidencePredictions(
  predictions: PlayerPropModel[],
  minConfidence: number = 75
): PlayerPropModel[] {
  return predictions.filter((p) => p.overallConfidence >= minConfidence);
}

/**
 * Sort predictions by confidence (descending)
 */
export function sortByConfidence(
  predictions: PlayerPropModel[]
): PlayerPropModel[] {
  return [...predictions].sort(
    (a, b) => b.overallConfidence - a.overallConfidence
  );
}

/**
 * Calculate model performance metrics
 */
export function calculateModelPerformance(
  predictions: Array<{
    prediction: "over" | "under";
    actual: number;
    line: number;
  }>
): {
  totalPredictions: number;
  correctPredictions: number;
  hitRate: number;
} {
  const totalPredictions = predictions.length;
  const correctPredictions = predictions.filter((p) => {
    const wasOver = p.actual > p.line;
    return (wasOver && p.prediction === "over") ||
      (!wasOver && p.prediction === "under")
      ? 1
      : 0;
  }).length;

  const hitRate =
    totalPredictions > 0
      ? Math.round((correctPredictions / totalPredictions) * 100)
      : 0;

  return {
    totalPredictions,
    correctPredictions,
    hitRate,
  };
}
