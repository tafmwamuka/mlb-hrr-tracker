import { describe, it, expect } from 'vitest';

/**
 * Validates the ODDS_API_KEY is set and returns live MLB events.
 * Uses .project-config.json as the key source (same as the server) to ensure
 * the test validates the key that the running server actually uses.
 */
describe('Odds API key validation', () => {
  it('should return MLB events with the configured key', async () => {
    // Read from .project-config.json (same source as the server's getOddsApiKey helper)
    let key = process.env.ODDS_API_KEY;
    try {
      const fs = await import('fs');
      const path = await import('path');
      const configPath = path.resolve(process.cwd(), '.project-config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const configKey = config?.secrets?.ODDS_API_KEY || '';
        if (configKey) key = configKey;
      }
    } catch { /* ignore */ }

    expect(key, 'ODDS_API_KEY must be set').toBeTruthy();

    const res = await fetch(
      `https://api.the-odds-api.com/v4/sports/baseball_mlb/events?apiKey=${key}`,
      { signal: AbortSignal.timeout(12000) }
    );
    expect(res.status, `Expected 200 but got ${res.status} — key may be invalid`).toBe(200);

    const data = await res.json();
    expect(Array.isArray(data), 'Response should be an array of events').toBe(true);
    expect(data.length, 'Should have at least one MLB event').toBeGreaterThan(0);
  }, 15000);
});
