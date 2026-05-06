import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * MLB Games table — stores game schedule and metadata
 */
export const mlbGames = mysqlTable("mlb_games", {
  id: int("id").autoincrement().primaryKey(),
  gameId: varchar("gameId", { length: 64 }).notNull().unique(),
  gameDate: timestamp("gameDate").notNull(),
  homeTeam: varchar("homeTeam", { length: 64 }).notNull(),
  awayTeam: varchar("awayTeam", { length: 64 }).notNull(),
  homeTeamId: int("homeTeamId"),
  awayTeamId: int("awayTeamId"),
  status: varchar("status", { length: 32 }).default("scheduled").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MLBGame = typeof mlbGames.$inferSelect;
export type InsertMLBGame = typeof mlbGames.$inferInsert;

/**
 * Player Props table — stores H/R/RBI prop lines for each player in each game
 */
export const playerProps = mysqlTable("player_props", {
  id: int("id").autoincrement().primaryKey(),
  gameId: varchar("gameId", { length: 64 }).notNull(),
  playerId: int("playerId").notNull(),
  playerName: varchar("playerName", { length: 128 }).notNull(),
  playerTeam: varchar("playerTeam", { length: 64 }).notNull(),
  hitsLine: text("hitsLine"),
  runsLine: text("runsLine"),
  rbiLine: text("rbiLine"),
  hitsConfidence: int("hitsConfidence"),
  runsConfidence: int("runsConfidence"),
  rbiConfidence: int("rbiConfidence"),
  parkFactor: text("parkFactor"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PlayerProp = typeof playerProps.$inferSelect;
export type InsertPlayerProp = typeof playerProps.$inferInsert;

/**
 * Prop Predictions table — stores model predictions with hit rate tracking
 */
export const propPredictions = mysqlTable("prop_predictions", {
  id: int("id").autoincrement().primaryKey(),
  gameId: varchar("gameId", { length: 64 }).notNull(),
  playerId: int("playerId").notNull(),
  playerName: varchar("playerName", { length: 128 }).notNull(),
  hitsPrediction: text("hitsPrediction"),
  runsPrediction: text("runsPrediction"),
  rbiPrediction: text("rbiPrediction"),
  hitsReasoning: text("hitsReasoning"),
  runsReasoning: text("runsReasoning"),
  rbiReasoning: text("rbiReasoning"),
  hitsActual: int("hitsActual"),
  runsActual: int("runsActual"),
  rbiActual: int("rbiActual"),
  hitsCorrect: int("hitsCorrect"),
  runsCorrect: int("runsCorrect"),
  rbiCorrect: int("rbiCorrect"),
  predictionDate: timestamp("predictionDate").notNull(),
  gameDate: timestamp("gameDate").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PropPrediction = typeof propPredictions.$inferSelect;
export type InsertPropPrediction = typeof propPredictions.$inferInsert;

/**
 * Model Performance table — tracks daily hit rate and model accuracy
 */
export const modelPerformance = mysqlTable("model_performance", {
  id: int("id").autoincrement().primaryKey(),
  date: timestamp("date").notNull().unique(),
  totalPredictions: int("totalPredictions").default(0),
  hitsCorrect: int("hitsCorrect").default(0),
  runsCorrect: int("runsCorrect").default(0),
  rbiCorrect: int("rbiCorrect").default(0),
  overallHitRate: int("overallHitRate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ModelPerformance = typeof modelPerformance.$inferSelect;
export type InsertModelPerformance = typeof modelPerformance.$inferInsert;
/**
 * User Favorites table — stores user's favorite prop predictions
 * Tracks which plays the user has marked as favorites and their outcomes
 */
export const userFavorites = mysqlTable("user_favorites", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  gameId: varchar("gameId", { length: 64 }).notNull(),
  playerId: int("playerId").notNull(),
  playerName: varchar("playerName", { length: 128 }).notNull(),
  playerTeam: varchar("playerTeam", { length: 64 }).notNull(),
  statType: mysqlEnum("statType", ["hits", "runs", "rbi"]).notNull(),
  prediction: varchar("prediction", { length: 32 }).notNull(), // "over" or "under"
  line: int("line"),
  confidence: int("confidence"),
  reasoning: text("reasoning"),
  gameDate: timestamp("gameDate").notNull(),
  result: mysqlEnum("result", ["pending", "hit", "miss"]).default("pending").notNull(),
  resultDate: timestamp("resultDate"),
  actualValue: int("actualValue"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserFavorite = typeof userFavorites.$inferSelect;
export type InsertUserFavorite = typeof userFavorites.$inferInsert;
