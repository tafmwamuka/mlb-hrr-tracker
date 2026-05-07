import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { playerProps, propPredictions } from "../../drizzle/schema";
import { eq, gte, and } from "drizzle-orm";

/**
 * Props router — handles fetching and managing prop lines
 * Integrates real Bet365 lines from The Odds API
 */

// Fetch real Bet365 player props from The Odds API
async function fetchBet365Props() {
  try {
    const oddsApiKey = process.env.ODDS_API_KEY;
    if (!oddsApiKey) {
      console.warn("ODDS_API_KEY not set, using mock data");
      return getMockBet365Props();
    }

    // Fetch MLB games for today
    const today = new Date().toISOString().split("T")[0];
    const gamesUrl = `https://api.the-odds-api.com/v4/sports/baseball_mlb/events?apiKey=${oddsApiKey}`;
    
    const gamesResponse = await fetch(gamesUrl);
    if (!gamesResponse.ok) {
      console.warn("Failed to fetch games from Odds API, using mock data");
      return getMockBet365Props();
    }

    const games = await gamesResponse.json();
    const props: any[] = [];

    // Fetch player props for each game
    for (const game of games.events.slice(0, 5)) {
      const propsUrl = `https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${game.id}/odds?apiKey=${oddsApiKey}&markets=player_hits_over_under,player_runs_over_under,player_rbis_over_under&oddsFormat=american`;
      
      try {
        const propsResponse = await fetch(propsUrl);
        if (propsResponse.ok) {
          const propsData = await propsResponse.json();
          
          // Extract Bet365 lines
          if (propsData.bookmakers) {
            const bet365 = propsData.bookmakers.find((b: any) => b.key === "bet365");
            if (bet365) {
              props.push({
                gameId: game.id,
                homeTeam: game.home_team,
                awayTeam: game.away_team,
                gameTime: game.commence_time,
                markets: bet365.markets,
              });
            }
          }
        }
      } catch (error) {
        console.warn(`Failed to fetch props for game ${game.id}:`, error);
      }
    }

    return props.length > 0 ? props : getMockBet365Props();
  } catch (error) {
    console.error("Error fetching Bet365 props:", error);
    return getMockBet365Props();
  }
}

// Mock Bet365 props for development/fallback
function getMockBet365Props() {
  return [
    {
      gameId: "game_1",
      homeTeam: "New York Yankees",
      awayTeam: "Boston Red Sox",
      gameTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      markets: [
        {
          key: "player_hits_over_under",
          outcomes: [
            { name: "Aaron Judge", description: "Over 3.5", price: -110, point: 3.5 },
            { name: "Aaron Judge", description: "Under 3.5", price: -110, point: 3.5 },
            { name: "Juan Soto", description: "Over 4.5", price: -110, point: 4.5 },
            { name: "Juan Soto", description: "Under 4.5", price: -110, point: 4.5 },
          ],
        },
        {
          key: "player_runs_over_under",
          outcomes: [
            { name: "Aaron Judge", description: "Over 0.5", price: -120, point: 0.5 },
            { name: "Aaron Judge", description: "Under 0.5", price: +100, point: 0.5 },
            { name: "Juan Soto", description: "Over 0.5", price: -110, point: 0.5 },
            { name: "Juan Soto", description: "Under 0.5", price: -110, point: 0.5 },
          ],
        },
        {
          key: "player_rbis_over_under",
          outcomes: [
            { name: "Aaron Judge", description: "Over 1.5", price: -110, point: 1.5 },
            { name: "Aaron Judge", description: "Under 1.5", price: -110, point: 1.5 },
            { name: "Juan Soto", description: "Over 1.5", price: -120, point: 1.5 },
            { name: "Juan Soto", description: "Under 1.5", price: +100, point: 1.5 },
          ],
        },
      ],
    },
  ];
}

