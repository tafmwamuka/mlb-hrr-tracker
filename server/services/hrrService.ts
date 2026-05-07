/**
 * HRR (Hits + Runs + RBI) Combined Prop Service
 * 
 * Calculates combined H+R+RBI projections using:
 * - Real player season stats (per-game averages)
 * - Park factor adjustments
 * - Savant metrics (xwOBA, Hard Hit%, etc.)
 * - Ballpark.com RC data
 * - Batting position weighting
 * 
 * HRR is a popular sportsbook prop where you bet on a player's
 * combined Hits + Runs + RBI total for a single game.
 */

export interface HRRProjection {
  playerId: number;
  playerName: string;
  team: string;
  position: string;
  battingPosition: number;
  pitcher: string;
  pitcherTeam: string;
  // Per-game stat projections (based on season stats + adjustments)
  expectedHits: number;
  expectedRuns: number;
  expectedRBI: number;
  expectedTotal: number;
  // The HRR line (rounded to nearest 0.5, set slightly below expected)
  hrrLine: number;
  // Edge: how much expected total exceeds the line
  edge: number;
  // HRR-specific confidence (0-100) based on edge + consistency + matchup
  hrrConfidence: number;
  // Data source scores
  rcScore: number;
  combinedScore: number;
  parkFactor: number;
  // Savant metrics if available
  savantMetrics?: {
    xwOBA: number;
    hardHitPct: number;
    exitVelocity: number;
    barrelPct: number;
  };
  // Reasoning
  reasoning: string;
  ballparkReasoning: string;
}

interface PlayerStats {
  hits: number;
  runs: number;
  rbi: number;
  slg: number;
  avg: number;
  obp: number;
  power: number;
}

interface PlayerData {
  playerId: number;
  name: string;
  team: string;
  position: string;
  battingPosition: number;
  handedness: 'R' | 'L' | 'S';
  stats: PlayerStats;
  recentForm?: {
    last15Games: {
      hits: number;
      runs: number;
      rbi: number;
      avg: number;
    };
    trend: 'hot' | 'cold' | 'neutral';
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
    handedness: 'R' | 'L';
    era: number;
  };
  rc: number;
  confidence: number;
}

/**
 * Calculate per-game average for a stat
 * Uses 40 games as baseline (early-mid season)
 */
export function calculatePerGameAverage(seasonTotal: number, gamesPlayed: number = 40): number {
  if (gamesPlayed <= 0) return 0;
  return seasonTotal / gamesPlayed;
}

/**
 * Apply park factor adjustment to per-game average
 * Park factor > 1.0 = hitter-friendly, < 1.0 = pitcher-friendly
 */
export function applyParkFactor(perGameAvg: number, parkFactor: number): number {
  return perGameAvg * parkFactor;
}

/**
 * Apply batting position boost
 * Middle-of-order hitters (3-5) get more RBI/run opportunities
 */
export function applyBattingPositionBoost(
  stat: 'hits' | 'runs' | 'rbi',
  value: number,
  battingPosition: number
): number {
  const boosts: Record<string, Record<number, number>> = {
    hits: { 1: 1.05, 2: 1.03, 3: 1.02, 4: 1.0, 5: 0.98, 6: 0.97, 7: 0.95, 8: 0.93, 9: 0.90 },
    runs: { 1: 1.15, 2: 1.10, 3: 1.05, 4: 1.03, 5: 1.0, 6: 0.95, 7: 0.92, 8: 0.90, 9: 0.85 },
    rbi: { 1: 0.85, 2: 0.90, 3: 1.10, 4: 1.15, 5: 1.10, 6: 1.05, 7: 1.0, 8: 0.95, 9: 0.85 },
  };
  const boost = boosts[stat][battingPosition] || 1.0;
  return value * boost;
}

/**
 * Apply recent form adjustment
 * Hot streaks get a boost, cold streaks get a penalty
 */
function applyRecentFormAdjustment(
  perGameAvg: number,
  recentForm?: PlayerData['recentForm']
): number {
  if (!recentForm) return perGameAvg;
  
  switch (recentForm.trend) {
    case 'hot': return perGameAvg * 1.08; // 8% boost for hot streak
    case 'cold': return perGameAvg * 0.92; // 8% penalty for cold streak
    default: return perGameAvg;
  }
}

/**
 * Calculate the HRR line from expected total
 * Sportsbooks set lines slightly below expected to create balanced action
 * Lines are always in 0.5 increments: 1.5, 2.5, 3.5, 4.5, 5.5, 6.5
 */
