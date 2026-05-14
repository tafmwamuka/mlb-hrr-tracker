/**
 * Vitest: Validate BALLPARK_PHPSESSID and BALLPARK_SYSTEM_ID env vars are set.
 * Note: We cannot test actual ballparkpal.com connectivity here because the
 * sandbox IP is currently blocked by Cloudflare. This test validates that the
 * env vars are present and non-empty, which is all we can verify at this time.
 * Full integration testing will be possible once the IP block clears.
 */
import { describe, it, expect } from 'vitest';
import * as dotenv from 'dotenv';
dotenv.config();

describe('BallparkPal session cookie env vars', () => {
  it('BALLPARK_PHPSESSID is set and non-empty', () => {
    const val = process.env.BALLPARK_PHPSESSID;
    expect(val).toBeDefined();
    expect(typeof val).toBe('string');
    expect(val!.length).toBeGreaterThan(0);
  });

  it('BALLPARK_SYSTEM_ID is set and non-empty', () => {
    const val = process.env.BALLPARK_SYSTEM_ID;
    expect(val).toBeDefined();
    expect(typeof val).toBe('string');
    expect(val!.length).toBeGreaterThan(0);
  });

  it('BALLPARK_PHPSESSID looks like a valid PHP session ID', () => {
    const val = process.env.BALLPARK_PHPSESSID || '';
    // PHP session IDs are alphanumeric, typically 26-32 chars
    expect(val).toMatch(/^[a-z0-9]{10,}$/i);
  });

  it('BALLPARK_SYSTEM_ID looks like a valid system_id', () => {
    const val = process.env.BALLPARK_SYSTEM_ID || '';
    // system_id format: hex.numeric e.g. "6a05bebe8802c9.72739147"
    expect(val).toMatch(/^[a-f0-9]+\.[0-9]+$/i);
  });
});
