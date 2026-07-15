/**
 * progressiveTracking.test.ts
 *
 * Unit tests for progressiveTrackingService:
 *   - getCumulativeRecord returns a valid empty record when DB is unavailable
 *   - saveLockedPick does not throw when DB is unavailable
 *   - verifyResultsForDate returns empty summary when DB is unavailable
 *   - CumulativeRecord structure matches the expected shape
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock getDb to return null (simulates DB unavailable)
vi.mock('../db', () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));

import {
  getCumulativeRecord,
  saveLockedPick,
  verifyResultsForDate,
  type LockedPickRecord,
  type CumulativeRecord,
} from './progressiveTrackingService';

describe('progressiveTrackingService', () => {
  describe('getCumulativeRecord — DB unavailable', () => {
    it('returns a valid empty record when DB is null', async () => {
      const record = await getCumulativeRecord();
      expect(record).toBeDefined();
      expect(record.totalPicks).toBe(0);
      expect(record.wins).toBe(0);
      expect(record.losses).toBe(0);
      expect(record.voids).toBe(0);
      expect(record.pending).toBe(0);
      expect(record.hitRate).toBe(0);
      expect(record.roi).toBe(0);
      expect(record.roiDollars).toBe(0);
      expect(Array.isArray(record.last7Days)).toBe(true);
      expect(record.currentStreak).toBeNull();
      expect(typeof record.byTier).toBe('object');
      expect(typeof record.byType).toBe('object');
      expect(typeof record.byProp).toBe('object');
    });

    it('returns empty record with sinceDate param', async () => {
      const record = await getCumulativeRecord('2025-01-01');
      expect(record.since).toBe('2025-01-01');
      expect(record.totalPicks).toBe(0);
    });
  });

  describe('saveLockedPick — DB unavailable', () => {
    it('does not throw when DB is null', async () => {
      const pick: LockedPickRecord = {
        slateDate: '2025-07-15',
        pickType: 'hrr',
        playerId: 123456,
        playerName: 'Test Player',
        team: 'NYY',
        opponent: 'BOS',
        gamePk: 999001,
        propType: 'hrr',
        line: 0.5,
        bookOdds: -115,
        modelProb: 72,
        edge: 5.2,
        tier: 'STRONG',
        overallScore: 78,
        lockedAt: new Date().toISOString(),
        actual: null,
        result: 'pending',
        verifiedAt: null,
        voidReason: null,
      };
      await expect(saveLockedPick(pick)).resolves.toBeUndefined();
    });
  });

  describe('verifyResultsForDate — DB unavailable', () => {
    it('returns empty summary when DB is null', async () => {
      const result = await verifyResultsForDate('2025-07-14');
      expect(result.verified).toBe(0);
      expect(result.hits).toBe(0);
      expect(result.misses).toBe(0);
      expect(result.voids).toBe(0);
    });
  });

  describe('CumulativeRecord shape', () => {
    it('has all required fields with correct types', async () => {
      const record: CumulativeRecord = await getCumulativeRecord();
      // Required string fields
      expect(typeof record.since).toBe('string');
      // Required number fields
      expect(typeof record.totalPicks).toBe('number');
      expect(typeof record.wins).toBe('number');
      expect(typeof record.losses).toBe('number');
      expect(typeof record.voids).toBe('number');
      expect(typeof record.pending).toBe('number');
      expect(typeof record.hitRate).toBe('number');
      expect(typeof record.roi).toBe('number');
      expect(typeof record.roiDollars).toBe('number');
      // last7Days is an array
      expect(Array.isArray(record.last7Days)).toBe(true);
      // currentStreak is null or { type, count }
      if (record.currentStreak !== null) {
        expect(['W', 'L']).toContain(record.currentStreak.type);
        expect(typeof record.currentStreak.count).toBe('number');
      }
    });
  });
});