export function calculateHRRLine(expectedTotal: number): number {
  // Round down to nearest 0.5 (the "under" side of the expected value)
  // This creates a slight edge for the OVER bettor when the model is accurate
  const line = Math.floor(expectedTotal * 2) / 2;
  
  // Ensure minimum line of 1.5 (realistic sportsbook minimum for HRR)
  // and maximum of 6.5 (even elite hitters rarely get lines above this)
  return Math.max(1.5, Math.min(6.5, line));
}

/**
 * Calculate HRR-specific confidence score
 * Based on: edge over line, player consistency, matchup quality, sample size
 */
export function calculateHRRConfidence(
  expectedTotal: number,
  hrrLine: number,
  combinedScore: number,
  rcScore: number,
  battingPosition: number
): number {
  // Edge component (0-40 points): how far above the line
  const edge = expectedTotal - hrrLine;
  const edgeScore = Math.min(40, Math.max(0, edge * 30));
  
  // Combined data quality (0-30 points): Savant + Ballpark combined score
  const dataScore = (combinedScore / 100) * 30;
  
  // RC component (0-15 points): ballpark.com matchup quality
  const rcComponent = (rcScore / 100) * 15;
  
  // Batting position (0-15 points): middle of order = more opportunities
  const positionWeights: Record<number, number> = {
    1: 10, 2: 12, 3: 14, 4: 15, 5: 14, 6: 12, 7: 10, 8: 8, 9: 6,
  };
  const positionScore = positionWeights[battingPosition] || 8;
  
  const total = Math.round(edgeScore + dataScore + rcComponent + positionScore);
  return Math.max(50, Math.min(98, total)); // Floor at 50, cap at 98
}

/**
 * Generate HRR projections from player data and matchups
 * This is the main function that produces HRR-specific picks
 * sorted by HRR over probability (not general AI pick order)
 */
