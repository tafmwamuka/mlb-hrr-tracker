/**
 * Game Totals Service
 * Fetches MLB game over/under lines from The Odds API (primary source).
 * Falls back to aggregate RC sum from model data when API unavailable.
 *
 * The game total (O/U) is the best single proxy for projected scoring environment.
 * A game with O/U 10.5 is objectively a higher-scoring environment than one at 7.0.
 * This directly boosts the probability of hits/runs/RBI for players in that game.
 */

// VS gate handles matchup scoring internally
import fs from 'fs';
import path from 'path';

/** Resolve the Odds API key — always prefers .project-config.json over .env */
function getOddsApiKey(override?: string): string {
  if (override) return override;
  try {
    const configPath = path.resolve(process.cwd(), '.project-config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const configKey = config?.secrets?.ODDS_API_KEY || '';
      if (configKey) return configKey;
    }
  } catch { /* ignore */ }
  return process.env.ODDS_API_KEY || '';
}

export interface GameTotal {
  /** e.g. "Giants @ Dodgers" or "SF @ LAD" */
  game: string;
  /** Away team abbreviation */
  awayTeam: string;
  /** Home team abbreviation */
  homeTeam: string;
  /** Vegas consensus over/under line (e.g. 9.5) — null if unavailable */
  overUnder: number | null;
  /** Source of the data */
  source: "odds_api" | "rc_aggregate" | "default";
  /** Normalized 0–100 score: 100 = highest-total game of the day */
  gameTotalScore: number;
  /** Raw RC aggregate (fallback) */
  rcAggregate?: number;
}

// Cache
let cachedTotals: Map<string, GameTotal> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

/** Clear the in-memory game totals cache (e.g. after an API key change) */
export function clearGameTotalsCache(): void {
  cachedTotals = null;
  cacheTimestamp = 0;
}
/** Return status of the game totals in-memory cache */
export function getGameTotalsStatus(): { loaded: boolean; gameCount: number; lastUpdated: Date | null } {
  if (!cachedTotals) return { loaded: false, gameCount: 0, lastUpdated: null };
  return {
    loaded: cachedTotals.size > 0,
    gameCount: cachedTotals.size,
    lastUpdated: cacheTimestamp > 0 ? new Date(cacheTimestamp) : null,
  };
}

// ─── Odds API ─────────────────────────────────────────────────────────────────

const ODDS_API_BASE = "https://api.the-odds-api.com/v4";
const SPORT = "baseball_mlb";

interface OddsApiGame {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Array<{
    key: string;
    title: string;
    markets: Array<{
      key: string;
      outcomes: Array<{
        name: string;
        price: number;
        point?: number;
      }>;
    }>;
  }>;
}

/** MLB team name → abbreviation mapping */
const TEAM_NAME_TO_ABBR: Record<string, string> = {
  "Arizona Diamondbacks": "ARI", "Atlanta Braves": "ATL", "Baltimore Orioles": "BAL",
  "Boston Red Sox": "BOS", "Chicago Cubs": "CHC", "Chicago White Sox": "CHW",
  "Cincinnati Reds": "CIN", "Cleveland Guardians": "CLE", "Colorado Rockies": "COL",
  "Detroit Tigers": "DET", "Houston Astros": "HOU", "Kansas City Royals": "KC",
  "Los Angeles Angels": "LAA", "Los Angeles Dodgers": "LAD", "Miami Marlins": "MIA",
  "Milwaukee Brewers": "MIL", "Minnesota Twins": "MIN", "New York Mets": "NYM",
  "New York Yankees": "NYY", "Oakland Athletics": "OAK", "Athletics": "ATH",
  "Philadelphia Phillies": "PHI", "Pittsburgh Pirates": "PIT", "San Diego Padres": "SD",
  "San Francisco Giants": "SF", "Seattle Mariners": "SEA", "St. Louis Cardinals": "STL",
  "Tampa Bay Rays": "TB", "Texas Rangers": "TEX", "Toronto Blue Jays": "TOR",
  "Washington Nationals": "WSH",
};

