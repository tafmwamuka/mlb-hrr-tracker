/**
 * Odds API Pipeline Diagnostic Script
 * 
 * Checks every step of the pipeline:
 * 1. API key delivery (env + .project-config.json)
 * 2. Events endpoint — are there games today?
 * 3. Money Pick (HRR batter) markets — raw response for one game
 * 4. Pitcher Strikeout markets — raw response for one game
 * 5. Pitcher Walk markets — raw response for one game
 * 6. Alternate K markets — raw response for one game
 * 7. Parser output — what does parsePitcherData produce?
 * 8. Filter analysis — what gets rejected and why?
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const SPORT = 'baseball_mlb';

// ─── Step 1: Resolve API key ─────────────────────────────────────────────────
function getApiKey() {
  // Try .project-config.json first
  try {
    const configPath = path.resolve(__dirname, '..', '.project-config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const key = config?.secrets?.ODDS_API_KEY || '';
      if (key) return { key, source: '.project-config.json' };
    }
  } catch (e) {
    console.error('  [!] Error reading .project-config.json:', e.message);
  }
  // Try .env
  try {
    const envPath = path.resolve(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, 'utf8').split('\n');
      for (const line of lines) {
        const m = line.match(/^ODDS_API_KEY=(.+)$/);
        if (m) return { key: m[1].trim(), source: '.env' };
      }
    }
  } catch (e) {
    console.error('  [!] Error reading .env:', e.message);
  }
  // Try process.env
  if (process.env.ODDS_API_KEY) {
    return { key: process.env.ODDS_API_KEY, source: 'process.env' };
  }
  return { key: '', source: 'NOT FOUND' };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function americanToImplied(odds) {
  if (odds < 0) return Math.abs(odds) / (Math.abs(odds) + 100);
  return 100 / (odds + 100);
}

function removeVig(overProb, underProb) {
  const total = overProb + underProb;
  return { trueOver: overProb / total, trueUnder: underProb / total };
}

async function fetchJSON(url, label) {
  console.log(`\n  → GET ${url.replace(/apiKey=[^&]+/, 'apiKey=***REDACTED***')}`);
  const start = Date.now();
  const res = await fetch(url);
  const elapsed = Date.now() - start;
  const remaining = res.headers.get('x-requests-remaining');
  const used = res.headers.get('x-requests-used');
  console.log(`  ← HTTP ${res.status} (${elapsed}ms) | Remaining: ${remaining ?? 'N/A'} | Used: ${used ?? 'N/A'}`);
  if (!res.ok) {
    const body = await res.text();
    console.error(`  [!] ${label} FAILED: ${body}`);
    return null;
  }
  return await res.json();
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  ODDS API PIPELINE DIAGNOSTIC');
  console.log('  ' + new Date().toISOString());
  console.log('═══════════════════════════════════════════════════════════════');

  // ── 1. API Key ──────────────────────────────────────────────────────────────
  console.log('\n[1] API KEY RESOLUTION');
  const { key, source } = getApiKey();
  if (!key) {
    console.error('  ✗ No API key found! Checked: .project-config.json, .env, process.env');
    process.exit(1);
  }
  console.log(`  ✓ Key found via: ${source}`);
  console.log(`  ✓ Key length: ${key.length} chars | Prefix: ${key.slice(0, 8)}...`);

  // ── 2. Active Window Check ──────────────────────────────────────────────────
  console.log('\n[2] ACTIVE WINDOW CHECK');
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = nowET.getHours();
  const minute = nowET.getMinutes();
  const inWindow = hour >= 9 && !(hour > 23) && !(hour === 23 && minute > 30);
  console.log(`  Current ET time: ${nowET.toLocaleTimeString('en-US', { timeZone: 'America/New_York' })}`);
  console.log(`  Active window (9AM–11:30PM ET): ${inWindow ? '✓ INSIDE' : '✗ OUTSIDE — API calls are BLOCKED by time gate'}`);
  if (!inWindow) {
    console.warn('  ⚠️  The isWithinActiveWindow() guard will prevent any API calls from running!');
    console.warn('  ⚠️  This is the most likely reason no data is being fetched.');
  }

  // ── 3. Events endpoint ──────────────────────────────────────────────────────
  console.log('\n[3] MLB EVENTS ENDPOINT');
  const eventsUrl = `${ODDS_API_BASE}/sports/${SPORT}/events?apiKey=${key}`;
  const events = await fetchJSON(eventsUrl, 'Events');
  if (!events || !Array.isArray(events) || events.length === 0) {
    console.error('  ✗ No events returned! Cannot proceed with market checks.');
    process.exit(1);
  }
  console.log(`  ✓ ${events.length} events found today`);
  const firstEvent = events[0];
  console.log(`  First event: ${firstEvent.away_team} @ ${firstEvent.home_team}`);
  console.log(`  Event ID: ${firstEvent.id}`);
  console.log(`  Commence: ${firstEvent.commence_time}`);
  console.log('\n  All events:');
  events.forEach((e, i) => {
    console.log(`    ${i + 1}. [${e.id}] ${e.away_team} @ ${e.home_team} — ${e.commence_time}`);
  });

  // ── 4. Money Pick (HRR Batter) Markets ─────────────────────────────────────
  console.log('\n[4] MONEY PICK (HRR BATTER) MARKETS — First game');
  const hrrMarkets = [
    'batter_hits_runs_rbis',
    'batter_hits_runs_rbis_alternate',
    'batter_hits',
    'batter_runs_scored',
    'batter_rbis',
  ].join(',');
  const hrrUrl = `${ODDS_API_BASE}/sports/${SPORT}/events/${firstEvent.id}/odds?apiKey=${key}&regions=us&markets=${hrrMarkets}&oddsFormat=american`;
  const hrrData = await fetchJSON(hrrUrl, 'HRR Markets');
  if (!hrrData) {
    console.error('  ✗ HRR market fetch failed');
  } else {
    const bookmakers = hrrData.bookmakers || [];
    console.log(`  ✓ ${bookmakers.length} bookmakers returned`);
    if (bookmakers.length === 0) {
      console.warn('  ⚠️  No bookmakers! This means no HRR props are available for this game.');
    }
    for (const bk of bookmakers) {
      const marketKeys = bk.markets.map(m => m.key);
      const totalOutcomes = bk.markets.reduce((s, m) => s + (m.outcomes?.length ?? 0), 0);
      console.log(`    ${bk.key} (${bk.title}): markets=[${marketKeys.join(', ')}] | outcomes=${totalOutcomes}`);
    }
    // Show sample player data from first bookmaker
    if (bookmakers.length > 0) {
      const bk = bookmakers[0];
      const hrrMarket = bk.markets.find(m => m.key === 'batter_hits_runs_rbis');
      if (hrrMarket) {
        console.log(`\n  Sample batter_hits_runs_rbis outcomes from ${bk.title} (first 6):`);
        const players = new Map();
        for (const o of hrrMarket.outcomes) {
          const existing = players.get(o.name) || [];
          existing.push(o);
          players.set(o.name, existing);
        }
        let count = 0;
        for (const [name, outs] of players.entries()) {
          if (count++ >= 6) break;
          const over = outs.find(o => o.description === 'Over');
          const under = outs.find(o => o.description === 'Under');
          console.log(`    ${name}: line=${over?.point ?? '?'} over=${over?.price ?? '?'} under=${under?.price ?? '?'}`);
        }
        console.log(`  Total unique players in batter_hits_runs_rbis: ${players.size}`);
      } else {
        console.warn(`  ⚠️  No batter_hits_runs_rbis market found in ${bk.title}`);
        console.log(`  Available markets: ${bk.markets.map(m => m.key).join(', ')}`);
      }
    }
  }

  // ── 5. Pitcher Strikeout Markets ────────────────────────────────────────────
  console.log('\n[5] PITCHER STRIKEOUT MARKETS — First game');
  const pitcherMarkets = [
    'pitcher_strikeouts',
    'pitcher_strikeouts_alternate',
    'pitcher_walks',
    'pitcher_walks_alternate',
  ].join(',');
  const pitcherUrl = `${ODDS_API_BASE}/sports/${SPORT}/events/${firstEvent.id}/odds?apiKey=${key}&regions=us&markets=${pitcherMarkets}&oddsFormat=american`;
  const pitcherData = await fetchJSON(pitcherUrl, 'Pitcher Markets');
  if (!pitcherData) {
    console.error('  ✗ Pitcher market fetch failed');
  } else {
    const bookmakers = pitcherData.bookmakers || [];
    console.log(`  ✓ ${bookmakers.length} bookmakers returned`);
    if (bookmakers.length === 0) {
      console.warn('  ⚠️  No bookmakers for pitcher markets on this game!');
      console.warn('  ⚠️  This may be normal if the game has no pitcher props posted yet.');
    }
    for (const bk of bookmakers) {
      const marketSummary = bk.markets.map(m => `${m.key}(${m.outcomes?.length ?? 0})`).join(', ');
      console.log(`    ${bk.key}: ${marketSummary}`);
    }

    // Detailed analysis of pitcher_strikeouts
    for (const bk of bookmakers) {
      const kMarket = bk.markets.find(m => m.key === 'pitcher_strikeouts');
      if (kMarket && kMarket.outcomes.length > 0) {
        console.log(`\n  Sample pitcher_strikeouts from ${bk.title}:`);
        // Detect layout
        const firstOut = kMarket.outcomes[0];
        const isPitcherLayout = firstOut.name === 'Over' || firstOut.name === 'Under';
        console.log(`    Layout: ${isPitcherLayout ? 'pitcher (name=Over/Under, description=pitcher)' : 'batter (name=player, description=Over/Under)'}`);
        
        // Group by pitcher
        const pitchers = new Map();
        for (const o of kMarket.outcomes) {
          const key = isPitcherLayout ? o.description : o.name;
          const existing = pitchers.get(key) || [];
          existing.push(o);
          pitchers.set(key, existing);
        }
        let count = 0;
        for (const [name, outs] of pitchers.entries()) {
          if (count++ >= 4) break;
          const over = isPitcherLayout ? outs.find(o => o.name === 'Over') : outs.find(o => o.description === 'Over');
          const under = isPitcherLayout ? outs.find(o => o.name === 'Under') : outs.find(o => o.description === 'Under');
          console.log(`    ${name}: line=${over?.point ?? '?'} over=${over?.price ?? '?'} under=${under?.price ?? '?'}`);
        }
        console.log(`    Total pitchers: ${pitchers.size}`);
        break;
      }
    }

    // Detailed analysis of pitcher_strikeouts_alternate
    for (const bk of bookmakers) {
      const altKMarket = bk.markets.find(m => m.key === 'pitcher_strikeouts_alternate');
      if (altKMarket && altKMarket.outcomes.length > 0) {
        console.log(`\n  Sample pitcher_strikeouts_alternate from ${bk.title}:`);
        const firstOut = altKMarket.outcomes[0];
        const isPitcherLayout = firstOut.name === 'Over' || firstOut.name === 'Under';
        console.log(`    Layout: ${isPitcherLayout ? 'pitcher (name=Over/Under, description=pitcher)' : 'batter (name=player, description=Over/Under)'}`);
        const pitchers = new Map();
        for (const o of altKMarket.outcomes) {
          const key = isPitcherLayout ? o.description : o.name;
          const existing = pitchers.get(key) || [];
          existing.push(o);
          pitchers.set(key, existing);
        }
        let count = 0;
        for (const [name, outs] of pitchers.entries()) {
          if (count++ >= 2) break;
          const overs = isPitcherLayout ? outs.filter(o => o.name === 'Over') : outs.filter(o => o.description === 'Over');
          console.log(`    ${name}: ${overs.length} alt K lines — ${overs.map(o => `${o.point}(${o.price})`).join(', ')}`);
        }
        console.log(`    Total pitchers with alt K lines: ${pitchers.size}`);
        break;
      }
    }

    // Detailed analysis of pitcher_walks
    for (const bk of bookmakers) {
      const walkMarket = bk.markets.find(m => m.key === 'pitcher_walks');
      if (walkMarket && walkMarket.outcomes.length > 0) {
        console.log(`\n  Sample pitcher_walks from ${bk.title}:`);
        const firstOut = walkMarket.outcomes[0];
        const isPitcherLayout = firstOut.name === 'Over' || firstOut.name === 'Under';
        console.log(`    Layout: ${isPitcherLayout ? 'pitcher (name=Over/Under, description=pitcher)' : 'batter (name=player, description=Over/Under)'}`);
        const pitchers = new Map();
        for (const o of walkMarket.outcomes) {
          const key = isPitcherLayout ? o.description : o.name;
          const existing = pitchers.get(key) || [];
          existing.push(o);
          pitchers.set(key, existing);
        }
        let count = 0;
        for (const [name, outs] of pitchers.entries()) {
          if (count++ >= 4) break;
          const over = isPitcherLayout ? outs.find(o => o.name === 'Over') : outs.find(o => o.description === 'Over');
          const under = isPitcherLayout ? outs.find(o => o.name === 'Under') : outs.find(o => o.description === 'Under');
          console.log(`    ${name}: line=${over?.point ?? '?'} over=${over?.price ?? '?'} under=${under?.price ?? '?'}`);
        }
        console.log(`    Total pitchers with walk lines: ${pitchers.size}`);
        break;
      }
    }

    // Detailed analysis of pitcher_walks_alternate
    for (const bk of bookmakers) {
      const altWalkMarket = bk.markets.find(m => m.key === 'pitcher_walks_alternate');
      if (altWalkMarket && altWalkMarket.outcomes.length > 0) {
        console.log(`\n  Sample pitcher_walks_alternate from ${bk.title}:`);
        const firstOut = altWalkMarket.outcomes[0];
        const isPitcherLayout = firstOut.name === 'Over' || firstOut.name === 'Under';
        console.log(`    Layout: ${isPitcherLayout ? 'pitcher (name=Over/Under, description=pitcher)' : 'batter (name=player, description=Over/Under)'}`);
        const pitchers = new Map();
        for (const o of altWalkMarket.outcomes) {
          const key = isPitcherLayout ? o.description : o.name;
          const existing = pitchers.get(key) || [];
          existing.push(o);
          pitchers.set(key, existing);
        }
        let count = 0;
        for (const [name, outs] of pitchers.entries()) {
          if (count++ >= 2) break;
          const overs = isPitcherLayout ? outs.filter(o => o.name === 'Over') : outs.filter(o => o.description === 'Over');
          console.log(`    ${name}: ${overs.length} alt walk lines — ${overs.map(o => `${o.point}(${o.price})`).join(', ')}`);
        }
        console.log(`    Total pitchers with alt walk lines: ${pitchers.size}`);
        break;
      }
    }
  }

  // ── 6. Second game check (pitcher markets can differ per game) ──────────────
  if (events.length > 1) {
    const secondEvent = events[1];
    console.log(`\n[6] PITCHER MARKETS — Second game: ${secondEvent.away_team} @ ${secondEvent.home_team}`);
    const url2 = `${ODDS_API_BASE}/sports/${SPORT}/events/${secondEvent.id}/odds?apiKey=${key}&regions=us&markets=${pitcherMarkets}&oddsFormat=american`;
    const data2 = await fetchJSON(url2, 'Pitcher Markets Game 2');
    if (data2) {
      const bks = data2.bookmakers || [];
      console.log(`  ${bks.length} bookmakers`);
      for (const bk of bks) {
        const summary = bk.markets.map(m => `${m.key}(${m.outcomes?.length ?? 0})`).join(', ');
        console.log(`    ${bk.key}: ${summary}`);
      }
    }
  }

  // ── 7. Full pipeline simulation for all games ───────────────────────────────
  console.log('\n[7] FULL PIPELINE SIMULATION — All games (pitcher markets)');
  console.log('  Fetching pitcher props for all events...');
  
  const allBookmakers = [];
  let gamesWithData = 0;
  let gamesWithoutData = 0;
  const marketCounts = {
    pitcher_strikeouts: 0,
    pitcher_strikeouts_alternate: 0,
    pitcher_walks: 0,
    pitcher_walks_alternate: 0,
  };

  for (const event of events) {
    const url = `${ODDS_API_BASE}/sports/${SPORT}/events/${event.id}/odds?apiKey=${key}&regions=us&markets=${pitcherMarkets}&oddsFormat=american`;
    const data = await fetchJSON(url, `Event ${event.id}`);
    if (data && data.bookmakers && data.bookmakers.length > 0) {
      gamesWithData++;
      allBookmakers.push(...data.bookmakers);
      for (const bk of data.bookmakers) {
        for (const m of bk.markets) {
          if (marketCounts[m.key] !== undefined) {
            marketCounts[m.key] += m.outcomes?.length ?? 0;
          }
        }
      }
    } else {
      gamesWithoutData++;
      console.log(`    No pitcher data for: ${event.away_team} @ ${event.home_team}`);
    }
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n  Games with pitcher data: ${gamesWithData}/${events.length}`);
  console.log(`  Games without pitcher data: ${gamesWithoutData}/${events.length}`);
  console.log('\n  Total outcome counts across all games:');
  for (const [market, count] of Object.entries(marketCounts)) {
    console.log(`    ${market}: ${count} outcomes`);
  }

  // ── 8. Parser simulation ────────────────────────────────────────────────────
  console.log('\n[8] PARSER SIMULATION');
  
  // Inline simplified parser to test
  const pitcherMap = new Map();
  const preferredBooks = ['fanduel', 'draftkings', 'bet365', 'betmgm', 'pointsbet'];
  const sortedBookmakers = [...allBookmakers].sort((a, b) => {
    const aIdx = preferredBooks.indexOf(a.key);
    const bIdx = preferredBooks.indexOf(b.key);
    return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
  });

  let mainKParsed = 0;
  let altKParsed = 0;
  let walkParsed = 0;
  let altWalkParsed = 0;
  let layoutMismatchWarnings = [];

  for (const bookmaker of sortedBookmakers) {
    for (const market of bookmaker.markets) {
      const outcomes = market.outcomes || [];
      if (outcomes.length === 0) continue;

      const firstOut = outcomes[0];
      const isPitcherLayout = firstOut.name === 'Over' || firstOut.name === 'Under';
      
      if (!isPitcherLayout) {
        layoutMismatchWarnings.push(`${bookmaker.key}/${market.key}: first outcome name="${firstOut.name}" — treated as BATTER layout`);
      }

      const pitcherOutcomes = new Map();
      for (const outcome of outcomes) {
        const groupKey = isPitcherLayout ? (outcome.description || '') : outcome.name;
        if (!groupKey) continue;
        const existing = pitcherOutcomes.get(groupKey) || [];
        existing.push(outcome);
        pitcherOutcomes.set(groupKey, existing);
      }

      for (const [pitcherName, pOutcomes] of pitcherOutcomes.entries()) {
        if (!pitcherMap.has(pitcherName)) {
          pitcherMap.set(pitcherName, { mainKLine: null, altKLines: [], walkLines: [] });
        }
        const pd = pitcherMap.get(pitcherName);

        const overOutcome = isPitcherLayout
          ? pOutcomes.find(o => o.name === 'Over')
          : pOutcomes.find(o => o.description === 'Over');
        if (!overOutcome) continue;

        const line = overOutcome.point;

        if (market.key === 'pitcher_strikeouts' && pd.mainKLine === null) {
          pd.mainKLine = line;
          mainKParsed++;
        } else if (market.key === 'pitcher_strikeouts_alternate') {
          if (!pd.altKLines.includes(line)) { pd.altKLines.push(line); altKParsed++; }
        } else if (market.key === 'pitcher_walks') {
          if (!pd.walkLines.includes(line)) { pd.walkLines.push(line); walkParsed++; }
        } else if (market.key === 'pitcher_walks_alternate') {
          if (!pd.walkLines.includes(line)) { pd.walkLines.push(line); altWalkParsed++; }
        }
      }
    }
  }

  console.log(`  Pitchers parsed: ${pitcherMap.size}`);
  console.log(`  Main K lines parsed: ${mainKParsed}`);
  console.log(`  Alt K lines parsed: ${altKParsed}`);
  console.log(`  Walk lines parsed (main): ${walkParsed}`);
  console.log(`  Walk lines parsed (alternate): ${altWalkParsed}`);

  if (layoutMismatchWarnings.length > 0) {
    console.warn(`\n  ⚠️  Layout detection warnings (${layoutMismatchWarnings.length}):`);
    for (const w of layoutMismatchWarnings.slice(0, 10)) {
      console.warn(`    ${w}`);
    }
  }

  console.log('\n  Pitcher breakdown (first 10):');
  let count = 0;
  for (const [name, pd] of pitcherMap.entries()) {
    if (count++ >= 10) break;
    console.log(`    ${name}: mainK=${pd.mainKLine ?? 'null'} | altKLines=[${pd.altKLines.join(', ')}] | walkLines=[${pd.walkLines.join(', ')}]`);
  }

  // ── 9. HRR Market parser simulation ────────────────────────────────────────
  console.log('\n[9] HRR BATTER MARKET PARSER SIMULATION — First game');
  const hrrRaw = await fetchJSON(
    `${ODDS_API_BASE}/sports/${SPORT}/events/${firstEvent.id}/odds?apiKey=${key}&regions=us&markets=batter_hits_runs_rbis,batter_hits_runs_rbis_alternate&oddsFormat=american`,
    'HRR Parser Test'
  );
  if (hrrRaw) {
    const bks = hrrRaw.bookmakers || [];
    const playerMap = new Map();
    for (const bk of bks) {
      for (const market of bk.markets) {
        for (const outcome of (market.outcomes || [])) {
          if (!playerMap.has(outcome.name)) playerMap.set(outcome.name, { lines: [] });
          const pd = playerMap.get(outcome.name);
          if (outcome.description === 'Over' && !pd.lines.includes(outcome.point)) {
            pd.lines.push(outcome.point);
          }
        }
      }
    }
    console.log(`  Players with HRR lines: ${playerMap.size}`);
    let c = 0;
    for (const [name, pd] of playerMap.entries()) {
      if (c++ >= 8) break;
      console.log(`    ${name}: lines=[${pd.lines.sort((a,b)=>a-b).join(', ')}]`);
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  DIAGNOSTIC SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  API Key: ${key ? '✓ Present' : '✗ MISSING'}`);
  console.log(`  Active Window: ${inWindow ? '✓ Inside (9AM–11:30PM ET)' : '✗ OUTSIDE — API calls blocked'}`);
  console.log(`  Events today: ${events?.length ?? 0}`);
  console.log(`  Pitchers with data: ${pitcherMap.size}`);
  console.log(`  Main K lines: ${mainKParsed}`);
  console.log(`  Alt K lines: ${altKParsed}`);
  console.log(`  Walk lines (main): ${walkParsed}`);
  console.log(`  Walk lines (alt): ${altWalkParsed}`);
  
  if (!inWindow) {
    console.log('\n  ⚠️  ROOT CAUSE: isWithinActiveWindow() is returning false.');
    console.log('  ⚠️  The app will NOT call the Odds API outside 9AM–11:30PM ET.');
    console.log('  ⚠️  To fix: either widen the window, or force a cache bust via Admin panel.');
  }
  
  console.log('\n  Done.');
}

main().catch(err => {
  console.error('Diagnostic script error:', err);
  process.exit(1);
});
