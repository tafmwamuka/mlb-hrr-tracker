/**
 * The Odds API Service — Fetches real sportsbook lines for MLB player props
 * 
 * Market keys used:
 * - batter_hits_runs_rbis: Featured HRR line (Over/Under)
 * - batter_hits_runs_rbis_alternate: Alternate HRR lines (multiple per player)
 * - batter_hits: Individual hits line
 * - batter_runs_scored: Individual runs line
 * - batter_rbis: Individual RBI line
 */

const ODDS_API_BASE = "https://api.the-odds-api.com/v4";
const SPORT = "baseball_mlb";

export interface OddsOutcome {
  name: string;        // Player name
  description: string; // "Over" or "Under"
  price: number;       // American odds (e.g., -110, +120)
  point: number;       // Line value (e.g., 2.5)
}

export interface OddsMarket {
  key: string;         // Market key (e.g., "batter_hits_runs_rbis")
  outcomes: OddsOutcome[];
}

export interface BookmakerData {
  key: string;         // Bookmaker key (e.g., "fanduel", "draftkings")
  title: string;
  markets: OddsMarket[];
}

export interface GameEvent {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
}

export interface PlayerPropLine {
  playerName: string;
  market: string;
  line: number;
  overOdds: number;    // American odds for Over
  underOdds: number;   // American odds for Under
  bookmaker: string;
  impliedProbability: number; // Derived from odds
}

export interface HRRMarketData {
  playerName: string;
  featuredLine: number | null;       // Main sportsbook HRR line
  featuredOverOdds: number | null;
  featuredUnderOdds: number | null;
  alternateLines: {
    line: number;
    overOdds: number;
    underOdds: number;
    impliedOverProb: number;
  }[];
  hitsLine: number | null;
  runsLine: number | null;
  rbiLine: number | null;
  bookmaker: string;
}

/**
 * Convert American odds to implied probability
 * -110 → 52.4%, +150 → 40%, etc.
 */
export function americanToImpliedProbability(americanOdds: number): number {
  if (americanOdds < 0) {
    return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
  } else {
    return 100 / (americanOdds + 100);
  }
}

/**
 * Remove vig from implied probabilities to get true probability
 * If over=52.4% and under=52.4%, total=104.8%, true over = 52.4/104.8 = 50%
 */
export function removeVig(overProb: number, underProb: number): { trueOver: number; trueUnder: number } {
  const total = overProb + underProb;
  return {
    trueOver: overProb / total,
    trueUnder: underProb / total,
  };
}

/**
 * Fetch today's MLB game events
 */
async function fetchMLBEvents(apiKey: string): Promise<GameEvent[]> {
  const url = `${ODDS_API_BASE}/sports/${SPORT}/events?apiKey=${apiKey}`;
  const response = await fetch(url);
  if (!response.ok) {
    console.warn(`Odds API events request failed: ${response.status}`);
    return [];
  }
  return await response.json();
}

/**
 * Fetch player prop odds for a specific game event
 * Requests HRR combined + individual H/R/RBI + alternates
 */
async function fetchPlayerProps(apiKey: string, eventId: string): Promise<BookmakerData[]> {
  const markets = [
    "batter_hits_runs_rbis",
    "batter_hits_runs_rbis_alternate",
    "batter_hits",
    "batter_runs_scored",
    "batter_rbis",
  ].join(",");

  const url = `${ODDS_API_BASE}/sports/${SPORT}/events/${eventId}/odds?apiKey=${apiKey}&regions=us&markets=${markets}&oddsFormat=american`;
  
  const response = await fetch(url);
  if (!response.ok) {
    console.warn(`Odds API props request failed for event ${eventId}: ${response.status}`);
    return [];
  }
  
  const data = await response.json();
  return data?.bookmakers || [];
}

/**
 * Parse bookmaker data into structured HRR market data per player
 */
