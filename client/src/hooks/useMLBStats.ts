/**
 * useMLBStats — fetches MLB season batting leaderboards from the official MLB Stats API
 * Endpoint: https://statsapi.mlb.com/api/v1/stats
 * No API key required. Data is live 2025 season stats.
 */

import { useState, useEffect, useCallback } from "react";

export type StatCategory = "hits" | "runs" | "rbi";

export interface PlayerStat {
  rank: number;
  playerId: number;
  fullName: string;
  firstName: string;
  lastName: string;
  teamName: string;
  teamId: number;
  league: string;
  position: string;
  hits: number;
  runs: number;
  rbi: number;
  avg: string;
  gamesPlayed: number;
  homeRuns: number;
  atBats: number;
}

interface MLBStatsState {
  data: PlayerStat[];
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
}

const MLB_API_BASE = "https://statsapi.mlb.com/api/v1";
const SEASON = "2025";
const LIMIT = 50;

const SORT_STAT_MAP: Record<StatCategory, string> = {
  hits: "hits",
  runs: "runs",
  rbi: "rbi",
};

// Cache to avoid redundant fetches
const cache: Record<string, { data: PlayerStat[]; timestamp: number }> = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchLeaderboard(sortStat: StatCategory): Promise<PlayerStat[]> {
  const cacheKey = sortStat;
  const now = Date.now();

  if (cache[cacheKey] && now - cache[cacheKey].timestamp < CACHE_TTL) {
    return cache[cacheKey].data;
  }

  const url = `${MLB_API_BASE}/stats?stats=season&group=hitting&season=${SEASON}&limit=${LIMIT}&sortStat=${SORT_STAT_MAP[sortStat]}&order=desc`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`MLB API error: ${response.status}`);
  }

  const json = await response.json();
  const splits = json?.stats?.[0]?.splits ?? [];

  const players: PlayerStat[] = splits.map((s: any, idx: number) => ({
    rank: s.rank ?? idx + 1,
    playerId: s.player?.id ?? 0,
    fullName: s.player?.fullName ?? "Unknown",
    firstName: s.player?.firstName ?? "",
    lastName: s.player?.lastName ?? "",
    teamName: s.team?.name ?? "Unknown",
    teamId: s.team?.id ?? 0,
    league: s.league?.name ?? "",
    position: s.position?.abbreviation ?? "",
    hits: s.stat?.hits ?? 0,
    runs: s.stat?.runs ?? 0,
    rbi: s.stat?.rbi ?? 0,
    avg: s.stat?.avg ?? ".000",
    gamesPlayed: s.stat?.gamesPlayed ?? 0,
    homeRuns: s.stat?.homeRuns ?? 0,
    atBats: s.stat?.atBats ?? 0,
  }));

  cache[cacheKey] = { data: players, timestamp: now };
  return players;
}

export function useMLBStats(sortStat: StatCategory): MLBStatsState & { refresh: () => void } {
  const [state, setState] = useState<MLBStatsState>({
    data: [],
    loading: true,
    error: null,
    lastUpdated: null,
  });

  const load = useCallback(
    async (bust = false) => {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      if (bust) {
        delete cache[sortStat];
      }
      try {
        const data = await fetchLeaderboard(sortStat);
        setState({ data, loading: false, error: null, lastUpdated: new Date() });
      } catch (err: any) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err?.message ?? "Failed to load stats",
        }));
      }
    },
    [sortStat]
  );

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, refresh: () => load(true) };
}

export function getHeadshotUrl(playerId: number): string {
  return `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_180,q_auto:best/v1/people/${playerId}/headshot/67/current`;
}

export function getStatValue(player: PlayerStat, stat: StatCategory): number {
  return player[stat];
}

export function getStatMax(players: PlayerStat[], stat: StatCategory): number {
  if (!players.length) return 1;
  return Math.max(...players.map((p) => getStatValue(p, stat)));
}
