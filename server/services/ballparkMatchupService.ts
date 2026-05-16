/**
 * BallparkPal Matchup Service
 * Fetches real batter-vs-pitcher matchup data from ballparkpal.com
 * Provides the VS Grade (1-10 scale) used as the PRIMARY gate filter for picks.
 * Also computes projected game totals from aggregate RC sums.
 *
 * Uses Puppeteer (headless Chromium) to bypass Cloudflare bot protection.
 * The page loads __matchupExportData as a JS variable after page render.
 * Session cookies (BALLPARK_EMAIL / BALLPARK_PASSWORD env vars) are injected
 * so the page shows subscriber matchup data instead of the paywall.
 *
 * Fallback: if Puppeteer fails, tries plain fetch as a last resort.
 */

import puppeteer from 'puppeteer-core';

export interface BallparkMatchup {
  game: string;           // e.g. "Giants @ Dodgers"
  team: string;           // e.g. "LAD"
  batter: string;         // e.g. "Freddie Freeman"
  bats: string;           // R, L, S
  pitcher: string;        // e.g. "Roupp"
  throws: string;         // R, L
  starter: boolean;       // true if in starting lineup
  rc: number;             // Runs Created (park-adjusted)
  vsGrade: number;        // -10 to 10 matchup rating (THE KEY FIELD)
  hrProb: number;         // HR probability %
  xbProb: number;         // Extra base hit probability %
  oneBProb: number;       // Single probability %
  bbProb: number;         // Walk probability %
  kProb: number;          // Strikeout probability %
  // Historical head-to-head
  pa: number;             // Plate appearances vs this pitcher
  ab: number;             // At-bats vs this pitcher
  h: number;              // Hits vs this pitcher
  avg: string;            // AVG vs this pitcher
  // No-park versions
  rcNoPark: number;
}

export interface GameTotal {
  game: string;           // e.g. "Giants @ Dodgers"
  totalRC: number;        // Sum of all starter RCs in this game
  avgRC: number;          // Average RC per starter
  playerCount: number;    // Number of starters
  // Normalized score 0-100 for use in scoring
  gameTotalScore: number;
}

// Cache
let cachedMatchups: BallparkMatchup[] | null = null;
let cachedGameTotals: Map<string, GameTotal> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 20 * 60 * 1000; // 20 minutes — BallparkPal data is stable for 20+ min

const CHROMIUM_PATH = '/usr/bin/chromium';

/**
 * Check if Chromium is available on this system.
 * In production (deployed), Chromium is not installed — skip Puppeteer entirely.
 */
function isChromiumAvailable(): boolean {
  try {
    const fs = require('fs');
    return fs.existsSync(CHROMIUM_PATH);
  } catch {
    return false;
  }
}

/**
 * Parse raw matchup data array into BallparkMatchup objects.
 */
function parseMatchups(rawData: Array<Record<string, any>>): BallparkMatchup[] {
  return rawData.map(d => ({
    game: (d.Game || '').trim(),
    team: (d.Team || '').trim(),
    batter: (d.Batter || '').trim(),
    bats: (d.Bats || 'R').trim(),
    pitcher: (d.Pitcher || '').trim(),
    throws: (d.Throws || 'R').trim(),
    starter: d.Starter === 1,
    rc: d.RC || 0,
    vsGrade: d['vs Grade'] ?? 0,
    hrProb: d['HR Prob'] || 0,
    xbProb: d['XB Prob'] || 0,
    oneBProb: d['1B Prob'] || 0,
    bbProb: d['BB Prob'] || 0,
    kProb: d['K Prob'] || 0,
    pa: d.PA || 0,
    ab: d.AB || 0,
    h: d.H || 0,
    avg: (d.AVG || '.000').trim(),
    rcNoPark: d['RC (no park)'] || 0,
  }));
}

/**
 * Fetch matchup data using Puppeteer headless browser.
 * This bypasses Cloudflare bot protection which blocks plain Node.js fetch.
 * Injects session cookies from env vars (BALLPARK_PHPSESSID, BALLPARK_SYSTEM_ID)
 * so the page shows subscriber matchup data instead of the paywall.
 */
