/**
 * HRR (Hits + Runs + RBI) Combined Prop Service
 * 
 * Calculates combined H+R+RBI projections using:
 * - Real player season stats (per-game averages)
 * - Park factor adjustments
 * - Savant metrics (xwOBA, Hard Hit%, etc.)
 * - Diamond Edge model RC data
 * - Batting position weighting
 * - Day/night splits (MLB Stats API)
 * - theLAB streak & edge data
 * 
 * HRR is a popular sportsbook prop where you bet on a player's
 * combined Hits + Runs + RBI total for a single game.
 */
import type { PlayerDayNightSplits } from "./dayNightSplitService";

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
  // HRR Matrix Score (0-100) using the 6-component formula
  hrrMatrixScore: number;
  hrrScoreComponents: {
    xwOBA: number;        // raw value (e.g. 0.350)
    xwOBAScore: number;   // 0-100 component score
    xwOBAWeighted: number; // after ×0.30
    barrelPct: number;    // raw value (e.g. 8.5)
    barrelScore: number;  // 0-100 component score
    barrelWeighted: number; // after ×0.20
    lineupSpot: number;   // batting order position (1-9)
    lineupScore: number;  // 0-100 component score
    lineupWeighted: number; // after ×0.15
    parkFactor: number;   // raw park factor (e.g. 1.08)
    parkScore: number;    // 0-100 component score
    parkWeighted: number; // after ×0.15
    weatherBoost: number; // 0-100 raw weather score
    weatherWeighted: number; // after ×0.10
    pitcherWeakness: number; // 0-100 raw pitcher weakness score
    pitcherWeighted: number; // after ×0.10
  };
  // Reasoning
  reasoning: string;
  ballparkReasoning: string;
  // Day/night split info
  dayNightSplit?: {
    gameTimeType: 'day' | 'night';
    splitAvg: number;
    splitBoost: number;
    favorable: boolean;
    splitGames: number;
  };
  // Streak info from theLAB
  streakInfo?: {
    streakType: 'hot' | 'cold' | 'neutral';
    streakLength: number;
    last5HitRate: number;
    trendDirection: 'up' | 'down' | 'stable';
    streakLabel?: string;
  };
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
  gamesPlayed?: number; // Phase AQ: real GP from MLB API (was always missing, causing gamesPlayed=40 fallback)
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
  gameTime?: string; // ISO string of game start time (for day/night split)
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
 * Phase CN fix: set line at 75% of expected total so OVER hits ~60% of the time.
 * Previous formula (floor to nearest 0.5) set lines too close to expected,
 * meaning players needed to exceed their average to hit — natural miss rate >50%.
 */
