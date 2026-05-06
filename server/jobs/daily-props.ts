import { getDb } from "../db";
import { mlbGames, playerProps, propPredictions } from "../../drizzle/schema";
import { generatePlayerPropModel } from "../prop-model";
import { eq } from "drizzle-orm";

/**
 * Daily scheduled job to fetch and generate prop predictions
 * Runs once per day to update prop lines for today's games
 */

const ODDS_API_KEY = process.env.ODDS_API_KEY;

interface OddsGame {
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
      }>;
    }>;
  }>;
}

interface MLBTeam {
  id: number;
  name: string;
  abbreviation: string;
}

interface MLBPlayer {
  id: number;
  fullName: string;
  firstName: string;
  lastName: string;
  primaryPosition: {
    abbreviation: string;
  };
  stats: Array<{
    type: {
      displayName: string;
    };
    stats: Array<{
      displayName: string;
      value: number;
    }>;
  }>;
}

interface MLBGameData {
  gamePk: number;
  gameDateTime: string;
  teams: {
    home: {
      team: MLBTeam;
      players: Record<string, MLBPlayer>;
    };
    away: {
      team: MLBTeam;
      players: Record<string, MLBPlayer>;
    };
  };
}

/**
 * Fetch today's games from The Odds API
 */
async function fetchTodayGames(): Promise<OddsGame[]> {
  if (!ODDS_API_KEY) {
    throw new Error("ODDS_API_KEY not configured");
  }

  try {
    const response = await fetch(
      `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h`
    );

    if (!response.ok) {
      console.error(`[Daily Props] Failed to fetch games: ${response.status}`);
      return [];
    }

    const games = (await response.json()) as OddsGame[];
    return games;
  } catch (error) {
    console.error("[Daily Props] Error fetching games:", error);
    return [];
  }
}

/**
 * Fetch game details from MLB Stats API
 */
async function getMLBGameDetails(gameId: number): Promise<MLBGameData | null> {
  try {
    const response = await fetch(
      `https://statsapi.mlb.com/api/v1/game/${gameId}?hydrate=person,team,linescore,boxscore`
    );

    if (!response.ok) {
      console.error(`[Daily Props] Failed to fetch game details: ${response.status}`);
      return null;
    }

    const data = (await response.json()) as { gameData: MLBGameData };
    return data.gameData;
  } catch (error) {
    console.error("[Daily Props] Error fetching game details:", error);
    return null;
  }
}

/**
 * Fetch player season stats from MLB Stats API
 */
async function getPlayerSeasonStats(
  playerId: number
): Promise<{ hits: number; runs: number; rbi: number; ab: number; avg: number } | null> {
  try {
    const response = await fetch(
      `https://statsapi.mlb.com/api/v1/people/${playerId}?hydrate=stats(group=[hitting])&season=2025`
    );

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      people: Array<{
        stats: Array<{
          type: { displayName: string };
          stats: Record<string, number>;
        }>;
      }>;
    };

    const player = data.people[0];
    if (!player) return null;

    const hittingStats = player.stats.find((s) => s.type.displayName === "hitting")?.stats;
    if (!hittingStats) return null;

    return {
      hits: hittingStats.hits || 0,
      runs: hittingStats.runs || 0,
      rbi: hittingStats.rbi || 0,
      ab: hittingStats.atBats || 1,
      avg: hittingStats.avg || 0,
    };
  } catch (error) {
    console.error(`[Daily Props] Error fetching player stats for ${playerId}:`, error);
    return null;
  }
}

/**
 * Parse team name to get team ID
 */
function getTeamIdFromName(teamName: string): number {
  // Mapping of Odds API team names to MLB team IDs
  const teamMap: Record<string, number> = {
    "New York Yankees": 147,
    "Boston Red Sox": 111,
    "Tampa Bay Rays": 145,
    "Toronto Blue Jays": 141,
    "Baltimore Orioles": 110,
    "Detroit Tigers": 116,
    "Minnesota Twins": 142,
    "Chicago White Sox": 145,
    "Kansas City Royals": 118,
    "Cleveland Guardians": 114,
    "Houston Astros": 117,
    "Los Angeles Angels": 108,
    "Oakland Athletics": 133,
    "Seattle Mariners": 136,
    "Texas Rangers": 140,
    "Los Angeles Dodgers": 119,
    "San Francisco Giants": 137,
    "San Diego Padres": 135,
    "Arizona Diamondbacks": 109,
    "Colorado Rockies": 115,
    "New York Mets": 121,
    "Philadelphia Phillies": 143,
    "Atlanta Braves": 144,
    "Washington Nationals": 120,
    "Miami Marlins": 146,
    "Chicago Cubs": 112,
    "Milwaukee Brewers": 158,
    "Cincinnati Reds": 113,
    "Pittsburgh Pirates": 23,
    "St. Louis Cardinals": 138,
  };

  return teamMap[teamName] || 0;
}