function parseHRRData(bookmakers: BookmakerData[]): Map<string, HRRMarketData> {
  const playerMap = new Map<string, HRRMarketData>();

  // Prefer these bookmakers in order
  const preferredBooks = ["fanduel", "draftkings", "bet365", "betmgm", "pointsbet"];
  
  // Sort bookmakers by preference
  const sortedBookmakers = [...bookmakers].sort((a, b) => {
    const aIdx = preferredBooks.indexOf(a.key);
    const bIdx = preferredBooks.indexOf(b.key);
    return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
  });

  for (const bookmaker of sortedBookmakers) {
    for (const market of bookmaker.markets) {
      const outcomes = market.outcomes || [];
      
      // Group outcomes by player name
      const playerOutcomes = new Map<string, OddsOutcome[]>();
      for (const outcome of outcomes) {
        const existing = playerOutcomes.get(outcome.name) || [];
        existing.push(outcome);
        playerOutcomes.set(outcome.name, existing);
      }

      for (const [playerName, pOutcomes] of Array.from(playerOutcomes.entries())) {
        if (!playerMap.has(playerName)) {
          playerMap.set(playerName, {
            playerName,
            featuredLine: null,
            featuredOverOdds: null,
            featuredUnderOdds: null,
            alternateLines: [],
            hitsLine: null,
            runsLine: null,
            rbiLine: null,
            bookmaker: bookmaker.title,
          });
        }
        const playerData = playerMap.get(playerName)!;

        // Parse based on market type
        if (market.key === "batter_hits_runs_rbis" && playerData.featuredLine === null) {
          const over = pOutcomes.find((o: OddsOutcome) => o.description === "Over");
          const under = pOutcomes.find((o: OddsOutcome) => o.description === "Under");
          if (over) {
            playerData.featuredLine = over.point;
            playerData.featuredOverOdds = over.price;
            playerData.featuredUnderOdds = under?.price || 0;
            playerData.bookmaker = bookmaker.title;
          }
        }

        if (market.key === "batter_hits_runs_rbis_alternate") {
          // Alternate lines — multiple lines per player
          const overs = pOutcomes.filter((o: OddsOutcome) => o.description === "Over");
          const unders = pOutcomes.filter((o: OddsOutcome) => o.description === "Under");
          
          for (const over of overs) {
            const matchingUnder = unders.find((u: OddsOutcome) => u.point === over.point);
            const overProb = americanToImpliedProbability(over.price);
            const underProb = matchingUnder ? americanToImpliedProbability(matchingUnder.price) : 1 - overProb;
            const { trueOver } = removeVig(overProb, underProb);
            
            // Only add if not already present
            if (!playerData.alternateLines.some((l: { line: number }) => l.line === over.point)) {
              playerData.alternateLines.push({
                line: over.point,
                overOdds: over.price,
                underOdds: matchingUnder?.price || 0,
                impliedOverProb: trueOver,
              });
            }
          }
        }

        if (market.key === "batter_hits" && playerData.hitsLine === null) {
          const over = pOutcomes.find((o: OddsOutcome) => o.description === "Over");
          if (over) playerData.hitsLine = over.point;
        }

        if (market.key === "batter_runs_scored" && playerData.runsLine === null) {
          const over = pOutcomes.find((o: OddsOutcome) => o.description === "Over");
          if (over) playerData.runsLine = over.point;
        }

        if (market.key === "batter_rbis" && playerData.rbiLine === null) {
          const over = pOutcomes.find((o: OddsOutcome) => o.description === "Over");
          if (over) playerData.rbiLine = over.point;
        }
      }
    }
  }

  // Sort alternate lines by line value
  playerMap.forEach((playerData) => {
    playerData.alternateLines.sort((a: { line: number }, b: { line: number }) => a.line - b.line);
  });

  return playerMap;
}

// In-memory cache: 10-minute TTL to avoid burning API credits on every pick request
let oddsCache: { data: Map<string, HRRMarketData>; ts: number } | null = null;
const ODDS_CACHE_TTL = 10 * 60 * 1000;

/**
 * Fetch all HRR market data for today's games
 * Returns a map of player name → HRR market data
 * Uses 10-minute in-memory cache to conserve API credits.
 */
export async function fetchHRRMarketData(apiKey?: string): Promise<Map<string, HRRMarketData>> {
  const key = apiKey || process.env.ODDS_API_KEY || '';
  if (!key) {
    console.warn('[OddsAPI] No API key available — skipping live odds fetch');
    return new Map();
  }

  // Return cached data if fresh
  if (oddsCache && Date.now() - oddsCache.ts < ODDS_CACHE_TTL) {
    console.log(`[OddsAPI] Returning cached odds (${oddsCache.data.size} players)`);
    return oddsCache.data;
  }

  try {
    console.log('[OddsAPI] Fetching today\'s MLB events...');
    const events = await fetchMLBEvents(key);
    if (events.length === 0) {
      console.warn('[OddsAPI] No MLB events found for today');
      return new Map();
    }
    console.log(`[OddsAPI] Found ${events.length} events, fetching player props...`);

    // Fetch props for all games in parallel (with concurrency limit of 5)
    const allBookmakers: BookmakerData[] = [];
    const chunks: GameEvent[][] = [];
    for (let i = 0; i < events.length; i += 5) {
      chunks.push(events.slice(i, i + 5));
    }
    for (const chunk of chunks) {
      const results = await Promise.allSettled(
        chunk.map(event => fetchPlayerProps(key, event.id))
      );
      for (const result of results) {
        if (result.status === 'fulfilled') {
          allBookmakers.push(...result.value);
        }
      }
    }

    const playerMap = parseHRRData(allBookmakers);
    console.log(`[OddsAPI] Parsed odds for ${playerMap.size} players`);

    // Cache the result
    oddsCache = { data: playerMap, ts: Date.now() };
    return playerMap;
  } catch (err) {
    console.error('[OddsAPI] Failed to fetch market data:', err);
    return oddsCache?.data ?? new Map();
  }
}