async function fetchWithPuppeteer(): Promise<BallparkMatchup[]> {
  let browser: import('puppeteer-core').Browser | null = null;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROMIUM_PATH,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-networking',
      ],
    });

    const page = await browser.newPage();

    // Set realistic user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    // Inject session cookies if available (from env vars)
    const phpSessId = process.env.BALLPARK_PHPSESSID;
    const systemId = process.env.BALLPARK_SYSTEM_ID;
    if (phpSessId && systemId) {
      await page.setCookie(
        { name: 'PHPSESSID', value: phpSessId, domain: 'www.ballparkpal.com', path: '/' },
        { name: 'system_id', value: systemId, domain: 'www.ballparkpal.com', path: '/' }
      );
      console.log('[BallparkPal] Session cookies injected from env vars');
    } else {
      console.log('[BallparkPal] No session cookies in env — attempting without auth');
    }

    // Navigate to the BvP Matchups page
    await page.goto('https://www.ballparkpal.com/MatchUps.php', {
      waitUntil: 'networkidle2',
      timeout: 35_000,
    });

    // Check for Cloudflare block
    const title = await page.title();
    if (title.includes('Attention Required') || title.includes('Cloudflare')) {
      console.error('[BallparkPal] Cloudflare block detected — IP may be blocked');
      return [];
    }

    // Check for paywall
    const isPaywall = await page.evaluate(() => {
      return document.title.includes('Secure Checkout') ||
             document.body.innerText.includes('Select Your Plan') ||
             document.body.innerText.includes('Subscribe');
    });
    if (isPaywall) {
      console.error('[BallparkPal] Paywall detected — session cookies may be expired or missing');
      return [];
    }

    // Extract __matchupExportData from the page's JS context
    const rawData = await page.evaluate(() => {
      // @ts-ignore
      return typeof window.__matchupExportData !== 'undefined' ? window.__matchupExportData : null;
    }) as Array<Record<string, any>> | null;

    if (!rawData || rawData.length === 0) {
      console.error('[BallparkPal] __matchupExportData not found or empty in page');
      return [];
    }

    const matchups = parseMatchups(rawData);
    console.log(`[BallparkPal] Puppeteer fetched ${matchups.length} matchups (${matchups.filter(m => m.starter).length} starters). ` +
      `VS≥9: ${matchups.filter(m => m.vsGrade >= 9).length} (${matchups.filter(m => m.vsGrade === 10).length} tens, ${matchups.filter(m => m.vsGrade === 9).length} nines)`);
    return matchups;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

/**
 * Get today's date in ET timezone as YYYY-MM-DD string.
 * Used for DB cache lookups.
 */
function getTodayET(): string {
  const now = new Date();
  const etOffset = -5 * 60; // EST (UTC-5); DST handled below
  // Simple DST detection: second Sunday in March to first Sunday in November
  const year = now.getUTCFullYear();
  const marchSecondSunday = new Date(Date.UTC(year, 2, 1));
  marchSecondSunday.setUTCDate(1 + (7 - marchSecondSunday.getUTCDay() + 0) % 7 + 7);
  const novFirstSunday = new Date(Date.UTC(year, 10, 1));
  novFirstSunday.setUTCDate(1 + (7 - novFirstSunday.getUTCDay()) % 7);
  const isDST = now >= marchSecondSunday && now < novFirstSunday;
  const etOffsetMs = (isDST ? -4 : -5) * 60 * 60 * 1000;
  const etDate = new Date(now.getTime() + etOffsetMs);
  return etDate.toISOString().slice(0, 10);
}

/**
 * Fetch today's matchup data from ballparkpal.com
 * Priority order:
 *   1. In-memory cache (fastest, avoids any I/O)
 *   2. Database cache (saved by scheduled task — works even when Cloudflare blocks server)
 *   3. Plain HTTP fetch (fast but often blocked by Cloudflare)
 *   4. Puppeteer headless browser (only available in dev/sandbox)
 */
