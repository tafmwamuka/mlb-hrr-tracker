import { describe, it, expect } from "vitest";

describe("Odds API Integration", () => {
  it("should validate The Odds API key by fetching MLB sports", async () => {
    const apiKey = process.env.ODDS_API_KEY;
    expect(apiKey).toBeDefined();

    if (!apiKey) {
      throw new Error("ODDS_API_KEY is not set");
    }

    // Test the API key by fetching available MLB sports
    const response = await fetch(
      `https://api.the-odds-api.com/v4/sports?apiKey=${apiKey}`
    );

    expect(response.ok).toBe(true);
    const data = (await response.json()) as Array<{ key: string; title: string }>;
    
    // Verify we can find MLB in the sports list
    const mlbSport = data.find((sport) => sport.key.includes("baseball_mlb"));
    expect(mlbSport).toBeDefined();
    expect(mlbSport?.key).toBe("baseball_mlb");
  });

  it("should fetch MLB odds with valid API key", async () => {
    const apiKey = process.env.ODDS_API_KEY;
    expect(apiKey).toBeDefined();

    if (!apiKey) {
      throw new Error("ODDS_API_KEY is not set");
    }

    // Fetch today's MLB games with standard odds
    const response = await fetch(
      `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds?apiKey=${apiKey}&regions=us&markets=h2h`
    );

    // API may return 422 if no games today, which is acceptable
    expect([200, 422]).toContain(response.status);
    
    if (response.ok) {
      const data = await response.json();
      // The Odds API returns an array directly, not wrapped in { data: ... }
      expect(Array.isArray(data)).toBe(true);
    }
  });
});
