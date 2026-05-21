import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users } from "../drizzle/schema";
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



// ─── Pick Snapshots ───────────────────────────────────────────────────────────
import { and, sql } from "drizzle-orm";
import { InsertPickSnapshot, pickSnapshots } from "../drizzle/schema";

/**
 * Insert or ignore a pick snapshot. Uses INSERT IGNORE so confirmed picks are
 * never overwritten by a later board rebuild. Only actualValue/result/currentOdds
 * can be updated after the initial insert.
 */
export async function insertPickSnapshotIfNew(snapshot: InsertPickSnapshot): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    // INSERT IGNORE — if pickId already exists, do nothing (preserves original locked record)
    await db.insert(pickSnapshots).ignore().values(snapshot);
  } catch (err) {
    console.error("[DB] insertPickSnapshotIfNew failed:", err);
  }
}

/**
 * Update currentOdds on an existing snapshot (non-destructive — does not touch confirmed details).
 */
export async function updatePickSnapshotOdds(pickId: string, currentOdds: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.update(pickSnapshots)
      .set({ currentOdds })
      .where(eq(pickSnapshots.pickId, pickId));
  } catch (err) {
    console.error("[DB] updatePickSnapshotOdds failed:", err);
  }
}

/**
 * Grade a pick snapshot when the game goes Final.
 */
export async function gradePickSnapshot(pickId: string, actualValue: number, result: "hit" | "miss"): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.update(pickSnapshots)
      .set({ actualValue, result, gradedAt: new Date() })
      .where(and(eq(pickSnapshots.pickId, pickId), eq(pickSnapshots.result, "pending")));
  } catch (err) {
    console.error("[DB] gradePickSnapshot failed:", err);
  }
}

/**
 * Get all pick snapshots for a given date (YYYY-MM-DD).
 * Returns only non-voided picks, ordered by confirmedAt ascending.
 */
export async function getPickSnapshotsByDate(gameDate: string) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.select().from(pickSnapshots)
      .where(and(
        eq(pickSnapshots.gameDate, gameDate),
        sql`${pickSnapshots.pickStatus} != 'voided'`
      ))
      .orderBy(pickSnapshots.confirmedAt);
  } catch (err) {
    console.error("[DB] getPickSnapshotsByDate failed:", err);
    return [];
  }
}

/**
 * Void a pick snapshot (player scratched, game postponed, etc.)
 */
export async function voidPickSnapshot(pickId: string, voidReason: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.update(pickSnapshots)
      .set({ pickStatus: "voided", voidedAt: new Date(), voidReason })
      .where(eq(pickSnapshots.pickId, pickId));
  } catch (err) {
    console.error("[DB] voidPickSnapshot failed:", err);
  }
}
