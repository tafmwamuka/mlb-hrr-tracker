/**
 * Poisson Probability Model for HRR Props
 * 
 * HRR (Hits + Runs + RBI) follows approximately a Poisson distribution
 * because each component is a count of rare events per game.
 * 
 * We use a shifted Poisson (or compound Poisson) to model the combined total.
 * The key insight: if H~Poisson(λ_h), R~Poisson(λ_r), RBI~Poisson(λ_rbi),
 * then H+R+RBI ~ Poisson(λ_h + λ_r + λ_rbi) approximately.
 * 
 * This gives us true probabilities for OVER/UNDER at any line.
 */

/**
 * Calculate Poisson probability P(X = k) for a given lambda
 */
export function poissonPMF(k: number, lambda: number): number {
  if (k < 0 || lambda <= 0) return 0;
  // Use log to avoid overflow for large k
  let logProb = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) {
    logProb -= Math.log(i);
  }
  return Math.exp(logProb);
}

/**
 * Calculate P(X <= k) - cumulative distribution function
 */
export function poissonCDF(k: number, lambda: number): number {
  if (lambda <= 0) return 1;
  let sum = 0;
  for (let i = 0; i <= Math.floor(k); i++) {
    sum += poissonPMF(i, lambda);
  }
  return Math.min(1, sum);
}

/**
 * Calculate P(X > line) - probability of going OVER a line
 * For half-integer lines (e.g., 2.5), this is P(X >= 3) = 1 - P(X <= 2)
 * For integer lines (e.g., 3), OVER means P(X > 3) = 1 - P(X <= 3)
 */
export function poissonOverProbability(line: number, lambda: number): number {
  // For sportsbook lines, they're always X.5 (e.g., 1.5, 2.5, 3.5)
  // OVER 2.5 means X >= 3, so P(X > 2.5) = 1 - P(X <= 2)
  const threshold = Math.floor(line);
  return 1 - poissonCDF(threshold, lambda);
}

/**
 * Calculate alternate lines with probabilities for a given expected total (lambda)
 * Returns lines from 0.5 to max reasonable value with OVER probabilities
 */
export function calculateAlternateLines(
  lambda: number,
  maxLine: number = 6.5
): { line: number; overProb: number; underProb: number }[] {
  const lines: { line: number; overProb: number; underProb: number }[] = [];
  
  for (let line = 0.5; line <= maxLine; line += 1.0) {
    const overProb = poissonOverProbability(line, lambda);
    // Only include lines where over prob is between 5% and 95%
    if (overProb >= 0.05 && overProb <= 0.95) {
      lines.push({
        line,
        overProb: Math.round(overProb * 1000) / 1000,
        underProb: Math.round((1 - overProb) * 1000) / 1000,
      });
    }
  }
  
  return lines;
}

/**
 * Find the "fair" line — where over probability is closest to 50%
 */
export function findFairLine(lambda: number): number {
  let bestLine = 1.5;
  let bestDiff = 1;
  
  for (let line = 0.5; line <= 8.5; line += 1.0) {
    const overProb = poissonOverProbability(line, lambda);
    const diff = Math.abs(overProb - 0.5);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestLine = line;
    }
  }
  
  return bestLine;
}

/**
 * Calculate edge: our model probability vs implied sportsbook probability
 * Positive edge = model thinks OVER is more likely than the book does
 */
export function calculateEdge(modelProb: number, bookImpliedProb: number): number {
  return modelProb - bookImpliedProb;
}

/**
 * Determine pick quality based on edge and optional Poisson probability.
 * Integration Patch: PQS system — quality based on probability, not just edge.
 */
export function getPickQuality(
  edge: number,
  overProb?: number  // Poisson model probability (0-1 scale)
): "strong" | "moderate" | "lean" | "avoid" {
  const prob = (overProb ?? 0.5) * 100; // convert to 0-100

  // Primary check: probability gate
  if (prob >= 70 && edge >= 0.04) return "strong";
  if (prob >= 60 && edge >= 0.02) return "moderate";
  if (prob >= 50 && edge >= 0.01) return "lean";
  if (prob >= 60 && edge < 0) return "lean";  // high prob but negative edge — still show
  return "avoid";
}
