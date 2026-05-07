import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { gamesRouter } from "./games";

describe("Games Router", () => {
  // Mock the fetch function
  const originalFetch = global.fetch;
  
  beforeAll(() => {
    global.fetch = vi.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe("getTodayGames", () => {
    it("should fetch today's games and return formatted game data", async () => {
      const mockResponse = {
        ok: true,
        json: async () => [
          {
            date: "2026-05-07",
            games: [
              {
                gamePk: 123456,
                gameDateTime: "2026-05-07T19:05:00Z",
                status: { abstractGameState: "Live" },
                teams: {
                  away: {
                    team: { id: 108, name: "Los Angeles Angels" },
                    score: 3,
                  },
                  home: {
                    team: { id: 145, name: "Chicago White Sox" },
                    score: 2,
                  },
                },
                venue: { name: "Guaranteed Rate Field" },
              },
            ],
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce(mockResponse);

      const caller = gamesRouter.createCaller({} as any);
      const result = await caller.getTodayGames();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "123456",
        status: "Live",
        awayTeam: {
          name: "Los Angeles Angels",
          teamId: 108,
          score: 3,
        },
        homeTeam: {
          name: "Chicago White Sox",
          teamId: 145,
          score: 2,
        },
        venue: "Guaranteed Rate Field",
      });
    });

    it("should handle API errors gracefully", async () => {
      const mockResponse = {
        ok: false,
        status: 500,
      };

      (global.fetch as any).mockResolvedValueOnce(mockResponse);

      const caller = gamesRouter.createCaller({} as any);
      const result = await caller.getTodayGames();

      expect(result).toEqual([]);
    });

    it("should handle network errors gracefully", async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error("Network error"));

      const caller = gamesRouter.createCaller({} as any);
      const result = await caller.getTodayGames();

      expect(result).toEqual([]);
    });
  });

  describe("getGamesByDate", () => {
    it("should fetch games for a specific date", async () => {
      const mockResponse = {
        ok: true,
        json: async () => [
          {
            date: "2026-05-06",
            games: [
              {
                gamePk: 789012,
                gameDateTime: "2026-05-06T19:05:00Z",
                status: { abstractGameState: "Final" },
                teams: {
                  away: { team: { id: 108, name: "Los Angeles Angels" }, score: 5 },
                  home: { team: { id: 145, name: "Chicago White Sox" }, score: 4 },
                },
                venue: { name: "Guaranteed Rate Field" },
              },
            ],
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce(mockResponse);

      const caller = gamesRouter.createCaller({} as any);
      const result = await caller.getGamesByDate("2026-05-06");

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe("Final");
    });

    it("should reject invalid date format", async () => {
      const caller = gamesRouter.createCaller({} as any);
      
      await expect(caller.getGamesByDate("05-06-2026")).rejects.toThrow();
    });
  });

  describe("getYesterdayGames", () => {
    it("should fetch yesterday's games", async () => {
      const mockResponse = {
        ok: true,
        json: async () => [
          {
            date: "2026-05-05",
            games: [
              {
                gamePk: 345678,
                gameDateTime: "2026-05-05T19:05:00Z",
                status: { abstractGameState: "Final" },
                teams: {
                  away: { team: { id: 108, name: "Los Angeles Angels" }, score: 2 },
                  home: { team: { id: 145, name: "Chicago White Sox" }, score: 3 },
                },
                venue: { name: "Guaranteed Rate Field" },
              },
            ],
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce(mockResponse);

      const caller = gamesRouter.createCaller({} as any);
      const result = await caller.getYesterdayGames();

      expect(result).toHaveLength(1);
    });
  });

  describe("getRecentGames", () => {
    it("should fetch games from the last 7 days", async () => {
      const mockResponse = {
        ok: true,
        json: async () => [
          {
            date: "2026-05-01",
            games: [
              {
                gamePk: 111111,
                gameDateTime: "2026-05-01T19:05:00Z",
                status: { abstractGameState: "Final" },
                teams: {
                  away: { team: { id: 108, name: "Los Angeles Angels" }, score: 1 },
                  home: { team: { id: 145, name: "Chicago White Sox" }, score: 2 },
                },
                venue: { name: "Guaranteed Rate Field" },
              },
            ],
          },
        ],
      };

      (global.fetch as any).mockResolvedValue(mockResponse);

      const caller = gamesRouter.createCaller({} as any);
      const result = await caller.getRecentGames();

      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });
});
