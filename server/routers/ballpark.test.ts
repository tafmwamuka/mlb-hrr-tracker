import { describe, it, expect } from "vitest";
import { ballparkRouter } from "./ballpark";

describe("Ballpark Router", () => {
  describe("getTodayMatchups", () => {
    it("should return matchups ranked by RC in descending order", async () => {
      const caller = ballparkRouter.createCaller({} as any);
      const result = await caller.getTodayMatchups();

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThanOrEqual(10);
    });

    it("should have correct ranking (1-10)", async () => {
      const caller = ballparkRouter.createCaller({} as any);
      const result = await caller.getTodayMatchups();

      result.forEach((matchup, index) => {
        expect(matchup.rank).toBe(index + 1);
      });
    });

    it("should have RC values in descending order", async () => {
      const caller = ballparkRouter.createCaller({} as any);
      const result = await caller.getTodayMatchups();

      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i].stats.rc).toBeGreaterThanOrEqual(result[i + 1].stats.rc);
      }
    });

    it("should include required matchup fields", async () => {
      const caller = ballparkRouter.createCaller({} as any);
      const result = await caller.getTodayMatchups();

      if (result.length > 0) {
        const matchup = result[0];
        expect(matchup).toHaveProperty("batter");
        expect(matchup).toHaveProperty("pitcher");
        expect(matchup).toHaveProperty("stats");
        expect(matchup).toHaveProperty("confidence");
        expect(matchup).toHaveProperty("rank");

        // Check batter fields
        expect(matchup.batter).toHaveProperty("name");
        expect(matchup.batter).toHaveProperty("id");
        expect(matchup.batter).toHaveProperty("team");

        // Check pitcher fields
        expect(matchup.pitcher).toHaveProperty("name");
        expect(matchup.pitcher).toHaveProperty("id");

        // Check stats fields
        expect(matchup.stats).toHaveProperty("rc");
        expect(matchup.stats).toHaveProperty("hr");
        expect(matchup.stats).toHaveProperty("xb");
        expect(matchup.stats).toHaveProperty("oneB");
        expect(matchup.stats).toHaveProperty("bb");
        expect(matchup.stats).toHaveProperty("k");
      }
    });

    it("should have confidence between 0-100", async () => {
      const caller = ballparkRouter.createCaller({} as any);
      const result = await caller.getTodayMatchups();

      result.forEach((matchup) => {
        expect(matchup.confidence).toBeGreaterThanOrEqual(0);
        expect(matchup.confidence).toBeLessThanOrEqual(100);
      });
    });

    it("should have positive stat values", async () => {
      const caller = ballparkRouter.createCaller({} as any);
      const result = await caller.getTodayMatchups();

      result.forEach((matchup) => {
        expect(matchup.stats.rc).toBeGreaterThanOrEqual(0);
        expect(matchup.stats.hr).toBeGreaterThanOrEqual(0);
        expect(matchup.stats.xb).toBeGreaterThanOrEqual(0);
        expect(matchup.stats.oneB).toBeGreaterThanOrEqual(0);
        expect(matchup.stats.bb).toBeGreaterThanOrEqual(0);
        expect(matchup.stats.k).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe("getGameMatchups", () => {
    it("should accept a game ID and return matchups", async () => {
      const caller = ballparkRouter.createCaller({} as any);
      const result = await caller.getGameMatchups("game-123");

      expect(Array.isArray(result)).toBe(true);
    });

    it("should reject invalid game ID format", async () => {
      const caller = ballparkRouter.createCaller({} as any);

      await expect(caller.getGameMatchups(123 as any)).rejects.toThrow();
    });
  });
});
