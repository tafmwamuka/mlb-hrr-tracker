/**
 * Comprehensive matchup data fetcher
 * Gathers all factors for accurate prop predictions:
 * - Handedness (RHH vs RHP, LHH vs LHP)
 * - Recent form (last 15 games)
 * - Pitcher workload
 * - Ballpark-specific stats
 * - Platoon splits
 * - Weather
 * - Rest days
 * - Injury status
 */

export interface MatchupData {
  batter: {
    playerId: number;
    name: string;
    handedness: "R" | "L" | "S"; // Right, Left, Switch
    recentForm: {
      last15Games: {
        hits: number;
        runs: number;
        rbi: number;
        avg: number;
      };
    };
    platoonSplits?: {
      vsRHP: { avg: number; slg: number };
      vsLHP: { avg: number; slg: number };
    };
    ballparkStats?: {
      atThisStadium: { avg: number; hr: number };
    };
    restDays: number;
    injuryStatus: string | null;
  };
  pitcher: {
    playerId: number;
    name: string;
    handedness: "R" | "L";
    era: number;
    recentForm: {
      last15Games: {
        era: number;
        inningsPitched: number;
      };
    };
    workload: {
      inningsPitchedRecently: number;
      gamesSinceRest: number;
    };
    injuryStatus: string | null;
  };
  game: {
    gameId: string;
    stadium: string;
    weather?: {
      temp: number;
      windSpeed: number;
      windDirection: string;
    };
  };
}

/**
 * Fetch handedness for a player
 */
export async function fetchPlayerHandedness(
  playerId: number
): Promise<"R" | "L" | "S" | null> {
  try {
    const response = await fetch(`https://statsapi.mlb.com/api/v1/people/${playerId}`);
    const data = await response.json();
    const person = data.people?.[0];
    return person?.batSide?.code || person?.pitchHand?.code || null;
  } catch (error) {
    console.error(`Failed to fetch handedness for ${playerId}:`, error);
    return null;
  }
}

/**
 * Fetch last 15 games stats for a player
 */
export async function fetchRecentFormStats(
  playerId: number,
  statType: "hitting" | "pitching" = "hitting"
): Promise<any | null> {
  try {
    const response = await fetch(
      `https://statsapi.mlb.com/api/v1/people/${playerId}?hydrate=stats(type=lastXGames,limit=15)`
    );
    const data = await response.json();
    const person = data.people?.[0];
    const stats = person?.stats?.find((s: any) =>
      statType === "hitting"
        ? s.type?.displayName?.includes("Last")
        : s.type?.displayName?.includes("Last")
    );
    return stats?.stats || null;
  } catch (error) {
    console.error(`Failed to fetch recent form for ${playerId}:`, error);
    return null;
  }
}

/**
 * Fetch platoon splits (vs RHP/LHP)
 */
export async function fetchPlatoonSplits(
  playerId: number
): Promise<{ vsRHP: any; vsLHP: any } | null> {
  try {
    const response = await fetch(
      `https://statsapi.mlb.com/api/v1/people/${playerId}?hydrate=stats(type=season,group=hitting)`
    );
    const data = await response.json();
    const person = data.people?.[0];

    // Look for split stats
    const splits = person?.stats?.find((s: any) => s.type?.displayName?.includes("split"));
    if (splits?.stats) {
      return {
        vsRHP: splits.stats.find((s: any) => s.opponent?.code === "rhp") || {},
        vsLHP: splits.stats.find((s: any) => s.opponent?.code === "lhp") || {},
      };
    }

    return null;
  } catch (error) {
    console.error(`Failed to fetch platoon splits for ${playerId}:`, error);
    return null;
  }
}

/**
 * Fetch ballpark-specific stats
 */
export async function fetchBallparkStats(
  playerId: number,
  stadiumId: number
): Promise<any | null> {
  try {
    const response = await fetch(
      `https://statsapi.mlb.com/api/v1/people/${playerId}?hydrate=stats(type=season,group=hitting)`
    );
    const data = await response.json();
    const person = data.people?.[0];

    // Look for stadium-specific stats
    const stats = person?.stats?.find((s: any) =>
      s.type?.displayName?.includes(`at ${stadiumId}`)
    );
    return stats?.stats || null;
  } catch (error) {
    console.error(`Failed to fetch ballpark stats for ${playerId}:`, error);
    return null;
  }
}

/**
 * Fetch pitcher workload (innings pitched recently)
 */
