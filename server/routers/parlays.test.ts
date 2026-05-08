import { describe, it, expect } from "vitest";
import { aiPicksRouter } from "./aiPicks";

/**
 * Test the parlay generation logic
 * Parlays are built from AI picks data on the frontend,
 * but we test the backend endpoint that provides the picks data.
 * 
 * NOTE: When lineups aren't available (e.g., no games today, early morning),
 * the endpoint returns { picks: [], lineupsPending: true } instead of mock data.
 * Tests handle both states.
 */
describe("Parlays - AI Picks Data Source", () => {
  const caller = aiPicksRouter.createCaller({} as any);

  it("should return a valid response with picks array or lineupsPending flag", async () => {
    const result = await caller.getComprehensivePicks();
    
    expect(result).toBeDefined();
    expect(result.picks).toBeDefined();
    expect(Array.isArray(result.picks)).toBe(true);
    expect(result.success).toBe(true);
    
    // Either has picks OR lineupsPending flag
    if (result.picks.length === 0) {
      expect((result as any).lineupsPending).toBe(true);
    }
  }, 30000);

  it("should return picks with required fields for parlay building (when lineups available)", async () => {
    const result = await caller.getComprehensivePicks();
    
    // Skip field validation if lineups pending
    if ((result as any).lineupsPending) {
      expect(result.picks.length).toBe(0);
      return;
    }
    
    // Each pick should have the fields needed for parlay construction
    expect(result.picks.length).toBeGreaterThanOrEqual(6);
    for (const pick of result.picks) {
      expect(pick.playerName).toBeDefined();
      expect(typeof pick.playerName).toBe("string");
      expect(pick.team).toBeDefined();
      expect(typeof pick.team).toBe("string");
      expect(pick.confidence).toBeDefined();
      expect(typeof pick.confidence).toBe("number");
      expect(pick.confidence).toBeGreaterThan(0);
      expect(pick.confidence).toBeLessThanOrEqual(100);
      expect(pick.statType).toBeDefined();
      expect(["hits", "runs", "rbi"]).toContain(pick.statType);
      expect(pick.line).toBeDefined();
      expect(typeof pick.line).toBe("number");
    }
  }, 30000);

  it("should return picks from diverse teams when lineups available", async () => {
    const result = await caller.getComprehensivePicks();
    
    if ((result as any).lineupsPending) return;
    
    const teams = new Set(result.picks.map((p: any) => p.team));
    // Need at least 3 different teams for 3-leg parlays
    expect(teams.size).toBeGreaterThanOrEqual(3);
  }, 15000);

  it("should return picks sorted by rank when lineups available", async () => {
    const result = await caller.getComprehensivePicks();
    
    if ((result as any).lineupsPending) return;
    
    // Picks should be sorted by rank
    for (let i = 0; i < result.picks.length - 1; i++) {
      expect(result.picks[i].rank).toBeLessThanOrEqual(result.picks[i + 1].rank);
    }
  });

  it("should have at least 15 picks for All Plays variety when lineups available", async () => {
    const result = await caller.getComprehensivePicks();
    
    if ((result as any).lineupsPending) return;
    
    // All Plays should show 15-20 players
    expect(result.picks.length).toBeGreaterThanOrEqual(15);
  });

  it("should include pitcherTeam field for game-level diversification", async () => {
    const result = await caller.getComprehensivePicks();
    
    if ((result as any).lineupsPending) return;
    
    // Each pick should have pitcherTeam for parlay game-level checks
    for (const pick of result.picks) {
      expect(pick.pitcherTeam).toBeDefined();
      expect(typeof pick.pitcherTeam).toBe("string");
      expect(pick.pitcherTeam.length).toBeGreaterThan(0);
      // pitcherTeam should be different from player's team
      expect(pick.pitcherTeam).not.toBe(pick.team);
    }
  });

  it("should have picks from different games when lineups available", async () => {
    const result = await caller.getComprehensivePicks();
    
    if ((result as any).lineupsPending) return;
    
    // Build game identifiers: sort team pair alphabetically
    const games = new Set(
      result.picks.map((p: any) => {
        const pair = [p.team, p.pitcherTeam].sort();
        return `${pair[0]}-${pair[1]}`;
      })
    );
    
    // Should have at least 3 different games for proper parlay diversification
    expect(games.size).toBeGreaterThanOrEqual(3);
  });
});
