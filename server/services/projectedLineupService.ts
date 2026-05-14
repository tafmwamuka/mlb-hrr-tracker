/**
 * Projected Lineup Service
 * When confirmed lineups are not yet posted (typically before 3-4 PM ET),
 * this service builds projected lineups using:
 * 1. Today's probable pitchers (from MLB API schedule)
 * 2. Each team's roster of active hitters (from MLB API roster endpoint)
 * 3. Historical batting order tendencies (last 10 games) for each player
 *
 * The projected lineup is clearly labelled PROJECTED and auto-upgrades to
 * CONFIRMED once the real lineup posts.
 */

const MLB_API_BASE = "https://statsapi.mlb.com/api/v1";

export type LineupSource = "confirmed" | "projected";

export interface ProjectedLineupPlayer {
  id: number;
  fullName: string;
  firstName: string;
  lastName: string;
  position: string;
  battingOrder: number; // 1-9 (projected or confirmed)
  teamId: number;
  teamName: string;
  teamAbbreviation: string;
  source: LineupSource;
}

// Cache for projected lineups (15 min TTL — refresh often since real lineups may post)
const projectedCache = new Map<number, { data: ProjectedLineupPlayer[]; timestamp: number }>();
const PROJECTED_TTL = 15 * 60 * 1000; // 15 minutes

// Cache for team rosters (1 hour TTL)
const rosterCache = new Map<number, { data: any[]; timestamp: number }>();
const ROSTER_TTL = 60 * 60 * 1000; // 1 hour

// Cache for historical batting orders (1 hour TTL)
const battingOrderCache = new Map<number, { data: Map<number, number>; timestamp: number }>();

/**
 * Fetch active roster for a team (hitters only)
 */
async function fetchTeamRoster(teamId: number): Promise<any[]> {
  const cached = rosterCache.get(teamId);
  if (cached && Date.now() - cached.timestamp < ROSTER_TTL) return cached.data;

  try {
    const season = new Date().getFullYear();
    const url = `${MLB_API_BASE}/teams/${teamId}/roster?rosterType=active&season=${season}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return [];
    const json = await resp.json() as any;
    const roster = (json.roster || []).filter((p: any) => {
      const pos = p.position?.abbreviation || "";
      // Exclude pitchers (P, SP, RP) from projected batting lineup
      return pos !== "P" && pos !== "SP" && pos !== "RP";
    });
    rosterCache.set(teamId, { data: roster, timestamp: Date.now() });
    return roster;
  } catch {
    return [];
  }
}

/**
 * Fetch historical batting order for a team (last 10 games)
 * Returns a map of playerId -> average batting order position
 */
async function fetchHistoricalBattingOrder(teamId: number): Promise<Map<number, number>> {
  const cached = battingOrderCache.get(teamId);
  if (cached && Date.now() - cached.timestamp < ROSTER_TTL) return cached.data;

  const battingOrderMap = new Map<number, { total: number; count: number }>();

  try {
    const season = new Date().getFullYear();
    // Get last 10 games for this team
    const schedUrl = `${MLB_API_BASE}/schedule?sportId=1&teamId=${teamId}&season=${season}&gameType=R&hydrate=lineups&limit=10&order=desc`;
    const resp = await fetch(schedUrl, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) {
      battingOrderCache.set(teamId, { data: new Map(), timestamp: Date.now() });
      return new Map();
    }
    const json = await resp.json() as any;
    const dates = json.dates || [];

    for (const date of dates.slice(0, 10)) {
      for (const game of date.games || []) {
        const isHome = game.teams?.home?.team?.id === teamId;
        const lineupPlayers = isHome
          ? (game.lineups?.homePlayers || [])
          : (game.lineups?.awayPlayers || []);

        lineupPlayers.forEach((p: any, idx: number) => {
          if (!p.id) return;
          const existing = battingOrderMap.get(p.id) || { total: 0, count: 0 };
          battingOrderMap.set(p.id, { total: existing.total + (idx + 1), count: existing.count + 1 });
        });
      }
    }
  } catch {
    // Return empty on error
  }

  // Convert to average batting order
  const result = new Map<number, number>();
  for (const [playerId, { total, count }] of Array.from(battingOrderMap.entries())) {
    result.set(playerId, Math.round(total / count));
  }

  battingOrderCache.set(teamId, { data: result, timestamp: Date.now() });
  return result;
}

/**
 * Build a projected lineup for a team using roster + historical batting order.
 * Returns up to 9 players sorted by their historical batting order tendency.
 */
export async function buildProjectedLineup(
  teamId: number,
  teamName: string,
  teamAbbr: string
): Promise<ProjectedLineupPlayer[]> {
  const cached = projectedCache.get(teamId);
  if (cached && Date.now() - cached.timestamp < PROJECTED_TTL) return cached.data;

  const [roster, battingOrderMap] = await Promise.all([
    fetchTeamRoster(teamId),
    fetchHistoricalBattingOrder(teamId),
  ]);

  if (roster.length === 0) return [];

  // Sort roster by historical batting order (players with no history go to bottom)
  const sorted = [...roster].sort((a, b) => {
    const aOrder = battingOrderMap.get(a.person?.id) ?? 10;
    const bOrder = battingOrderMap.get(b.person?.id) ?? 10;
    return aOrder - bOrder;
  });

  // Take top 9 (typical batting lineup)
  const lineup: ProjectedLineupPlayer[] = sorted.slice(0, 9).map((p, idx) => ({
    id: p.person?.id || 0,
    fullName: p.person?.fullName || "Unknown",
    firstName: (p.person?.fullName || "").split(" ")[0],
    lastName: (p.person?.fullName || "").split(" ").slice(1).join(" "),
    position: p.position?.abbreviation || "DH",
    battingOrder: idx + 1,
    teamId,
    teamName,
    teamAbbreviation: teamAbbr,
    source: "projected" as LineupSource,
  }));

  projectedCache.set(teamId, { data: lineup, timestamp: Date.now() });
  return lineup;
}

/**
 * Determine if a game has confirmed lineups posted.
 * Returns true if at least 8 players are in the lineup (full confirmed lineup).
 */
export function isLineupConfirmed(lineupPlayers: any[]): boolean {
  return lineupPlayers.length >= 8;
}

/**
 * Get the lineup source label for display
 */
export function getLineupSourceLabel(source: LineupSource): string {
  return source === "confirmed" ? "CONFIRMED" : "PROJECTED";
}
