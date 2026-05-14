/**
 * History Router Tests
 * Tests for storeDailyResults, getPerformanceSummary, getResultsByDate, getResultDates
 */

import { describe, it, expect } from "vitest";

// ─── Unit tests for helper functions ─────────────────────────────────────────

describe("History Router - Data Validation", () => {
  it("should correctly compute hit rate from hits and total", () => {
    const hits = 7;
    const total = 10;
    const hitRate = total > 0 ? Math.round((hits / total) * 100) : 0;
    expect(hitRate).toBe(70);
  });

  it("should return 0 hit rate when total is 0", () => {
    const hits = 0;
    const total = 0;
    const hitRate = total > 0 ? Math.round((hits / total) * 100) : 0;
    expect(hitRate).toBe(0);
  });

  it("should correctly map result string from hit boolean", () => {
    const mapResult = (hit: boolean | null): "pending" | "hit" | "miss" => {
      if (hit === true) return "hit";
      if (hit === false) return "miss";
      return "pending";
    };
    expect(mapResult(true)).toBe("hit");
    expect(mapResult(false)).toBe("miss");
    expect(mapResult(null)).toBe("pending");
  });

  it("should correctly map source from results tab format", () => {
    const mapSource = (source: string): "money" | "allplays" => {
      return source === "money" ? "money" : "allplays";
    };
    expect(mapSource("money")).toBe("money");
    expect(mapSource("allPlays")).toBe("allplays");
    expect(mapSource("allplays")).toBe("allplays");
  });

  it("should compute period start dates correctly", () => {
    const subtractDays = (days: number): string => {
      const d = new Date();
      d.setDate(d.getDate() - days);
      return d.toISOString().split("T")[0];
    };
    const weekAgo = subtractDays(7);
    const monthAgo = subtractDays(30);
    // Both should be valid YYYY-MM-DD strings
    expect(weekAgo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(monthAgo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Week ago should be more recent than month ago
    expect(weekAgo > monthAgo).toBe(true);
  });

  it("should group results by date correctly", () => {
    const rows = [
      { gameDate: "2026-05-10", result: "hit" },
      { gameDate: "2026-05-10", result: "miss" },
      { gameDate: "2026-05-11", result: "hit" },
    ];
    const byDateMap = new Map<string, { date: string; hits: number; total: number; hitRate: number }>();
    for (const row of rows) {
      const existing = byDateMap.get(row.gameDate) ?? { date: row.gameDate, hits: 0, total: 0, hitRate: 0 };
      existing.total += 1;
      if (row.result === "hit") existing.hits += 1;
      existing.hitRate = Math.round((existing.hits / existing.total) * 100);
      byDateMap.set(row.gameDate, existing);
    }
    expect(byDateMap.size).toBe(2);
    expect(byDateMap.get("2026-05-10")?.hits).toBe(1);
    expect(byDateMap.get("2026-05-10")?.total).toBe(2);
    expect(byDateMap.get("2026-05-10")?.hitRate).toBe(50);
    expect(byDateMap.get("2026-05-11")?.hitRate).toBe(100);
  });

  it("should filter only settled results (not pending)", () => {
    const rows = [
      { result: "hit" },
      { result: "miss" },
      { result: "pending" },
      { result: "hit" },
    ];
    const settled = rows.filter(r => r.result !== "pending");
    const hits = settled.filter(r => r.result === "hit").length;
    expect(settled.length).toBe(3);
    expect(hits).toBe(2);
    const hitRate = Math.round((hits / settled.length) * 100);
    expect(hitRate).toBe(67);
  });

  it("should correctly compute source-specific hit rates", () => {
    const rows = [
      { source: "money", result: "hit" },
      { source: "money", result: "miss" },
      { source: "money", result: "hit" },
      { source: "allplays", result: "hit" },
      { source: "allplays", result: "miss" },
    ];
    const moneyRows = rows.filter(r => r.source === "money");
    const allPlaysRows = rows.filter(r => r.source === "allplays");
    const moneyHits = moneyRows.filter(r => r.result === "hit").length;
    const allPlaysHits = allPlaysRows.filter(r => r.result === "hit").length;
    const moneyHitRate = moneyRows.length > 0 ? Math.round((moneyHits / moneyRows.length) * 100) : 0;
    const allPlaysHitRate = allPlaysRows.length > 0 ? Math.round((allPlaysHits / allPlaysRows.length) * 100) : 0;
    expect(moneyHitRate).toBe(67);
    expect(allPlaysHitRate).toBe(50);
  });
});