export function calculateHRRLine(expectedTotal: number): number {
  // Set line at ~75% of expected total — player should clear ~60% of the time
  // This mimics how sportsbooks set HRR lines for balanced action
  const rawLine = expectedTotal * 0.75;
  // Round to nearest 0.5
  const rounded = Math.round(rawLine * 2) / 2;
  // Bounds: minimum 0.5, maximum 5.5
  return Math.max(0.5, Math.min(5.5, rounded));
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
  
  // RC component (0-15 points): matchup quality score
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
  savantData?: Map<string, { xwOBA: number; hardHitPct: number; exitVelocity: number; barrelPct: number }>,
  dayNightSplitsMap?: Map<number, PlayerDayNightSplits>,
  mlbStreakMap?: Map<number, import('./mlbStreakService').PlayerStreakData>
): HRRProjection[] {
  const projections: HRRProjection[] = matchups
    .map((matchup) => {
      const playerData = playerDataMap.get(matchup.playerId);
      if (!playerData) return null;

      // Phase AQ: use real gamesPlayed from MLB API (was hardcoded 40 — inflated stats for low-GP players)
      const gamesPlayed = (playerData.gamesPlayed && playerData.gamesPlayed >= 5) ? playerData.gamesPlayed : 40;
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
      let expectedHits = applyRecentFormAdjustment(posAdjHits, playerData.recentForm);
      let expectedRuns = applyRecentFormAdjustment(posAdjRuns, playerData.recentForm);
      let expectedRBI = applyRecentFormAdjustment(posAdjRBI, playerData.recentForm);

      // Step 4b: Apply day/night split adjustment
      const splits: PlayerDayNightSplits | null = dayNightSplitsMap?.get(matchup.playerId) ?? null;
      let dayNightSplitInfo: HRRProjection['dayNightSplit'] | undefined;
      if (splits) {
        // Determine game time type (day = before 5pm ET)
        const gameHourUTC = matchup.gameTime ? new Date(matchup.gameTime).getUTCHours() : 22;
        const etHour = (gameHourUTC - 4 + 24) % 24;
        const gameTimeType: 'day' | 'night' = etHour < 17 ? 'day' : 'night';
        const split = gameTimeType === 'day' ? splits.day : splits.night;
        if (split && split.gamesPlayed >= 5) {
          const splitAvgNum = parseFloat(split.avg) || 0;
          const seasonAvg = playerData.stats.avg;
          const boost = seasonAvg > 0 ? ((splitAvgNum - seasonAvg) / seasonAvg) : 0;
          const multiplier = 1 + (boost * 0.5); // Apply 50% of the split boost
          expectedHits *= multiplier;
          expectedRuns *= multiplier;
          expectedRBI *= multiplier;
          dayNightSplitInfo = {
            gameTimeType,
            splitAvg: splitAvgNum,
            splitBoost: Math.round(boost * 100),
            favorable: boost > 0.05,
            splitGames: split.gamesPlayed,
          };
        }
      }

      // Step 4c: Apply streak adjustment (MLB game log)
      const mlbStreak = mlbStreakMap?.get(matchup.playerId) ?? null;
      let streakInfo: HRRProjection['streakInfo'] | undefined;

      if (mlbStreak?.hasRealData) {
        const last5 = mlbStreak.last5HitRate;
        const streakLen = mlbStreak.streakLength;
        const trend = mlbStreak.trendDirection;
        let streakType: 'hot' | 'cold' | 'neutral' = 'neutral';
        if (last5 >= 70 || streakLen >= 3 || trend === 'HOT') streakType = 'hot';
        else if ((last5 <= 30 && (streakLen <= -3 || trend === 'COLD')) || streakLen <= -5) streakType = 'cold';
        const streakMultiplier = streakType === 'hot' ? 1.10 : streakType === 'cold' ? 0.90 : 1.0;
        expectedHits *= streakMultiplier;
        expectedRuns *= streakMultiplier;
        expectedRBI *= streakMultiplier;
        streakInfo = {
          streakType,
          streakLength: Math.abs(streakLen),
          last5HitRate: Math.round(last5),
          trendDirection: trend === 'HOT' ? 'up' : trend === 'COLD' ? 'down' : 'stable',
          streakLabel: mlbStreak.streakLabel ?? '',
        };
      }

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

      // Step 11b: Compute HRR Matrix Score using the 6-component formula
      // HRR Score = (xwOBA*0.30) + (Barrel%*0.20) + (Lineup Spot*0.15)
      //           + (Park Factor*0.15) + (Weather Boost*0.10) + (Pitcher Weakness*0.10)

      // xwOBA component: scale 0.200–0.450 → 0–100
      const rawXwOBA = playerSavant?.xwOBA ?? 0.310; // league avg fallback
      const xwOBAScore = Math.round(Math.min(100, Math.max(0, ((rawXwOBA - 0.200) / (0.450 - 0.200)) * 100)));
      const xwOBAWeighted = Math.round(xwOBAScore * 0.30 * 10) / 10;

      // Barrel% component: scale 0–20% → 0–100
      const rawBarrelPct = playerSavant?.barrelPct ?? 5.0; // league avg fallback
      const barrelScore = Math.round(Math.min(100, Math.max(0, (rawBarrelPct / 20) * 100)));
      const barrelWeighted = Math.round(barrelScore * 0.20 * 10) / 10;

      // Lineup Spot component: position 1–9, best spots are 1–5
      // Spot 1–2: 90–100 (most PA), 3–5: 70–85 (RBI), 6–9: 30–60
      const lineupSpotScores: Record<number, number> = { 1: 95, 2: 90, 3: 85, 4: 80, 5: 75, 6: 60, 7: 50, 8: 40, 9: 30 };
      const lineupScore = lineupSpotScores[matchup.battingPosition] ?? 50;
      const lineupWeighted = Math.round(lineupScore * 0.15 * 10) / 10;

      // Park Factor component: scale 0.85–1.20 → 0–100
      const parkScore = Math.round(Math.min(100, Math.max(0, ((parkFactor - 0.85) / (1.20 - 0.85)) * 100)));
      const parkWeighted = Math.round(parkScore * 0.15 * 10) / 10;

      // Weather Boost component: use day/night split boost as proxy
      // Favorable split = high weather/condition score; neutral = 50
      const weatherBoost = dayNightSplitInfo
        ? Math.round(Math.min(100, Math.max(0, 50 + (dayNightSplitInfo.splitBoost * 2))))
        : 50;
      const weatherWeighted = Math.round(weatherBoost * 0.10 * 10) / 10;

      // Pitcher Weakness component: based on ERA (scale 2.00–7.00 → 0–100)
      const pitcherERAVal = matchup.pitcher.era;
      const pitcherWeakness = Math.round(Math.min(100, Math.max(0, ((pitcherERAVal - 2.00) / (7.00 - 2.00)) * 100)));
      const pitcherWeighted = Math.round(pitcherWeakness * 0.10 * 10) / 10;

      // Total HRR Matrix Score (0-100)
      const hrrMatrixScore = Math.round(
        xwOBAWeighted + barrelWeighted + lineupWeighted + parkWeighted + weatherWeighted + pitcherWeighted
      );

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
      
      // Streak/split reasoning
      if (streakInfo?.streakType === 'hot') reasons.push(`🔥 HOT — ${streakInfo.last5HitRate}% hit rate last 5`);
      else if (streakInfo?.streakType === 'cold') reasons.push(`❄️ COLD — ${streakInfo.last5HitRate}% hit rate last 5`);
      if (dayNightSplitInfo?.favorable) reasons.push(`Strong ${dayNightSplitInfo.gameTimeType} performer (+${dayNightSplitInfo.splitBoost}%)`);
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
        hrrMatrixScore,
        hrrScoreComponents: {
          xwOBA: rawXwOBA,
          xwOBAScore,
          xwOBAWeighted,
          barrelPct: rawBarrelPct,
          barrelScore,
          barrelWeighted,
          lineupSpot: matchup.battingPosition,
          lineupScore,
          lineupWeighted,
          parkFactor,
          parkScore,
          parkWeighted,
          weatherBoost,
          weatherWeighted,
          pitcherWeakness,
          pitcherWeighted,
        },
        reasoning,
        ballparkReasoning,
        dayNightSplit: dayNightSplitInfo,
        streakInfo,
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
