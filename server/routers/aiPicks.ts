/**
 * AI Picks Router
 * Comprehensive AI picks using all data sources
 */

import { router, publicProcedure } from "../_core/trpc";
import { getDb, insertPickSnapshotIfNew, updatePickSnapshotOdds } from "../db";
import { dailyResults, pickSnapshots } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { rankAIPicks, getMockHRTargets, getMockParkFactors } from "../services/aiRankingService";
import type { AIPick } from "../services/aiRankingService";
// Phase AP: getMockSavantData removed — savant enrichment now uses real statcastCache only
import { generateHRRProjections } from "../services/hrrService";
import { americanToImpliedProbability } from "../services/oddsApiService";
import { poissonOverProbability, calculateAlternateLines, findFairLine, calculateEdge, getPickQuality } from "../services/poissonModel";
import { getAdaptedLineupData, getGamesForUI } from "../services/lineupAdapter";
import { getDataDate, type MLBGame } from "../services/mlbLineupService";
import { getEnrichmentData, onEnrichmentWarm } from "../services/enrichmentCache";
import { fetchGameTotals } from "../services/gameTotalsService";
import { bustPicksCache, clearHardLock, getEnrichedMoneyPicks, isBoardHardLocked, setHardLock } from "../services/hrrPicksService";

// Mock player data with batting position
const MOCK_PLAYERS = new Map([
  [660271, {
    playerId: 660271,
    name: "Aaron Judge",
    team: "NYY",
    position: "RF",
    battingPosition: 4,
    handedness: 'R' as const,
    stats: {
      hits: 42,
      runs: 30,
      rbi: 32,
      slg: 0.580,
      avg: 0.275,
      obp: 0.380,
      power: 0.185,
    },
    recentForm: {
      last15Games: {
        hits: 16,
        runs: 12,
        rbi: 14,
        avg: 0.295,
      },
      trend: 'hot' as const,
    },
  }],
  [592450, {
    playerId: 592450,
    name: "Juan Soto",
    team: "NYM",
    position: "LF",
    battingPosition: 3,
    handedness: 'L' as const,
    stats: {
      hits: 48,
      runs: 32,
      rbi: 28,
      slg: 0.545,
      avg: 0.310,
      obp: 0.420,
      power: 0.195,
    },
    recentForm: {
      last15Games: {
        hits: 19,
        runs: 13,
        rbi: 11,
        avg: 0.325,
      },
      trend: 'hot' as const,
    },
  }],
  [608070, {
    playerId: 608070,
    name: "B. Buxton",
    team: "MIN",
    position: "CF",
    battingPosition: 2,
    handedness: 'R' as const,
    stats: {
      hits: 38,
      runs: 24,
      rbi: 22,
      slg: 0.480,
      avg: 0.275,
      obp: 0.360,
      power: 0.165,
    },
  }],
  [543807, {
    playerId: 543807,
    name: "B. Bichette",
    team: "BOS",
    position: "DH",
    battingPosition: 5,
    handedness: 'R' as const,
    stats: {
      hits: 44,
      runs: 22,
      rbi: 26,
      slg: 0.470,
      avg: 0.280,
      obp: 0.340,
      power: 0.160,
    },
  }],
  [665742, {
    playerId: 665742,
    name: "J. Wood",
    team: "WAS",
    position: "LF",
    battingPosition: 3,
    handedness: 'L' as const,
    stats: {
      hits: 40,
      runs: 24,
      rbi: 25,
      slg: 0.495,
      avg: 0.280,
      obp: 0.365,
      power: 0.170,
    },
  }],
  [592885, {
    playerId: 592885,
    name: "M. Betts",
    team: "LAD",
    position: "SS",
    battingPosition: 1,
    handedness: 'R' as const,
    stats: {
      hits: 46,
      runs: 30,
      rbi: 24,
      slg: 0.530,
      avg: 0.295,
      obp: 0.385,
      power: 0.185,
    },
  }],
  [605141, {
    playerId: 605141,
    name: "C. Raleigh",
    team: "SEA",
    position: "C",
    battingPosition: 6,
    handedness: 'R' as const,
    stats: {
      hits: 32,
      runs: 18,
      rbi: 24,
      slg: 0.450,
      avg: 0.240,
      obp: 0.320,
      power: 0.155,
    },
  }],
  [571970, {
    playerId: 571970,
    name: "S. Ohtani",
    team: "LAD",
    position: "DH",
    battingPosition: 2,
    handedness: 'L' as const,
    stats: {
      hits: 48,
      runs: 34,
      rbi: 30,
      slg: 0.580,
      avg: 0.305,
      obp: 0.400,
      power: 0.210,
    },
  }],
  [668939, {
    playerId: 668939,
    name: "R. Acuna Jr.",
    team: "ATL",
    position: "RF",
    battingPosition: 1,
    handedness: 'R' as const,
    stats: {
      hits: 44,
      runs: 30,
      rbi: 20,
      slg: 0.500,
      avg: 0.285,
      obp: 0.380,
      power: 0.175,
    },
  }],
  [665487, {
    playerId: 665487,
    name: "M. Olson",
    team: "ATL",
    position: "1B",
    battingPosition: 4,
    handedness: 'L' as const,
    stats: {
      hits: 38,
      runs: 24,
      rbi: 30,
      slg: 0.510,
      avg: 0.260,
      obp: 0.355,
      power: 0.180,
    },
  }],
  [665489, {
    playerId: 665489,
    name: "K. Tucker",
    team: "HOU",
    position: "LF",
    battingPosition: 3,
    handedness: 'L' as const,
    stats: {
      hits: 44,
      runs: 26,
      rbi: 28,
      slg: 0.500,
      avg: 0.290,
      obp: 0.370,
      power: 0.175,
    },
  }],
  [665862, {
    playerId: 665862,
    name: "C. Carroll",
    team: "ARI",
    position: "CF",
    battingPosition: 1,
    handedness: 'L' as const,
    stats: {
      hits: 42,
      runs: 28,
      rbi: 18,
      slg: 0.440,
      avg: 0.280,
      obp: 0.355,
      power: 0.140,
    },
  }],
  [665750, {
    playerId: 665750,
    name: "G. Henderson",
    team: "BAL",
    position: "SS",
    battingPosition: 2,
    handedness: 'R' as const,
    stats: {
      hits: 45,
      runs: 28,
      rbi: 26,
      slg: 0.515,
      avg: 0.290,
      obp: 0.370,
      power: 0.180,
    },
  }],
  [665861, {
    playerId: 665861,
    name: "E. De La Cruz",
    team: "CIN",
    position: "SS",
    battingPosition: 3,
    handedness: 'R' as const,
    stats: {
      hits: 40,
      runs: 26,
      rbi: 22,
      slg: 0.490,
      avg: 0.265,
      obp: 0.330,
      power: 0.175,
    },
  }],
  [664023, {
    playerId: 664023,
    name: "T. Turner",
    team: "PHI",
    position: "SS",
    battingPosition: 1,
    handedness: 'R' as const,
    stats: {
      hits: 46,
      runs: 26,
      rbi: 20,
      slg: 0.450,
      avg: 0.285,
      obp: 0.340,
      power: 0.145,
    },
  }],
  [663728, {
    playerId: 663728,
    name: "A. Rutschman",
    team: "BAL",
    position: "C",
    battingPosition: 3,
    handedness: 'S' as const,
    stats: {
      hits: 40,
      runs: 24,
      rbi: 26,
      slg: 0.470,
      avg: 0.270,
      obp: 0.365,
      power: 0.160,
    },
  }],
  [666971, {
    playerId: 666971,
    name: "W. Smith",
    team: "LAD",
    position: "C",
    battingPosition: 5,
    handedness: 'R' as const,
    stats: {
      hits: 38,
      runs: 22,
      rbi: 26,
      slg: 0.490,
      avg: 0.270,
      obp: 0.355,
      power: 0.170,
    },
  }],
  [670541, {
    playerId: 670541,
    name: "B. Witt Jr.",
    team: "KC",
    position: "SS",
    battingPosition: 2,
    handedness: 'R' as const,
    stats: {
      hits: 50,
      runs: 30,
      rbi: 24,
      slg: 0.510,
      avg: 0.310,
      obp: 0.350,
      power: 0.170,
    },
  }],
  [682998, {
    playerId: 682998,
    name: "J. Jung",
    team: "TEX",
    position: "3B",
    battingPosition: 4,
    handedness: 'R' as const,
    stats: {
      hits: 40,
      runs: 22,
      rbi: 28,
      slg: 0.480,
      avg: 0.270,
      obp: 0.345,
      power: 0.165,
    },
  }],
  [677594, {
    playerId: 677594,
    name: "J. Rodriguez",
    team: "SEA",
    position: "CF",
    battingPosition: 3,
    handedness: 'R' as const,
    stats: {
      hits: 42,
      runs: 24,
      rbi: 26,
      slg: 0.495,
      avg: 0.275,
      obp: 0.340,
      power: 0.170,
    },
  }],
]);

