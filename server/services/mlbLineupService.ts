/**
 * MLB Lineup Service
 * Fetches today's real games, lineups, and player season stats from MLB Stats API.
 * Ensures picks are only generated for players actually playing today on their correct teams.
 */

const MLB_API_BASE = "https://statsapi.mlb.com/api/v1";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MLBGame {
  gamePk: number;
  gameDate: string; // ISO timestamp
  gameTime: string; // formatted local time
  status: string;
  dayNight: string;
  venue: string;
  venueId: number;
  awayTeam: {
    id: number;
    name: string;
    abbreviation: string;
    record: string;
    probablePitcher: { id: number; fullName: string } | null;
  };
  homeTeam: {
    id: number;
    name: string;
    abbreviation: string;
    record: string;
    probablePitcher: { id: number; fullName: string } | null;
  };
  awayLineup: LineupPlayer[];
  homeLineup: LineupPlayer[];
}

export interface LineupPlayer {
  id: number;
  fullName: string;
  firstName: string;
  lastName: string;
  position: string;
  battingOrder: number; // 1-9
  teamId: number;
  teamName: string;
  teamAbbreviation: string;
}

export interface PlayerSeasonStats {
  playerId: number;
  fullName: string;
  teamId: number;
  teamName: string;
  teamAbbreviation: string;
  gamesPlayed: number;
  atBats: number;
  hits: number;
  runs: number;
  rbi: number;
  homeRuns: number;
  avg: string;
  obp: string;
  slg: string;
  ops: string;
  strikeOuts: number;
  baseOnBalls: number;
  stolenBases: number;
  // Per-game averages
  hitsPerGame: number;
  runsPerGame: number;
  rbiPerGame: number;
  hrrPerGame: number;
}

export interface PlayerWithContext extends PlayerSeasonStats {
  game: MLBGame;
  battingPosition: number;
  opposingPitcher: { id: number; fullName: string } | null;
  isHome: boolean;
}

// ─── Team abbreviation mapping ────────────────────────────────────────────────

const TEAM_ABBREVIATIONS: Record<number, string> = {
  108: "LAA", 109: "ARI", 110: "BAL", 111: "BOS", 112: "CHC",
  113: "CIN", 114: "CLE", 115: "COL", 116: "DET", 117: "HOU",
  118: "KC", 119: "LAD", 120: "WSH", 121: "NYM", 133: "OAK",
  134: "PIT", 135: "SD", 136: "SEA", 137: "SF", 138: "STL",
  139: "TB", 140: "TEX", 141: "TOR", 142: "MIN", 143: "PHI",
  144: "ATL", 145: "CWS", 146: "MIA", 147: "NYY", 158: "MIL",
};

function getTeamAbbreviation(teamId: number, teamName: string): string {
  return TEAM_ABBREVIATIONS[teamId] || teamName.split(" ").pop()?.toUpperCase().slice(0, 3) || "???";
}

// ─── Cache ────────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const gameCache: { entry: CacheEntry<MLBGame[]> | null; dataDate: string | null } = { entry: null, dataDate: null };
const statsCache = new Map<number, CacheEntry<PlayerSeasonStats>>();

const GAME_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const STATS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Check if the cached data is from a previous day (ET timezone).
 * If so, invalidate the cache so we fetch fresh data for today.
 */
function isCacheStaleForNewDay(): boolean {
  if (!gameCache.entry || !gameCache.dataDate) return false;
  const currentETDate = getQueryDate();
  // If the cached data date is different from today's ET date, cache is stale
  return gameCache.dataDate !== currentETDate;
}

// ─── Fetch today's games with lineups ─────────────────────────────────────────

/**
 * Get the best date to query for games with lineups.
 * Uses today's date in Eastern time (MLB operates on ET).
 */
function getQueryDate(): string {
  const now = new Date();
  const etDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const year = etDate.getFullYear();
  const month = String(etDate.getMonth() + 1).padStart(2, '0');
  const day = String(etDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Generate a list of recent dates to try if today has no lineups.
 * Tries the last 7 days in the current MLB season (April-October).
 * If the current year has no data, tries the same date range in the previous year.
 */
function getRecentDatesWithGames(): string[] {
  const dates: string[] = [];
  const now = new Date();
  
  // Try yesterday and the last few days in current year
  for (let i = 1; i <= 3; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split('T')[0]);
  }
  
  // Try same date range in previous year (for future sandbox dates)
  const prevYear = now.getFullYear() - 1;
  for (let i = 0; i <= 3; i++) {
    const d = new Date(now);
    d.setFullYear(prevYear);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split('T')[0]);
  }
  
  return dates;
}

export async function getDataDate(): Promise<string> {
  // Return the actual date of the data being displayed
  if (gameCache.dataDate) return gameCache.dataDate;
  // If no cache, compute it
  await fetchTodaysGames();
  return gameCache.dataDate || getQueryDate();
}