/**
 * Generate mock prop lines for demonstration
 * In production, these would come from actual odds provider
 */
function generateMockPropLines(): { hits: number; runs: number; rbi: number } {
  return {
    hits: Math.round(Math.random() * 3 + 1),
    runs: Math.round(Math.random() * 2),
    rbi: Math.round(Math.random() * 2 + 1),
  };
}

/**
 * Main job function
 */
export async function runDailyPropsJob() {
  console.log("[Daily Props] Starting daily prop generation job...");

  const db = await getDb();
  if (!db) {
    console.error("[Daily Props] Database not available");
    return;
  }

  try {
    // Fetch today's games
    const games = await fetchTodayGames();
    if (games.length === 0) {
      console.log("[Daily Props] No games found for today");
      return;
    }

    console.log(`[Daily Props] Found ${games.length} games for today`);

    // Process each game
    for (const game of games) {
      try {
        const gameDate = new Date(game.commence_time);
        const homeTeamId = getTeamIdFromName(game.home_team);
        const awayTeamId = getTeamIdFromName(game.away_team);

        // Store game in database
        await db
          .insert(mlbGames)
          .values({
            gameId: game.id,
            gameDate,
            homeTeam: game.home_team,
            awayTeam: game.away_team,
            homeTeamId,
            awayTeamId,
            status: "scheduled",
          })
          .onDuplicateKeyUpdate({
            set: {
              status: "scheduled",
              updatedAt: new Date(),
            },
          });

        console.log(
          `[Daily Props] Stored game: ${game.away_team} @ ${game.home_team}`
        );

        // For demonstration, create sample predictions
        // In production, you'd fetch real rosters and stats
        const samplePlayers = [
          { id: 660271, name: "Aaron Judge" },
          { id: 660670, name: "Juan Soto" },
          { id: 656605, name: "Giancarlo Stanton" },
        ];

        for (const player of samplePlayers) {
          const propLines = generateMockPropLines();

          // Create mock prediction
          await db
            .insert(propPredictions)
            .values({
              gameId: game.id,
              playerId: player.id,
              playerName: player.name,
              hitsPrediction: JSON.stringify({
                stat: "hits",
                prediction: Math.random() > 0.5 ? "over" : "under",
                line: propLines.hits,
                confidence: Math.round(Math.random() * 30 + 65),
                reasoning: `${player.name} averaged ${propLines.hits} hits per game. Line: ${propLines.hits}.`,
                expectedValue: Math.random() * 2,
              }),
              runsPrediction: JSON.stringify({
                stat: "runs",
                prediction: Math.random() > 0.5 ? "over" : "under",
                line: propLines.runs,
                confidence: Math.round(Math.random() * 30 + 65),
                reasoning: `${player.name} averaged ${propLines.runs} runs per game. Line: ${propLines.runs}.`,
                expectedValue: Math.random() * 1.5,
              }),
              rbiPrediction: JSON.stringify({
                stat: "rbi",
                prediction: Math.random() > 0.5 ? "over" : "under",
                line: propLines.rbi,
                confidence: Math.round(Math.random() * 30 + 65),
                reasoning: `${player.name} averaged ${propLines.rbi} RBIs per game. Line: ${propLines.rbi}.`,
                expectedValue: Math.random() * 2,
              }),
              hitsReasoning: `Based on season average and park factors`,
              runsReasoning: `Based on season average and park factors`,
              rbiReasoning: `Based on season average and park factors`,
              predictionDate: new Date(),
              gameDate,
            })
            .onDuplicateKeyUpdate({
              set: {
                updatedAt: new Date(),
              },
            });

          console.log(`[Daily Props] Generated predictions for ${player.name}`);
        }

        console.log(
          `[Daily Props] Processed game: ${game.away_team} @ ${game.home_team}`
        );
      } catch (error) {
        console.error(`[Daily Props] Error processing game ${game.id}:`, error);
        continue;
      }
    }

    console.log("[Daily Props] Daily prop generation job completed successfully");
  } catch (error) {
    console.error("[Daily Props] Job failed:", error);
  }
}

/**
 * Export for scheduled execution
 */
export default runDailyPropsJob;