// Mock matchup data
const MOCK_MATCHUPS = [
  {
    playerId: 660271,
    playerName: "Aaron Judge",
    team: "NYY",
    position: "RF",
    battingPosition: 4,
    pitcher: { name: "Framber Valdez", team: "HOU", handedness: "L" as const, era: 3.01 },
    rc: 38,
    confidence: 88,
  },
  {
    playerId: 592450,
    playerName: "Juan Soto",
    team: "NYM",
    position: "LF",
    battingPosition: 3,
    pitcher: { name: "Kevin Gausman", team: "TOR", handedness: "R" as const, era: 3.25 },
    rc: 42,
    confidence: 92,
  },
  {
    playerId: 608070,
    playerName: "B. Buxton",
    team: "MIN",
    position: "CF",
    battingPosition: 2,
    pitcher: { name: "Drew Rasmussen", team: "TB", handedness: "R" as const, era: 3.89 },
    rc: 35,
    confidence: 82,
  },
  {
    playerId: 543807,
    playerName: "B. Bichette",
    team: "BOS",
    position: "DH",
    battingPosition: 5,
    pitcher: { name: "Gerrit Cole", team: "NYY", handedness: "R" as const, era: 3.41 },
    rc: 40,
    confidence: 85,
  },
  {
    playerId: 665742,
    playerName: "J. Wood",
    team: "WAS",
    position: "LF",
    battingPosition: 3,
    pitcher: { name: "Camilo Doval", team: "SF", handedness: "R" as const, era: 3.55 },
    rc: 33,
    confidence: 78,
  },
  {
    playerId: 592885,
    playerName: "M. Betts",
    team: "LAD",
    position: "SS",
    battingPosition: 1,
    pitcher: { name: "Max Scherzer", team: "NYM", handedness: "R" as const, era: 3.42 },
    rc: 36,
    confidence: 80,
  },
  {
    playerId: 605141,
    playerName: "C. Raleigh",
    team: "SEA",
    position: "C",
    battingPosition: 6,
    pitcher: { name: "Pablo Lopez", team: "MIN", handedness: "R" as const, era: 3.71 },
    rc: 28,
    confidence: 72,
  },
  {
    playerId: 571970,
    playerName: "S. Ohtani",
    team: "LAD",
    position: "DH",
    battingPosition: 2,
    pitcher: { name: "Zac Gallen", team: "ARI", handedness: "R" as const, era: 3.65 },
    rc: 41,
    confidence: 89,
  },
  {
    playerId: 668939,
    playerName: "R. Acuna Jr.",
    team: "ATL",
    position: "RF",
    battingPosition: 1,
    pitcher: { name: "Sonny Gray", team: "STL", handedness: "R" as const, era: 3.68 },
    rc: 37,
    confidence: 84,
  },
  {
    playerId: 665487,
    playerName: "M. Olson",
    team: "ATL",
    position: "1B",
    battingPosition: 4,
    pitcher: { name: "Blake Snell", team: "SF", handedness: "L" as const, era: 3.12 },
    rc: 34,
    confidence: 79,
  },
  {
    playerId: 665489,
    playerName: "K. Tucker",
    team: "HOU",
    position: "LF",
    battingPosition: 3,
    pitcher: { name: "Zack Wheeler", team: "PHI", handedness: "R" as const, era: 2.98 },
    rc: 32,
    confidence: 76,
  },
  {
    playerId: 665862,
    playerName: "C. Carroll",
    team: "ARI",
    position: "CF",
    battingPosition: 1,
    pitcher: { name: "Yu Darvish", team: "SD", handedness: "R" as const, era: 3.45 },
    rc: 30,
    confidence: 73,
  },
  {
    playerId: 665750,
    playerName: "G. Henderson",
    team: "BAL",
    position: "SS",
    battingPosition: 2,
    pitcher: { name: "Nestor Cortes", team: "NYY", handedness: "L" as const, era: 3.62 },
    rc: 35,
    confidence: 81,
  },
  {
    playerId: 665861,
    playerName: "E. De La Cruz",
    team: "CIN",
    position: "SS",
    battingPosition: 3,
    pitcher: { name: "Miles Mikolas", team: "STL", handedness: "R" as const, era: 4.01 },
    rc: 29,
    confidence: 70,
  },
  {
    playerId: 664023,
    playerName: "T. Turner",
    team: "PHI",
    position: "SS",
    battingPosition: 1,
    pitcher: { name: "Marcus Stroman", team: "NYM", handedness: "R" as const, era: 3.78 },
    rc: 31,
    confidence: 74,
  },
  {
    playerId: 663728,
    playerName: "A. Rutschman",
    team: "BAL",
    position: "C",
    battingPosition: 3,
    pitcher: { name: "Tarik Skubal", team: "DET", handedness: "L" as const, era: 2.85 },
    rc: 36,
    confidence: 82,
  },
  {
    playerId: 666971,
    playerName: "W. Smith",
    team: "LAD",
    position: "C",
    battingPosition: 5,
    pitcher: { name: "Merrill Kelly", team: "ARI", handedness: "R" as const, era: 3.52 },
    rc: 33,
    confidence: 77,
  },
  {
    playerId: 670541,
    playerName: "B. Witt Jr.",
    team: "KC",
    position: "SS",
    battingPosition: 2,
    pitcher: { name: "Joe Ryan", team: "MIN", handedness: "R" as const, era: 3.45 },
    rc: 39,
    confidence: 86,
  },
  {
    playerId: 682998,
    playerName: "J. Jung",
    team: "TEX",
    position: "3B",
    battingPosition: 4,
    pitcher: { name: "Luis Castillo", team: "SEA", handedness: "R" as const, era: 3.38 },
    rc: 30,
    confidence: 72,
  },
  {
    playerId: 677594,
    playerName: "J. Rodriguez",
    team: "SEA",
    position: "CF",
    battingPosition: 3,
    pitcher: { name: "Shane Bieber", team: "CLE", handedness: "R" as const, era: 3.22 },
    rc: 34,
    confidence: 78,
  },
];

// Phase AP: findSavantHitter and enrichPicksWithSavant removed.
// Mock Savant data was causing player-specific scoring bias.
// Real Statcast data flows through statcastCache via rankAIPicks.

// ─── Pick Stability System ───────────────────────────────────────────────────
// Two lock modes:
//   'time'      — projected lineup: retained for 30 min, then re-evaluated
//   'confirmed' — official lineup:  retained permanently until game start
// Score buffer: if a pick drops ≤5 pts, keep it (any lock type).
// Score-change warning: if a confirmed pick drops >15 pts, flag it.
interface LockedPick {
  playerName: string;
  team: string;
  qualifiedAt: number;          // timestamp when first qualified
  lastScore: number;            // last known overallScore
  scoreAtLock: number;          // score when the pick was first locked
  lastRecommendedLine: number;  // last known recommended line
  lastRecommendedProb: number;  // last known recommended probability
  lineupSource: 'confirmed' | 'projected';
  lockType: 'time' | 'confirmed'; // 'confirmed' = permanent until game start
  gameTime: string | null;        // ISO game start time for expiry check
  // Phase BJ: snapshot of odds at confirmation time
  confirmedAt: number | null;           // ms timestamp when pick was first confirmed
  confirmedOdds: string | null;         // American odds at confirmation (e.g. "-115")
  confirmedOddsProvider: string | null; // bookmaker at confirmation
  lockReason: string | null;            // human-readable reason for lock
  pitcherId: number | null;             // pitcher id at lock time — for pitcher-change detection
  pitcherName: string | null;           // pitcher name at lock time
  gamePk: number | null;                // game pk for postponement detection
}

const PICK_LOCK_WINDOW_MS = 30 * 60 * 1000; // 30 minutes (time locks only)
const SCORE_BUFFER = 5;                       // allow 5-pt drop before removing
const SCORE_CHANGE_THRESHOLD = 15;            // flag confirmed picks that drop >15 pts
const GAME_GRACE_MS = 5 * 60 * 1000;         // keep picks 5 min after game start
const lockedPicksStore = new Map<string, LockedPick>();

// ─── Phase BJ: Strict Locked Board Store ─────────────────────────────────────
// Once a pick reaches 'confirmed' or 'final_official' status it is added here.
// The locked board is the source of truth between official pulls — new qualifying
// picks that cannot fit (board already full) are routed to laterQualifiers instead.
//
// Major-event invalidation rules (the ONLY reasons to remove a confirmed pick):
//   1. Player confirmed scratched / not in any lineup
//   2. Game postponed or cancelled
//   3. Probable pitcher changed (different pitcher id)
//   4. Sportsbook market removed (no odds data + was previously live)
//   5. Score drops ≥8 pts since lock (hard downgrade)
//   6. Injury flag detected in riskFlags
const MAX_BOARD_SIZE = 12; // maximum locked picks on the official board

interface LockedBoardEntry {
  pick: any;                    // full pick object at lock time
  lockedAt: number;             // ms timestamp
  lockPhase: SlatePhase;        // phase when locked
  confirmedOdds: string | null; // odds snapshot at lock time
  confirmedOddsProvider: string | null;
  pitcherId: number | null;     // pitcher id at lock time
  pitcherName: string | null;
  gamePk: number | null;
  scoreAtLock: number;          // overallScore at lock time
}

// The persistent locked board — survives between recalculations
const lockedBoardStore = new Map<string, LockedBoardEntry>(); // playerName → entry

/** Add or refresh a pick in the locked board */
function addToLockedBoard(pick: any, phase: SlatePhase, matchups: any[]): void {
  const existing = lockedBoardStore.get(pick.playerName);
  if (existing) return; // already locked — do not overwrite
  const matchup = matchups.find((m: any) => m.playerName === pick.playerName);
  lockedBoardStore.set(pick.playerName, {
    pick,
    lockedAt: Date.now(),
    lockPhase: phase,
    confirmedOdds: pick.bookOdds ?? null,
    confirmedOddsProvider: pick.bookOddsProvider ?? null,
    pitcherId: matchup?.pitcher?.id ?? null,
    pitcherName: matchup?.pitcher?.name ?? pick.pitcher ?? null,
    gamePk: matchup?.gamePk ?? null,
    scoreAtLock: pick.overallScore ?? 0,
  });
  console.log(`[BJ] Locked board: added ${pick.playerName} (score=${pick.overallScore}, phase=${phase})`);
}

/**
 * Phase BJ: Validate the locked board against current lineup/game state.
 * Removes picks that have a major invalidating event.
 * Returns the list of removed picks with reasons for UI display.
 */
function validateLockedBoard(
  currentMatchups: any[],
  currentScoreMap: Map<string, number>,
  games: any[],
): { removedName: string; reason: string }[] {
  const removed: { removedName: string; reason: string }[] = [];
  const allLineupNames = new Set(currentMatchups.map((m: any) => m.playerName));

  for (const [playerName, entry] of Array.from(lockedBoardStore.entries())) {
    let invalidateReason: string | null = null;

    // Rule 1: Player not in any lineup (confirmed scratch)
    if (!allLineupNames.has(playerName)) {
      invalidateReason = 'Player scratched from lineup';
    }

    // Rule 2: Game postponed or cancelled
    if (!invalidateReason && entry.gamePk !== null) {
      const game = games.find((g: any) => g.gamePk === entry.gamePk);
      if (game && (game.status === 'Postponed' || game.status === 'Cancelled' || game.status === 'Suspended')) {
        invalidateReason = `Game ${game.status.toLowerCase()}`;
      }
    }

    // Rule 3: Probable pitcher changed
    if (!invalidateReason && entry.pitcherId !== null) {
      const matchup = currentMatchups.find((m: any) => m.playerName === playerName);
      if (matchup?.pitcher?.id && matchup.pitcher.id !== entry.pitcherId) {
        invalidateReason = `Pitcher changed: ${entry.pitcherName} → ${matchup.pitcher.name}`;
      }
    }

    // Rule 4: Score drops ≥8 pts since lock (hard downgrade)
    if (!invalidateReason) {
      const currentScore = currentScoreMap.get(playerName);
      if (currentScore !== undefined && entry.scoreAtLock - currentScore >= 8) {
        invalidateReason = `Score dropped ${Math.round(entry.scoreAtLock - currentScore)} pts since lock`;
      }
    }

    // Rule 5: Injury flag in current pick riskFlags
    if (!invalidateReason) {
      const currentMatchup = currentMatchups.find((m: any) => m.playerName === playerName);
      const riskFlags: string[] = entry.pick?.riskFlags ?? [];
      if (riskFlags.some((f: string) => f.toLowerCase().includes('injur') || f.toLowerCase().includes('scratch') || f.toLowerCase().includes('dl') || f.toLowerCase().includes('il'))) {
        invalidateReason = 'Injury/IL flag detected';
      }
    }

    if (invalidateReason) {
      lockedBoardStore.delete(playerName);
      removed.push({ removedName: playerName, reason: invalidateReason });
      console.log(`[BJ] Locked board: removed ${playerName} — ${invalidateReason}`);
    }
  }
  return removed;
}

