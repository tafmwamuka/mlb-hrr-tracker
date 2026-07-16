/**
 * LockBadge.tsx
 *
 * Lock status badge for Money Picks and Pitcher pick cards.
 * Shows the current lock stage with countdown and explanation.
 *
 * Usage:
 *   <LockBadge lockStatus={pick} showExplanation />
 */

import { useState, useEffect } from "react";

// ─── Types (mirrors pickLockService) ─────────────────────────────────────────

export type LockStage =
  | 'PRELIMINARY'
  | 'LOCKING_SOON'
  | 'LOCKED'
  | 'FINAL'
  | 'VOID'
  | 'POSTPONED';

export interface LockStatus {
  lockStage: LockStage;
  lockLabel: string;
  lockColor: string;
  canStillBet: boolean;
  minutesUntilGame: number;
  minutesUntilLock: number;
  lockedAt: string | null;
}

// ─── Lock badge ───────────────────────────────────────────────────────────────

export function LockBadge({
  lockStatus,
  showExplanation = false,
  compact = false,
}: {
  lockStatus: LockStatus | null;
  showExplanation?: boolean;
  compact?: boolean;
}) {
  if (!lockStatus) return null;

  const config = {
    PRELIMINARY: {
      emoji: '🚀',
      text: compact ? 'PRELIM' : 'Preliminary',
      className: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20',
      explanation: 'Lineup not confirmed — pick may change',
    },
    LOCKING_SOON: {
      emoji: '⚠️',
      text: lockStatus.lockLabel,
      className: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/25',
      explanation: 'Locking soon — place your bet before the window closes',
    },
    LOCKED: {
      emoji: '🔒',
      text: compact ? 'LOCKED' : lockStatus.lockLabel,
      className: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
      explanation: 'Odds and lineup frozen at time of lock',
    },
    FINAL: {
      emoji: '⚾',
      text: 'In Progress',
      className: 'text-zinc-500 bg-zinc-500/8 border-zinc-500/15',
      explanation: 'Game in progress — check Results tab',
    },
    VOID: {
      emoji: '❌',
      text: 'Voided',
      className: 'text-red-400/70 bg-red-500/8 border-red-500/15',
      explanation: 'Player scratched — pick cancelled, not tracked as miss',
    },
    POSTPONED: {
      emoji: '🌧️',
      text: 'Postponed',
      className: 'text-zinc-500 bg-zinc-500/8 border-zinc-500/15',
      explanation: 'Game postponed — pick removed',
    },
  }[lockStatus.lockStage];

  return (
    <div>
      <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${config.className}`}>
        {config.emoji} {config.text}
      </span>
      {showExplanation && (
        <p className="text-[10px] text-zinc-600 mt-0.5 ml-0.5">{config.explanation}</p>
      )}
    </div>
  );
}

// ─── Lock countdown timer ─────────────────────────────────────────────────────
// Live countdown for picks in the LOCKING_SOON stage

export function LockCountdown({ minutesUntilLock }: { minutesUntilLock: number }) {
  const [mins, setMins] = useState(minutesUntilLock);

  useEffect(() => {
    setMins(minutesUntilLock);
    const interval = setInterval(() => {
      setMins(m => Math.max(0, m - 1 / 60));
    }, 1000);
    return () => clearInterval(interval);
  }, [minutesUntilLock]);

  const totalMins = Math.floor(mins);
  const secs = Math.floor((mins - totalMins) * 60);

  if (totalMins <= 0 && secs <= 0) {
    return (
      <span className="text-[10px] text-red-400 font-bold">
        🔒 Locking now...
      </span>
    );
  }

  return (
    <span className="text-[10px] text-yellow-400 font-mono font-bold">
      ⚠️ Locks in {totalMins}:{String(secs).padStart(2, '0')}
    </span>
  );
}

// ─── Voided pick overlay ──────────────────────────────────────────────────────

export function VoidedPickOverlay({ reason }: { reason: string }) {
  return (
    <div className="absolute inset-0 rounded-2xl bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center z-10">
      <span className="text-2xl mb-1">❌</span>
      <p className="text-white font-bold text-sm">Pick Voided</p>
      <p className="text-zinc-400 text-xs text-center px-4 mt-1">{reason}</p>
      <p className="text-zinc-600 text-[10px] mt-2">Not tracked as miss in Results</p>
    </div>
  );
}
