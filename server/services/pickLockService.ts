/**
 * pickLockService.ts
 *
 * Per-game pick locking system for Diamond Edge.
 *
 * Lock stages (per game, not per slate):
 *   PRELIMINARY  → lineup not confirmed, odds updating freely
 *   LOCKING_SOON → 90 mins before first pitch — warning shown to users
 *   LOCKED       → 60 mins before first pitch — odds frozen, pick is final
 *   FINAL        → game started — archived to results, no longer on main board
 *   VOID         → player scratched after lock — pick cancelled, not tracked
 *   POSTPONED    → game postponed — pick removed
 *
 * Key design decisions:
 *   - Lock is PER GAME based on that game's start time
 *   - A 1:05 PM game locks at 12:05 PM
 *   - A 10:10 PM game stays live until 9:10 PM
 *   - Locks are stored in memory with a TTL — no DB required
 *   - When a pick locks, its odds/edge are FROZEN at lock time
 *   - If lineup changes after lock → VOID (not miss, not hit)
 */

import type { MLBGame, LineupPlayer } from './mlbLineupService';

// ─── Types ────────────────────────────────────────────────────────────────────

export type LockStage =
  | 'PRELIMINARY'   // lineup not confirmed, all data live
  | 'LOCKING_SOON'  // 90 mins out — show warning
  | 'LOCKED'        // 60 mins out — frozen
  | 'FINAL'         // game started
  | 'VOID'          // player scratched after lock
  | 'POSTPONED';    // game postponed

export interface GameLockStatus {
  gamePk: number;
  gameStartTime: Date;
  lockStage: LockStage;
  minutesUntilGame: number;    // negative if game started
  minutesUntilLock: number;    // negative if locked
  lockedAt: Date | null;       // when it locked (for display)
  lockLabel: string;           // human readable
  lockColor: string;           // 'green' | 'yellow' | 'red' | 'gray'
  canStillBet: boolean;        // false once LOCKED or past
}

export interface LockedPickSnapshot {
  playerId: number;
  playerName: string;
  gamePk: number;
  gameStartTime: Date;
  lockedAt: Date;

  // Frozen at lock time — these never change after locking
  frozenOdds: number;
  frozenEdge: number;
  frozenModelProb: number;
  frozenLine: number;
  frozenLineupPosition: number;