// ─── Official Pull Store ─────────────────────────────────────────────────────
// Diamond Edge uses a structured 3-pull system:
//   Pull #1 — Morning Initial  : first pull of the day (projected lineups, early odds)
//   Pull #2 — Midday (1 PM ET) : confirmed lineups, stabilized odds
//   Pull #3 — Final (7 PM ET)  : evening slate lock, final confirmations
//
// Between official pulls:
//   - Picks from the last official board stay visible
//   - Score drops ≤8 pts do NOT remove a pick
//   - Edge changes ≤2% do NOT trigger a reshuffle
//   - Only major events (scratch, 8+ score drop, pitcher change) override
//
// slatePhase labels:
//   'preliminary'    — before 1 PM ET (morning pull active)
//   'confirmed'      — 1–7 PM ET (midday pull active)
//   'final'          — after 7 PM ET (evening lock active)

type SlatePhase = 'preliminary' | 'confirmed' | 'final';

interface OfficialPullRecord {
  phase: SlatePhase;
  pulledAt: number;           // ms timestamp
  slateDate: string;          // YYYY-MM-DD ET date
  officialPicks: any[];       // the locked official board from this pull
  _restoredFromDb?: boolean;  // true if board was reloaded from DB on startup
}

let officialPullStore: OfficialPullRecord | null = null;

// Phase BP: Reload the official board from DB on startup so the board survives server restarts.
// This runs once at module load time. If today's DB has picks, we restore them as the frozen board.
(async () => {
  try {
    const db = await getDb();
    if (!db) return;
    const todayET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const rows = await db.select()
      .from(dailyResults)
      .where(and(eq(dailyResults.gameDate, todayET), eq(dailyResults.source, 'money')))
      .limit(50);
    if (rows.length > 0) {
      // Reconstruct a minimal officialPullRecord from DB rows so the board is frozen immediately
      const restoredPicks = rows.map(r => ({
        playerId: r.playerId,
        playerName: r.playerName,
        team: r.playerTeam,
        playerTeam: r.playerTeam,
        recommendedLine: parseFloat(r.line),
        hrrLine: parseFloat(r.line),
        recommendedProb: r.probability ?? 0,
        overProb: r.probability ?? 0,
        bookOdds: r.odds ? parseInt(r.odds, 10) : null,
        bookOddsProvider: r.oddsProvider ?? null,
        overallScore: r.matrixScore ?? 0,
        pickStatus: 'confirmed' as const,
        isEarlyLocked: false,
        gameLockTime: null,
        gameLockReason: null,
        tier: r.tier ?? null,
        // Minimal fields needed for Results grading
        _restoredFromDb: true,
      }));
      officialPullStore = {
        phase: 'confirmed',
        pulledAt: Date.now(),
        slateDate: todayET,
        officialPicks: restoredPicks,
      };
      console.log(`[aiPicks] Startup: restored ${restoredPicks.length} picks from DB for ${todayET}`);
    }
  } catch (err) {
    console.error('[aiPicks] Startup DB restore failed:', err);
  }
})();

// Phase BA: When enrichment warms after startup, reset the official board ONLY if it was
// restored from DB (cold placeholder data). If it was restored from DB, keep it frozen.
onEnrichmentWarm(() => {
  if (officialPullStore?._restoredFromDb as any) {
    // Board was restored from DB — keep it frozen, just bust the picks cache so
    // the next request re-enriches display fields (odds, edge) without rebuilding picks
    console.log('[aiPicks] Enrichment warm — keeping DB-restored board frozen, busting picks cache for re-enrichment');
    bustPicksCache();
    return;
  }
  console.log('[aiPicks] Enrichment warm detected — resetting official board for fresh build with real data');
  officialPullStore = null;
  bustPicksCache();
});

/** Return which pull phase applies right now (NDT time) */
function getSlatePhase(nowNDT: Date): SlatePhase {
  const h = nowNDT.getHours();
  const m = nowNDT.getMinutes();
  const totalMinutes = h * 60 + m;
  if (totalMinutes >= 19 * 60) return 'final';       // 7:00 PM NDT+
  if (totalMinutes >= 13 * 60) return 'confirmed';   // 1:00 PM NDT+
  return 'preliminary';                               // before 1 PM NDT
}

/** True if we should trigger a new official pull (phase boundary crossed or new day) */
function shouldTriggerOfficialPull(nowNDT: Date, slateDate: string): boolean {
  if (!officialPullStore) return true;                         // first pull of the day
  if (officialPullStore.slateDate !== slateDate) return true;  // new day
  const currentPhase = getSlatePhase(nowNDT);
  if (officialPullStore.phase !== currentPhase) return true;   // phase boundary crossed
  return false;
}

/** True if a pick is a major downgrade (scratch, 8+ score drop) */
function isMajorDowngrade(currentScore: number, scoreAtLock: number): boolean {
  return scoreAtLock - currentScore >= 8;
}

// ─── Game-Specific Lock Store ─────────────────────────────────────────────────
// Each game tracks its own readiness and lock state independently.
// Early confirmed games can lock BEFORE the scheduled 1PM/7PM pull windows.
//
// Lock conditions (ALL must be true):
//   1. Official lineup confirmed
//   2. 30 minutes elapsed since lineup confirmation
//   3. Sportsbook odds loaded
//   4. Enrichment data available
//   5. Matrix score stable (no major downgrade in last 30 min)
//   6. Game within 90 minutes of first pitch (early-lock trigger)

const LINEUP_STABILIZATION_MS = 15 * 60 * 1000; // 15 min after lineup confirmed → pick locks
const EARLY_LOCK_WINDOW_MS = 90 * 60 * 1000;    // also lock when within 90 min of first pitch (whichever comes first)

interface GameLockRecord {
  gameId: string;           // e.g. "TOR@DET"
  firstPitchMs: number;     // UTC ms of first pitch
  lineupConfirmedAt: number | null;  // UTC ms when lineup was confirmed
  isLocked: boolean;
  lockedAt: number | null;  // UTC ms when game was locked
  lockReason: 'early_auto_lock' | 'scheduled_pull' | null;
  scoreAtLock: Map<string, number>; // playerName → score at lock time
}

// In-memory store: gameId → lock record
const gameLockStore = new Map<string, GameLockRecord>();

/** Register or update a game in the lock store */
function upsertGameLock(gameId: string, firstPitchMs: number, lineupSource: 'confirmed' | 'projected'): void {
  const existing = gameLockStore.get(gameId);
  const nowMs = Date.now();
  if (!existing) {
    gameLockStore.set(gameId, {
      gameId,
      firstPitchMs,
      lineupConfirmedAt: lineupSource === 'confirmed' ? nowMs : null,
      isLocked: false,
      lockedAt: null,
      lockReason: null,
      scoreAtLock: new Map(),
    });
  } else {
    // Update first pitch time in case it changed
    existing.firstPitchMs = firstPitchMs;
    // Record when lineup first became confirmed
    if (lineupSource === 'confirmed' && existing.lineupConfirmedAt === null) {
      existing.lineupConfirmedAt = nowMs;
    }
  }
}

/** Check if a game is ready for early auto-lock */
function isGameReadyForEarlyLock(
  gameId: string,
  hasOdds: boolean,
  hasEnrichment: boolean,
): boolean {
  const record = gameLockStore.get(gameId);
  if (!record) return false;
  if (record.isLocked) return false; // already locked

  const nowMs = Date.now();
  const msToFirstPitch = record.firstPitchMs - nowMs;

  // Must be within 90 min of first pitch
  if (msToFirstPitch > EARLY_LOCK_WINDOW_MS) return false;
  // Game must not have already started
  if (msToFirstPitch < -GAME_GRACE_MS) return false;

  // Lineup must be confirmed
  if (record.lineupConfirmedAt === null) return false;

  // 30-min stabilization window must have elapsed
  const stabilizationElapsed = nowMs - record.lineupConfirmedAt >= LINEUP_STABILIZATION_MS;
  if (!stabilizationElapsed) return false;

  // Odds and enrichment must be available
  if (!hasOdds || !hasEnrichment) return false;

  return true;
}

/** Lock a game and record scores at lock time */
function lockGame(gameId: string, picks: any[], reason: 'early_auto_lock' | 'scheduled_pull'): void {
  const record = gameLockStore.get(gameId);
  if (!record) return;
  record.isLocked = true;
  record.lockedAt = Date.now();
  record.lockReason = reason;
  for (const pick of picks) {
    record.scoreAtLock.set(pick.playerName, pick.overallScore ?? 0);
  }
}

/** Phase AX: Game lock records are never cleaned — picks stay permanently */
function cleanExpiredGameLocks(_nowMs: number): void {
  // No-op: picks are never removed due to game start
}

/** Phase AX: Locked picks are never expired — all plays stay on the board */
function cleanExpiredLocks(_nowMs: number) {
  // No-op: picks are never removed due to game start or lock expiry
}