export async function fetchPitcherWorkload(playerId: number): Promise<any | null> {
  try {
    const response = await fetch(
      `https://statsapi.mlb.com/api/v1/people/${playerId}?hydrate=stats(type=lastXGames,limit=10)`
    );
    const data = await response.json();
    const person = data.people?.[0];
    const pitchingStats = person?.stats?.find((s: any) =>
      s.type?.displayName?.includes("Last")
    );

    if (pitchingStats?.stats) {
      const inningsPitched = pitchingStats.stats.inningsPitched || 0;
      const gamesSinceRest = pitchingStats.stats.gamesPlayed || 0;
      return { inningsPitched, gamesSinceRest };
    }

    return null;
  } catch (error) {
    console.error(`Failed to fetch pitcher workload for ${playerId}:`, error);
    return null;
  }
}

/**
 * Fetch injury status
 */
export async function fetchInjuryStatus(playerId: number): Promise<string | null> {
  try {
    const response = await fetch(`https://statsapi.mlb.com/api/v1/people/${playerId}`);
    const data = await response.json();
    const person = data.people?.[0];
    return person?.injuries?.[0]?.description || null;
  } catch (error) {
    console.error(`Failed to fetch injury status for ${playerId}:`, error);
    return null;
  }
}

/**
 * Fetch weather data for a game
 */
export async function fetchGameWeather(gameId: string): Promise<any | null> {
  try {
    const response = await fetch(`https://statsapi.mlb.com/api/v1/game/${gameId}`);
    const data = await response.json();
    const weather = data.weather;
    return weather || null;
  } catch (error) {
    console.error(`Failed to fetch weather for game ${gameId}:`, error);
    return null;
  }
}

/**
 * Calculate rest days for a player
 */
export async function calculateRestDays(playerId: number): Promise<number> {
  try {
    const response = await fetch(
      `https://statsapi.mlb.com/api/v1/people/${playerId}?hydrate=stats(type=season)`
    );
    const data = await response.json();
    const person = data.people?.[0];

    // Get last game date
    const stats = person?.stats?.find((s: any) => s.type?.displayName === "season");
    const lastGameDate = stats?.stats?.lastPlayedDate;

    if (lastGameDate) {
      const lastGame = new Date(lastGameDate);
      const today = new Date();
      const daysSinceLastGame = Math.floor(
        (today.getTime() - lastGame.getTime()) / (1000 * 60 * 60 * 24)
      );
      return daysSinceLastGame;
    }

    return 0;
  } catch (error) {
    console.error(`Failed to calculate rest days for ${playerId}:`, error);
    return 0;
  }
}

/**
 * Aggregate all matchup data
 */
export async function fetchCompleteMatchupData(
  batterId: number,
  pitcherId: number,
  gameId: string,
  stadiumId: number
): Promise<MatchupData | null> {
  try {
    const [
      batterHandedness,
      pitcherHandedness,
      batterRecentForm,
      pitcherRecentForm,
      platoonSplits,
      ballparkStats,
      pitcherWorkload,
      batterInjury,
      pitcherInjury,
      weather,
      restDays,
    ] = await Promise.all([
      fetchPlayerHandedness(batterId),
      fetchPlayerHandedness(pitcherId),
      fetchRecentFormStats(batterId, "hitting"),
      fetchRecentFormStats(pitcherId, "pitching"),
      fetchPlatoonSplits(batterId),
      fetchBallparkStats(batterId, stadiumId),
      fetchPitcherWorkload(pitcherId),
      fetchInjuryStatus(batterId),
      fetchInjuryStatus(pitcherId),
      fetchGameWeather(gameId),
      calculateRestDays(batterId),
    ]);

    return {
      batter: {
        playerId: batterId,
        name: "",
        handedness: (batterHandedness as "R" | "L" | "S") || "R",
        recentForm: {
          last15Games: batterRecentForm || { hits: 0, runs: 0, rbi: 0, avg: 0 },
        },
        platoonSplits: platoonSplits || undefined,
        ballparkStats,
        restDays,
        injuryStatus: batterInjury,
      },
      pitcher: {
        playerId: pitcherId,
        name: "",
        handedness: (pitcherHandedness as "R" | "L") || "R",
        era: 0,
        recentForm: {
          last15Games: pitcherRecentForm || { era: 0, inningsPitched: 0 },
        },
        workload: pitcherWorkload || { inningsPitchedRecently: 0, gamesSinceRest: 0 },
        injuryStatus: pitcherInjury,
      },
      game: {
        gameId,
        stadium: "",
        weather,
      },
    };
  } catch (error) {
    console.error("Failed to fetch complete matchup data:", error);
    return null;
  }
}
