/**
 * verifyResultsJob.ts
 *
 * Runs verifyYesterdayResults() once per day at 6:00 AM ET.
 * Fills in actual stats and hit/miss results for all pending picks_history rows.
 *
 * Pattern mirrors autoGradeResults.ts: startup setTimeout + daily setInterval.
 */

import { verifyYesterdayResults } from '../services/progressiveTrackingService';

const JOB_NAME = '[VerifyResultsJob]';

/**
 * Milliseconds until the next 6:00 AM ET from now.
 * If it's already past 6 AM today, schedules for tomorrow.
 */
function msUntilNext6amET(): number {
  const now = new Date();
  const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));

  const next6am = new Date(nowET);
  next6am.setHours(6, 0, 0, 0);

  if (nowET >= next6am) {
    // Already past 6 AM today — schedule for tomorrow
    next6am.setDate(next6am.getDate() + 1);
  }

  // Convert back to UTC ms delta
  const deltaMs = next6am.getTime() - nowET.getTime();
  return Math.max(deltaMs, 0);
}

async function runVerification() {
  console.log(`${JOB_NAME} Running yesterday's results verification...`);
  try {
    const summary = await verifyYesterdayResults();
    console.log(
      `${JOB_NAME} Done — verified ${summary.verified} picks: ` +
      `${summary.hits}W ${summary.misses}L ${summary.voids}V`
    );
  } catch (err) {
    console.error(`${JOB_NAME} Verification failed:`, err);
  }
}

/**
 * Start the daily 6 AM ET verification job.
 * Call once from server/_core/index.ts after server.listen().
 */
export function startVerifyResultsJob(): void {
  const delayMs = msUntilNext6amET();
  const delayHours = Math.round(delayMs / 1000 / 60 / 10) / 6; // approximate hours
  console.log(`${JOB_NAME} Scheduled — first run in ~${delayHours.toFixed(1)}h (6 AM ET)`);

  setTimeout(() => {
    // Run immediately at 6 AM ET
    runVerification();

    // Then repeat every 24 hours
    setInterval(() => {
      runVerification();
    }, 24 * 60 * 60 * 1000);
  }, delayMs);
}
