/**
 * BallparkPal Matchup Service
 * Fetches real batter-vs-pitcher matchup data from ballparkpal.com
 * Provides the VS Grade (1-10 scale) used as the PRIMARY gate filter for picks.
 * Also computes projected game totals from aggregate RC sums.
 */

export interface BallparkMatchup {
  game: string;           // e.g. "Giants @ Dodgers"
  team: string;           // e.g. "LAD"
  batter: string;         // e.g. "Freddie Freeman"
  bats: string;           // R, L, S
  pitcher: string;        // e.g. "Roupp"
  throws: string;         // R, L
  starter: boolean;       // true if in starting lineup
  rc: number;             // Runs Created (park-adjusted)
  vsGrade: number;        // -10 to 10 matchup rating (THE KEY FIELD)
  hrProb: number;         // HR probability %
  xbProb: number;         // Extra base hit probability %
  oneBProb: number;       // Single probability %
  bbProb: number;         // Walk probability %
  kProb: number;          // Strikeout probability %
  // Historical head-to-head
  pa: number;             // Plate appearances vs this pitcher
  ab: number;             // At-bats vs this pitcher
  h: number;              // Hits vs this pitcher
  avg: string;            // AVG vs this pitcher
  // No-park versions
  rcNoPark: number;
}

export interface GameTotal {
  game: string;           // e.g. "Giants @ Dodgers"
  totalRC: number;        // Sum of all starter RCs in this game
  avgRC: number;          // Average RC per starter
  playerCount: number;    // Number of starters
  // Normalized score 0-100 for use in scoring
  gameTotalScore: number;
}

// Cache
let cachedMatchups: BallparkMatchup[] | null = null;
let cachedGameTotals: Map<string, GameTotal> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Fetch today's matchup data from ballparkpal.com
 * The page embeds a JSON variable `__matchupExportData` with all matchups.
 */
async function fetchMatchupData(): Promise<BallparkMatchup[]> {
  // Check cache
  if (cachedMatchups && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedMatchups;
  }

  try {
    const resp = await fetch('https://www.ballparkpal.com/MatchUps.php', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MLBHRRTracker/1.0)',
        'Accept': 'text/html',
      },
    });

    if (!resp.ok) {
      console.error(`[BallparkPal] Failed to fetch matchups: ${resp.status}`);
      return cachedMatchups || [];
    }

    const html = await resp.text();
    const match = html.match(/var __matchupExportData = (\[[\s\S]*?\]);/);
    if (!match) {
      console.error('[BallparkPal] Could not find matchup data in page');
      return cachedMatchups || [];
    }

    const rawData = JSON.parse(match[1]) as Array<Record<string, any>>;

    const matchups: BallparkMatchup[] = rawData.map(d => ({
      game: (d.Game || '').trim(),
      team: (d.Team || '').trim(),
      batter: (d.Batter || '').trim(),
      bats: (d.Bats || 'R').trim(),
      pitcher: (d.Pitcher || '').trim(),
      throws: (d.Throws || 'R').trim(),
      starter: d.Starter === 1,
      rc: d.RC || 0,
      vsGrade: d['vs Grade'] ?? 0,
      hrProb: d['HR Prob'] || 0,
      xbProb: d['XB Prob'] || 0,
      oneBProb: d['1B Prob'] || 0,
      bbProb: d['BB Prob'] || 0,
      kProb: d['K Prob'] || 0,
      pa: d.PA || 0,
      ab: d.AB || 0,
      h: d.H || 0,
      avg: (d.AVG || '.000').trim(),
      rcNoPark: d['RC (no park)'] || 0,
    }));

    cachedMatchups = matchups;
    cacheTimestamp = Date.now();
    console.log(`[BallparkPal] Fetched ${matchups.length} matchups (${matchups.filter(m => m.starter).length} starters)`);
    return matchups;
  } catch (error) {
    console.error('[BallparkPal] Error fetching matchups:', error);
    return cachedMatchups || [];
  }
}

/**
 * Compute projected game totals from aggregate RC sums.
 * Higher total RC = more runs expected = higher game total.
 */
