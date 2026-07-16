/**
 * closingLinePollerJob.ts
 *
 * Runs pollClosingLines() every 5 minutes throughout the day.
 * The 12-minute lookahead window combined with 5-minute polling gives each
 * eligible pick 2–3 chances to be caught before its game starts, tolerating
 * a single failed API call.
 *
 * Pattern mirrors verifyResultsJob.ts: startup setTimeout + setInterval.
 * Registered in server/_core/index.ts alongside the other background jobs.
 */

import { pollClosingLines } from '../services/closingLinePoller';

const JOB_NAME = '[ClosingLinePollerJob]';
const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Milliseconds until the next 5-minute boundary from now.
 * Starting on a clean boundary is optional but keeps log timestamps tidy.
 */
function msUntilNextFiveMinuteBoundary(): number {
  const now = Date.now();
  const remainder = now % INTERVAL_MS;
  return remainder === 0 ? 0 : INTERVAL_MS - remainder;
}

async function runPollCycle() {
  try {
    const result = await pollClosingLines();
    // Only log if there was something to do — avoids noise on quiet slates
    if (result.checked > 0) {
      console.log(
        `${JOB_NAME} Cycle complete — ` +
        `${result.checked} checked, ${result.captured} captured, ${result.failed} failed`
      );
    }
  } catch (err) {
    console.error(`${JOB_NAME} Cycle failed:`, err);
  }
}

/**
 * Start the every-5-minute closing line poller.
 * Call once from server/_core/index.ts after server.listen().
 */
export function startClosingLinePollerJob(): void {
  const delayMs = msUntilNextFiveMinuteBoundary();
  const delayMin = Math.round(delayMs / 1000 / 60 * 10) / 10;

  console.log(
    `${JOB_NAME} Scheduled — first run in ~${delayMin.toFixed(1)}min, ` +
    `then every 5 minutes`
  );

  setTimeout(() => {
    // First run at the next 5-minute boundary
    runPollCycle();

    // Then every 5 minutes
    setInterval(runPollCycle, INTERVAL_MS);
  }, delayMs);
}