  lockStage: LockStage;
  voidReason: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LOCK_MINUTES_BEFORE_GAME = 60;      // freeze pick data 60 mins before
const WARNING_MINUTES_BEFORE_GAME = 90;   // warn user 90 mins before
const GAME_STARTED_BUFFER_MINUTES = 10;   // consider game "started" 10 mins after scheduled time

// ─── In-memory store ──────────────────────────────────────────────────────────

// Stores lock snapshots per player+game
const lockSnapshots = new Map<string, LockedPickSnapshot>();

// Stores game lock statuses — refreshed every 5 mins
const gameLockCache = new Map<number, { status: GameLockStatus; cachedAt: number }>();
const LOCK_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

// ─── Core lock logic ──────────────────────────────────────────────────────────

/**
 * Parse game start time from MLB game object.
 * Handles the gameDate ISO string from the MLB Stats API.
 */
export function parseGameStartTime(game: MLBGame): Date | null {
  try {
    if (!game.gameDate || game.gameDate === 'TBD') return null;
    const d = new Date(game.gameDate);
    if (isNaN(d.getTime())) return null;
    return d;
  } catch {
    return null;
  }
}

/**
 * Get the lock status for a specific game right now.
 */
export function getGameLockStatus(game: MLBGame): GameLockStatus {
  // Check cache
  const cached = gameLockCache.get(game.gamePk);
  if (cached && Date.now() - cached.cachedAt < LOCK_CACHE_TTL) {
    return cached.status;
  }

  const now = new Date();
  const gameStart = parseGameStartTime(game);

  // Can't parse time — treat as preliminary
  if (!gameStart) {
    const status: GameLockStatus = {
      gamePk: game.gamePk,
      gameStartTime: now,
      lockStage: 'PRELIMINARY',
      minutesUntilGame: 999,
      minutesUntilLock: 999,
      lockedAt: null,
      lockLabel: 'Time TBD',
      lockColor: 'gray',
      canStillBet: true,
    };
    gameLockCache.set(game.gamePk, { status, cachedAt: Date.now() });
    return status;
  }

  // Handle postponed games
  if (game.status === 'Postponed' || game.status === 'Cancelled') {
    const status: GameLockStatus = {
      gamePk: game.gamePk,
      gameStartTime: gameStart,
      lockStage: 'POSTPONED',
      minutesUntilGame: 0,
      minutesUntilLock: 0,
      lockedAt: null,
      lockLabel: 'Postponed',
      lockColor: 'gray',
      canStillBet: false,
    };
    gameLockCache.set(game.gamePk, { status, cachedAt: Date.now() });
    return status;
  }

  const minutesUntilGame = (gameStart.getTime() - now.getTime()) / (1000 * 60);
  const minutesUntilLock = minutesUntilGame - LOCK_MINUTES_BEFORE_GAME;

  let lockStage: LockStage;
  let lockLabel: string;
  let lockColor: string;
  let canStillBet: boolean;
  let lockedAt: Date | null = null;

  if (minutesUntilGame < -GAME_STARTED_BUFFER_MINUTES) {
    // Game has started (with buffer)
    lockStage = 'FINAL';
    lockLabel = 'In Progress';
    lockColor = 'gray';
    canStillBet = false;
    lockedAt = new Date(gameStart.getTime() - LOCK_MINUTES_BEFORE_GAME * 60 * 1000);
  } else if (minutesUntilGame <= 0) {
    // Game just started (within buffer)
    lockStage = 'FINAL';
    lockLabel = 'Game Started';
    lockColor = 'gray';
    canStillBet = false;
    lockedAt = new Date(gameStart.getTime() - LOCK_MINUTES_BEFORE_GAME * 60 * 1000);
  } else if (minutesUntilGame <= LOCK_MINUTES_BEFORE_GAME) {
    // Within lock window — LOCKED
    lockStage = 'LOCKED';
    const minsAgo = Math.round(LOCK_MINUTES_BEFORE_GAME - minutesUntilGame);
    lockLabel = `Locked ${minsAgo}m ago`;
    lockColor = 'red';
    canStillBet = false;
    lockedAt = new Date(gameStart.getTime() - LOCK_MINUTES_BEFORE_GAME * 60 * 1000);
  } else if (minutesUntilGame <= WARNING_MINUTES_BEFORE_GAME) {
    // Warning window — LOCKING_SOON
    lockStage = 'LOCKING_SOON';
    const minsToLock = Math.round(minutesUntilGame - LOCK_MINUTES_BEFORE_GAME);
    lockLabel = `Locks in ${minsToLock}m`;
    lockColor = 'yellow';
    canStillBet = true;
  } else {
    // Well before game — PRELIMINARY or normal
    lockStage = game.lineupSource === 'confirmed' ? 'LOCKING_SOON' : 'PRELIMINARY';
    const hours = Math.floor(minutesUntilGame / 60);
    const mins = Math.round(minutesUntilGame % 60);
    lockLabel = hours > 0
      ? `Locks in ${hours}h ${mins}m`
      : `Locks in ${mins}m`;
    lockColor = game.lineupSource === 'confirmed' ? 'green' : 'gray';
    canStillBet = true;
  }

  const status: GameLockStatus = {
    gamePk: game.gamePk,
    gameStartTime: gameStart,
    lockStage,
    minutesUntilGame: Math.round(minutesUntilGame),
    minutesUntilLock: Math.round(minutesUntilLock),
    lockedAt,
    lockLabel,
    lockColor,
    canStillBet,
  };

  gameLockCache.set(game.gamePk, { status, cachedAt: Date.now() });
  return status;
}

/**
 * Create or update a lock snapshot for a pick.
 * Call this whenever a pick is generated — it will freeze the data
 * when the game enters the LOCKED stage.
 */
export function snapshotPickAtLock(
  playerId: number,
  playerName: string,
  game: MLBGame,
  currentOdds: number,
  currentEdge: number,
  currentModelProb: number,
  currentLine: number,
  currentLineupPosition: number,
): LockedPickSnapshot | null {
  const lockStatus = getGameLockStatus(game);
  const key = `${playerId}_${game.gamePk}`;

  // If already locked and we have a snapshot, don't overwrite it
  const existing = lockSnapshots.get(key);
  if (existing && ['LOCKED', 'FINAL', 'VOID'].includes(existing.lockStage)) {
    return existing;
  }

  // If game is now locked, freeze the current data
  if (['LOCKED', 'FINAL'].includes(lockStatus.lockStage)) {
    const snapshot: LockedPickSnapshot = {
      playerId,
      playerName,
      gamePk: game.gamePk,
      gameStartTime: lockStatus.gameStartTime,
      lockedAt: lockStatus.lockedAt ?? new Date(),
      frozenOdds: currentOdds,
      frozenEdge: currentEdge,
      frozenModelProb: currentModelProb,
      frozenLine: currentLine,
      frozenLineupPosition: currentLineupPosition,
      lockStage: lockStatus.lockStage,
      voidReason: null,
    };
    lockSnapshots.set(key, snapshot);
    return snapshot;
  }

  return null; // not locked yet
}

/**
 * Void a pick — player was scratched after lock.
 * This means the pick is cancelled, not tracked as a miss.
 */
export function voidPick(
  playerId: number,
  gamePk: number,
  reason: string
): void {
  const key = `${playerId}_${gamePk}`;
  const existing = lockSnapshots.get(key);
  if (existing) {
    lockSnapshots.set(key, {
      ...existing,
      lockStage: 'VOID',
      voidReason: reason,
    });
  }
}

/**
 * Get the lock snapshot for a pick (if it exists).
 */
export function getPickSnapshot(
  playerId: number,
  gamePk: number
): LockedPickSnapshot | null {
  return lockSnapshots.get(`${playerId}_${gamePk}`) ?? null;
}

/**
 * Check if a player is still in the lineup after lock.
 * If they've been scratched, void the pick.
 */
export function checkForScratch(
  playerId: number,
  game: MLBGame,
  currentLineup: LineupPlayer[]
): { scratched: boolean; reason: string | null } {
  const lockStatus = getGameLockStatus(game);

  // Only check for scratches once locked
  if (!['LOCKED', 'FINAL'].includes(lockStatus.lockStage)) {
    return { scratched: false, reason: null };
  }

  const stillInLineup = currentLineup.some(p => p.id === playerId);
  if (!stillInLineup) {
    const reason = 'Player scratched from lineup after pick was locked';
    voidPick(playerId, game.gamePk, reason);
    return { scratched: true, reason };
  }

  return { scratched: false, reason: null };
}

// ─── Batch utilities ──────────────────────────────────────────────────────────

/**
 * Get lock statuses for all games in today's slate.
 * Returns a Map keyed by gamePk.
 */
export function batchGetLockStatuses(
  games: MLBGame[]
): Map<number, GameLockStatus> {
  const result = new Map<number, GameLockStatus>();
  for (const game of games) {
    result.set(game.gamePk, getGameLockStatus(game));
  }
  return result;
}

/**
 * Filter picks to only those where betting is still possible.
 * Used in hrrPicksService to exclude locked/finished games.
 */
export function filterBettablePicks<T extends { gamePk?: number; game?: MLBGame }>(
  picks: T[],
  lockStatuses: Map<number, GameLockStatus>
): T[] {
  return picks.filter(pick => {
    const gamePk = pick.gamePk ?? pick.game?.gamePk;
    if (!gamePk) return true; // no game info — keep it
    const status = lockStatuses.get(gamePk);
    if (!status) return true; // no status — keep it
    return status.canStillBet || status.lockStage === 'LOCKED'; // show locked picks but mark them
  });
}

/**
 * Enrich picks with their lock status.
 * Adds lockStage, lockLabel, lockColor, canStillBet to each pick.
 */
export function enrichPicksWithLockStatus<T extends { gamePk?: number; game?: MLBGame }>(
  picks: T[],
  lockStatuses: Map<number, GameLockStatus>
): Array<T & { lockStatus: GameLockStatus | null }> {
  return picks.map(pick => {
    const gamePk = pick.gamePk ?? pick.game?.gamePk;
    const lockStatus = gamePk ? (lockStatuses.get(gamePk) ?? null) : null;
    return { ...pick, lockStatus };
  });
}

// ─── Display helpers ──────────────────────────────────────────────────────────

/**
 * Format the lock status for display on a pick card.
 */
export function formatLockBadge(status: GameLockStatus): {
  text: string;
  emoji: string;
  className: string;
} {
  switch (status.lockStage) {
    case 'PRELIMINARY':
      return {
        text: 'Preliminary',
        emoji: '🚀',
        className: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20',
      };
    case 'LOCKING_SOON':
      return {
        text: status.lockLabel,
        emoji: '⚠️',
        className: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/25',
      };
    case 'LOCKED':
      return {
        text: status.lockLabel,
        emoji: '🔒',
        className: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
      };
    case 'FINAL':
      return {
        text: 'In Progress',
        emoji: '⚾',
        className: 'text-zinc-500 bg-zinc-500/8 border-zinc-500/15',
      };
    case 'VOID':
      return {
        text: 'Voided',
        emoji: '❌',
        className: 'text-red-400 bg-red-500/8 border-red-500/15',
      };
    case 'POSTPONED':
      return {
        text: 'Postponed',
        emoji: '🌧️',
        className: 'text-zinc-500 bg-zinc-500/8 border-zinc-500/15',
      };
  }
}

/**
 * Get a user-friendly explanation of what the lock stage means.
 */
export function getLockStageExplanation(stage: LockStage): string {
  switch (stage) {
    case 'PRELIMINARY':
      return 'Lineup not confirmed — pick may change as lineup posts';
    case 'LOCKING_SOON':
      return 'Locking soon — place your bet before the window closes';
    case 'LOCKED':
      return 'Pick locked — odds and lineup frozen at time of lock';
    case 'FINAL':
      return 'Game in progress — pick moved to Results tab';
    case 'VOID':
      return 'Player scratched after lock — pick cancelled, not tracked';
    case 'POSTPONED':
      return 'Game postponed — pick removed';
  }
}