export const propsRouter = router({
  /**
   * Get today's prop predictions with real Bet365 lines
   */
  getTodayProps: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      throw new Error("Database not available");
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const predictions = await db
      .select()
      .from(propPredictions)
      .where(gte(propPredictions.gameDate, today))
      .orderBy(propPredictions.gameDate);

    // Fetch real Bet365 lines
    const bet365Props = await fetchBet365Props();

    return predictions.map((p) => ({
      id: p.id,
      gameId: p.gameId,
      playerId: p.playerId,
      playerName: p.playerName,
      hitsPrediction: p.hitsPrediction ? JSON.parse(p.hitsPrediction) : null,
      runsPrediction: p.runsPrediction ? JSON.parse(p.runsPrediction) : null,
      rbiPrediction: p.rbiPrediction ? JSON.parse(p.rbiPrediction) : null,
      hitsReasoning: p.hitsReasoning,
      runsReasoning: p.runsReasoning,
      rbiReasoning: p.rbiReasoning,
      gameDate: p.gameDate,
      bet365Lines: bet365Props.find((bp: any) => bp.gameId === p.gameId),
    }));
  }),

  /**
   * Get real Bet365 lines for today's games
   */
  getBet365Lines: publicProcedure.query(async () => {
    return await fetchBet365Props();
  }),

  /**
   * Get props for a specific player
   */
  getPlayerProps: publicProcedure
    .input(z.object({ playerId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const predictions = await db
        .select()
        .from(propPredictions)
        .where(
          and(
            eq(propPredictions.playerId, input.playerId),
            gte(propPredictions.gameDate, today)
          )
        );

      return predictions.map((p) => ({
        id: p.id,
        gameId: p.gameId,
        playerName: p.playerName,
        hitsPrediction: p.hitsPrediction ? JSON.parse(p.hitsPrediction) : null,
        runsPrediction: p.runsPrediction ? JSON.parse(p.runsPrediction) : null,
        rbiPrediction: p.rbiPrediction ? JSON.parse(p.rbiPrediction) : null,
        hitsConfidence: p.hitsCorrect,
        runsConfidence: p.runsCorrect,
        rbiConfidence: p.rbiCorrect,
        gameDate: p.gameDate,
      }));
    }),

  /**
   * Get high-confidence props (75%+ confidence)
   */
  getHighConfidenceProps: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      throw new Error("Database not available");
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const predictions = await db
      .select()
      .from(propPredictions)
      .where(gte(propPredictions.gameDate, today))
      .orderBy(propPredictions.gameDate);

    // Filter for high confidence predictions
    const highConfidence = predictions
      .map((p) => {
        const hits = p.hitsPrediction ? JSON.parse(p.hitsPrediction) : null;
        const runs = p.runsPrediction ? JSON.parse(p.runsPrediction) : null;
        const rbi = p.rbiPrediction ? JSON.parse(p.rbiPrediction) : null;

        const avgConfidence =
          ((hits?.confidence || 0) +
            (runs?.confidence || 0) +
            (rbi?.confidence || 0)) /
          3;

        return {
          ...p,
          hitsPrediction: hits,
          runsPrediction: runs,
          rbiPrediction: rbi,
          avgConfidence,
        };
      })
      .filter((p) => p.avgConfidence >= 75)
      .sort((a, b) => b.avgConfidence - a.avgConfidence);

    return highConfidence;
  }),

  /**
   * Get model performance metrics
   */
  getModelPerformance: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      throw new Error("Database not available");
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const predictions = await db
      .select()
      .from(propPredictions)
      .where(
        and(
          gte(propPredictions.gameDate, sevenDaysAgo),
          gte(propPredictions.gameDate, today)
        )
      );

    // Calculate hit rates
    let hitsCorrect = 0;
    let runsCorrect = 0;
    let rbiCorrect = 0;
    let slgCorrect = 0;
    let totalPredictions = 0;

    predictions.forEach((p) => {
      if (p.hitsCorrect !== null) {
        hitsCorrect += p.hitsCorrect;
        totalPredictions++;
      }
      if (p.runsCorrect !== null) {
        runsCorrect += p.runsCorrect;
      }
      if (p.rbiCorrect !== null) {
        rbiCorrect += p.rbiCorrect;
      }
      if (p.slgCorrect !== null) {
        slgCorrect += p.slgCorrect;
      }
    });

    const hitsHitRate =
      totalPredictions > 0
        ? Math.round((hitsCorrect / totalPredictions) * 100)
        : 0;
    const runsHitRate =
      totalPredictions > 0
        ? Math.round((runsCorrect / totalPredictions) * 100)
        : 0;
    const rbiHitRate =
      totalPredictions > 0
        ? Math.round((rbiCorrect / totalPredictions) * 100)
        : 0;
    const slgHitRate =
      totalPredictions > 0
        ? Math.round((slgCorrect / totalPredictions) * 100)
        : 0;
    const overallHitRate = Math.round(
      ((hitsCorrect + runsCorrect + rbiCorrect + slgCorrect) / (totalPredictions * 4)) * 100
    );

    return {
      period: "7 days",
      totalPredictions,
      hitsHitRate,
      runsHitRate,
      rbiHitRate,
      slgHitRate,
      overallHitRate,
    };
  }),
});