function toAbbr(teamName: string): string {
  return TEAM_NAME_TO_ABBR[teamName] || teamName.split(" ").pop()?.toUpperCase().slice(0, 3) || "???";
}

/**
 * Fetch game totals from The Odds API.
 * Uses the "totals" market (over/under on total runs).
 * Returns a map keyed by "AWAY@HOME" abbreviation pair.
 */
async function fetchOddsApiTotals(apiKey: string): Promise<Map<string, { overUnder: number; awayTeam: string; homeTeam: string }>> {
  const url = `${ODDS_API_BASE}/sports/${SPORT}/odds?apiKey=${apiKey}&regions=us&markets=totals&oddsFormat=american`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.error(`[GameTotals] Odds API error: ${resp.status}`);
      return new Map();
    }

    const games: OddsApiGame[] = await resp.json();
    const result = new Map<string, { overUnder: number; awayTeam: string; homeTeam: string }>();

    for (const game of games) {
      const awayAbbr = toAbbr(game.away_team);
      const homeAbbr = toAbbr(game.home_team);

      // Find the totals market across all bookmakers, take consensus
      const totalsPoints: number[] = [];
      for (const bookmaker of game.bookmakers) {
        const totalsMarket = bookmaker.markets.find(m => m.key === "totals");
        if (totalsMarket) {
          const overOutcome = totalsMarket.outcomes.find(o => o.name === "Over");
          if (overOutcome?.point != null) {
            totalsPoints.push(overOutcome.point);
          }
        }
      }

      if (totalsPoints.length > 0) {
        // Consensus: median of all bookmaker lines
        totalsPoints.sort((a, b) => a - b);
        const median = totalsPoints[Math.floor(totalsPoints.length / 2)];
        const key = `${awayAbbr}@${homeAbbr}`;
        result.set(key, { overUnder: median, awayTeam: awayAbbr, homeTeam: homeAbbr });
        console.log(`[GameTotals] ${key}: O/U ${median} (${totalsPoints.length} books)`);
      }
    }

    console.log(`[GameTotals] Odds API: fetched ${result.size} game totals`);
    return result;
  } catch (error) {
    console.error("[GameTotals] Error fetching Odds API:", error);
    return new Map();
  }
}

// RC Aggregate Fallback removed — not needed

// ─── Normalization ────────────────────────────────────────────────────────────

/**
 * Normalize an array of values to 0–100 scores.
 * Higher value = higher score.
 */
function normalizeToScore(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values.map(v => Math.round(((v - min) / range) * 100));
}

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Simple team-based input for game totals (replaces BallparkMatchup[]).
 * Used when RC data is unavailable.
 */
export interface TeamMatchupRef {
  batter: string;
  team: string;
  vsGrade?: number;
  /** Starting pitcher ERA for this team (used for game total estimation when Odds API unavailable) */
  pitcherERA?: number;
}

/**
 * Fetch today's game totals.
 * Primary: The Odds API (consensus O/U line from multiple books).
 * Fallback: Default neutral score (50) when Odds API is unavailable.
 *
 * Returns a map keyed by team abbreviation for easy lookup.
 */
