/**
 * Pitcher Learning Engine
 *
 * Stores every official pitcher prop recommendation and its outcome in the
 * pitcher_recommendation_history table. Derives historical adjustment signals
 * that compound over the season to improve future prop probability estimates.
 *
 * Key functions:
 *   - recordRecommendation()   — write a new recommendation row
 *   - gradeRecommendation()    — update result when game goes Final
 *   - getHistoricalAdjustment()— compute avg boost from past results
 */

import { getDb } from "../db";
import { pitcherRecommendationHistory } from "../../drizzle/schema";
import { and, eq, desc } from "drizzle-orm";

// ── Types ──────────────────────────────────────────────────────────────────────
export interface RecommendationRecord {
  gameDate: string;
  pitcherName: string;
  pitcherId?: number;
  pitcherTeam: string;
  opponentTeam: string;
  propType: "strikeouts" | "walks" | "outs" | "innings" | "hits_allowed" | "earned_runs";
  pitcherHand?: "L" | "R" | "S";
  umpire?: string;
  weather?: string;
  park?: string;
  bookOdds?: number;
  projection?: number;  // e.g. 6.5 → stored as 65
  line?: number;        // e.g. 6.5 → stored as 65
  disciplineEdge?: boolean;
  tms?: number;
  disciplineGrade?: string;
}

export interface HistoricalAdjustment {
  sampleSize: number;
  hitRate: number | null;
  avgBoostBps: number;  // basis points: positive = boost, negative = fade
}

// ── In-memory cache for historical adjustments ────────────────────────────────
const adjustmentCache = new Map<string, { data: HistoricalAdjustment; ts: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function cacheKey(pitcherName: string, opponentTeam: string, propType: string, hand: string): string {
  return `${pitcherName}|${opponentTeam}|${propType}|${hand}`;
}

// ── Record a new recommendation ───────────────────────────────────────────────
export async function recordRecommendation(rec: RecommendationRecord): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    await db.insert(pitcherRecommendationHistory).values({
      gameDate: rec.gameDate,
      pitcherName: rec.pitcherName,
      pitcherId: rec.pitcherId ?? null,
      pitcherTeam: rec.pitcherTeam,
      opponentTeam: rec.opponentTeam,
      propType: rec.propType,
      pitcherHand: (rec.pitcherHand ?? "R") as "L" | "R" | "S",
      umpire: rec.umpire ?? null,
      weather: rec.weather ?? null,
      park: rec.park ?? null,
      bookOdds: rec.bookOdds ?? null,
      projection: rec.projection != null ? Math.round(rec.projection * 10) : null,
      line: rec.line != null ? Math.round(rec.line * 10) : null,
      result: "pending",
      disciplineEdge: rec.disciplineEdge ? 1 : 0,
      tms: rec.tms ?? null,
      disciplineGrade: rec.disciplineGrade ?? null,
    });
  } catch (e) {
    console.warn("[LearningEngine] Failed to record recommendation:", e);
  }
}

// ── Grade a recommendation when game goes Final ───────────────────────────────
export async function gradeRecommendation(params: {
  gameDate: string;
  pitcherName: string;
  propType: string;
  actualValue: number;  // actual stat value
  line: number;         // the sportsbook line
}): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    const { gameDate, pitcherName, propType, actualValue, line } = params;
    const result = actualValue > line ? "hit" : "miss";

    await db
      .update(pitcherRecommendationHistory)
      .set({
        result: result as "hit" | "miss",
        actualValue: Math.round(actualValue * 10),
      })
      .where(
        and(
          eq(pitcherRecommendationHistory.gameDate, gameDate),
          eq(pitcherRecommendationHistory.pitcherName, pitcherName),
          eq(pitcherRecommendationHistory.propType, propType as "strikeouts" | "walks" | "outs" | "innings" | "hits_allowed" | "earned_runs"),
          eq(pitcherRecommendationHistory.result, "pending")
        )
      );

    // Invalidate cache for this pitcher
    for (const key of Array.from(adjustmentCache.keys())) {
      if (key.startsWith(`${pitcherName}|`)) {
        adjustmentCache.delete(key);
      }
    }
  } catch (e) {
    console.warn("[LearningEngine] Failed to grade recommendation:", e);
  }
}

