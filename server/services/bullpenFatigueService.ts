/**
 * Bullpen Fatigue Service — Phase S3
 *
 * Tracks bullpen exhaustion and availability per team.
 * Fetches pitcher game logs from MLB Stats API for the last 3 days.
 *
 * Fatigue score (0-100):
 *   0   = Fresh bullpen (no recent usage)
 *   50  = Moderate usage
 *   100 = Exhausted bullpen (heavy usage last 3 days)
 *
 * A tired bullpen is a scoring opportunity boost for batters.
 */

const MLB_API_BASE = "https://statsapi.mlb.com/api/v1";

export interface BullpenFatigue {
  teamId: number;
  teamAbbr: string;
  pitchesLast3Days: number;
  inningsLast3Days: number;
  relieverAppearances: number;
  fatigueScore: number;       // 0-100 (higher = more tired = more scoring opportunity)
  fatigueLabel: string;       // "Fresh" | "Moderate" | "Tired" | "Exhausted"
  highLeverageUnavailable: boolean; // True if top relievers used heavily
}

interface CacheEntry {
  data: Map<number, BullpenFatigue>;
  timestamp: number;
}

let cache: CacheEntry | null = null;
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

/**
 * Get dates for the last N days in YYYY-MM-DD format
 */
function getLastNDates(n: number): string[] {
  const dates: string[] = [];
  const now = new Date();
  for (let i = 1; i <= n; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

/**
 * Fetch pitcher game logs for a team over the last 3 days
 * Returns total pitches, innings, and reliever appearances
 */
async function fetchTeamBullpenUsage(teamId: number, dates: string[]): Promise<{
  pitches: number;
  innings: number;
  appearances: number;
  highLeverageUsed: number;
}> {
  let totalPitches = 0;
  let totalInnings = 0;
  let totalAppearances = 0;
  let highLeverageUsed = 0;

  for (const date of dates) {
    try {
      // Fetch games for this team on this date
      const url = `${MLB_API_BASE}/schedule?sportId=1&date=${date}&teamId=${teamId}&hydrate=boxscore`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) continue;

      const json = await resp.json() as any;
      const games = json.dates?.[0]?.games || [];

      for (const game of games) {
        const gamePk = game.gamePk;
        if (!gamePk) continue;

        // Fetch boxscore for pitcher details
        try {
          const bsUrl = `${MLB_API_BASE}/game/${gamePk}/boxscore`;
          const bsResp = await fetch(bsUrl, { signal: AbortSignal.timeout(5000) });
          if (!bsResp.ok) continue;

          const bs = await bsResp.json() as any;

          // Determine if this team is home or away
          const homeTeamId = bs.teams?.home?.team?.id;
          const teamKey = homeTeamId === teamId ? 'home' : 'away';
          const pitchers = bs.teams?.[teamKey]?.pitchers || [];
          const playerStats = bs.teams?.[teamKey]?.players || {};

          // Count reliever usage (skip starter = first pitcher)
          for (let i = 1; i < pitchers.length; i++) {
            const pitcherId = pitchers[i];
            const playerKey = `ID${pitcherId}`;
            const stats = playerStats[playerKey]?.stats?.pitching;
            if (!stats) continue;

            const pitches = stats.pitchesThrown || 0;
            const inningsPitched = parseFloat(stats.inningsPitched || '0');
            totalPitches += pitches;
            totalInnings += inningsPitched;
            totalAppearances += 1;

            // High leverage = pitched 20+ pitches or 1+ innings
            if (pitches >= 20 || inningsPitched >= 1.0) {
              highLeverageUsed += 1;
            }
          }
        } catch {
          // Skip this game
        }
      }
    } catch {
      // Skip this date
    }
  }

  return {
    pitches: totalPitches,
    innings: totalInnings,
    appearances: totalAppearances,
    highLeverageUsed,
  };
}

/**
 * Calculate fatigue score from usage stats
 */
function calculateFatigueScore(pitches: number, innings: number, appearances: number): number {
  // Benchmarks: 
  //   0 pitches = 0 (fresh)
  //   150 pitches over 3 days = 50 (moderate)
  //   300+ pitches = 100 (exhausted)
  const pitchScore = Math.min(100, (pitches / 300) * 100);
  const inningScore = Math.min(100, (innings / 15) * 100);
  const appScore = Math.min(100, (appearances / 8) * 100);

  return Math.round(pitchScore * 0.40 + inningScore * 0.35 + appScore * 0.25);
}

function getFatigueLabel(score: number): string {
  if (score >= 75) return 'Exhausted';
  if (score >= 50) return 'Tired';
  if (score >= 25) return 'Moderate';
  return 'Fresh';
}

/**
 * Get bullpen fatigue data for a list of teams.
 * Returns a map of teamId -> BullpenFatigue.
 */
export async function getBullpenFatigue(
  teams: Array<{ teamId: number; teamAbbr: string }>
): Promise<Map<number, BullpenFatigue>> {
  // Check cache
  if (cache && Date.now() - cache.timestamp < CACHE_TTL) {
    return cache.data;
  }

  const dates = getLastNDates(3);
  const result = new Map<number, BullpenFatigue>();

  // Fetch in parallel (max 5 concurrent to avoid rate limits)
  const BATCH_SIZE = 5;
  for (let i = 0; i < teams.length; i += BATCH_SIZE) {
    const batch = teams.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async ({ teamId, teamAbbr }) => {
      try {
        const usage = await fetchTeamBullpenUsage(teamId, dates);
        const fatigueScore = calculateFatigueScore(usage.pitches, usage.innings, usage.appearances);
        result.set(teamId, {
          teamId,
          teamAbbr,
          pitchesLast3Days: usage.pitches,
          inningsLast3Days: usage.innings,
          relieverAppearances: usage.appearances,
          fatigueScore,
          fatigueLabel: getFatigueLabel(fatigueScore),
          highLeverageUnavailable: usage.highLeverageUsed >= 3,
        });
      } catch {
        // Fallback: neutral fatigue
        result.set(teamId, {
          teamId,
          teamAbbr,
          pitchesLast3Days: 0,
          inningsLast3Days: 0,
          relieverAppearances: 0,
          fatigueScore: 50,
          fatigueLabel: 'Moderate',
          highLeverageUnavailable: false,
        });
      }
    }));
  }

  cache = { data: result, timestamp: Date.now() };
  console.log(`[BullpenFatigue] Fetched fatigue data for ${result.size} teams`);
  return result;
}

/**
 * Get bullpen fatigue score for a specific team (0-100, higher = more tired = scoring opportunity)
 */
export function getBullpenFatigueScore(
  teamId: number,
  fatigueMap: Map<number, BullpenFatigue>
): { score: number; label: string; highLeverageUnavailable: boolean } {
  const fatigue = fatigueMap.get(teamId);
  if (!fatigue) return { score: 50, label: 'Unknown', highLeverageUnavailable: false };
  return {
    score: fatigue.fatigueScore,
    label: fatigue.fatigueLabel,
    highLeverageUnavailable: fatigue.highLeverageUnavailable,
  };
}