export async function fetchGameTotals(
  apiKey: string | undefined,
  matchups: TeamMatchupRef[]
): Promise<Map<string, GameTotal>> {
  // Check cache
  if (cachedTotals && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedTotals;
  }

  let oddsData = new Map<string, { overUnder: number; awayTeam: string; homeTeam: string }>();

  // Try Odds API first
  const resolvedKey = getOddsApiKey(apiKey);
  if (resolvedKey) {
    oddsData = await fetchOddsApiTotals(resolvedKey);
  }

  // Merge: prefer Odds API, fall back to default neutral scores
  const result = new Map<string, GameTotal>();

  if (oddsData.size > 0) {
    // Use Odds API data — score O/U on an ABSOLUTE MLB scale (6.5=0, 12.5=100)
    // This prevents low-total games from scoring near 0 just because a high-total
    // game exists on the same slate (the old relative normalization bug).
    // MLB realistic range: 6.5 (pitcher's duel) to 12.5 (slugfest)
    const MLB_OU_MIN = 6.5;
    const MLB_OU_MAX = 12.5;
    for (const [key, data] of Array.from(oddsData.entries())) {
      const absScore = Math.round(
        Math.min(100, Math.max(0, ((data.overUnder - MLB_OU_MIN) / (MLB_OU_MAX - MLB_OU_MIN)) * 100))
      );
      const gameTotal: GameTotal = {
        game: key,
        awayTeam: data.awayTeam,
        homeTeam: data.homeTeam,
        overUnder: data.overUnder,
        source: "odds_api",
        gameTotalScore: absScore,
      };
      result.set(key, gameTotal);
      // Also index by individual team abbreviations for easy lookup
      result.set(data.awayTeam, gameTotal);
      result.set(data.homeTeam, gameTotal);
    }
  }

  // Fill in any teams not covered by Odds API with a pitcher-ERA-based estimate
  // MLB average: 8.5 runs/game total (4.25 per team). Adjust by pitcher ERA:
  //   ERA < 3.00 → subtract 0.5 runs from total
  //   ERA 3.00-4.00 → subtract 0.25
  //   ERA 4.00-5.00 → neutral (8.5)
  //   ERA 5.00-6.00 → add 0.5
  //   ERA > 6.00 → add 1.0
  const MLB_AVG_TOTAL = 8.5;
  const coveredTeams = new Set(Array.from(result.keys()));
  for (const m of matchups) {
    if (!coveredTeams.has(m.team)) {
      // Use pitcher ERA to estimate game total
      const era = m.pitcherERA ?? null;
      let estimatedTotal = MLB_AVG_TOTAL;
      if (era !== null) {
        if (era < 3.0) estimatedTotal = 7.5;
        else if (era < 4.0) estimatedTotal = 8.0;
        else if (era < 5.0) estimatedTotal = 8.5;
        else if (era < 6.0) estimatedTotal = 9.5;
        else estimatedTotal = 10.5;
      }
      // Normalize: MLB range is roughly 6.5 (low) to 12.0 (high)
      const normalizedScore = Math.round(Math.min(100, Math.max(0, ((estimatedTotal - 6.5) / 5.5) * 100)));
      const defaultTotal: GameTotal = {
        game: m.team,
        awayTeam: m.team,
        homeTeam: m.team,
        overUnder: era !== null ? estimatedTotal : null,
        source: "rc_aggregate",
        gameTotalScore: era !== null ? normalizedScore : 50,
      };
      result.set(m.team, defaultTotal);
      coveredTeams.add(m.team);
    }
  }

  cachedTotals = result;
  cacheTimestamp = Date.now();
  console.log(`[GameTotals] Built ${result.size} game total entries (${oddsData.size} from Odds API, ${result.size - oddsData.size} default neutral)`);
  return result;
}

/**
 * Look up game total score for a team abbreviation.
 * Returns 50 (neutral) if not found.
 */
export function getGameTotalScoreForTeam(
  teamAbbr: string,
  gameTotals: Map<string, GameTotal>
): { score: number; overUnder: number | null; source: string } {
  const entry = gameTotals.get(teamAbbr);
  if (!entry) return { score: 50, overUnder: null, source: "default" };
  return { score: entry.gameTotalScore, overUnder: entry.overUnder, source: entry.source };
}

/**
 * Convert game total O/U to a 0-100 score.
 * Used when we have a single O/U value and need to score it without context.
 * MLB O/U typically ranges from 6.5 to 12.5.
 */
export function ouToScore(overUnder: number): number {
  const MIN_OU = 6.5;
  const MAX_OU = 12.5;
  return Math.round(Math.min(100, Math.max(0, ((overUnder - MIN_OU) / (MAX_OU - MIN_OU)) * 100)));
}