async function fetchMatchupData(): Promise<BallparkMatchup[]> {
  // Check in-memory cache
  if (cachedMatchups && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedMatchups;
  }

  try {
    // Step 1: Try plain fetch first (fast, ~2s) — works when not Cloudflare-blocked
    console.log('[BallparkPal] Attempting plain fetch...');
    try {
      const resp = await fetch('https://www.ballparkpal.com/MatchUps.php', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Cookie': process.env.BALLPARK_PHPSESSID ? `PHPSESSID=${process.env.BALLPARK_PHPSESSID}; system_id=${process.env.BALLPARK_SYSTEM_ID}` : '',
        },
        signal: AbortSignal.timeout(8000), // 8s max — fail fast
      });

      if (resp.ok) {
        const html = await resp.text();
        // Check for paywall/block
        if (!html.includes('Secure Checkout') && !html.includes('Attention Required')) {
          const match = html.match(/__matchupExportData\s*=\s*(\[[\s\S]*?\]);/);
          if (match && match[1] && match[1].length > 10) {
            const rawData = JSON.parse(match[1]) as Array<Record<string, any>>;
            const matchups = parseMatchups(rawData);
            if (matchups.length > 0) {
              cachedMatchups = matchups;
              cacheTimestamp = Date.now();
              console.log(`[BallparkPal] Plain fetch success: ${matchups.length} matchups (${matchups.filter(m => m.vsGrade >= 9).length} grade 9+)`);
              return matchups;
            }
          }
        }
      }
    } catch (fetchErr) {
      console.log('[BallparkPal] Plain fetch failed (Cloudflare block or network error), trying Puppeteer...');
    }

    // Step 2: Puppeteer fallback — only if Chromium is available (dev/sandbox only)
    if (isChromiumAvailable()) {
      console.log('[BallparkPal] Trying Puppeteer headless browser...');
      const matchups = await fetchWithPuppeteer();
      if (matchups.length > 0) {
        cachedMatchups = matchups;
        cacheTimestamp = Date.now();
        return matchups;
      }
    } else {
      console.log('[BallparkPal] Chromium not available (production) — skipping Puppeteer');
    }

    console.log('[BallparkPal] All fetch methods failed — using mlbMatchupService fallback');
    return cachedMatchups || [];
  } catch (error) {
    console.error('[BallparkPal] Error fetching matchups:', error);
    return cachedMatchups || [];
  }
}

/**
 * Public export: fetch matchup data for use by enrichmentCache.
 */
export async function fetchMatchupDataPublic(): Promise<BallparkMatchup[]> {
  return fetchMatchupData();
}

/**
 * Public export: compute game totals from matchups for use by enrichmentCache.
 * Returns a Map<gameName, GameTotal> using the gameTotalsService-compatible interface.
 * Converts BallparkPal RC aggregate into the gameTotalsService.GameTotal shape.
 */
export function computeGameTotalsFromMatchups(matchups: BallparkMatchup[]): Map<string, import('./gameTotalsService').GameTotal> {
  const raw = computeGameTotals(matchups);
  const result = new Map<string, import('./gameTotalsService').GameTotal>();
  for (const entry of Array.from(raw.entries())) {
    const [game, gt] = entry;
    // Parse game string like "Giants @ Dodgers" → away=Giants, home=Dodgers
    const parts = game.split('@').map(s => s.trim());
    const awayTeam = parts[0] || game;
    const homeTeam = parts[1] || game;
    result.set(game, {
      game: gt.game,
      awayTeam,
      homeTeam,
      overUnder: null, // not available from RC aggregate
      source: 'rc_aggregate' as const,
      gameTotalScore: gt.gameTotalScore,
      rcAggregate: (gt as any).totalRC ?? 0,
    });
  }
  return result;
}

/**
 * Compute projected game totals from aggregate RC sums.
 * Higher total RC = more runs expected = higher game total.
 */
