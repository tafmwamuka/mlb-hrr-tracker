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

  it("should return empty array for new user with no favorites", async () => {
    const caller = favoritesRouter.createCaller(mockContext);

    const favorites = await caller.getAllFavorites();
    expect(favorites).toEqual([]);
  });

  it("should return zero hit rate for user with no completed predictions", async () => {
    const caller = favoritesRouter.createCaller(mockContext);

    const hitRate = await caller.getUserHitRate();
    expect(hitRate).toEqual({
      total: 0,
      hits: 0,
      misses: 0,
      hitRate: 0,
    });
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

  it("should return empty array for top 3 plays when no favorites exist", async () => {
    const caller = favoritesRouter.createCaller(mockContext);

    const topThree = await caller.getTopThreePlays();
    expect(topThree).toEqual([]);
  });

  it("should return empty array for history when no favorites exist", async () => {
    const caller = favoritesRouter.createCaller(mockContext);

    const history = await caller.getFavoritesHistory();
    expect(history).toEqual([]);
  });
});
