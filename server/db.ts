import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { ballparkpalCache, InsertUser, users } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// TODO: add feature queries here as your schema grows.

// ─── BallparkPal Cache Helpers ────────────────────────────────────────────────

/**
 * Save BallparkPal matchup data to the database.
 * Called by the scheduled task after a successful BallparkPal fetch.
 * Upserts by slateDate so each day has exactly one cached record.
 */
export async function saveBallparkPalCache(
  slateDate: string,
  matchups: object[],
  source: string = 'scheduled_task'
): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn('[BallparkPalDB] Cannot save cache: database not available');
    return;
  }
  try {
    const matchupsJson = JSON.stringify(matchups);
    const matchupCount = matchups.length;
    const fetchedAt = new Date();
    // Delete existing record for this date, then insert fresh
    await db.delete(ballparkpalCache).where(eq(ballparkpalCache.slateDate, slateDate));
    await db.insert(ballparkpalCache).values({
      slateDate,
      matchupsJson,
      matchupCount,
      source,
      fetchedAt,
    });
    console.log(`[BallparkPalDB] Saved ${matchupCount} matchups for ${slateDate} (source: ${source})`);
  } catch (error) {
    console.error('[BallparkPalDB] Failed to save cache:', error);
  }
}

/**
 * Read BallparkPal matchup data from the database.
 * Returns null if no cache exists for today or if cache is older than maxAgeMs.
 */
export async function getBallparkPalCache(
  slateDate: string,
  maxAgeMs: number = 6 * 60 * 60 * 1000 // 6 hours default
): Promise<{ matchups: object[]; fetchedAt: Date; source: string; matchupCount: number } | null> {
  const db = await getDb();
  if (!db) {
    console.warn('[BallparkPalDB] Cannot read cache: database not available');
    return null;
  }
  try {
    const rows = await db
      .select()
      .from(ballparkpalCache)
      .where(eq(ballparkpalCache.slateDate, slateDate))
      .limit(1);
    if (rows.length === 0) {
      console.log(`[BallparkPalDB] No cache found for ${slateDate}`);
      return null;
    }
    const row = rows[0];
    const ageMs = Date.now() - row.fetchedAt.getTime();
    if (ageMs > maxAgeMs) {
      const ageMin = Math.round(ageMs / 60000);
      console.log(`[BallparkPalDB] Cache for ${slateDate} is stale (${ageMin} min old, max ${maxAgeMs / 60000} min)`);
      return null;
    }
    const matchups = JSON.parse(row.matchupsJson) as object[];
    const ageMin = Math.round(ageMs / 60000);
    console.log(`[BallparkPalDB] Cache hit: ${matchups.length} matchups for ${slateDate} (${ageMin} min old, source: ${row.source})`);
    return { matchups, fetchedAt: row.fetchedAt, source: row.source, matchupCount: row.matchupCount };
  } catch (error) {
    console.error('[BallparkPalDB] Failed to read cache:', error);
    return null;
  }
}

/**
 * Get the status of the BallparkPal cache for a given date.
 * Used by admin endpoint to show cache health.
 */
export async function getBallparkPalCacheStatus(slateDate: string): Promise<{
  exists: boolean;
  slateDate: string;
  fetchedAt: Date | null;
  matchupCount: number;
  ageMinutes: number | null;
  source: string | null;
} | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const rows = await db
      .select()
      .from(ballparkpalCache)
      .where(eq(ballparkpalCache.slateDate, slateDate))
      .limit(1);
    if (rows.length === 0) {
      return { exists: false, slateDate, fetchedAt: null, matchupCount: 0, ageMinutes: null, source: null };
    }
    const row = rows[0];
    const ageMinutes = Math.round((Date.now() - row.fetchedAt.getTime()) / 60000);
    return {
      exists: true,
      slateDate: row.slateDate,
      fetchedAt: row.fetchedAt,
      matchupCount: row.matchupCount,
      ageMinutes,
      source: row.source,
    };
  } catch (error) {
    console.error('[BallparkPalDB] Failed to get cache status:', error);
    return null;
  }
}
