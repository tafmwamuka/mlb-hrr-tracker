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

/**
 * Fetch all HRR market data for today's games
 * Returns a map of player name → HRR market data
 */
export async function fetchHRRMarketData(): Promise<Map<string, HRRMarketData>> {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    console.warn("ODDS_API_KEY not set, returning empty market data");
    return new Map();
  }

  try {
    // Step 1: Get today's events
    const events = await fetchMLBEvents(apiKey);
    if (events.length === 0) {
      console.warn("No MLB events found today");
      return new Map();
    }

    // Step 2: Fetch props for each game (limit to 8 games to conserve API calls)
    const allBookmakers: BookmakerData[] = [];
    for (const event of events.slice(0, 8)) {
      const bookmakers = await fetchPlayerProps(apiKey, event.id);
      allBookmakers.push(...bookmakers);
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Step 3: Parse into structured data
    return parseHRRData(allBookmakers);
  } catch (error) {
    console.error("Error fetching HRR market data:", error);
    return new Map();
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