export async function fetchTodaysGames(): Promise<MLBGame[]> {
  // Invalidate cache if we've crossed midnight ET (new day)
  if (isCacheStaleForNewDay()) {
    console.log(`New day detected (was ${gameCache.dataDate}, now ${getQueryDate()}). Clearing cache.`);
    gameCache.entry = null;
    gameCache.dataDate = null;
    statsCache.clear();
  }

  // Check cache - only use if it has games with lineups and isn't expired
  if (gameCache.entry && Date.now() - gameCache.entry.timestamp < GAME_CACHE_TTL) {
    return gameCache.entry.data;
  }

  const today = getQueryDate();
  let url = `${MLB_API_BASE}/schedule?sportId=1&date=${today}&hydrate=lineups,probablePitcher`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`MLB API error: ${response.status}`);
    }
    const json = await response.json() as any;
    const dates = json.dates || [];
    if (dates.length === 0) return [];

    let gamesData = dates[0].games;

    // Check if any game has lineups posted
    const hasLineups = gamesData.some((g: any) => 
      (g.lineups?.awayPlayers?.length > 0) || (g.lineups?.homePlayers?.length > 0)
    );

    // If no lineups for today (e.g., future season, early morning), try recent past dates
    if (!hasLineups && gamesData.length > 0) {
      console.log(`No lineups for ${today}, trying recent dates...`);
      const fallbackDates = getRecentDatesWithGames();
      for (const fallbackDate of fallbackDates) {
        try {
          const fbUrl = `${MLB_API_BASE}/schedule?sportId=1&date=${fallbackDate}&hydrate=lineups,probablePitcher`;
          const fbResp = await fetch(fbUrl);
          if (fbResp.ok) {
            const fbJson = await fbResp.json() as any;
            const fbDates = fbJson.dates || [];
            if (fbDates.length > 0) {
              const fbGames = fbDates[0].games;
              const fbHasLineups = fbGames.some((g: any) => 
                (g.lineups?.awayPlayers?.length > 0) || (g.lineups?.homePlayers?.length > 0)
              );
              if (fbHasLineups) {
                console.log(`Found lineups for ${fallbackDate}, using as data source`);
                gamesData = fbGames;
                gameCache.dataDate = fallbackDate;
                break;
              }
            }
          }
        } catch {
          // Skip this fallback date
        }
      }
    }

    const games: MLBGame[] = gamesData.map((g: any) => {
      const awayTeamId = g.teams?.away?.team?.id || 0;
      const homeTeamId = g.teams?.home?.team?.id || 0;
      const awayTeamName = g.teams?.away?.team?.name || "Unknown";
      const homeTeamName = g.teams?.home?.team?.name || "Unknown";
      const awayAbbr = getTeamAbbreviation(awayTeamId, awayTeamName);
      const homeAbbr = getTeamAbbreviation(homeTeamId, homeTeamName);

      const awayLineup: LineupPlayer[] = (g.lineups?.awayPlayers || []).map((p: any, i: number) => ({
        id: p.id,
        fullName: p.fullName,
        firstName: p.firstName || p.fullName.split(" ")[0],
        lastName: p.lastName || p.fullName.split(" ").slice(1).join(" "),
        position: p.primaryPosition?.abbreviation || "DH",
        battingOrder: i + 1,
        teamId: awayTeamId,
        teamName: awayTeamName,
        teamAbbreviation: awayAbbr,
      }));

      const homeLineup: LineupPlayer[] = (g.lineups?.homePlayers || []).map((p: any, i: number) => ({
        id: p.id,
        fullName: p.fullName,
        firstName: p.firstName || p.fullName.split(" ")[0],
        lastName: p.lastName || p.fullName.split(" ").slice(1).join(" "),
        position: p.primaryPosition?.abbreviation || "DH",
        battingOrder: i + 1,
        teamId: homeTeamId,
        teamName: homeTeamName,
        teamAbbreviation: homeAbbr,
      }));

      return {
        gamePk: g.gamePk,
        gameDate: g.gameDate,
        gameTime: g.gameDate ? new Date(g.gameDate).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) : "TBD",
        status: g.status?.abstractGameState || "Scheduled",
        dayNight: g.dayNight || "night",
        venue: g.venue?.name || "Unknown",
        venueId: g.venue?.id || 0,
        awayTeam: {
          id: awayTeamId,
          name: awayTeamName,
          abbreviation: awayAbbr,
          record: `${g.teams?.away?.leagueRecord?.wins || 0}-${g.teams?.away?.leagueRecord?.losses || 0}`,
          probablePitcher: g.teams?.away?.probablePitcher
            ? { id: g.teams.away.probablePitcher.id, fullName: g.teams.away.probablePitcher.fullName }
            : null,
        },
        homeTeam: {
          id: homeTeamId,
          name: homeTeamName,
          abbreviation: homeAbbr,
          record: `${g.teams?.home?.leagueRecord?.wins || 0}-${g.teams?.home?.leagueRecord?.losses || 0}`,
          probablePitcher: g.teams?.home?.probablePitcher
            ? { id: g.teams.home.probablePitcher.id, fullName: g.teams.home.probablePitcher.fullName }
            : null,
        },
        awayLineup,
        homeLineup,
      } as MLBGame;
    });

    // If we didn't set a fallback date, use today
    if (!gameCache.dataDate) {
      gameCache.dataDate = today;
    }
    gameCache.entry = { data: games, timestamp: Date.now() };
    return games;
  } catch (error) {
    console.error("Error fetching MLB games:", error);
    // Return cached data if available, even if stale
    return gameCache.entry?.data || [];
  }
}