function computeGameTotals(matchups: BallparkMatchup[]): Map<string, GameTotal> {
  const gameMap = new Map<string, { total: number; count: number }>();

  for (const m of matchups) {
    if (!m.starter) continue;
    const existing = gameMap.get(m.game) || { total: 0, count: 0 };
    existing.total += m.rc;
    existing.count++;
    gameMap.set(m.game, existing);
  }

  // Normalize: find min/max RC sums to create 0-100 scale
  const entries = Array.from(gameMap.entries());
  const rcSums = entries.map(([, v]) => v.total);
  const minRC = Math.min(...rcSums);
  const maxRC = Math.max(...rcSums);
  const range = maxRC - minRC || 1;

  const result = new Map<string, GameTotal>();
  for (const [game, { total, count }] of entries) {
    // Normalize to 0-100 scale
    const gameTotalScore = Math.round(((total - minRC) / range) * 100);
    result.set(game, {
      game,
      totalRC: total,
      avgRC: Math.round((total / count) * 10) / 10,
      playerCount: count,
      gameTotalScore,
    });
  }

  return result;
}

/**
 * Get today's VS-gated matchup pool.
 * PRIMARY GATE: Only starters with VS Grade >= 9 pass through.
 * VS=10: always included
 * VS=9: included as "exceptions" — they still go through the full scoring matrix
 * 
 * All batters in the pool still go through the full scoring matrix for final ranking.
 */
export async function getVSGatedPool(): Promise<{
  pool: BallparkMatchup[];
  gameTotals: Map<string, GameTotal>;
  allMatchups: BallparkMatchup[];
}> {
  const allMatchups = await fetchMatchupData();
  const starters = allMatchups.filter(m => m.starter);
  
  // PRIMARY GATE: VS Grade >= 9 (10s always, 9s as exceptions)
  const pool = starters.filter(m => m.vsGrade >= 9);

  // Compute game totals for influence scoring
  const gameTotals = computeGameTotals(allMatchups);
  cachedGameTotals = gameTotals;

  console.log(`[BallparkPal] VS Gate: ${pool.length} players pass (VS≥9 starters). ${pool.filter(m => m.vsGrade === 10).length} tens, ${pool.filter(m => m.vsGrade === 9).length} nines.`);

  return { pool, gameTotals, allMatchups };
}

/**
 * Get the game total score for a specific game.
 * Returns 0-100 where 100 = highest projected scoring game of the day.
 */
export function getGameTotalScore(game: string): number {
  if (!cachedGameTotals) return 50; // neutral if no data
  const gameTotal = cachedGameTotals.get(game);
  return gameTotal?.gameTotalScore ?? 50;
}

/**
 * Get all matchup data (for display purposes, not gating)
 */
export async function getAllMatchups(): Promise<BallparkMatchup[]> {
  return fetchMatchupData();
}

/**
 * Get game totals map
 */
export async function getGameTotalsMap(): Promise<Map<string, GameTotal>> {
  if (cachedGameTotals && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedGameTotals;
  }
  const matchups = await fetchMatchupData();
  cachedGameTotals = computeGameTotals(matchups);
  return cachedGameTotals;
}

/**
 * Match a player name from MLB lineup to ballparkpal batter name.
 * BallparkPal uses full names like "Freddie Freeman", MLB uses "Freddie Freeman" too.
 * We do fuzzy matching on last name.
 */
export function findMatchupForPlayer(
  playerName: string,
  team: string,
  matchups: BallparkMatchup[]
): BallparkMatchup | null {
  // Exact match first
  const exact = matchups.find(m => 
    m.batter.toLowerCase() === playerName.toLowerCase() && 
    m.team === team
  );
  if (exact) return exact;

  // Last name match with team
  const lastName = playerName.split(' ').pop()?.toLowerCase() || '';
  const lastNameMatch = matchups.find(m => 
    m.batter.toLowerCase().split(' ').pop() === lastName && 
    m.team === team
  );
  if (lastNameMatch) return lastNameMatch;

  // Last name match without team (for team abbreviation mismatches)
  const fuzzy = matchups.find(m => 
    m.batter.toLowerCase().split(' ').pop() === lastName
  );
  return fuzzy || null;
}