/**
 * Targeted fetch: given a list of player names + their teams, find only the
 * matching event IDs and fetch props for those games only.
 * This conserves API credits by avoiding fetching all 28+ daily events.
 */
export async function fetchOddsForPicks(
  picks: Array<{ playerName: string; team: string }>,
  apiKey?: string
): Promise<Map<string, HRRMarketData>> {
  const key = apiKey || process.env.ODDS_API_KEY || '';
  if (!key || picks.length === 0) return new Map();

  // Return cached data if fresh (shared with fetchHRRMarketData)
  if (oddsCache && Date.now() - oddsCache.ts < ODDS_CACHE_TTL) {
    console.log(`[OddsAPI] Returning cached odds for ${picks.length} picks`);
    return oddsCache.data;
  }

  try {
    // Step 1: Get all today's events (1 API call)
    const events = await fetchMLBEvents(key);
    if (events.length === 0) return new Map();

    // Step 2: Find which events contain our picks' teams
    const pickTeams = new Set(
      picks.map(p => p.team.toLowerCase().trim())
    );

    const matchingEvents = events.filter(event => {
      const home = event.home_team.toLowerCase();
      const away = event.away_team.toLowerCase();
      // Match by team name substring (e.g. "Yankees" matches "New York Yankees")
      return Array.from(pickTeams).some(t =>
        home.includes(t) || away.includes(t) ||
        t.includes(home.split(' ').pop()?.toLowerCase() ?? '') ||
        t.includes(away.split(' ').pop()?.toLowerCase() ?? '')
      );
    });

    if (matchingEvents.length === 0) {
      console.log('[OddsAPI] No matching events found for picks teams');
      return new Map();
    }

    console.log(`[OddsAPI] Fetching props for ${matchingEvents.length} targeted events (${picks.length} picks)`);

    // Step 3: Fetch props only for matching events (typically 1-3 calls)
    const allBookmakers: BookmakerData[] = [];
    const results = await Promise.allSettled(
      matchingEvents.map(event => fetchPlayerProps(key, event.id))
    );
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allBookmakers.push(...result.value);
      }
    }

    const playerMap = parseHRRData(allBookmakers);
    console.log(`[OddsAPI] Parsed odds for ${playerMap.size} players (targeted fetch)`);

    // Cache the result
    oddsCache = { data: playerMap, ts: Date.now() };
    return playerMap;
  } catch (err) {
    console.error('[OddsAPI] Targeted fetch failed:', err);
    return oddsCache?.data ?? new Map();
  }
}

/**
 * Get the best available HRR line for a player
 * Falls back to model-calculated line if no sportsbook line available
 */
export function getBestHRRLine(
  playerName: string,
  marketData: Map<string, HRRMarketData>,
  modelLine: number
): { line: number; source: "sportsbook" | "model"; odds: number | null; impliedProb: number | null } {
  const market = marketData.get(playerName);
  
  if (market?.featuredLine !== null && market?.featuredLine !== undefined) {
    const overProb = market.featuredOverOdds ? americanToImpliedProbability(market.featuredOverOdds) : null;
    const underProb = market.featuredUnderOdds ? americanToImpliedProbability(market.featuredUnderOdds) : null;
    let trueProb: number | null = null;
    if (overProb && underProb) {
      const { trueOver } = removeVig(overProb, underProb);
      trueProb = trueOver;
    }
    
    return {
      line: market.featuredLine,
      source: "sportsbook",
      odds: market.featuredOverOdds,
      impliedProb: trueProb,
    };
  }

  return {
    line: modelLine,
    source: "model",
    odds: null,
    impliedProb: null,
  };
}
