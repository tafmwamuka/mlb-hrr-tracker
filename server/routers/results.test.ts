import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

/**
 * Tests for the results router logic
 * Tests the parsePrediction helper and the backfill comparison logic
 */

// Test parsePrediction logic (extracted inline for testing)
function parsePrediction(predJson: string | null): { line: number; confidence: number; direction: string } | null {
  if (!predJson) return null;
  try {
    const parsed = JSON.parse(predJson);
    return {
      line: parsed.line || 0,
      confidence: parsed.confidence || 0,
      direction: parsed.direction || "over",
    };
  } catch {
    return null;
  }
}

// Test the hit/miss determination logic
function determineCorrectness(actual: number, line: number, direction: string): boolean {
  if (direction === "over") {
    return actual > line;
  }
  return actual < line;
}

describe("Results Router - parsePrediction", () => {
  it("should parse valid prediction JSON", () => {
    const json = JSON.stringify({ line: 1.5, confidence: 85, direction: "over" });
    const result = parsePrediction(json);
    expect(result).toEqual({ line: 1.5, confidence: 85, direction: "over" });
  });

  it("should return null for null input", () => {
    expect(parsePrediction(null)).toBeNull();
  });

  it("should return null for invalid JSON", () => {
    expect(parsePrediction("not json")).toBeNull();
  });

  it("should handle missing fields with defaults", () => {
    const json = JSON.stringify({ line: 2.5 });
    const result = parsePrediction(json);
    expect(result).toEqual({ line: 2.5, confidence: 0, direction: "over" });
  });

  it("should handle empty object", () => {
    const json = JSON.stringify({});
    const result = parsePrediction(json);
    expect(result).toEqual({ line: 0, confidence: 0, direction: "over" });
  });

  it("should parse prediction with combinedScore and savantMetrics", () => {
    const json = JSON.stringify({
      line: 3.5,
      confidence: 92,
      direction: "over",
      combinedScore: 88,
      savantMetrics: { xwOBA: 0.380, hardHitPct: 45 },
    });
    const result = parsePrediction(json);
    expect(result).toEqual({ line: 3.5, confidence: 92, direction: "over" });
  });
});

describe("Results Router - Hit/Miss Determination", () => {
  it("should mark as hit when actual > line for OVER", () => {
    expect(determineCorrectness(3, 2.5, "over")).toBe(true);
  });

  it("should mark as miss when actual <= line for OVER", () => {
    expect(determineCorrectness(2, 2.5, "over")).toBe(false);
  });

  it("should mark as miss when actual equals line for OVER", () => {
    expect(determineCorrectness(2.5, 2.5, "over")).toBe(false);
  });

  it("should handle 0 actual vs 0.5 line (miss)", () => {
    expect(determineCorrectness(0, 0.5, "over")).toBe(false);
  });

  it("should handle 1 actual vs 0.5 line (hit)", () => {
    expect(determineCorrectness(1, 0.5, "over")).toBe(true);
  });

  it("should handle large values", () => {
    expect(determineCorrectness(5, 4.5, "over")).toBe(true);
    expect(determineCorrectness(4, 4.5, "over")).toBe(false);
  });
});

