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
 * Player Props table — stores H/R/RBI/Slg % prop lines for each player in each game
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
  slgLine: text("slgLine"),
  hitsConfidence: int("hitsConfidence"),
  runsConfidence: int("runsConfidence"),
  rbiConfidence: int("rbiConfidence"),
  slgConfidence: int("slgConfidence"),
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
  slgPrediction: text("slgPrediction"),
  hitsReasoning: text("hitsReasoning"),
  runsReasoning: text("runsReasoning"),
  rbiReasoning: text("rbiReasoning"),
  slgReasoning: text("slgReasoning"),
  hitsActual: int("hitsActual"),
  runsActual: int("runsActual"),
  rbiActual: int("rbiActual"),
  slgActual: int("slgActual"),
  hitsCorrect: int("hitsCorrect"),
  runsCorrect: int("runsCorrect"),
  rbiCorrect: int("rbiCorrect"),
  slgCorrect: int("slgCorrect"),
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
  slgCorrect: int("slgCorrect").default(0),
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
  statType: mysqlEnum("statType", ["hits", "runs", "rbi", "slg"]).notNull(),
  prediction: varchar("prediction", { length: 32 }).notNull(),
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

/**
 * User Watchlist table — stores user's "My Players" watchlist
 */
export const userWatchlist = mysqlTable("user_watchlist", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  playerId: int("playerId").notNull(),
  playerName: varchar("playerName", { length: 128 }).notNull(),
  playerTeam: varchar("playerTeam", { length: 64 }).notNull(),
  playerPosition: varchar("playerPosition", { length: 32 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserWatchlist = typeof userWatchlist.$inferSelect;
export type InsertUserWatchlist = typeof userWatchlist.$inferInsert;

/**
 * User Settings table — stores user preferences for prop model and notifications
 */
export const userSettings = mysqlTable("user_settings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  minConfidenceThreshold: int("minConfidenceThreshold").default(75),
  enableNotifications: int("enableNotifications").default(1),
  notifyHighConfidence: int("notifyHighConfidence").default(1),
  notifyNewGames: int("notifyNewGames").default(0),
  preferredStats: varchar("preferredStats", { length: 64 }).default("hits,runs,rbi,slg"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserSettings = typeof userSettings.$inferSelect;
export type InsertUserSettings = typeof userSettings.$inferInsert;

/**
 * Notifications table — stores user notifications for high-confidence props
 */
export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  playerId: int("playerId").notNull(),
  playerName: varchar("playerName", { length: 128 }).notNull(),
  statType: mysqlEnum("statType", ["hits", "runs", "rbi", "slg"]).notNull(),
  confidence: int("confidence"),
  message: text("message"),
  read: int("read").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

/**
 * Daily Results table — stores the outcome of each day's picks for historical tracking
 * Populated automatically when games go Final (via the live results service)
 */
export const dailyResults = mysqlTable("daily_results", {
  id: int("id").autoincrement().primaryKey(),
  gameDate: varchar("gameDate", { length: 16 }).notNull(), // YYYY-MM-DD
  playerId: int("playerId").notNull(),
  playerName: varchar("playerName", { length: 128 }).notNull(),
  playerTeam: varchar("playerTeam", { length: 64 }).notNull(),
  statType: mysqlEnum("statType", ["hits", "runs", "rbi", "hrr"]).notNull(),
  source: mysqlEnum("source", ["money", "allplays"]).notNull(),
  line: text("line").notNull(), // e.g. "OVER 0.5"
  probability: int("probability").notNull(), // 0-100
  actualValue: int("actualValue"), // null until game is Final
  result: mysqlEnum("result", ["pending", "hit", "miss", "ppd"]).default("pending").notNull(),
  odds: varchar("odds", { length: 16 }), // American odds e.g. "-164" or "+120"
  oddsProvider: varchar("oddsProvider", { length: 64 }),
  streakLabel: varchar("streakLabel", { length: 64 }),
  dayNightLabel: varchar("dayNightLabel", { length: 64 }),
  // Phase AE: tracking fields added May 15, 2025
  tier: varchar("tier", { length: 8 }), // S, A, Lean, or null
  edge: int("edge"), // model edge % vs book implied probability
  closingLineValue: int("closingLineValue"), // CLV: closing line vs our pick line (positive = value)
  matrixScore: int("matrixScore"), // 10-factor matrix score (0-100)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DailyResult = typeof dailyResults.$inferSelect;
export type InsertDailyResult = typeof dailyResults.$inferInsert;

/**
 * Pick Snapshots table — frozen versioned record of every pick that reaches CONFIRMED or EVENING CONFIRMED status.
 * This is the single source of truth for Results history.
 * Once a pick is written here it is NEVER overwritten — only actualValue/result are updated when games go Final.
 */
export const pickSnapshots = mysqlTable("pick_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  // Identity
  pickId: varchar("pickId", { length: 64 }).notNull().unique(), // stable ID: `{gameDate}_{playerId}_{market}`
  gameDate: varchar("gameDate", { length: 16 }).notNull(), // YYYY-MM-DD
  playerId: int("playerId").notNull(),
  playerName: varchar("playerName", { length: 128 }).notNull(),
  playerTeam: varchar("playerTeam", { length: 64 }).notNull(),
  gameId: varchar("gameId", { length: 64 }).notNull(),
  market: varchar("market", { length: 32 }).notNull().default("hrr"), // hrr, hits, runs, rbi
  // Pick details frozen at confirmation time
  recommendedLine: text("recommendedLine").notNull(), // e.g. "O2.5"
  confirmedOdds: int("confirmedOdds"), // American odds at confirmation e.g. -145
  currentOdds: int("currentOdds"),    // Latest odds (updated but pick stays)
  edge: int("edge"),                  // Model edge % at confirmation
  matrixScore: int("matrixScore"),    // Matrix score at confirmation
  probability: int("probability"),    // Model probability 0-100
  tier: varchar("tier", { length: 8 }), // Elite, Strong, A, Lean
  boardPhase: varchar("boardPhase", { length: 32 }).notNull(), // PRELIMINARY, MIDDAY_CONFIRMED, EVENING_CONFIRMED, EARLY_LOCKED, LATER_QUALIFIER
  pickStatus: mysqlEnum("pickStatus", ["preliminary", "confirmed", "evening_confirmed", "early_locked", "later_qualifier", "voided"]).notNull(),
  confirmedAt: timestamp("confirmedAt"), // when pick was locked
  voidedAt: timestamp("voidedAt"),       // if voided
  voidReason: varchar("voidReason", { length: 256 }), // e.g. "player scratched"
  // Results (filled in when game goes Final)
  actualValue: int("actualValue"),
  result: mysqlEnum("result", ["pending", "hit", "miss", "ppd"]).default("pending").notNull(),
  gradedAt: timestamp("gradedAt"),
  // Metadata
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PickSnapshot = typeof pickSnapshots.$inferSelect;
export type InsertPickSnapshot = typeof pickSnapshots.$inferInsert;

/**
 * Team Discipline Profiles table — stores computed discipline grades and prop tendency profiles
 * for every MLB team. Refreshed daily from the MLB Stats API.
 */
export const teamDisciplineProfiles = mysqlTable("team_discipline_profiles", {
  id: int("id").autoincrement().primaryKey(),
  teamAbbr: varchar("teamAbbr", { length: 8 }).notNull().unique(), // e.g. "NYY"
  teamName: varchar("teamName", { length: 64 }).notNull(),
  season: int("season").notNull(),
  // Discipline metrics (stored as integers * 1000 for precision, e.g. 0.123 → 123)
  walkRatePct: int("walkRatePct"),        // BB% * 1000
  strikeoutRatePct: int("strikeoutRatePct"), // K% * 1000
  chaseRatePct: int("chaseRatePct"),      // O-Swing% * 1000
  contactRatePct: int("contactRatePct"),  // Contact% * 1000
  zoneContactPct: int("zoneContactPct"),  // Z-Contact% * 1000
  swingStrikePct: int("swingStrikePct"),  // SwStr% * 1000
  firstPitchSwingPct: int("firstPitchSwingPct"), // F-Strike% * 1000
  pitchesPerPA: int("pitchesPerPA"),      // P/PA * 100
  walkRateVsRHP: int("walkRateVsRHP"),    // BB% vs RHP * 1000
  walkRateVsLHP: int("walkRateVsLHP"),    // BB% vs LHP * 1000
  kRateVsRHP: int("kRateVsRHP"),          // K% vs RHP * 1000
  kRateVsLHP: int("kRateVsLHP"),          // K% vs LHP * 1000
  // Computed grades
  disciplineGrade: mysqlEnum("disciplineGrade", ["A+", "A", "B", "C", "D"]).notNull().default("B"),
  disciplineScore: int("disciplineScore").notNull().default(50), // 0-100
  // Prop tendency scores (0-100)
  walkTendencyScore: int("walkTendencyScore").default(50),
  strikeoutTendencyScore: int("strikeoutTendencyScore").default(50),
  pitchCountTendencyScore: int("pitchCountTendencyScore").default(50),
  patientScore: int("patientScore").default(50),       // high = patient (walks, long ABs)
  aggressiveScore: int("aggressiveScore").default(50), // high = aggressive (chase, first pitch)
  // Market tendency (derived from historical results)
  marketOverPerformScore: int("marketOverPerformScore").default(50), // how often team outperforms market
  marketUnderPerformScore: int("marketUnderPerformScore").default(50),
  // Auto-boost adjustments (stored as integer basis points, e.g. 300 = +3%)
  walkBoostBps: int("walkBoostBps").default(0),       // ±500 max (±5%)
  strikeoutBoostBps: int("strikeoutBoostBps").default(0),
  // Metadata
  lastFetchedAt: timestamp("lastFetchedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TeamDisciplineProfile = typeof teamDisciplineProfiles.$inferSelect;
export type InsertTeamDisciplineProfile = typeof teamDisciplineProfiles.$inferInsert;

/**
 * Pitcher Recommendation History table — stores every official pitcher edge recommendation
 * and its outcome. Used by the learning engine to derive historical adjustments.
 */
export const pitcherRecommendationHistory = mysqlTable("pitcher_recommendation_history", {
  id: int("id").autoincrement().primaryKey(),
  gameDate: varchar("gameDate", { length: 16 }).notNull(), // YYYY-MM-DD
  pitcherName: varchar("pitcherName", { length: 128 }).notNull(),
  pitcherId: int("pitcherId"),
  pitcherTeam: varchar("pitcherTeam", { length: 8 }).notNull(),
  opponentTeam: varchar("opponentTeam", { length: 8 }).notNull(),
  propType: mysqlEnum("propType", ["strikeouts", "walks", "outs", "innings", "hits_allowed", "earned_runs"]).notNull(),
  pitcherHand: mysqlEnum("pitcherHand", ["L", "R", "S"]).default("R"),
  umpire: varchar("umpire", { length: 128 }),
  weather: varchar("weather", { length: 256 }), // JSON string
  park: varchar("park", { length: 64 }),
  bookOdds: int("bookOdds"),       // American odds e.g. -115
  projection: int("projection"),   // model projected value * 10 e.g. 65 = 6.5 K
  line: int("line"),               // sportsbook line * 10 e.g. 65 = 6.5
  result: mysqlEnum("result", ["pending", "hit", "miss", "ppd"]).default("pending").notNull(),
  actualValue: int("actualValue"), // actual stat value * 10
  disciplineEdge: int("disciplineEdge").default(0), // 1 if DISCIPLINE EDGE was flagged
  tms: int("tms"),                 // Team Matchup Score at time of recommendation (0-100)
  disciplineGrade: varchar("disciplineGrade", { length: 4 }), // opponent's discipline grade
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PitcherRecommendationHistory = typeof pitcherRecommendationHistory.$inferSelect;
export type InsertPitcherRecommendationHistory = typeof pitcherRecommendationHistory.$inferInsert;

