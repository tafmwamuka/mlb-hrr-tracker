import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Validates the ODDS_API_KEY is set and can reach the live Odds API.
 * Key resolution order (matches the server's getOddsApiKey function):
 *   1. .project-config.json secrets.ODDS_API_KEY (updated by webdev_request_secrets)
 *   2. process.env.ODDS_API_KEY (production injection fallback)
 *
 * NOTE: We intentionally do NOT import 'dotenv/config' here because the sandbox
 * .env file cannot be updated and may contain a stale key. The .project-config.json
 * file is always up-to-date.
 */
function resolveOddsApiKey(): string {
  // Prefer .project-config.json — always up-to-date in both dev and production
  try {
    const configPath = path.resolve(process.cwd(), '.project-config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { secrets?: { ODDS_API_KEY?: string } };
      const configKey = config?.secrets?.ODDS_API_KEY || '';
      if (configKey) return configKey;
    }
  } catch { /* ignore */ }
  // Fallback: process.env (production deployment)
  return process.env.ODDS_API_KEY || '';
}

describe('Odds API key validation', () => {
  it('should be resolvable from project config or environment', () => {
    const key = resolveOddsApiKey();
    expect(key, 'ODDS_API_KEY must be set via webdev_request_secrets').toBeTruthy();
    expect(key.length, 'ODDS_API_KEY should be at least 20 characters').toBeGreaterThanOrEqual(20);
  });

  it('should be a valid 32-char hex string (Odds API key format)', () => {
    const key = resolveOddsApiKey();
    expect(key).toMatch(/^[a-f0-9]{32}$/i);
  });

  it('should return MLB events from the live API', async () => {
    const key = resolveOddsApiKey();
    expect(key, 'ODDS_API_KEY must be resolvable').toBeTruthy();

    const res = await fetch(
      `https://api.the-odds-api.com/v4/sports/baseball_mlb/events?apiKey=${key}`,
      { signal: AbortSignal.timeout(12000) }
    );
    expect(res.status, `Expected 200 but got ${res.status} — key may be invalid`).toBe(200);

    const data = await res.json();
    expect(Array.isArray(data), 'Response should be an array of events').toBe(true);
    expect((data as unknown[]).length, 'Should have at least one MLB event').toBeGreaterThan(0);
  }, 15000);
});