export const aiPicksRouter = router({
  /**
   * Get TOP 5 picks - independently scored using combined Savant + Ballpark data
   * These may differ from All Plays since they use different scoring weights
   */
  getTopPicks: publicProcedure.query(async () => {
    try {
      // Only use real lineup data - no mock fallback
      const lineupData = await getAdaptedLineupData();
      const dataDate = await getDataDate();

      // Get enrichment data early (lineup + Statcast + VS grades + bullpen)
      const enrichment = await getEnrichmentData(
        lineupData.matchups.map(m => ({
          playerId: m.playerId,
          playerName: m.playerName,
          team: m.team,
          gameTime: m.gameTime,
          pitcherId: m.pitcher.id ?? null,
          pitcherHand: m.pitcher.handedness ?? null,
        }))
      ).catch(() => ({
        vsGradeMap: new Map<string, number>(),
        gameTotalsMap: new Map(),
        dayNightSplitsMap: new Map(),
        mlbStreakMap: new Map(),
        statcastCache: { data: new Map(), byId: new Map(), fetchedAt: Date.now(), year: new Date().getFullYear() },
        bullpenFatigueMap: new Map(),
        fetchedAt: Date.now(),
        isWarm: false,
      }));
      const { vsGradeMap, gameTotalsMap, dayNightSplitsMap, mlbStreakMap, statcastCache, bullpenFatigueMap } = enrichment as any;

      const matchups = lineupData.matchups;
      const players = lineupData.playerDataMap;

      if (matchups.length === 0) {
        return {
          success: true,
          picks: [],
          lineupsPending: true,
          dataDate,
          timestamp: new Date(),
        };
      }

      const hrTargetsMap = getMockHRTargets();

      const allPicks = rankAIPicks(
        matchups,
        players,
        hrTargetsMap,
        getMockParkFactors(),
        dayNightSplitsMap,
        mlbStreakMap,
        vsGradeMap,
        gameTotalsMap,
        statcastCache,
        undefined, // ballparkMatchups (legacy)
        bullpenFatigueMap ?? new Map(),
        undefined, // edgeScoreMap
        lineupData.lineupSource // lower thresholds for projected lineups
      );
      
      // Phase AP: mock Savant enrichment removed — picks use real statcastCache data from rankAIPicks
      const enrichedPicks = allPicks;
      
      // Re-sort by combinedScore (Savant + Ballpark) for top picks
      // Stat priority tiebreaker: Hits > Runs > RBI (RBI is riskiest)
      const STAT_SORT_PRIORITY: Record<string, number> = { hits: 3, runs: 2, rbi: 1, slg: 0 };
      const topPicks = [...enrichedPicks]
        .sort((a, b) => {
          const scoreDiff = (b.combinedScore || b.overallScore) - (a.combinedScore || a.overallScore);
          if (Math.abs(scoreDiff) < 3) {
            // Within 3 points, prefer by stat priority
            return (STAT_SORT_PRIORITY[b.statType] || 0) - (STAT_SORT_PRIORITY[a.statType] || 0);
          }
          return scoreDiff;
        })
        .slice(0, 10)
        .map((pick, idx) => ({ ...pick, rank: idx + 1 }));
      
      return {
        success: true,
        picks: topPicks,
        lineupSource: lineupData.lineupSource,
        dataDate,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error("Error generating top picks:", error);
      const fallbackDate = await getDataDate();
      return {
        success: false,
        picks: [],
        dataDate: fallbackDate,
        error: "Failed to generate top picks",
        timestamp: new Date(),
      };
    }
  }),

  /**
   * Get comprehensive AI picks for today (All Plays - 15-20 picks)
   * Uses all data sources: RC, player stats, park factors, HR Targets, pitcher matchup, batting position + Savant
   */
  getComprehensivePicks: publicProcedure.query(async () => {
    try {
      // Only use real lineup data - no mock fallback
      const lineupData = await getAdaptedLineupData();
      const dataDate = await getDataDate();

      // Get enrichment data early (lineup + Statcast + VS grades + bullpen)
      const enrichment2 = await getEnrichmentData(
        lineupData.matchups.map(m => ({
          playerId: m.playerId,
          playerName: m.playerName,
          team: m.team,
          gameTime: m.gameTime,
          pitcherId: m.pitcher.id ?? null,
          pitcherHand: m.pitcher.handedness ?? null,
        }))
      ).catch(() => ({
        vsGradeMap: new Map<string, number>(),
        gameTotalsMap: new Map(),
        dayNightSplitsMap: new Map(),
        mlbStreakMap: new Map(),
        statcastCache: { data: new Map(), byId: new Map(), fetchedAt: Date.now(), year: new Date().getFullYear() },
        bullpenFatigueMap: new Map(),
        fetchedAt: Date.now(),
        isWarm: false,
      }));
      const { vsGradeMap, gameTotalsMap, dayNightSplitsMap, mlbStreakMap, statcastCache: statcastCache2, bullpenFatigueMap: bullpenFatigueMap2 } = enrichment2 as any;

      const matchups = lineupData.matchups;
      const players = lineupData.playerDataMap;

      if (matchups.length === 0) {
        return {
          success: true,
          picks: [],
          lineupsPending: true,
          dataDate,
          timestamp: new Date(),
        };
      }

      const hrTargetsMap2 = getMockHRTargets();

      const picks = rankAIPicks(
        matchups,
        players,
        hrTargetsMap2,
        getMockParkFactors(),
        dayNightSplitsMap,
        mlbStreakMap,
        vsGradeMap,
        gameTotalsMap,
        statcastCache2,
        undefined, // ballparkMatchups (legacy)
        bullpenFatigueMap2 ?? new Map(),
        undefined, // edgeScoreMap
        lineupData.lineupSource // lower thresholds for projected lineups
      );
      
      // Enrich all picks with Savant data
      // Phase AP: mock Savant enrichment removed
      const enrichedPicks = picks;
      
      // Re-sort with stat priority tiebreaker: Hits > Runs > RBI (RBI is riskiest)
      const STAT_SORT_PRIORITY_ALL: Record<string, number> = { hits: 3, runs: 2, rbi: 1, slg: 0 };
      const sortedPicks = [...enrichedPicks]
        .sort((a, b) => {
          const scoreDiff = (b.combinedScore || b.overallScore) - (a.combinedScore || a.overallScore);
          if (Math.abs(scoreDiff) < 3) {
            return (STAT_SORT_PRIORITY_ALL[b.statType] || 0) - (STAT_SORT_PRIORITY_ALL[a.statType] || 0);
          }
          return scoreDiff;
        })
        .map((pick, idx) => ({ ...pick, rank: idx + 1 }));

      return {
        success: true,
        picks: sortedPicks,
        lineupSource: lineupData.lineupSource,
        dataDate,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error("Error generating AI picks:", error);
      const fallbackDate = await getDataDate();
      return {
        success: false,
        picks: [],
        dataDate: fallbackDate,
        error: "Failed to generate AI picks",
        timestamp: new Date(),
      };
    }
  }),

  /**
   * Get HRR Combined Props - dedicated endpoint with real stat-based calculations
   * Uses per-game averages from season stats, park factors, batting position, and recent form
   * Ranked by HRR-specific probability (not general AI pick order)
   */
  getHRRPicks: publicProcedure.query(async () => {
    try {
      // Only use real lineup data - no mock fallback
      const lineupData = await getAdaptedLineupData();
      const dataDate = await getDataDate();

      // Get enrichment data early (lineup + Statcast + VS grades + bullpen)
      const enrichment3 = await getEnrichmentData(
        lineupData.matchups.map(m => ({ playerId: m.playerId, playerName: m.playerName, team: m.team, gameTime: m.gameTime, pitcherId: m.pitcher.id ?? null, pitcherHand: m.pitcher.handedness ?? null }))
      ).catch(() => ({
        vsGradeMap: new Map<string, number>(),
        gameTotalsMap: new Map(),
        dayNightSplitsMap: new Map(),
        mlbStreakMap: new Map(),
        statcastCache: { data: new Map(), byId: new Map(), fetchedAt: Date.now(), year: new Date().getFullYear() },
        bullpenFatigueMap: new Map(),
        fetchedAt: Date.now(),
        isWarm: false,
      }));
      const { vsGradeMap, gameTotalsMap: _gameTotalsMap3, dayNightSplitsMap, mlbStreakMap, statcastCache: statcastCache3, bullpenFatigueMap: bullpenFatigueMap3 } = enrichment3 as any;

      const matchups = lineupData.matchups;
      const players = lineupData.playerDataMap;

      if (matchups.length === 0) {
        return {
          success: true,
          picks: [],
          lineupsPending: true,
          dataDate,
          timestamp: new Date(),
          hasOddsData: false,
        };
      }

      // Get park factors
      const parkFactors = getMockParkFactors();

      // Phase AP: Build barrel threat map from REAL statcastCache (no mock data)
      const savantMap = new Map<string, { xwOBA: number; hardHitPct: number; exitVelocity: number; barrelPct: number }>();
      const scData = (statcastCache3 as any)?.data;
      if (scData && scData.size > 0) {
        for (const [, entry] of scData) {
          const pName = (entry as any).player_name ?? (entry as any).playerName;
          if (pName) {
            savantMap.set(pName, {
              xwOBA: (entry as any).xwoba ?? 0,
              hardHitPct: (entry as any).hard_hit_percent ?? 0,
              exitVelocity: (entry as any).launch_speed ?? 0,
              barrelPct: (entry as any).barrel_batted_rate ?? 0,
            });
          }
        }
      }

      // Filter matchups through VS gate before HRR projections
      // Phase BB: Thresholds aligned with hrrPicksService.ts (5.0/3.5) for consistent board sizing.
      // MODERATE secondary check relaxed: default true when no ERA data, barrel threshold lowered to 6.0.
      const HRR_STRONG_THRESHOLD = 5.0;   // was 6.0
      const HRR_MODERATE_THRESHOLD = 3.5; // was 4.5
      // Phase BA fix: skip VS gate when vsGradeMap is empty or all neutral (5.0 fallback)
      const allNeutral3 = vsGradeMap.size > 0 && Array.from(vsGradeMap.values()).every(v => v === 5.0);
      const skipVsGate3 = vsGradeMap.size === 0 || allNeutral3;

      const gatedMatchups = skipVsGate3
        ? matchups
        : matchups.filter(m => {
            const vsScore = vsGradeMap.get(m.playerName) ?? null;
            if (vsScore === null) return true; // no entry = neutral, let through
            if (vsScore >= HRR_STRONG_THRESHOLD) return true;
            if (vsScore >= HRR_MODERATE_THRESHOLD) {
              const playerData = players.get(m.playerId);
              const batterHand = playerData?.handedness ?? 'R';
              const pitcherHand = m.pitcher?.handedness ?? 'R';
              const hasPlatoonAdvantage = batterHand !== pitcherHand;
              const pitcherERA = m.pitcher?.era ?? null;
              const pitcherIsVulnerable = pitcherERA !== null ? pitcherERA >= 4.00 : true; // default true when no ERA data
              const savantEntry = savantMap.get(m.playerName);
              const isBarrelThreat = savantEntry ? savantEntry.barrelPct >= 6.0 : false; // lowered from 8.0
              const isPrimeLineupSpot = m.battingPosition !== undefined && m.battingPosition <= 5;
              return hasPlatoonAdvantage || pitcherIsVulnerable || isBarrelThreat || isPrimeLineupSpot;
            }
            return false;
          });

      console.log(`[HRR] VS Gate (internal mlbMatchup, STRONG>=${HRR_STRONG_THRESHOLD}, MOD>=${HRR_MODERATE_THRESHOLD}): ${matchups.length} → ${gatedMatchups.length} matchups passed`);

      // ── STAGE 1: Run the 10-factor scoring matrix on all VS-gated players ──────
      // Every pick on every tab must pass through rankAIPicks first.
      const { gameTotalsMap } = enrichment3;

      const hrTargetsMap3 = getMockHRTargets();

      const matrixPicks = rankAIPicks(
        gatedMatchups,
        players,
        hrTargetsMap3,
        parkFactors,
        dayNightSplitsMap,
        mlbStreakMap,
        vsGradeMap,
        gameTotalsMap,
        statcastCache3,
        undefined, // ballparkMatchups (legacy)
        bullpenFatigueMap3 ?? new Map()
      );

      console.log(`[HRR] Matrix scored: ${matrixPicks.length} picks`);

      // ── STAGE 2: Generate HRR projections for matrix-ranked players ───────────
      // Use the matrix-ranked player list to drive HRR projections.
      // This ensures the same VS gate + matrix ranking applies to HRR/Money Picks.
      const matrixPlayerNames = new Set(matrixPicks.map(p => p.playerName));
      const matrixGatedMatchups = gatedMatchups.filter(m => matrixPlayerNames.has(m.playerName));

      const projections = generateHRRProjections(
        matrixGatedMatchups,
        players,
        parkFactors,
        savantMap,
        dayNightSplitsMap,
        mlbStreakMap
      );

      // ── STAGE 3: Enrich with Poisson probabilities + matrix scores ────────────
      const enrichedPicks = projections.map((proj) => {
        // Find the corresponding matrix pick for this player
        const matrixPick = matrixPicks.find(p => p.playerName === proj.playerName);

        // Lambda = expected HRR total per game (from our model)
        const lambda = proj.expectedTotal;
        const activeLine = proj.hrrLine;

        // Calculate Poisson probability of going OVER the active line
        const modelOverProb = poissonOverProbability(activeLine, lambda);

        // No book odds — use model probability only
        const bookImpliedProb = 0.5;
        const edge = calculateEdge(modelOverProb, bookImpliedProb);
        const pickQuality = getPickQuality(edge);

        // Generate alternate lines with probabilities
        const alternates = calculateAlternateLines(lambda, 5.5);

        // Find the fair line (closest to 50/50)
        const fairLine = findFairLine(lambda);

        return {
          ...proj,
          hrrLine: activeLine,
          lineSource: "model" as const,
          // Matrix scores (from 10-factor scoring pipeline)
          overallScore: matrixPick?.overallScore ?? proj.hrrConfidence,
          baseScore: matrixPick?.baseScore,
          factorBreakdown: matrixPick?.factorBreakdown,
          vsGrade: matrixPick?.vsGrade,
          gameTotalOU: matrixPick?.gameTotalOU,
          primePosition: matrixPick?.primePosition,
          primePositionFactors: matrixPick?.primePositionFactors,
          // Phase R: structured reasons, risk flags, grade, BP boost
          reasons: matrixPick?.reasons ?? [],
          riskFlags: matrixPick?.riskFlags ?? [],
          grade: matrixPick?.grade ?? 'strong',
          bpBoost: matrixPick?.bpBoost ?? 0,
          // Poisson-based probabilities
          overProbability: Math.round(modelOverProb * 100),
          // Edge vs book
          edge: Math.round(edge * 100), // as percentage points
          pickQuality,
          bookOdds: null,
          bookOddsProvider: null,
          bookImpliedProb: null,
          // Alternate lines
          alternateLines: alternates.map(alt => ({
            line: alt.line,
            overProb: Math.round(alt.overProb * 100),
            underProb: Math.round(alt.underProb * 100),
          })),
          fairLine,
          // Expected value (lambda)
          expectedTotal: Math.round(lambda * 10) / 10,
        };
      });

      // ── STAGE 3b: No expiry — all picks kept regardless of game start time ───────
      // Phase AX: Picks are NEVER removed due to game start. All plays stay on the board.
      const nowMs3 = Date.now();
      const preGamePicks3 = enrichedPicks;

      // ── STAGE 3c: Money picks selection — use shared cached board from hrrPicksService ──
      // Phase BC: getEnrichedMoneyPicks() is the single source of truth for moneyPicks.
      // This ensures all devices see the same board regardless of enrichment timing.
      // The local enrichedPicks pipeline still runs for the All Plays tab.
      const hrrCachedResult = await getEnrichedMoneyPicks();
      const qualifyingPicks3: any[] = hrrCachedResult.moneyPicks.map((pick: any) => ({
        ...pick,
        recommendedLine: pick.recommendedLine ?? pick.fairLine ?? pick.hrrLine ?? 1.5,
        recommendedProb: pick.recommendedProb ?? pick.overProbability ?? 55,
      }));

      // ── STAGE 3d: Official Pull Store — 3-pull stability system + Early Auto-Lock ─────
      // Determine current NDT time and slate phase
      const nowET3 = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/St_Johns' }));
      // Phase BN fix: use ET (America/New_York) for the DB date key to match getDataDate() in results.ts
      // NDT is UTC-2:30, ET is UTC-4; using NDT here caused date mismatches around midnight
      const nowET3_forDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const todayETDate3 = `${nowET3_forDate.getFullYear()}-${String(nowET3_forDate.getMonth() + 1).padStart(2, '0')}-${String(nowET3_forDate.getDate()).padStart(2, '0')}`;
      const currentSlatePhase: SlatePhase = getSlatePhase(nowET3);
      const currentLineupSource = lineupData.lineupSource;

      // Determine enrichment readiness for early-lock checks
      const hasOdds3 = (enrichment3 as any).isWarm === true;
      const hasEnrichment3 = (enrichment3 as any).statcastCache?.data?.size > 0;

      // Register all games in the game lock store and check for early auto-lock
      const games3ForLock = await getGamesForUI();
      cleanExpiredGameLocks(nowMs3);
      const earlyLockedGameIds = new Set<string>();

      for (const game of games3ForLock) {
        const gameId = `${game.awayTeam}@${game.homeTeam}`;
        const firstPitchMs = game.gameDate ? new Date(game.gameDate).getTime() : 0;
        if (!firstPitchMs) continue;

        const gameLineupSource: 'confirmed' | 'projected' =
          game.lineupSource === 'confirmed' ? 'confirmed' : 'projected';

        upsertGameLock(gameId, firstPitchMs, gameLineupSource);

        // Check if this game qualifies for early auto-lock
        if (isGameReadyForEarlyLock(gameId, hasOdds3, hasEnrichment3)) {
          const picksForGame = qualifyingPicks3.filter((p: any) => p.team === game.homeTeam || p.team === game.awayTeam);
          lockGame(gameId, picksForGame, 'early_auto_lock');
          earlyLockedGameIds.add(gameId);
          console.log(`[HRRPicks] Early auto-lock triggered for ${gameId} (first pitch in ${Math.round((firstPitchMs - nowMs3) / 60000)} min)`);
        }
      }

      // Also run the per-pick confirmed-lineup lock for game-start expiry
      cleanExpiredLocks(nowMs3);

      // Decide whether to issue a new official pull or serve the existing board
      // Phase BQ: Never trigger an official pull if the board is hard-locked.
      // Force Refresh (clearPickLocks) clears the hard lock if the user wants to update.
      const isNewOfficialPull = !isBoardHardLocked() && shouldTriggerOfficialPull(nowET3, todayETDate3);

      let moneyPicks3: any[];

      if (isNewOfficialPull) {
        // ── NEW OFFICIAL PULL: build fresh board from top-ranked picks ──────────────
        console.log(`[HRRPicks] Official pull triggered — phase: ${currentSlatePhase}`);

        // Register all new qualifying picks in the per-pick lock store
        for (const pick of qualifyingPicks3 as any[]) {
          const existing = lockedPicksStore.get(pick.playerName);
          const newLockType: 'time' | 'confirmed' =
            currentLineupSource === 'confirmed' ? 'confirmed' : (existing?.lockType ?? 'time');
          const matchupForPick = lineupData.matchups.find((m: any) => m.playerName === pick.playerName);
          lockedPicksStore.set(pick.playerName, {
            playerName: pick.playerName,
            team: pick.team,
            qualifiedAt: existing?.qualifiedAt ?? nowMs3,
            lastScore: pick.overallScore ?? 0,
            scoreAtLock: existing?.scoreAtLock ?? (pick.overallScore ?? 0),
            lastRecommendedLine: pick.recommendedLine,
            lastRecommendedProb: pick.recommendedProb,
            lineupSource: currentLineupSource,
            lockType: newLockType,
            gameTime: pick.gameTime ?? existing?.gameTime ?? null,
            // Phase BJ: snapshot fields
            confirmedAt: existing?.confirmedAt ?? (newLockType === 'confirmed' ? nowMs3 : null),
            confirmedOdds: existing?.confirmedOdds ?? (newLockType === 'confirmed' ? (pick.bookOdds ?? null) : null),
            confirmedOddsProvider: existing?.confirmedOddsProvider ?? (newLockType === 'confirmed' ? (pick.bookOddsProvider ?? null) : null),
            lockReason: newLockType === 'confirmed' ? 'Official lineup confirmed' : 'Preliminary — projected lineup',
            pitcherId: matchupForPick?.pitcher?.id ?? existing?.pitcherId ?? null,
            pitcherName: matchupForPick?.pitcher?.name ?? pick.pitcher ?? existing?.pitcherName ?? null,
            gamePk: matchupForPick?.gamePk ?? existing?.gamePk ?? null,
          });
        }

         // Phase BR: Per-game stage engine — each pick's stage is driven by its own game's
        // lineup post time and first pitch, not the global slate phase.
        // Stages: preliminary → confirmed (lineup posted) → locked (15 min after lineup OR first pitch)
        const nowMsForStatus = Date.now();
        moneyPicks3 = qualifyingPicks3.map((p: any) => {
          const matchedGame3 = games3ForLock.find((g: any) => g.homeTeam === p.team || g.awayTeam === p.team);
          const gameId3 = matchedGame3
            ? `${matchedGame3.awayTeam}@${matchedGame3.homeTeam}`
            : null;
          const gameLock3 = gameId3 ? gameLockStore.get(gameId3) : null;
          const isEarlyLocked = gameId3 ? earlyLockedGameIds.has(gameId3) : false;

          // Per-game stage logic:
          // 1. LOCKED: game is in gameLockStore and isLocked, OR within 90 min of first pitch with lineup confirmed
          // 2. CONFIRMED: lineup has been posted for this game (lineupConfirmedAt is set)
          // 3. PRELIMINARY: no lineup yet
          let pickStatus: 'preliminary' | 'confirmed' | 'locked';
          if (gameLock3?.isLocked || isEarlyLocked) {
            pickStatus = 'locked';
          } else if (gameLock3?.lineupConfirmedAt !== null && gameLock3?.lineupConfirmedAt !== undefined) {
            // Lineup is confirmed — check if 15 min stabilization has elapsed
            const msSinceLineup = nowMsForStatus - gameLock3.lineupConfirmedAt;
            const minsToFirstPitch = gameLock3.firstPitchMs
              ? Math.round((gameLock3.firstPitchMs - nowMsForStatus) / 60000)
              : 999;
            if (msSinceLineup >= LINEUP_STABILIZATION_MS || minsToFirstPitch <= 15) {
              // 15 min elapsed since lineup OR within 15 min of first pitch → lock
              pickStatus = 'locked';
              // Trigger the lock in gameLockStore if not already locked
              if (gameId3 && gameLock3 && !gameLock3.isLocked) {
                lockGame(gameId3, qualifyingPicks3.filter((q: any) => {
                  const qGame = games3ForLock.find((g: any) => g.homeTeam === q.team || g.awayTeam === q.team);
                  return qGame && `${qGame.awayTeam}@${qGame.homeTeam}` === gameId3;
                }), 'early_auto_lock');
              }
            } else {
              pickStatus = 'confirmed';
            }
          } else if (p.lineupSource === 'confirmed' || currentSlatePhase !== 'preliminary') {
            // Fallback: if lineup source is confirmed but no gameLock record yet, treat as confirmed
            pickStatus = 'confirmed';
          } else {
            pickStatus = 'preliminary';
          }

          return {
            ...p,
            pickStatus,
            isEarlyLocked,
            gameLockTime: gameLock3?.lockedAt ? new Date(gameLock3.lockedAt).toISOString() : null,
            gameLockReason: gameLock3?.lockReason ?? null,
            lastUpdated: new Date().toISOString(),
          };
        });

        // Phase BA fix: never save an empty board as the official pull.
        // If the new build produced 0 picks (e.g. enrichment hiccup), keep the previous board.
        if (moneyPicks3.length > 0) {
          officialPullStore = {
            phase: currentSlatePhase,
            pulledAt: nowMs3,
            slateDate: todayETDate3,
            officialPicks: moneyPicks3,
          };
          console.log(`[HRRPicks] Official board saved: ${moneyPicks3.length} picks (phase=${currentSlatePhase}, earlyLocked=${earlyLockedGameIds.size} games)`);
          // Phase BQ: Set hard lock after the official board is saved.
          // This prevents any subsequent scheduled pull from overwriting the board.
          // Force Refresh (clearPickLocks) can clear this lock if needed.
          setHardLock(todayETDate3);
          // Phase BS: Persist versioned pick snapshots — INSERT IGNORE so confirmed picks are never overwritten
          void (async () => {
            try {
              const nowTs = new Date();
              const boardPhase = currentSlatePhase === 'final'
                ? 'EVENING_CONFIRMED'
                : currentSlatePhase === 'confirmed'
                ? 'MIDDAY_CONFIRMED'
                : 'PRELIMINARY';
              for (const p of moneyPicks3 as any[]) {
                const pickId = `${todayETDate3}_${p.playerId}_hrr`;
                const isEarlyLocked = earlyLockedGameIds.has(
                  (() => {
                    const g = games3ForLock.find((g: any) => g.homeTeam === p.team || g.awayTeam === p.team);
                    return g ? `${g.awayTeam}@${g.homeTeam}` : '';
                  })()
                );
                const snapshotStatus = isEarlyLocked
                  ? 'early_locked'
                  : boardPhase === 'EVENING_CONFIRMED'
                  ? 'evening_confirmed'
                  : boardPhase === 'MIDDAY_CONFIRMED'
                  ? 'confirmed'
                  : 'preliminary';
                await insertPickSnapshotIfNew({
                  pickId,
                  gameDate: todayETDate3,
                  playerId: p.playerId,
                  playerName: p.playerName,
                  playerTeam: p.team ?? p.playerTeam ?? '',
                  gameId: String(p.gamePk ?? p.gameId ?? ''),
                  market: 'hrr',
                  recommendedLine: String(p.recommendedLine ?? p.hrrLine ?? 'O1.5'),
                  confirmedOdds: p.bookOdds ?? null,
                  currentOdds: p.bookOdds ?? null,
                  edge: p.edge != null ? Math.round(p.edge) : null,
                  matrixScore: p.overallScore != null ? Math.round(p.overallScore) : null,
                  probability: p.recommendedProb != null ? Math.round(p.recommendedProb) : null,
                  tier: p.overallScore >= 83 ? 'Elite' : p.overallScore >= 74 ? 'Strong' : p.overallScore >= 68 ? 'A' : 'Lean',
                  boardPhase,
                  pickStatus: snapshotStatus as any,
                  confirmedAt: nowTs,
                  voidedAt: null,
                  voidReason: null,
                  actualValue: null,
                  result: 'pending',
                  gradedAt: null,
                });
                // Also update currentOdds if pick already exists (non-destructive)
                if (p.bookOdds != null) {
                  await updatePickSnapshotOdds(pickId, p.bookOdds);
                }
              }
              console.log(`[HRRPicks] Phase BS: ${moneyPicks3.length} pick snapshots saved/updated for ${todayETDate3}`);
            } catch (err) {
              console.error('[HRRPicks] Phase BS: Failed to save pick snapshots:', err);
            }
          })();
          // Phase BN: Persist the official board to DB so Results tab always mirrors Money Picks exactly
          void (async () => {
            try {
              const db = await getDb();
              if (!db) return;
              const rows = moneyPicks3.map((p: any) => ({
                gameDate: todayETDate3,
                playerId: p.playerId,
                playerName: p.playerName,
                playerTeam: p.team ?? p.playerTeam ?? "",
                statType: "hrr" as const,
                source: "money" as const,
                line: String(p.recommendedLine ?? p.hrrLine ?? 1.5),
                probability: Math.round(p.recommendedProb ?? p.overProb ?? 0),
                actualValue: null,
                result: "pending" as const,
                odds: p.bookOdds != null ? String(p.bookOdds) : null,
                oddsProvider: p.bookOddsProvider ?? null,
                streakLabel: null,
                dayNightLabel: null,
                tier: p.overallScore >= 83 ? "S" : p.overallScore >= 74 ? "A" : p.overallScore >= 68 ? "Lean" : null,
                edge: null,
                closingLineValue: null,
                matrixScore: p.overallScore ?? null,
              }));
              // Phase BP: Only replace DB rows if the new board has MORE picks than what's already stored.
              // This prevents a later smaller pull from overwriting a larger earlier board.
              // Also never delete rows that have already been graded (result != 'pending').
              const existingRows = await db.select({ id: dailyResults.id, result: dailyResults.result })
                .from(dailyResults)
                .where(and(eq(dailyResults.gameDate, todayETDate3), eq(dailyResults.source, "money")));
              const existingPendingCount = existingRows.filter(r => r.result === 'pending').length;
              const existingGradedCount = existingRows.filter(r => r.result !== 'pending').length;
              if (rows.length > existingPendingCount || existingPendingCount === 0) {
                // New board is larger (or DB is empty) — safe to replace pending rows
                if (existingPendingCount > 0) {
                  await db.delete(dailyResults)
                    .where(and(eq(dailyResults.gameDate, todayETDate3), eq(dailyResults.source, "money"), eq(dailyResults.result, "pending")));
                }
                if (rows.length > 0) {
                  await db.insert(dailyResults).values(rows);
                }
                console.log(`[HRRPicks] Persisted ${rows.length} picks to DB for ${todayETDate3} (replaced ${existingPendingCount} pending, kept ${existingGradedCount} graded)`);
              } else {
                console.log(`[HRRPicks] Skipped DB overwrite: existing ${existingPendingCount} pending rows >= new ${rows.length} picks (${existingGradedCount} already graded)`);
              }
            } catch (err) {
              console.error("[HRRPicks] Failed to persist picks to DB:", err);
            }
          })();
        } else if (officialPullStore?.officialPicks?.length) {
          moneyPicks3 = officialPullStore.officialPicks;
          console.warn(`[HRRPicks] New official pull returned 0 picks — keeping previous board (${moneyPicks3.length} picks)`);
        } else {
          console.warn(`[HRRPicks] New official pull returned 0 picks and no previous board exists`);
        }

      } else {
        // ── BETWEEN OFFICIAL PULLS: serve FROZEN board ─────────────────────────────
        // Phase BP: The official board is FROZEN once saved. No picks are ever removed.
        // The only changes allowed between pulls are:
        //   - Update displayed odds/edge (cosmetic only, does not change pick list)
        //   - Promote preliminary picks to confirmed if their game has been early-locked
        // Picks are NEVER removed because:
        //   - lineupData.matchups only contains PRE-GAME players; once a game starts,
        //     those players disappear from matchups even though they're still playing.
        //   - Score drops are unreliable mid-day as enrichment data refreshes.
        const officialBoard = officialPullStore?.officialPicks ?? qualifyingPicks3;

        // Only update cosmetic fields (odds, edge, lock status) — never filter
        const frozenBoard = officialBoard.map((p: any) => {
          // Update live odds/edge display without changing pick order or removing picks
          const livePick = preGamePicks3.find((lp: any) => lp.playerName === p.playerName);

          // Phase BR: Per-game stage logic on frozen board — update pickStatus based on game time
          const matchedGameFrozen = games3ForLock.find((g: any) => g.homeTeam === p.team || g.awayTeam === p.team);
          const gameId3 = matchedGameFrozen
            ? `${matchedGameFrozen.awayTeam}@${matchedGameFrozen.homeTeam}`
            : null;
          const gameLock3 = gameId3 ? gameLockStore.get(gameId3) : null;
          const isEarlyLocked = gameId3 ? earlyLockedGameIds.has(gameId3) : false;
          const nowMsFrozen = Date.now();
          let pickStatus: 'preliminary' | 'confirmed' | 'locked';
          if (gameLock3?.isLocked || isEarlyLocked) {
            pickStatus = 'locked';
          } else if (gameLock3?.lineupConfirmedAt !== null && gameLock3?.lineupConfirmedAt !== undefined) {
            const msSinceLineup = nowMsFrozen - gameLock3.lineupConfirmedAt;
            const minsToFirstPitch = gameLock3.firstPitchMs
              ? Math.round((gameLock3.firstPitchMs - nowMsFrozen) / 60000)
              : 999;
            if (msSinceLineup >= LINEUP_STABILIZATION_MS || minsToFirstPitch <= 15) {
              pickStatus = 'locked';
              if (gameId3 && gameLock3 && !gameLock3.isLocked) {
                lockGame(gameId3, officialBoard.filter((q: any) => {
                  const qGame = games3ForLock.find((g: any) => g.homeTeam === q.team || g.awayTeam === q.team);
                  return qGame && `${qGame.awayTeam}@${qGame.homeTeam}` === gameId3;
                }), 'early_auto_lock');
              }
            } else {
              pickStatus = 'confirmed';
            }
          } else {
            pickStatus = p.pickStatus ?? 'preliminary';
          }

          return {
            ...p,
            // Update live odds/edge display only — keep original recommended line and pick order
            bookOdds: livePick?.bookOdds ?? p.bookOdds,
            bookOddsProvider: livePick?.bookOddsProvider ?? p.bookOddsProvider,
            bookImpliedProb: livePick?.bookImpliedProb ?? p.bookImpliedProb,
            edge: livePick?.edge ?? p.edge,
            overProbability: livePick?.overProbability ?? p.overProbability,
            pickStatus,
            isEarlyLocked: isEarlyLocked ?? false,
            gameLockTime: gameLock3?.lockedAt ? new Date(gameLock3.lockedAt).toISOString() : null,
            gameLockReason: gameLock3?.lockReason ?? null,
            lastUpdated: new Date().toISOString(),
          };
        });

        moneyPicks3 = frozenBoard;
        console.log(`[HRRPicks] Serving FROZEN board (${officialPullStore?.phase} pull): ${moneyPicks3.length} picks`);
        // Phase BN fix: lazy DB sync — if the DB has no rows for today, re-persist the current board
        // This ensures Results tab always mirrors Money Picks even if the server restarted after the official pull
        void (async () => {
          try {
            const db = await getDb();
            if (!db || moneyPicks3.length === 0) return;
            const { count: countResult } = await import('drizzle-orm');
            const existing = await db.select({ id: dailyResults.id })
              .from(dailyResults)
              .where(and(eq(dailyResults.gameDate, todayETDate3), eq(dailyResults.source, 'money')))
              .limit(1);
            if (existing.length > 0) return; // DB already has rows — no need to re-persist
            const rows = (moneyPicks3 as any[]).map((p: any) => ({
              gameDate: todayETDate3,
              playerId: p.playerId,
              playerName: p.playerName,
              playerTeam: p.team ?? p.playerTeam ?? '',
              statType: 'hrr' as const,
              source: 'money' as const,
              line: String(p.recommendedLine ?? p.hrrLine ?? 1.5),
              probability: Math.round(p.recommendedProb ?? p.overProb ?? 0),
              actualValue: null,
              result: 'pending' as const,
              odds: p.bookOdds != null ? String(p.bookOdds) : null,
              oddsProvider: p.bookOddsProvider ?? null,
              streakLabel: null,
              dayNightLabel: null,
              tier: p.overallScore >= 83 ? 'S' : p.overallScore >= 74 ? 'A' : p.overallScore >= 68 ? 'Lean' : null,
              edge: null,
              closingLineValue: null,
              matrixScore: p.overallScore ?? null,
            }));
            if (rows.length > 0) {
              await db.insert(dailyResults).values(rows);
              console.log(`[HRRPicks] Lazy DB sync: persisted ${rows.length} picks to DB for ${todayETDate3}`);
            }
          } catch (err) {
            console.error('[HRRPicks] Lazy DB sync failed:', err);
          }
        })();
      }

      // Compute early-locked game count for UI
      const earlyLockedCount = Array.from(gameLockStore.values()).filter(g => g.isLocked && g.lockReason === 'early_auto_lock').length;

      // ─── Phase BJ: Strict Locked Board ─────────────────────────────────────────
      // 1. Validate existing locked board (remove major-event invalidated picks)
      const bjCurrentScoreMap = new Map<string, number>();
      for (const p of preGamePicks3 as any[]) {
        bjCurrentScoreMap.set(p.playerName, p.overallScore ?? 0);
      }
      validateLockedBoard(lineupData.matchups, bjCurrentScoreMap, games3ForLock);

      // 2. Lock confirmed/final picks from the current moneyPicks3 board
      for (const pick of moneyPicks3 as any[]) {
        if (pick.pickStatus === 'confirmed' || pick.pickStatus === 'final_official') {
          addToLockedBoard(pick, currentSlatePhase, lineupData.matchups);
        }
      }

      // 3. Build merged board: locked picks + new open-slot picks
      const lockedBoardPicks: any[] = Array.from(lockedBoardStore.values()).map(entry => {
        const livePick = moneyPicks3.find((p: any) => p.playerName === entry.pick.playerName);
        return {
          ...entry.pick,
          bookOdds: livePick?.bookOdds ?? entry.pick.bookOdds,
          bookOddsProvider: livePick?.bookOddsProvider ?? entry.pick.bookOddsProvider,
          edge: livePick?.edge ?? entry.pick.edge,
          overProbability: livePick?.overProbability ?? entry.pick.overProbability,
          confirmedAt: new Date(entry.lockedAt).toISOString(),
          confirmedOdds: entry.confirmedOdds,
          confirmedOddsProvider: entry.confirmedOddsProvider,
          lockReason: entry.lockPhase === 'final' ? 'Final official board' : 'Official lineup confirmed',
          lastUpdated: new Date().toISOString(),
        };
      });

      const lockedNames = new Set(lockedBoardStore.keys());
      const newUnlockedPicks = moneyPicks3.filter((p: any) => !lockedNames.has(p.playerName));
      const openSlots = Math.max(0, MAX_BOARD_SIZE - lockedBoardPicks.length);
      const newBoardPicks = newUnlockedPicks.slice(0, openSlots);
      const laterQualifiers: any[] = newUnlockedPicks.slice(openSlots).map((p: any) => ({
        ...p,
        isLaterQualifier: true,
        laterQualifierReason: 'Board full at time of qualification',
      }));

      if (lockedBoardPicks.length > 0) {
        moneyPicks3 = [...lockedBoardPicks, ...newBoardPicks];
        console.log(`[BJ] Locked board: ${lockedBoardPicks.length} locked + ${newBoardPicks.length} new = ${moneyPicks3.length} total, ${laterQualifiers.length} later qualifiers`);
      } else {
        console.log(`[BJ] No locked picks yet — serving standard board (${moneyPicks3.length} picks)`);
      }
      // ─── End Phase BJ ──────────────────────────────────────────────────────────

      // ── STAGE 4: Sort by matrix score first, then Poisson quality ────────────
      // Primary sort: matrix overallScore (same ranking as All Plays / Top Plays)
      // Secondary sort: Poisson pick quality + over probability
      enrichedPicks.sort((a, b) => {
        const scoreDiff = ((b.overallScore ?? 0) - (a.overallScore ?? 0));
        if (Math.abs(scoreDiff) > 3) return scoreDiff;
        // Within 3 points, prefer by Poisson quality
        const qualityOrder: Record<string, number> = { strong: 4, moderate: 3, lean: 2, avoid: 1 };
        const qDiff = (qualityOrder[b.pickQuality] ?? 0) - (qualityOrder[a.pickQuality] ?? 0);
        if (qDiff !== 0) return qDiff;
        return b.overProbability - a.overProbability;
      });

      // Build slate metadata for UI display
      const now = new Date();
      const todayNDT = new Date(now.toLocaleString('en-US', { timeZone: 'America/St_Johns' }));
      const todayETDate = `${todayNDT.getFullYear()}-${String(todayNDT.getMonth() + 1).padStart(2, '0')}-${String(todayNDT.getDate()).padStart(2, '0')}`;
      const isStaleSlate = dataDate !== todayETDate && todayNDT.getHours() >= 5;

      // Find first pitch time from games
      const games3 = await getGamesForUI();
      const upcomingGames = games3.filter(g => g.status === 'Preview' || g.status === 'Scheduled');
      // Use gameDate (ISO) for firstPitchTime so the frontend can parse it correctly
      const firstPitchTime = upcomingGames.length > 0
        ? upcomingGames.sort((a, b) => new Date(a.gameDate).getTime() - new Date(b.gameDate).getTime())[0]?.gameDate ?? null
        : null;
      const confirmedCount = games3.filter(g => g.lineupSource === 'confirmed').length;
      const projectedCount = games3.filter(g => g.lineupSource === 'projected').length;

      // Compute enrichment status
      const enrichmentStatus = {
        lineups: (matchups.length > 0 ? 'ok' : 'pending') as 'ok' | 'pending' | 'failed',
        odds: ((enrichment3 as any).isWarm ? 'ok' : 'partial') as 'ok' | 'partial' | 'pending' | 'failed',
        statcast: ((enrichment3 as any).statcastCache?.data?.size > 0 ? 'ok' : 'partial') as 'ok' | 'partial' | 'failed',
        streaks: ((enrichment3 as any).mlbStreakMap?.size > 0 ? 'ok' : 'partial') as 'ok' | 'partial' | 'failed',
        dayNight: ((enrichment3 as any).dayNightSplitsMap?.size > 0 ? 'ok' : 'partial') as 'ok' | 'partial' | 'failed',
        bullpen: ((enrichment3 as any).bullpenFatigueMap?.size > 0 ? 'ok' : 'partial') as 'ok' | 'partial' | 'failed',
        isPartialEnrichment: !(enrichment3 as any).isWarm,
        lastUpdated: new Date().toISOString(),
      };

      // Compute topCandidates (top 3 near-miss picks that didn't make money picks)
      const moneyPickNames3 = new Set(moneyPicks3.map((p: any) => p.playerName));
      const topCandidates = enrichedPicks
        .filter(p => !moneyPickNames3.has(p.playerName))
        .slice(0, 3);

      // Compute bestAvailableScore
      const bestAvailableScore = enrichedPicks.length > 0 ? (enrichedPicks[0]?.overallScore ?? null) : null;

      // Compute emptySlateReasons
      const emptySlateReasons: string[] = [];
      if (moneyPicks3.length === 0) {
        if (enrichedPicks.length === 0) {
          emptySlateReasons.push('No matchups passed the VS quality gate today.');
        } else {
          const topScore = enrichedPicks[0]?.overallScore ?? 0;
          if (topScore < 55) {
            emptySlateReasons.push(`Best available score is ${topScore.toFixed(1)} — all players scored below minimum quality level.`);
          } else {
            emptySlateReasons.push(`Top candidate scored ${topScore.toFixed(1)} — lean tier picks available.`);
          }
          const highPitcherCount = matrixPicks.filter((p: AIPick) => ((p as any).factors?.pitcherWeakness ?? 0) < 3).length;
          if (highPitcherCount > matrixPicks.length * 0.6) {
            emptySlateReasons.push('Strong pitching matchups across the slate are suppressing scores.');
          }
        }
      }

      return {
        success: true,
        picks: enrichedPicks,
        moneyPicks: moneyPicks3,
        lineupSource: lineupData.lineupSource,
        dataDate,
        timestamp: new Date(),
        hasOddsData: enrichedPicks.some(p => p.bookOdds !== null),
        // Slate metadata
        slateDate: todayETDate,
        isStaleSlate,
        firstPitchTime,
        oddsUpdatedAt: new Date(),
        confirmedGames: confirmedCount,
        projectedGames: projectedCount,
        totalGames: games3.length,
        // Phase AE: enrichment metadata
        enrichmentStatus,
        topCandidates,
        emptySlateReasons,
        bestAvailableScore,
        // Phase AS: slate phase for UI labels
        slatePhase: currentSlatePhase,
        officialPullPhase: officialPullStore?.phase ?? currentSlatePhase,
        officialPullTime: officialPullStore?.pulledAt ? new Date(officialPullStore.pulledAt).toISOString() : null,
        // Phase AT: early auto-lock metadata
        earlyLockedCount,
        earlyLockedGames: Array.from(gameLockStore.values())
          .filter(g => g.isLocked && g.lockReason === 'early_auto_lock')
          .map(g => ({
            gameId: g.gameId,
            lockedAt: g.lockedAt ? new Date(g.lockedAt).toISOString() : null,
            firstPitchMs: g.firstPitchMs,
          })),
        // Phase BJ: later qualifiers (picks that qualified after the board was full)
        laterQualifiers,
        lockedBoardSize: lockedBoardStore.size,
      };
    } catch (error) {
      console.error("Error generating HRR picks:", error);
      const fallbackDate = await getDataDate();
      return {
        success: false,
        picks: [],
        dataDate: fallbackDate,
        error: "Failed to generate HRR picks",
        timestamp: new Date(),
        hasOddsData: false,
      };
    }
  }),

  /**
   * Get AI picks for a specific game
   */
  getGamePicks: publicProcedure
    .input((input: unknown) => {
      if (typeof input !== "string") throw new Error("Game ID must be a string");
      return input;
    })
    .query(async ({ input: gameId }) => {
      try {
        // Filter matchups for this game
        const gameMatchups = MOCK_MATCHUPS.slice(0, 3); // Mock: return first 3

        const picks = rankAIPicks(
          gameMatchups,
          MOCK_PLAYERS,
          getMockHRTargets(),
          getMockParkFactors()
        );

        return {
          success: true,
          gameId,
          picks,
          timestamp: new Date(),
        };
      } catch (error) {
        console.error("Error generating game picks:", error);
        return {
          success: false,
          gameId,
          picks: [],
          error: "Failed to generate game picks",
          timestamp: new Date(),
        };
      }
    }),

  /**
   * Get the full scoring matrix — all scored candidates before the quality gate.
   * Shows every player's 10-factor breakdown so you can see exactly why picks
   * were included or excluded.
   */
  getScoringMatrix: publicProcedure.query(async () => {
    try {
      const lineupData = await getAdaptedLineupData();
      const dataDate = await getDataDate();

      const enrichment = await getEnrichmentData(
        lineupData.matchups.map(m => ({
          playerId: m.playerId,
          playerName: m.playerName,
          team: m.team,
          gameTime: m.gameTime,
          pitcherId: m.pitcher.id ?? null,
          pitcherHand: m.pitcher.handedness ?? null,
        }))
      ).catch(() => ({
        vsGradeMap: new Map<string, number>(),
        gameTotalsMap: new Map(),
        dayNightSplitsMap: new Map(),
        mlbStreakMap: new Map(),
        statcastCache: { data: new Map(), byId: new Map(), fetchedAt: Date.now(), year: new Date().getFullYear() },
        bullpenFatigueMap: new Map(),
        fetchedAt: Date.now(),
        isWarm: false,
      }));
      const { vsGradeMap, gameTotalsMap, dayNightSplitsMap, mlbStreakMap, statcastCache, bullpenFatigueMap } = enrichment as any;

      const matchups = lineupData.matchups;
      const players = lineupData.playerDataMap;

      if (matchups.length === 0) {
        return { success: true, candidates: [], dataDate, timestamp: new Date(), totalCandidates: 0 };
      }

      const hrTargetsMap = getMockHRTargets();

      const allScoredPicks = rankAIPicks(
        matchups,
        players,
        hrTargetsMap,
        getMockParkFactors(),
        dayNightSplitsMap,
        mlbStreakMap,
        vsGradeMap,
        gameTotalsMap,
        statcastCache,
        undefined, // ballparkMatchups (legacy)
        bullpenFatigueMap ?? new Map()
      );

      // Build a lightweight matrix row for each pick
      const candidates = allScoredPicks.map((pick, idx) => ({
        rank: idx + 1,
        playerName: pick.playerName,
        team: pick.team,
        battingPosition: pick.battingPosition,
        pitcher: pick.pitcher,
        pitcherTeam: pick.pitcherTeam,
        overallScore: pick.overallScore,
        baseScore: pick.baseScore,
        bpBoost: pick.bpBoost,
        grade: pick.grade,
        vsGrade: pick.vsGrade ?? null,
        gameTotalOU: pick.gameTotalOU ?? null,
        projectedPA: pick.projectedPA ?? null,
        passesGate: pick.overallScore >= 75,
        factors: {
          teamImpliedRuns: pick.factorBreakdown.teamImpliedRuns,
          lineupSpot: pick.factorBreakdown.lineupSpot,
          obpXwOBA: pick.factorBreakdown.obpXwOBA,
          pitcherWeakness: pick.factorBreakdown.pitcherWeakness,
          recentForm: pick.factorBreakdown.recentForm,
          dayNightSplit: pick.factorBreakdown.dayNightSplit,
          parkWeather: pick.factorBreakdown.parkWeather,
          bullpenWeakness: pick.factorBreakdown.bullpenWeakness,
          platoonAdvantage: pick.factorBreakdown.platoonAdvantage,
          hardContactBarrel: pick.factorBreakdown.hardContactBarrel,
        },
        reasons: pick.reasons,
        riskFlags: pick.riskFlags,
      }));

      return {
        success: true,
        candidates,
        dataDate,
        timestamp: new Date(),
        totalCandidates: candidates.length,
        qualifiedCount: candidates.filter(c => c.passesGate).length,
      };
    } catch (error) {
      console.error('Error generating scoring matrix:', error);
      const fallbackDate = await getDataDate();
      return {
        success: false,
        candidates: [],
        dataDate: fallbackDate,
        timestamp: new Date(),
        totalCandidates: 0,
        qualifiedCount: 0,
        error: 'Failed to generate scoring matrix',
      };
    }
  }),

  /**
   * Get game log for a specific player on-demand (for expanded card view)
   * Returns last 7 games with H/R/RBI breakdown
   */
  getPlayerGameLog: publicProcedure
    .input((input: unknown) => {
      if (typeof input !== 'number') throw new Error('playerId must be a number');
      return input;
    })
    .query(async ({ input: playerId }) => {
      try {
        const { getPlayerStreak } = await import('../services/mlbStreakService');
        const streakData = await getPlayerStreak(playerId, 'hits');
        return {
          success: true,
          playerId,
          last5Games: streakData.last5Games,
          streakLength: streakData.streakLength,
          trendDirection: streakData.trendDirection,
          streakLabel: streakData.streakLabel,
          last5HitRate: streakData.last5HitRate,
          hasRealData: streakData.hasRealData,
        };
      } catch (error) {
        console.error('[getPlayerGameLog] Error:', error);
        return {
          success: false,
          playerId,
          last5Games: [],
          streakLength: 0,
          trendDirection: 'NEUTRAL' as const,
          streakLabel: '',
          last5HitRate: 0,
          hasRealData: false,
        };
      }
    }),

  /**
   * Get today's games with lineups for game cards UI
   * Returns real MLB schedule data with batting orders and probable pitchers
   */
  getTodaysGames: publicProcedure.query(async () => {
    try {
      const games = await getGamesForUI();
      const dataDate = await getDataDate();

      // Fetch game totals (O/U) from Odds API for display on game cards
      const teamMatchups = games.flatMap(g => [
        { batter: g.awayTeam.abbreviation, team: g.awayTeam.abbreviation },
        { batter: g.homeTeam.abbreviation, team: g.homeTeam.abbreviation },
      ]);
      const gameTotalsMap = await fetchGameTotals(process.env.ODDS_API_KEY, teamMatchups).catch(() => new Map());

      // Attach O/U and moneyline to each game
      const gamesWithOdds = games.map(g => {
        const awayData = gameTotalsMap.get(g.awayTeam.abbreviation);
        const homeData = gameTotalsMap.get(g.homeTeam.abbreviation);
        const overUnder = awayData?.overUnder ?? homeData?.overUnder ?? null;
        return {
          ...g,
          overUnder,
        };
      });

      return {
        success: true,
        games: gamesWithOdds,
        dataDate,
        timestamp: new Date(),
        lineupAvailable: games.some(g => g.homeLineup.length > 0 || g.awayLineup.length > 0),
      };
    } catch (error) {
      console.error("Error fetching today's games:", error);
      return {
        success: false,
        games: [] as MLBGame[],
        dataDate: new Date().toISOString().split('T')[0],
        timestamp: new Date(),
        lineupAvailable: false,
      };
    }
  }),

  /**
   * Phase AL/AM/BQ: Manual refresh — clears time-locked picks and the hard lock
   * so the next getHRRPicks call re-evaluates all picks from scratch.
   * Confirmed locks (official lineup) are preserved and returned as skippedConfirmed.
   * Phase BQ: Force Refresh also clears the hard lock so the board can be updated
   * even after the pre-game lock has fired.
   */
  clearPickLocks: publicProcedure.mutation(() => {
    let clearedCount = 0;
    let skippedConfirmed = 0;
    const skippedNames: string[] = [];
    for (const [key, lp] of Array.from(lockedPicksStore.entries())) {
      if (lp.lockType === 'confirmed') {
        skippedConfirmed++;
        skippedNames.push(lp.playerName);
      } else {
        lockedPicksStore.delete(key);
        clearedCount++;
      }
    }
    // Phase BQ: Also clear the hard lock so Force Refresh can override the pre-game lock.
    // This also busts the picks cache so the next getHRRPicks builds a fresh board.
    const wasHardLocked = isBoardHardLocked();
    if (wasHardLocked) {
      clearHardLock();
    }
    // Phase BR: Clear all per-game stage locks so Force Refresh resets every pick to Preliminary
    // They will re-advance through Confirmed → Locked as lineup data comes back in
    const clearedGameLocks = gameLockStore.size;
    gameLockStore.clear();
    // Bust the picks cache so the next getHRRPicks triggers a full rebuild
    bustPicksCache();
    // Also reset the official pull store so the next pull is treated as a new official pull
    officialPullStore = null;
    console.log(
      `[HRR] clearPickLocks: cleared ${clearedCount} time-locked pick(s), ` +
      `preserved ${skippedConfirmed} confirmed-locked pick(s): [${skippedNames.join(', ')}], ` +
      `cleared ${clearedGameLocks} game stage lock(s)` +
      (wasHardLocked ? ' [hard lock cleared]' : '')
    );
    return {
      success: true,
      clearedCount,
      skippedConfirmed,
      skippedNames,
      wasHardLocked,
      clearedGameLocks,
      clearedAt: new Date().toISOString(),
    };
  }),
});