function computeGameTotals(matchups: BallparkMatchup[]): Map<string, GameTotal> {
  const gameMap = new Map<string, { total: number; count: number }>();

  for (const m of matchups) {
    if (!m.starter) continue;
    const existing = gameMap.get(m.game) || { total: 0, count: 0 };
    existing.total += m.rc;
    existing.count++;
    gameMap.set(m.game, existing);
  }

  // Normalize: find min/max RC sums to create 0-100 scale
  const entries = Array.from(gameMap.entries());
  const rcSums = entries.map(([, v]) => v.total);
  const minRC = Math.min(...rcSums);
  const maxRC = Math.max(...rcSums);
  const range = maxRC - minRC || 1;

  const result = new Map<string, GameTotal>();
  for (const [game, { total, count }] of entries) {
    // Normalize to 0-100 scale
    const gameTotalScore = Math.round(((total - minRC) / range) * 100);
    result.set(game, {
      game,
      totalRC: total,
      avgRC: Math.round((total / count) * 10) / 10,
      playerCount: count,
      gameTotalScore,
    });
  }

  return result;
}

/**
 * Get today's VS-gated matchup pool.
 * PRIMARY GATE: Only starters with VS Grade >= 9 pass through.
 * VS=10: always included
 * VS=9: included as "exceptions" — they still go through the full scoring matrix
 * 
 * All batters in the pool still go through the full scoring matrix for final ranking.
 */
export async function getVSGatedPool(): Promise<{
  pool: BallparkMatchup[];
  gameTotals: Map<string, GameTotal>;
  allMatchups: BallparkMatchup[];
}> {
  const allMatchups = await fetchMatchupData();
  const starters = allMatchups.filter(m => m.starter);
  
  // PRIMARY GATE: VS Grade >= 9 (10s always, 9s as exceptions)
  const pool = starters.filter(m => m.vsGrade >= 9);

  // Compute game totals for influence scoring
  const gameTotals = computeGameTotals(allMatchups);
  cachedGameTotals = gameTotals;

  console.log(`[BallparkPal] VS Gate: ${pool.length} players pass (VS≥9 starters). ${pool.filter(m => m.vsGrade === 10).length} tens, ${pool.filter(m => m.vsGrade === 9).length} nines.`);

  return { pool, gameTotals, allMatchups };
}

/**
 * Get the game total score for a specific game.
 * Returns 0-100 where 100 = highest projected scoring game of the day.
 */
export function getGameTotalScore(game: string): number {
  if (!cachedGameTotals) return 50; // neutral if no data
  const gameTotal = cachedGameTotals.get(game);
  return gameTotal?.gameTotalScore ?? 50;
}

/**
 * Get all matchup data (for display purposes, not gating)
 */
export async function getAllMatchups(): Promise<BallparkMatchup[]> {
  return fetchMatchupData();
}

/**
 * Get game totals map
 */
export async function getGameTotalsMap(): Promise<Map<string, GameTotal>> {
  if (cachedGameTotals && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedGameTotals;
  }
  const matchups = await fetchMatchupData();
  cachedGameTotals = computeGameTotals(matchups);
  return cachedGameTotals;
}

/**
 * Match a player name from MLB lineup to ballparkpal batter name.
 * BallparkPal uses full names like "Freddie Freeman", MLB uses "Freddie Freeman" too.
 * We do fuzzy matching on last name.
 */
export function findMatchupForPlayer(
  playerName: string,
  team: string,
  matchups: BallparkMatchup[]
): BallparkMatchup | null {
  // Exact match first
  const exact = matchups.find(m => 
    m.batter.toLowerCase() === playerName.toLowerCase() && 
    m.team === team
  );
  if (exact) return exact;

  // Last name match with team
  const lastName = playerName.split(' ').pop()?.toLowerCase() || '';
  const lastNameMatch = matchups.find(m => 
    m.batter.toLowerCase().split(' ').pop() === lastName && 
    m.team === team
  );
  if (lastNameMatch) return lastNameMatch;

  // Last name match without team (for team abbreviation mismatches)
  const fuzzy = matchups.find(m => 
    m.batter.toLowerCase().split(' ').pop() === lastName
  );
  return fuzzy || null;
}