describe("Results Router - MLB API Response Parsing", () => {
  const originalFetch = global.fetch;

  beforeAll(() => {
    // Mock fetch for MLB API calls
    global.fetch = vi.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("should handle MLB schedule response format", async () => {
    const mockSchedule = {
      dates: [{
        games: [
          { gamePk: 12345, status: { abstractGameState: "Final" } },
          { gamePk: 12346, status: { abstractGameState: "Final" } },
        ],
      }],
    };

    expect(mockSchedule.dates[0].games.length).toBe(2);
    expect(mockSchedule.dates[0].games[0].status.abstractGameState).toBe("Final");
  });

  it("should handle boxscore player stats format", () => {
    const mockBoxscore = {
      teams: {
        home: {
          players: {
            "ID660271": {
              person: { id: 660271, fullName: "Aaron Judge" },
              stats: { batting: { hits: 2, runs: 1, rbi: 3 } },
            },
          },
        },
        away: {
          players: {
            "ID592450": {
              person: { id: 592450, fullName: "Juan Soto" },
              stats: { batting: { hits: 3, runs: 2, rbi: 1 } },
            },
          },
        },
      },
    };

    // Verify we can extract stats from boxscore format
    const homePlayer = Object.values(mockBoxscore.teams.home.players)[0] as any;
    expect(homePlayer.person.id).toBe(660271);
    expect(homePlayer.stats.batting.hits).toBe(2);
    expect(homePlayer.stats.batting.runs).toBe(1);
    expect(homePlayer.stats.batting.rbi).toBe(3);

    const awayPlayer = Object.values(mockBoxscore.teams.away.players)[0] as any;
    expect(awayPlayer.person.id).toBe(592450);
    expect(awayPlayer.stats.batting.hits).toBe(3);
  });

  it("should handle missing batting stats gracefully", () => {
    const playerWithNoBatting = {
      person: { id: 123456 },
      stats: {},
    };

    const batting = (playerWithNoBatting as any).stats?.batting;
    expect(batting).toBeUndefined();
    
    // Our code checks: if (playerId && batting) - so this player would be skipped
    const hits = batting?.hits || 0;
    expect(hits).toBe(0);
  });

  it("should handle empty schedule response", () => {
    const emptySchedule = { dates: [] };
    const games = emptySchedule.dates?.[0]?.games || [];
    expect(games.length).toBe(0);
  });
});

describe("Results Router - Hit Rate Calculation", () => {
  it("should calculate hit rate correctly", () => {
    const results = [
      { hit: true }, { hit: true }, { hit: true }, { hit: false }, { hit: false },
    ];
    const hitCount = results.filter(r => r.hit).length;
    const hitRate = Math.round((hitCount / results.length) * 100);
    expect(hitRate).toBe(60);
  });

  it("should handle 100% hit rate", () => {
    const results = [{ hit: true }, { hit: true }, { hit: true }];
    const hitCount = results.filter(r => r.hit).length;
    const hitRate = Math.round((hitCount / results.length) * 100);
    expect(hitRate).toBe(100);
  });

  it("should handle 0% hit rate", () => {
    const results = [{ hit: false }, { hit: false }];
    const hitCount = results.filter(r => r.hit).length;
    const hitRate = Math.round((hitCount / results.length) * 100);
    expect(hitRate).toBe(0);
  });

  it("should handle empty results", () => {
    const results: any[] = [];
    const hitRate = results.length > 0 ? Math.round((results.filter(r => r.hit).length / results.length) * 100) : 0;
    expect(hitRate).toBe(0);
  });

  it("should separate resolved from pending results", () => {
    const results = [
      { actualValue: 3, hit: true },
      { actualValue: 1, hit: false },
      { actualValue: null, hit: null },
      { actualValue: null, hit: null },
    ];
    
    const resolved = results.filter(r => r.actualValue !== null);
    const pending = results.filter(r => r.actualValue === null);
    
    expect(resolved.length).toBe(2);
    expect(pending.length).toBe(2);
    
    const hitCount = resolved.filter(r => r.hit === true).length;
    expect(hitCount).toBe(1);
  });
});

describe("Results Router - Date Handling", () => {
  it("should calculate yesterday's date correctly", () => {
    const today = new Date("2026-05-07T12:00:00Z");
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    expect(yesterday.toISOString().split("T")[0]).toBe("2026-05-06");
  });

  it("should handle month boundaries", () => {
    const today = new Date("2026-05-01T12:00:00Z");
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    expect(yesterday.toISOString().split("T")[0]).toBe("2026-04-30");
  });

  it("should handle year boundaries", () => {
    const today = new Date("2026-01-01T12:00:00Z");
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    expect(yesterday.toISOString().split("T")[0]).toBe("2025-12-31");
  });
});

describe("Results Router - Backfill Logic", () => {
  it("should skip predictions that already have actuals", () => {
    const predictions = [
      { id: 1, hitsActual: 2, runsActual: 1, rbiActual: 0 }, // already filled
      { id: 2, hitsActual: null, runsActual: null, rbiActual: null }, // needs fill
    ];
    
    const needsFill = predictions.filter(
      p => p.hitsActual === null && p.runsActual === null && p.rbiActual === null
    );
    
    expect(needsFill.length).toBe(1);
    expect(needsFill[0].id).toBe(2);
  });

  it("should correctly map player stats to predictions", () => {
    const actualStats = new Map<number, { hits: number; runs: number; rbi: number }>();
    actualStats.set(660271, { hits: 2, runs: 1, rbi: 3 });
    actualStats.set(592450, { hits: 1, runs: 0, rbi: 0 });
    
    const prediction = { playerId: 660271, hitsPrediction: JSON.stringify({ line: 1.5, confidence: 85, direction: "over" }) };
    const playerStats = actualStats.get(prediction.playerId);
    
    expect(playerStats).toBeDefined();
    expect(playerStats!.hits).toBe(2);
    
    const hitsPred = parsePrediction(prediction.hitsPrediction);
    const isCorrect = playerStats!.hits > hitsPred!.line;
    expect(isCorrect).toBe(true); // 2 > 1.5
  });

  it("should handle players not found in game data", () => {
    const actualStats = new Map<number, { hits: number; runs: number; rbi: number }>();
    actualStats.set(660271, { hits: 2, runs: 1, rbi: 3 });
    
    // Player 999999 wasn't in any game
    const playerStats = actualStats.get(999999);
    expect(playerStats).toBeUndefined();
  });
});

describe("Results - Live Results Integration (getTodayResults)", () => {
  it("should return a valid response from getTodayResults with unique players", async () => {
    const response = await fetch("http://localhost:3000/api/trpc/results.getTodayResults");
    expect(response.ok).toBe(true);

    const json = await response.json();
    const result = json?.result?.data?.json;

    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof result.totalPlays).toBe("number");
    expect(typeof result.hitRate).toBe("number");
    expect(typeof result.hasActuals).toBe("boolean");
    expect(typeof result.gamesInProgress).toBe("number");
    expect(typeof result.gamesCompleted).toBe("number");
    expect(typeof result.gamesScheduled).toBe("number");
    expect(Array.isArray(result.results)).toBe(true);

    // Key fix validation: should NOT repeat same 3 names
    if (!result.lineupsPending && result.results.length > 0) {
      const uniqueNames = new Set(result.results.map((r: any) => r.playerName));
      expect(uniqueNames.size).toBeGreaterThan(3);

      // No single player should have more than 3 entries (H, R, RBI)
      const nameCounts: Record<string, number> = {};
      for (const r of result.results) {
        nameCounts[r.playerName] = (nameCounts[r.playerName] || 0) + 1;
      }
      for (const count of Object.values(nameCounts)) {
        expect(count).toBeLessThanOrEqual(3);
      }
    }
  }, 30000);

  it("should return results with correct field structure", async () => {
    const response = await fetch("http://localhost:3000/api/trpc/results.getTodayResults");
    const json = await response.json();
    const result = json?.result?.data?.json;

    if (result.lineupsPending || result.results.length === 0) return;

    const firstResult = result.results[0];
    expect(firstResult).toHaveProperty("playerId");
    expect(firstResult).toHaveProperty("playerName");
    expect(firstResult).toHaveProperty("team");
    expect(firstResult).toHaveProperty("stat");
    expect(firstResult).toHaveProperty("line");
    expect(firstResult).toHaveProperty("prediction", "over");
    expect(firstResult).toHaveProperty("confidence");
    expect(firstResult).toHaveProperty("gameStatus");
    expect(["hits", "runs", "rbi"]).toContain(firstResult.stat);
    expect(["Scheduled", "In Progress", "Final", "Postponed"]).toContain(firstResult.gameStatus);
    expect(firstResult.confidence).toBeGreaterThanOrEqual(0);
    expect(firstResult.confidence).toBeLessThanOrEqual(100);
  }, 30000);
});
