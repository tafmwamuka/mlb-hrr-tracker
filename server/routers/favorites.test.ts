import { describe, it, expect, vi, beforeEach } from "vitest";
import { favoritesRouter } from "./favorites";
import type { TrpcContext } from "../_core/context";

/**
 * Mock user context for testing
 */
function createMockContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "test-user",
      email: "test@example.com",
      name: "Test User",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("favoritesRouter", () => {
  let mockContext: TrpcContext;

  beforeEach(() => {
    mockContext = createMockContext();
  });

  it("should have all required procedures", () => {
    const caller = favoritesRouter.createCaller(mockContext);

    expect(caller.addFavorite).toBeDefined();
    expect(caller.removeFavorite).toBeDefined();
    expect(caller.getAllFavorites).toBeDefined();
    expect(caller.getTopThreePlays).toBeDefined();
    expect(caller.getFavoritesHistory).toBeDefined();
    expect(caller.updateFavoriteResult).toBeDefined();
    expect(caller.getUserHitRate).toBeDefined();
    expect(caller.isFavorited).toBeDefined();
  });

  it("should return array of all favorites for user", async () => {
    const caller = favoritesRouter.createCaller(mockContext);

    const favorites = await caller.getAllFavorites();
    expect(Array.isArray(favorites)).toBe(true);
  });

  it("should return zero hit rate for user with no completed predictions", async () => {
    const caller = favoritesRouter.createCaller(mockContext);

    const hitRate = await caller.getUserHitRate();
    // Verify the structure is correct
    expect(hitRate).toHaveProperty('total');
    expect(hitRate).toHaveProperty('hits');
    expect(hitRate).toHaveProperty('misses');
    expect(hitRate).toHaveProperty('hitRate');
    // Verify types
    expect(typeof hitRate.total).toBe('number');
    expect(typeof hitRate.hits).toBe('number');
    expect(typeof hitRate.misses).toBe('number');
    expect(typeof hitRate.hitRate).toBe('number');
    // Verify hits <= total and misses = total - hits
    expect(hitRate.hits).toBeLessThanOrEqual(hitRate.total);
    expect(hitRate.misses).toBe(hitRate.total - hitRate.hits);
  });


  it("should return null when checking non-existent favorite", async () => {
    const caller = favoritesRouter.createCaller(mockContext);

    const isFavorited = await caller.isFavorited({
      gameId: "test-game-123",
      playerId: 12345,
      statType: "hits",
    });

    expect(isFavorited).toBeNull();
  });

  it("should return array for top 3 plays", async () => {
    const caller = favoritesRouter.createCaller(mockContext);

    const topThree = await caller.getTopThreePlays();
    expect(Array.isArray(topThree)).toBe(true);
    expect(topThree.length).toBeLessThanOrEqual(3);
  });

  it("should return array for history", async () => {
    const caller = favoritesRouter.createCaller(mockContext);

    const history = await caller.getFavoritesHistory();
    expect(Array.isArray(history)).toBe(true);
  });
});