export function generateHRRProjections(
  matchups: MatchupData[],
  playerDataMap: Map<number, PlayerData>,
  parkFactors: Map<string, number>,
  savantData?: Map<string, { xwOBA: number; hardHitPct: number; exitVelocity: number; barrelPct: number }>
): HRRProjection[] {
  const projections: HRRProjection[] = matchups
    .map((matchup) => {
      const playerData = playerDataMap.get(matchup.playerId);
      if (!playerData) return null;

      const gamesPlayed = 40; // Early-mid season baseline
      const parkFactor = parkFactors.get(matchup.team) || 1.0;

      // Step 1: Calculate per-game averages from real season stats
      const rawHitsPerGame = calculatePerGameAverage(playerData.stats.hits, gamesPlayed);
      const rawRunsPerGame = calculatePerGameAverage(playerData.stats.runs, gamesPlayed);
      const rawRBIPerGame = calculatePerGameAverage(playerData.stats.rbi, gamesPlayed);

      // Step 2: Apply park factor adjustments
      const parkAdjHits = applyParkFactor(rawHitsPerGame, parkFactor);
      const parkAdjRuns = applyParkFactor(rawRunsPerGame, parkFactor);
      const parkAdjRBI = applyParkFactor(rawRBIPerGame, parkFactor);

      // Step 3: Apply batting position boosts
      const posAdjHits = applyBattingPositionBoost('hits', parkAdjHits, matchup.battingPosition);
      const posAdjRuns = applyBattingPositionBoost('runs', parkAdjRuns, matchup.battingPosition);
      const posAdjRBI = applyBattingPositionBoost('rbi', parkAdjRBI, matchup.battingPosition);

      // Step 4: Apply recent form adjustment
      const expectedHits = applyRecentFormAdjustment(posAdjHits, playerData.recentForm);
      const expectedRuns = applyRecentFormAdjustment(posAdjRuns, playerData.recentForm);
      const expectedRBI = applyRecentFormAdjustment(posAdjRBI, playerData.recentForm);

      // Step 5: Calculate expected total
      const expectedTotal = expectedHits + expectedRuns + expectedRBI;

      // Step 6: Calculate HRR line
      const hrrLine = calculateHRRLine(expectedTotal);

      // Step 7: Calculate edge
      const edge = expectedTotal - hrrLine;

      // Step 8: Calculate RC score (0-100)
      const rcScore = Math.min(100, Math.round((matchup.rc / 42) * 100));

      // Step 9: Combined score (RC + matchup confidence average)
      const combinedScore = Math.round((rcScore * 0.5) + (matchup.confidence * 0.5));

      // Step 10: Calculate HRR-specific confidence
      const hrrConfidence = calculateHRRConfidence(
        expectedTotal,
        hrrLine,
        combinedScore,
        rcScore,
        matchup.battingPosition
      );

      // Step 11: Get Savant metrics if available
      const playerSavant = savantData?.get(matchup.playerName);

      // Step 12: Build detailed reasoning with Statcast + Ballpark data
      const parkType = parkFactor > 1.05 ? "hitter-friendly" : parkFactor < 0.95 ? "pitcher-friendly" : "neutral";
      const reasons: string[] = [];
      
      // Statcast-based reasoning
      if (playerSavant) {
        if (playerSavant.xwOBA > 0.380) reasons.push(`Elite xwOBA (${playerSavant.xwOBA.toFixed(3)}) — top-tier contact quality`);
        else if (playerSavant.xwOBA > 0.340) reasons.push(`Strong xwOBA (${playerSavant.xwOBA.toFixed(3)}) — above avg contact`);
        if (playerSavant.hardHitPct > 45) reasons.push(`${playerSavant.hardHitPct.toFixed(0)}% hard hit rate — drives production`);
        if (playerSavant.barrelPct > 12) reasons.push(`${playerSavant.barrelPct.toFixed(1)}% barrel rate — extra-base hit upside`);
        if (playerSavant.exitVelocity > 92) reasons.push(`${playerSavant.exitVelocity.toFixed(1)} mph avg exit velo`);
      }
      
      // Ballpark/matchup reasoning
      if (rcScore > 80) reasons.push(`RC ${Math.round(matchup.rc)} — elite matchup vs ${matchup.pitcher.name}`);
      else if (rcScore > 65) reasons.push(`RC ${Math.round(matchup.rc)} — favorable vs ${matchup.pitcher.name}`);
      if (matchup.pitcher.era > 4.5) reasons.push(`Pitcher ERA ${matchup.pitcher.era.toFixed(2)} — gives up runs`);
      if (parkFactor > 1.08) reasons.push(`Hitter-friendly park (${parkFactor.toFixed(2)}x factor)`);
      else if (parkFactor > 1.03) reasons.push(`Slightly hitter-friendly park`);
      
      // Lineup/form reasoning
      if (matchup.battingPosition <= 2) reasons.push(`Bats ${matchup.battingPosition}${matchup.battingPosition === 1 ? 'st' : 'nd'} — more plate appearances`);
      else if (matchup.battingPosition <= 5) reasons.push(`Bats ${matchup.battingPosition}${matchup.battingPosition === 3 ? 'rd' : 'th'} — RBI opportunities`);
      if (playerData.recentForm?.trend === 'hot') {
        const last15Avg = playerData.recentForm.last15Games.avg;
        reasons.push(`Hot streak — .${Math.round(last15Avg * 1000)} over last 15 games`);
      }
      
      // Edge reasoning
      if (expectedTotal > hrrLine + 0.5) reasons.push(`Model projects ${expectedTotal.toFixed(1)} total vs ${hrrLine} line`);

      const reasoning = reasons.slice(0, 4).join(" • ") || "Solid projection based on season stats";
      const ballparkReasoning = `Per-game projection: ${rawHitsPerGame.toFixed(2)}H + ${rawRunsPerGame.toFixed(2)}R + ${rawRBIPerGame.toFixed(2)}RBI = ${(rawHitsPerGame + rawRunsPerGame + rawRBIPerGame).toFixed(2)} raw. Park: ${parkType} (${parkFactor.toFixed(2)}x). RC: ${Math.round(matchup.rc)}/100 vs ${matchup.pitcher.name} (${matchup.pitcher.era.toFixed(2)} ERA).`;

      return {
        playerId: matchup.playerId,
        playerName: matchup.playerName,
        team: matchup.team,
        position: matchup.position,
        battingPosition: matchup.battingPosition,
        pitcher: matchup.pitcher.name,
        pitcherTeam: matchup.pitcher.team,
        expectedHits: Math.round(expectedHits * 10) / 10,
        expectedRuns: Math.round(expectedRuns * 10) / 10,
        expectedRBI: Math.round(expectedRBI * 10) / 10,
        expectedTotal: Math.round(expectedTotal * 10) / 10,
        hrrLine,
        edge: Math.round(edge * 100) / 100,
        hrrConfidence,
        rcScore,
        combinedScore,
        parkFactor,
        savantMetrics: playerSavant,
        reasoning,
        ballparkReasoning,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null) as HRRProjection[];

  // Sort by HRR-specific ranking: edge * confidence (best OVER probability first)
  // This is the KEY difference from general AI picks — we rank by HRR over likelihood
  projections.sort((a, b) => {
    // Primary: HRR confidence (which already factors in edge, data quality, position)
    if (b.hrrConfidence !== a.hrrConfidence) {
      return b.hrrConfidence - a.hrrConfidence;
    }
    // Tiebreaker: raw edge over the line
    return b.edge - a.edge;
  });

  return projections.slice(0, 15);
}
