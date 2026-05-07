/**
 * Fetch ERA (pitcher) and ISO (batter) data from MLB Stats API
 * ERA = Earned Run Average (lower is better for pitcher)
 * ISO = Isolated Power (higher is better for batter power)
 */

export interface PlayerERAISO {
  playerId: number;
  playerName: string;
  era?: number; // For pitchers
  iso?: number; // For batters
  avg?: number; // Batting average
  slg?: number; // Slugging percentage
  obp?: number; // On-base percentage
}

/**
 * Fetch ERA for a pitcher from MLB Stats API
 */
export async function fetchPitcherERA(playerId: number): Promise<number | null> {
  try {
    const response = await fetch(
      `https://statsapi.mlb.com/api/v1/people/${playerId}?hydrate=stats(type=season)`
    );
    const data = await response.json();

    // Find pitching stats
    const stats = data.stats?.find((s: any) => s.type?.displayName === "season");
    const pitchingStats = stats?.stats;

    if (pitchingStats) {
      const era = pitchingStats.era;
      return era ? parseFloat(era) : null;
    }

    return null;
  } catch (error) {
    console.error(`Failed to fetch ERA for pitcher ${playerId}:`, error);
    return null;
  }
}

/**
 * Fetch ISO (Isolated Power) for a batter from MLB Stats API
 * ISO = (SLG - AVG) = power metric
 */
export async function fetchBatterISO(playerId: number): Promise<PlayerERAISO | null> {
  try {
    const response = await fetch(
      `https://statsapi.mlb.com/api/v1/people/${playerId}?hydrate=stats(type=season)`
    );
    const data = await response.json();

    // Find batting stats
    const stats = data.stats?.find((s: any) => s.type?.displayName === "season");
    const battingStats = stats?.stats;

    if (battingStats) {
      const avg = parseFloat(battingStats.avg || "0");
      const slg = parseFloat(battingStats.slg || "0");
      const obp = parseFloat(battingStats.obp || "0");

      // ISO = SLG - AVG
      const iso = slg - avg;

      return {
        playerId,
        playerName: data.fullName || "",
        iso: iso > 0 ? iso : 0,
        avg,
        slg,
        obp,
      };
    }

    return null;
  } catch (error) {
    console.error(`Failed to fetch ISO for batter ${playerId}:`, error);
    return null;
  }
}

/**
 * Get matchup advantage score (batter ISO vs pitcher ERA)
 * Higher score = better for batter (higher ISO, lower ERA)
 */
export function calculateMatchupAdvantage(
  batterISO: number,
  pitcherERA: number
): number {
  // Normalize to 0-100 scale
  // ISO typically ranges 0.1-0.3, ERA typically ranges 2.5-5.0
  const normalizedISO = Math.min(100, (batterISO / 0.3) * 50); // 0-50 points
  const normalizedERA = Math.max(0, 50 - (pitcherERA / 5.0) * 50); // 0-50 points (lower ERA = higher score)

  return Math.round(normalizedISO + normalizedERA);
}

/**
 * Batch fetch ERA/ISO for multiple players
 */
export async function fetchBatchERAISO(
  playerIds: number[]
): Promise<Map<number, PlayerERAISO>> {
  const results = new Map<number, PlayerERAISO>();

  for (const playerId of playerIds) {
    const iso = await fetchBatterISO(playerId);
    if (iso) {
      results.set(playerId, iso);
    }
  }

  return results;
}
