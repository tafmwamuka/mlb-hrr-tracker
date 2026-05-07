import { describe, it, expect } from "vitest";
import { aiPicksRouter } from "./aiPicks";

/**
 * Test the parlay generation logic
 * Parlays are built from AI picks data on the frontend,
 * but we test the backend endpoint that provides the picks data
 */
describe("Parlays - AI Picks Data Source", () => {
  const caller = aiPicksRouter.createCaller({} as any);

  it("should return enough picks to build parlays (at least 4 for 2-leg, 6 for 3-leg)", async () => {
    const result = await caller.getComprehensivePicks();
    
    expect(result).toBeDefined();
    expect(result.picks).toBeDefined();
    expect(Array.isArray(result.picks)).toBe(true);
    // Need at least 6 picks to build both 2-leg and 3-leg parlays
    expect(result.picks.length).toBeGreaterThanOrEqual(6);
  });

  it("should return picks with required fields for parlay building", async () => {
    const result = await caller.getComprehensivePicks();
    
    // Each pick should have the fields needed for parlay construction
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
  });

  it("should return picks from diverse teams (needed for cross-game parlays)", async () => {
    const result = await caller.getComprehensivePicks();
    
    const teams = new Set(result.picks.map((p: any) => p.team));
    // Need at least 3 different teams for 3-leg parlays
    expect(teams.size).toBeGreaterThanOrEqual(3);
  });

  it("should return picks sorted by rank", async () => {
    const result = await caller.getComprehensivePicks();
    
    // Picks should be sorted by rank
    for (let i = 0; i < result.picks.length - 1; i++) {
      expect(result.picks[i].rank).toBeLessThanOrEqual(result.picks[i + 1].rank);
    }
  });

  it("should have at least 15 picks for All Plays variety", async () => {
    const result = await caller.getComprehensivePicks();
    
    // All Plays should show 15-20 players
    expect(result.picks.length).toBeGreaterThanOrEqual(15);
  });
});