// ── Get historical adjustment for a pitcher vs team profile ───────────────────
export async function getHistoricalAdjustment(
  pitcherName: string,
  opponentTeam: string,
  propType: string,
  pitcherHand: string = "R"
): Promise<HistoricalAdjustment> {
  const key = cacheKey(pitcherName, opponentTeam, propType, pitcherHand);
  const cached = adjustmentCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  try {
    const db = await getDb();
    if (!db) return { sampleSize: 0, hitRate: null, avgBoostBps: 0 };

    // Fetch last 30 results for this pitcher vs this opponent on this prop type
    const rows = await db
      .select()
      .from(pitcherRecommendationHistory)
      .where(
        and(
          eq(pitcherRecommendationHistory.pitcherName, pitcherName),
          eq(pitcherRecommendationHistory.opponentTeam, opponentTeam),
          eq(pitcherRecommendationHistory.propType, propType as "strikeouts" | "walks" | "outs" | "innings" | "hits_allowed" | "earned_runs")
        )
      )
      .orderBy(desc(pitcherRecommendationHistory.gameDate))
      .limit(30);

    const graded = rows.filter(r => r.result === "hit" || r.result === "miss");
    const sampleSize = graded.length;

    if (sampleSize === 0) {
      const result = { sampleSize: 0, hitRate: null, avgBoostBps: 0 };
      adjustmentCache.set(key, { data: result, ts: Date.now() });
      return result;
    }

    const hits = graded.filter(r => r.result === "hit").length;
    const hitRate = hits / sampleSize;

    // Compute average boost: hit rate vs 50% baseline
    // 60% hit rate → +200 bps, 70%+ → +400 bps, 40% → -200 bps
    const deviation = hitRate - 0.50;
    const avgBoostBps = Math.min(400, Math.max(-400, Math.round(deviation * 2000)));

    // Weight by sample size (more samples = more confidence)
    const confidenceWeight = Math.min(1.0, sampleSize / 15);
    const weightedBoostBps = Math.round(avgBoostBps * confidenceWeight);

    const result = { sampleSize, hitRate, avgBoostBps: weightedBoostBps };
    adjustmentCache.set(key, { data: result, ts: Date.now() });
    return result;
  } catch (e) {
    console.warn("[LearningEngine] Failed to get historical adjustment:", e);
    return { sampleSize: 0, hitRate: null, avgBoostBps: 0 };
  }
}

// ── Get all historical records for a pitcher ─────────────────────────────────
export async function getPitcherHistory(pitcherName: string, limit = 50): Promise<typeof pitcherRecommendationHistory.$inferSelect[]> {
  try {
    const db = await getDb();
    if (!db) return [];

    return await db
      .select()
      .from(pitcherRecommendationHistory)
      .where(eq(pitcherRecommendationHistory.pitcherName, pitcherName))
      .orderBy(desc(pitcherRecommendationHistory.gameDate))
      .limit(limit);
  } catch {
    return [];
  }
}

// ── Get recent recommendations with Discipline Edge ───────────────────────────
export async function getDisciplineEdgeHistory(limit = 20): Promise<typeof pitcherRecommendationHistory.$inferSelect[]> {
  try {
    const db = await getDb();
    if (!db) return [];

    return await db
      .select()
      .from(pitcherRecommendationHistory)
      .where(eq(pitcherRecommendationHistory.disciplineEdge, 1))
      .orderBy(desc(pitcherRecommendationHistory.gameDate))
      .limit(limit);
  } catch {
    return [];
  }
}