// ─── Fetch player season stats ────────────────────────────────────────────────

export async function fetchPlayerStats(playerId: number, playerName: string, teamId: number, teamName: string, teamAbbr: string): Promise<PlayerSeasonStats | null> {
  // Check cache
  const cached = statsCache.get(playerId);
  if (cached && Date.now() - cached.timestamp < STATS_CACHE_TTL) {
    return cached.data;
  }

  const season = new Date().getFullYear();
  const url = `${MLB_API_BASE}/people/${playerId}/stats?stats=season&group=hitting&season=${season}`;

  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const json = await response.json() as any;
    const splits = json.stats?.[0]?.splits || [];
    if (splits.length === 0) return null;

    const stat = splits[0].stat;
    const gamesPlayed = stat.gamesPlayed || 1;

    const playerStats: PlayerSeasonStats = {
      playerId,
      fullName: playerName,
      teamId,
      teamName,
      teamAbbreviation: teamAbbr,
      gamesPlayed,
      atBats: stat.atBats || 0,
      hits: stat.hits || 0,
      runs: stat.runs || 0,
      rbi: stat.rbi || 0,
      homeRuns: stat.homeRuns || 0,
      avg: stat.avg || ".000",
      obp: stat.obp || ".000",
      slg: stat.slg || ".000",
      ops: stat.ops || ".000",
      strikeOuts: stat.strikeOuts || 0,
      baseOnBalls: stat.baseOnBalls || 0,
      stolenBases: stat.stolenBases || 0,
      hitsPerGame: (stat.hits || 0) / gamesPlayed,
      runsPerGame: (stat.runs || 0) / gamesPlayed,
      rbiPerGame: (stat.rbi || 0) / gamesPlayed,
      hrrPerGame: ((stat.hits || 0) + (stat.runs || 0) + (stat.rbi || 0)) / gamesPlayed,
    };

    statsCache.set(playerId, { data: playerStats, timestamp: Date.now() });
    return playerStats;
  } catch (error) {
    console.error(`Error fetching stats for player ${playerId}:`, error);
    return cached?.data || null;
  }
}

// ─── Get all players in today's lineups with their stats ──────────────────────

export async function getTodaysPlayersWithStats(): Promise<PlayerWithContext[]> {
  const games = await fetchTodaysGames();
  const players: PlayerWithContext[] = [];

  // Fetch stats for all players in parallel (batched to avoid rate limits)
  const allLineupPlayers: { player: LineupPlayer; game: MLBGame; isHome: boolean }[] = [];

  for (const game of games) {
    // Skip games that are already final or postponed
    if (game.status === "Postponed" || game.status === "Cancelled") continue;

    for (const p of game.awayLineup) {
      allLineupPlayers.push({ player: p, game, isHome: false });
    }
    for (const p of game.homeLineup) {
      allLineupPlayers.push({ player: p, game, isHome: true });
    }
  }

  // Batch fetch stats (10 at a time to be respectful of rate limits)
  const BATCH_SIZE = 10;
  for (let i = 0; i < allLineupPlayers.length; i += BATCH_SIZE) {
    const batch = allLineupPlayers.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(({ player }) =>
        fetchPlayerStats(player.id, player.fullName, player.teamId, player.teamName, player.teamAbbreviation)
      )
    );

    for (let j = 0; j < batch.length; j++) {
      const stats = results[j];
      if (!stats || stats.gamesPlayed < 5) continue; // Skip players with too few games

      const { player, game, isHome } = batch[j];
      const opposingPitcher = isHome
        ? game.awayTeam.probablePitcher
        : game.homeTeam.probablePitcher;

      players.push({
        ...stats,
        game,
        battingPosition: player.battingOrder,
        opposingPitcher,
        isHome,
      });
    }
  }

  return players;
}

// ─── Get games summary (for game cards UI) ────────────────────────────────────

export async function getTodaysGamesSummary(): Promise<MLBGame[]> {
  return fetchTodaysGames();
}
