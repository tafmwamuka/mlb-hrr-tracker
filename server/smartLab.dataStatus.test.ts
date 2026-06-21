/**
 * Tests for smartLab.getDataStatus procedure
 * Verifies that the data status endpoint returns the expected shape
 * and reflects cache state correctly.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock the services used by getDataStatus
vi.mock("./services/oddsApiService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/oddsApiService")>();
  return {
    ...actual,
    getPitcherOddsStatus: vi.fn(() => ({ loaded: false, pitcherCount: 0, lastUpdated: null })),
    getHRROddsStatus: vi.fn(() => ({ loaded: false, playerCount: 0, lastUpdated: null })),
    getOddsApiKeyStatus: vi.fn(() => ({ present: false, prefix: '', length: 0 })),
  };
});

vi.mock("./services/enrichmentCache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/enrichmentCache")>();
  return {
    ...actual,
    isEnrichmentWarm: vi.fn(() => false),
  };
});

vi.mock("./services/gameTotalsService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/gameTotalsService")>();
  return {
    ...actual,
    getGameTotalsStatus: vi.fn(() => ({ loaded: false, gameCount: 0, lastUpdated: null })),
  };
});

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("smartLab.getDataStatus", () => {
  it("returns the expected shape with all sources offline when caches are empty", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.smartLab.getDataStatus();

    // Shape checks
    expect(result).toHaveProperty("moneyPickOdds");
    expect(result).toHaveProperty("pitcherStrikeoutOdds");
    expect(result).toHaveProperty("gameTotals");
    expect(result).toHaveProperty("enrichmentCache");
    expect(result).toHaveProperty("tmsDatabase");
    expect(result).toHaveProperty("disciplineDatabase");
    expect(result).toHaveProperty("oddsApiKeyStatus");
    expect(result.oddsApiKeyStatus).toHaveProperty("present");
    expect(result.oddsApiKeyStatus).toHaveProperty("prefix");
    expect(result.oddsApiKeyStatus).toHaveProperty("length");

    // TMS and Discipline are always connected (computed in-memory)
    expect(result.tmsDatabase.connected).toBe(true);
    expect(result.disciplineDatabase.connected).toBe(true);

    // Caches are empty so these should be offline/not connected
    expect(result.moneyPickOdds.connected).toBe(false);
    expect(result.pitcherStrikeoutOdds.connected).toBe(false);
    expect(result.gameTotals.connected).toBe(false);
    expect(result.enrichmentCache.connected).toBe(false);

    // lastUpdated should be null when no caches have data
    expect(result.lastUpdated).toBeNull();
  });

  it("reflects loaded state when pitcher odds cache has data", async () => {
    const { getPitcherOddsStatus } = await import("./services/oddsApiService");
    vi.mocked(getPitcherOddsStatus).mockReturnValueOnce({
      loaded: true,
      pitcherCount: 12,
      lastUpdated: new Date("2026-06-21T15:00:00Z"),
    });

    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.smartLab.getDataStatus();

    expect(result.pitcherStrikeoutOdds.connected).toBe(true);
    expect(result.pitcherStrikeoutOdds.pitcherCount).toBe(12);
    expect(result.lastUpdated).not.toBeNull();
  });

  it("reflects loaded state when HRR odds cache has data", async () => {
    const { getHRROddsStatus } = await import("./services/oddsApiService");
    vi.mocked(getHRROddsStatus).mockReturnValueOnce({
      loaded: true,
      playerCount: 45,
      lastUpdated: new Date("2026-06-21T16:00:00Z"),
    });

    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.smartLab.getDataStatus();

    expect(result.moneyPickOdds.connected).toBe(true);
    expect(result.moneyPickOdds.playerCount).toBe(45);
  });

  it("reflects warm enrichment cache", async () => {
    const { isEnrichmentWarm } = await import("./services/enrichmentCache");
    vi.mocked(isEnrichmentWarm).mockReturnValueOnce(true);

    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.smartLab.getDataStatus();

    expect(result.enrichmentCache.connected).toBe(true);
  });
});
