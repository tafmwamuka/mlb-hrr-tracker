/**
 * Advanced Data Service
 * Fetches and processes advanced baseball metrics:
 * - Pitcher/batter handedness and platoon splits
 * - Recent form (last 15 games)
 * - Weather data
 * - Pitcher workload
 */

interface PitcherData {
  id: number;
  name: string;
  handedness: 'R' | 'L';
  era: number;
  workload: number; // Recent innings pitched
  strikeoutRate: number; // K/9
  walkRate: number; // BB/9
}

interface BatterRecentForm {
  last15Games: {
    hits: number;
    runs: number;
    rbi: number;
    avg: number;
  };
  trend: 'hot' | 'cold' | 'neutral';
}

interface PlatoonSplit {
  vsRHP: number; // Avg vs RHP
  vsLHP: number; // Avg vs LHP
}

interface WeatherData {
  temperature: number; // Fahrenheit
  windSpeed: number; // MPH
  windDirection: string; // N, S, E, W, NE, NW, SE, SW
}

/**
 * Calculate recent form trend
 * Compares last 15 games avg to season avg
 */
export function calculateTrend(
  last15Avg: number,
  seasonAvg: number
): 'hot' | 'cold' | 'neutral' {
  const diff = last15Avg - seasonAvg;
  if (diff > 0.020) return 'hot';
  if (diff < -0.020) return 'cold';
  return 'neutral';
}

/**
 * Calculate handedness advantage
 * Returns 0-100 score based on batter vs pitcher handedness
 */
export function calculateHandednessAdvantage(
  batterHandedness: 'R' | 'L' | 'S',
  pitcherHandedness: 'R' | 'L',
  platoonSplit?: PlatoonSplit
): number {
  // Switch hitters get 50 (neutral)
  if (batterHandedness === 'S') return 50;

  // If we have platoon split data, use it
  if (platoonSplit) {
    if (batterHandedness === 'R' && pitcherHandedness === 'R') {
      // RHB vs RHP - typically disadvantage
      return Math.min(100, (platoonSplit.vsRHP / 0.280) * 100);
    }
    if (batterHandedness === 'R' && pitcherHandedness === 'L') {
      // RHB vs LHP - typically advantage
      return Math.min(100, (platoonSplit.vsLHP / 0.300) * 100);
    }
    if (batterHandedness === 'L' && pitcherHandedness === 'R') {
      // LHB vs RHP - typically advantage
      return Math.min(100, (platoonSplit.vsRHP / 0.300) * 100);
    }
    if (batterHandedness === 'L' && pitcherHandedness === 'L') {
      // LHB vs LHP - typically disadvantage
      return Math.min(100, (platoonSplit.vsLHP / 0.280) * 100);
    }
  }

  // Default handedness advantage without platoon data
  const sameHandedness = batterHandedness === pitcherHandedness;
  return sameHandedness ? 45 : 55; // Opposite handedness slightly favored
}

/**
 * Calculate pitcher workload impact
 * Fatigue affects performance
 */
export function calculateWorkloadImpact(inningsPitched: number): number {
  // Typical season is ~200 innings
  // >200 innings = fatigue penalty
  // <150 innings = fresh bonus
  if (inningsPitched < 100) return 70; // Very fresh
  if (inningsPitched < 150) return 80; // Fresh
  if (inningsPitched < 200) return 90; // Normal
  if (inningsPitched < 220) return 85; // Slight fatigue
  return 75; // Significant fatigue
}

/**
 * Calculate weather impact on hitting
 * Warm, low wind, favorable direction = better hitting
 */
export function calculateWeatherImpact(weather: WeatherData): number {
  let score = 50;

  // Temperature impact (optimal 75-85°F)
  if (weather.temperature >= 75 && weather.temperature <= 85) {
    score += 15;
  } else if (weather.temperature >= 70 && weather.temperature <= 90) {
    score += 10;
  } else if (weather.temperature >= 65 && weather.temperature <= 95) {
    score += 5;
  }

  // Wind impact (lower wind = better)
  if (weather.windSpeed < 5) {
    score += 10; // Calm conditions
  } else if (weather.windSpeed < 10) {
    score += 5; // Light wind
  } else if (weather.windSpeed > 15) {
    score -= 10; // Strong wind
  }

  // Wind direction (tailwind helps, headwind hurts)
  // For simplicity, assume neutral unless specified
  // In production, would need ballpark orientation

  return Math.min(100, Math.max(0, score));
}

/**
 * Calculate pitcher effectiveness score
 * Based on ERA, strikeout rate, walk rate, and workload
 */
export function calculatePitcherEffectiveness(pitcher: PitcherData): number {
  const eraScore = Math.min(100, (3.50 / pitcher.era) * 100); // Lower ERA = better
  const strikeoutScore = Math.min(100, (pitcher.strikeoutRate / 9) * 100); // K/9
  const walkScore = Math.min(100, (3.0 / pitcher.walkRate) * 100); // Lower BB/9 = better
  const workloadScore = calculateWorkloadImpact(pitcher.workload);

  // Weighted average
  return (
    eraScore * 0.35 +
    strikeoutScore * 0.25 +
    walkScore * 0.20 +
    workloadScore * 0.20
  );
}

/**
 * Calculate recent form impact on confidence
 * Hot players get bonus, cold players get penalty
 */
export function calculateRecentFormBonus(recentForm: BatterRecentForm): number {
  switch (recentForm.trend) {
    case 'hot':
      return 15; // +15% confidence bonus
    case 'cold':
      return -15; // -15% confidence penalty
    case 'neutral':
      return 0; // No adjustment
  }
}

/**
 * Mock function to fetch pitcher data from MLB Stats API
 * In production, would call actual API
 */
export function getMockPitcherData(): Map<string, PitcherData> {
  return new Map([
    [
      'Framber Valdez',
      {
        id: 570275,
        name: 'Framber Valdez',
        handedness: 'L',
        era: 2.98,
        workload: 185,
        strikeoutRate: 9.2,
        walkRate: 2.1,
      },
    ],
    [
      'Kevin Gausman',
      {
        id: 543143,
        name: 'Kevin Gausman',
        handedness: 'R',
        era: 3.45,
        workload: 192,
        strikeoutRate: 8.8,
        walkRate: 2.5,
      },
    ],
    [
      'Clayton Kershaw',
      {
        id: 477132,
        name: 'Clayton Kershaw',
        handedness: 'L',
        era: 3.12,
        workload: 156,
        strikeoutRate: 9.5,
        walkRate: 1.8,
      },
    ],
  ]);
}

/**
 * Mock function to fetch weather data
 * In production, would call weather API (e.g., OpenWeatherMap)
 */
export function getMockWeatherData(): Map<string, WeatherData> {
  return new Map([
    [
      'HOU',
      {
        temperature: 78,
        windSpeed: 8,
        windDirection: 'N',
      },
    ],
    [
      'TOR',
      {
        temperature: 72,
        windSpeed: 5,
        windDirection: 'S',
      },
    ],
    [
      'LAD',
      {
        temperature: 82,
        windSpeed: 3,
        windDirection: 'W',
      },
    ],
  ]);
}

/**
 * Mock function to fetch platoon splits
 * In production, would call MLB Stats API
 */
export function getMockPlatoonSplits(): Map<number, PlatoonSplit> {
  return new Map([
    [660271, { vsRHP: 0.295, vsLHP: 0.270 }], // Aaron Judge
    [592450, { vsRHP: 0.315, vsLHP: 0.305 }], // Juan Soto
    [608070, { vsRHP: 0.285, vsLHP: 0.275 }], // B. Buxton
  ]);
}
