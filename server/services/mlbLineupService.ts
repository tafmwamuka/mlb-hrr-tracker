/**
 * MLB Lineup Service
 * Fetches today's real games, lineups, and player season stats from MLB Stats API.
 * Ensures picks are only generated for players actually playing today on their correct teams.
 * When confirmed lineups are not yet posted, falls back to projected lineups.
 */

import { buildProjectedLineup, isLineupConfirmed, type LineupSource } from "./projectedLineupService";

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
  lineupSource: LineupSource; // 'confirmed' | 'projected'
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
  source?: LineupSource; // 'confirmed' | 'projected'
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
 * Get the current hour in Eastern Time (0-23).
 */
function getETHour(): number {
  const now = new Date();
  const etDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return etDate.getHours();
}

/**
 * Get the best date to query for games with lineups.
 * Uses today's date in Eastern time (MLB operates on ET).
 * After 5 AM ET, always returns today — never yesterday.
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
 * Returns true if it's after 5 AM ET — the "active slate" window.
 * After 5 AM ET, the site must always show today's games, never yesterday's.
 */
function isActiveSlatePeriod(): boolean {
  return getETHour() >= 5;
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
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
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

    // CRITICAL SLATE RULE: After 5 AM ET, NEVER fall back to yesterday's slate.
    // Today's games will use projected lineups if official lineups aren't posted yet.
    // Only fall back to past dates before 5 AM ET (overnight window).
    if (!hasLineups && gamesData.length === 0 && !isActiveSlatePeriod()) {
      // Before 5 AM ET and no games at all — try recent past dates
      console.log(`No games for ${today} (pre-5AM ET), trying recent dates...`);
      const fallbackDates = getRecentDatesWithGames();
      for (const fallbackDate of fallbackDates) {
        try {
          const fbUrl = `${MLB_API_BASE}/schedule?sportId=1&date=${fallbackDate}&hydrate=lineups,probablePitcher`;
          const fbResp = await fetch(fbUrl, { signal: AbortSignal.timeout(8000) });
          if (fbResp.ok) {
            const fbJson = await fbResp.json() as any;
            const fbDates = fbJson.dates || [];
            if (fbDates.length > 0) {
              const fbGames = fbDates[0].games;
              const fbHasLineups = fbGames.some((g: any) => 
                (g.lineups?.awayPlayers?.length > 0) || (g.lineups?.homePlayers?.length > 0)
              );
              if (fbHasLineups) {
                console.log(`[Slate] Pre-5AM fallback: using ${fallbackDate} lineup data`);
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
    } else if (!hasLineups && gamesData.length > 0 && isActiveSlatePeriod()) {
      // After 5 AM ET: today has games but no lineups yet — stay on today, use projected lineups
      console.log(`[Slate] Active slate period (${getETHour()}h ET): ${today} has ${gamesData.length} games, lineups pending. Using projected lineups.`);
      gameCache.dataDate = today;
    } else if (!hasLineups && gamesData.length === 0 && isActiveSlatePeriod()) {
      // After 5 AM ET: no games today at all (off day or API issue) — stay on today, show empty
      console.log(`[Slate] Active slate period: no games found for ${today} (off day or API issue)`);
      gameCache.dataDate = today;
    }

    const games: MLBGame[] = gamesData.map((g: any) => {
      const awayTeamId = g.teams?.away?.team?.id || 0;
      const homeTeamId = g.teams?.home?.team?.id || 0;
      const awayTeamName = g.teams?.away?.team?.name || "Unknown";
      const homeTeamName = g.teams?.home?.team?.name || "Unknown";
      const awayAbbr = getTeamAbbreviation(awayTeamId, awayTeamName);
      const homeAbbr = getTeamAbbreviation(homeTeamId, homeTeamName);

      const rawAwayLineup = g.lineups?.awayPlayers || [];
      const rawHomeLineup = g.lineups?.homePlayers || [];
      const awayConfirmed = isLineupConfirmed(rawAwayLineup);
      const homeConfirmed = isLineupConfirmed(rawHomeLineup);

      const awayLineup: LineupPlayer[] = rawAwayLineup.map((p: any, i: number) => ({
        id: p.id,
        fullName: p.fullName,
        firstName: p.firstName || p.fullName.split(" ")[0],
        lastName: p.lastName || p.fullName.split(" ").slice(1).join(" "),
        position: p.primaryPosition?.abbreviation || "DH",
        battingOrder: i + 1,
        teamId: awayTeamId,
        teamName: awayTeamName,
        teamAbbreviation: awayAbbr,
        source: "confirmed" as LineupSource,
      }));

      const homeLineup: LineupPlayer[] = rawHomeLineup.map((p: any, i: number) => ({
        id: p.id,
        fullName: p.fullName,
        firstName: p.firstName || p.fullName.split(" ")[0],
        lastName: p.lastName || p.fullName.split(" ").slice(1).join(" "),
        position: p.primaryPosition?.abbreviation || "DH",
        battingOrder: i + 1,
        teamId: homeTeamId,
        teamName: homeTeamName,
        teamAbbreviation: homeAbbr,
        source: "confirmed" as LineupSource,
      }));

      // Determine overall lineup source for this game
      const lineupSource: LineupSource = (awayConfirmed && homeConfirmed) ? "confirmed" : "projected";

      return {
        gamePk: g.gamePk,
        gameDate: g.gameDate,
        gameTime: g.gameDate ? new Date(g.gameDate).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/St_Johns" }) : "TBD",
        status: (() => {
          const abs = g.status?.abstractGameState || 'Scheduled';
          const det = g.status?.detailedState || '';
          if (abs === 'Postponed' || det.includes('Postponed') || det.includes('Cancelled') || det.includes('Suspended')) return 'Postponed';
          return abs;
        })(),
        dayNight: g.dayNight || "night",
        venue: g.venue?.name || "Unknown",
        venueId: g.venue?.id || 0,
        lineupSource,
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

    // ── Projected lineup fallback ─────────────────────────────────────────────
    // For games without confirmed lineups, fetch projected lineups in parallel
    const projectedFills = games
      .filter(game => game.lineupSource === "projected")
      .map(async game => {
        const [awayProj, homeProj] = await Promise.all([
          game.awayLineup.length < 8 ? buildProjectedLineup(game.awayTeam.id, game.awayTeam.name, game.awayTeam.abbreviation) : Promise.resolve(null),
          game.homeLineup.length < 8 ? buildProjectedLineup(game.homeTeam.id, game.homeTeam.name, game.homeTeam.abbreviation) : Promise.resolve(null),
        ]);
        if (awayProj && awayProj.length > 0) game.awayLineup = awayProj;
        if (homeProj && homeProj.length > 0) game.homeLineup = homeProj;
        return game;
      });

    if (projectedFills.length > 0) {
      await Promise.all(projectedFills);
      console.log(`[Lineups] Filled projected lineups for ${projectedFills.length} games`);
    }

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
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
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

// ─── Bulk fetch stats for a team (one call instead of per-player) ─────────────
async function fetchTeamBulkStats(teamId: number, season: number): Promise<Map<number, any>> {
  const url = `${MLB_API_BASE}/teams/${teamId}/roster?rosterType=active&season=${season}&hydrate=person(stats(type=season,group=hitting,season=${season}))`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) return new Map();
    const json = await response.json() as any;
    const result = new Map<number, any>();
    for (const entry of (json.roster ?? [])) {
      const person = entry.person;
      if (!person?.id) continue;
      const splits = person.stats?.[0]?.splits ?? [];
      if (splits.length > 0) {
        result.set(person.id, splits[0].stat);
      }
    }
    return result;
  } catch {
    return new Map();
  }
}

// ─── Get all players in today's lineups with their stats ────────────────────────────────────────────────

export async function getTodaysPlayersWithStats(): Promise<PlayerWithContext[]> {
  const games = await fetchTodaysGames();
  const players: PlayerWithContext[] = [];

  const allLineupPlayers: { player: LineupPlayer; game: MLBGame; isHome: boolean }[] = [];
  const teamIds = new Set<number>();

  for (const game of games) {
    if (game.status === "Postponed" || game.status === "Cancelled") continue;
    teamIds.add(game.awayTeam.id);
    teamIds.add(game.homeTeam.id);
    for (const p of game.awayLineup) allLineupPlayers.push({ player: p, game, isHome: false });
    for (const p of game.homeLineup) allLineupPlayers.push({ player: p, game, isHome: true });
  }

  if (allLineupPlayers.length === 0) return [];

  const season = new Date().getFullYear();

  // Strategy 1: Bulk fetch by team (1 call per team instead of 1 per player)
  // This reduces ~150 individual calls to ~30 team calls, far more reliable.
  const bulkStatMaps = await Promise.all(
    Array.from(teamIds).map(async (teamId) => {
      // Check if we already have all players cached for this team
      const teamPlayers = allLineupPlayers.filter(lp => lp.player.teamId === teamId);
      const allCached = teamPlayers.every(lp => {
        const c = statsCache.get(lp.player.id);
        return c && Date.now() - c.timestamp < STATS_CACHE_TTL;
      });
      if (allCached) return { teamId, stats: new Map<number, any>() }; // cache hit, skip bulk
      const stats = await fetchTeamBulkStats(teamId, season);
      return { teamId, stats };
    })
  );

  // Populate statsCache from bulk results
  for (const { stats } of bulkStatMaps) {
    for (const [pid, stat] of Array.from(stats.entries())) {
      if (!statsCache.has(pid) || Date.now() - statsCache.get(pid)!.timestamp >= STATS_CACHE_TTL) {
        const gamesPlayed = stat.gamesPlayed || 1;
        // We need fullName/teamId/teamName/teamAbbr — look them up from lineup
        const lp = allLineupPlayers.find(l => l.player.id === pid);
        if (!lp) continue;
        const playerStats: PlayerSeasonStats = {
          playerId: pid,
          fullName: lp.player.fullName,
          teamId: lp.player.teamId,
          teamName: lp.player.teamName,
          teamAbbreviation: lp.player.teamAbbreviation,
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
        statsCache.set(pid, { data: playerStats, timestamp: Date.now() });
      }
    }
  }

  // Strategy 2: For any player still missing from cache, fall back to individual fetch
  const missing = allLineupPlayers.filter(lp => {
    const c = statsCache.get(lp.player.id);
    return !c || Date.now() - c.timestamp >= STATS_CACHE_TTL;
  });
  if (missing.length > 0) {
    console.log(`[LineupService] Bulk fetch complete. ${missing.length} players missing stats, falling back to individual fetch.`);
    await Promise.all(
      missing.map(({ player }) =>
        fetchPlayerStats(player.id, player.fullName, player.teamId, player.teamName, player.teamAbbreviation)
      )
    );
  }

  const enrichedCount = allLineupPlayers.filter(lp => statsCache.has(lp.player.id)).length;
  console.log(`[LineupService] Stats loaded: ${enrichedCount}/${allLineupPlayers.length} lineup players enriched.`);

  for (const { player, game, isHome } of allLineupPlayers) {
    const cached = statsCache.get(player.id);
    if (!cached || cached.data.gamesPlayed < 5) continue;
    const opposingPitcher = isHome ? game.awayTeam.probablePitcher : game.homeTeam.probablePitcher;
    players.push({
      ...cached.data,
      game,
      battingPosition: player.battingOrder,
      opposingPitcher,
      isHome,
    });
  }

  return players;
}

// ─── Get games summary (for game cards UI) ────────────────────────────────────────────────

export async function getTodaysGamesSummary(): Promise<MLBGame[]> {
  return fetchTodaysGames();
}
