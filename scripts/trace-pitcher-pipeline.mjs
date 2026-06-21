/**
 * Pitcher Pipeline Trace Script
 * 
 * Traces the full pipeline for one pitcher:
 *   1. Fetch today's MLB games (probable pitchers)
 *   2. Fetch pitcher odds from Odds API
 *   3. Attempt name matching (same logic as PitcherEdgeEngine)
 *   4. Log: raw API odds, cached odds, match result, edge calculation
 *   5. Identify exact break point
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// ── Load API key ──────────────────────────────────────────────────────────────
function getApiKey() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(projectRoot, '.project-config.json'), 'utf8'));
    return cfg?.secrets?.ODDS_API_KEY || '';
  } catch { return process.env.ODDS_API_KEY || ''; }
}

// ── Normalize name (same logic as pitcherEdgeEngine.ts) ──────────────────────
const normalize = (n) => n.toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

// ── American odds helpers ─────────────────────────────────────────────────────
function americanToImplied(odds) {
  if (odds < 0) return Math.abs(odds) / (Math.abs(odds) + 100);
  return 100 / (odds + 100);
}
function removeVig(overProb, underProb) {
  const total = overProb + underProb;
  return { trueOver: overProb / total, trueUnder: underProb / total };
}
function probToAmerican(prob) {
  if (prob >= 0.5) return Math.round(-(prob / (1 - prob)) * 100);
  return Math.round(((1 - prob) / prob) * 100);
}

// ── Step 1: Fetch today's MLB probable pitchers ───────────────────────────────
async function fetchMLBProbablePitchers() {
  const today = new Date().toISOString().split('T')[0];
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${today}&hydrate=probablePitcher(note),team,linescore`;
  const res = await fetch(url);
  const data = await res.json();
  
  const pitchers = [];
  for (const date of (data.dates || [])) {
    for (const game of (date.games || [])) {
      const home = game.teams?.home;
      const away = game.teams?.away;
      const gameTime = game.gameDate;
      
      if (home?.probablePitcher) {
        pitchers.push({
          fullName: home.probablePitcher.fullName,
          id: home.probablePitcher.id,
          team: home.team?.abbreviation || home.team?.name,
          opponent: away?.team?.abbreviation || away?.team?.name,
          gameTime,
          side: 'home',
        });
      }
      if (away?.probablePitcher) {
        pitchers.push({
          fullName: away.probablePitcher.fullName,
          id: away.probablePitcher.id,
          team: away.team?.abbreviation || away.team?.name,
          opponent: home?.team?.abbreviation || home?.team?.name,
          gameTime,
          side: 'away',
        });
      }
    }
  }
  return pitchers;
}

// ── Step 2: Fetch Odds API events ─────────────────────────────────────────────
async function fetchMLBEvents(apiKey) {
  const res = await fetch(`https://api.the-odds-api.com/v4/sports/baseball_mlb/events?apiKey=${apiKey}`);
  return await res.json();
}

// ── Step 3: Fetch pitcher props for all events ────────────────────────────────
async function fetchPitcherProps(apiKey, eventId) {
  const markets = 'pitcher_strikeouts,pitcher_strikeouts_alternate,pitcher_walks,pitcher_walks_alternate';
  const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${eventId}/odds?apiKey=${apiKey}&regions=us&markets=${markets}&oddsFormat=american`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return data?.bookmakers || [];
}

// ── Step 4: Parse pitcher data (same logic as oddsApiService.ts) ──────────────
function parsePitcherData(bookmakers) {
  const pitcherMap = new Map();
  const preferredBooks = ['fanduel', 'draftkings', 'bet365', 'betmgm', 'pointsbet'];
  
  const sorted = [...bookmakers].sort((a, b) => {
    const ai = preferredBooks.indexOf(a.key);
    const bi = preferredBooks.indexOf(b.key);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  for (const bk of sorted) {
    for (const market of bk.markets) {
      const outcomes = market.outcomes || [];
      
      // Detect layout: pitcher markets use name=Over/Under, description=pitcher name
      const isPitcherMarket = outcomes.length > 0 &&
        (outcomes[0].name === 'Over' || outcomes[0].name === 'Under');
      
      const groups = new Map();
      for (const o of outcomes) {
        const groupKey = isPitcherMarket ? (o.description || '') : o.name;
        if (!groupKey) continue;
        const arr = groups.get(groupKey) || [];
        arr.push(o);
        groups.set(groupKey, arr);
      }
      
      for (const [pitcherName, outs] of groups.entries()) {
        if (!pitcherMap.has(pitcherName)) {
          pitcherMap.set(pitcherName, {
            pitcherName,
            mainKLine: null,
            mainKOverOdds: null,
            altKLines: [],
            walkLines: [],
            bookmaker: bk.title,
          });
        }
        const pd = pitcherMap.get(pitcherName);
        
        const overOut = isPitcherMarket
          ? outs.find(o => o.name === 'Over')
          : outs.find(o => o.description === 'Over');
        const underOut = isPitcherMarket
          ? outs.find(o => o.name === 'Under')
          : outs.find(o => o.description === 'Under');
        if (!overOut) continue;
        
        const overOdds = overOut.price;
        const underOdds = underOut?.price ?? (overOdds < 0 ? 100 : -110);
        const line = overOut.point;
        const overImplied = americanToImplied(overOdds);
        const underImplied = americanToImplied(underOdds);
        const { trueOver } = removeVig(overImplied, underImplied);
        
        if (market.key === 'pitcher_strikeouts' && pd.mainKLine === null) {
          pd.mainKLine = line;
          pd.mainKOverOdds = overOdds;
          if (!pd.altKLines.some(l => l.line === line)) {
            pd.altKLines.push({ line, overOdds, underOdds, trueOverProb: trueOver });
          }
        } else if (market.key === 'pitcher_strikeouts_alternate') {
          if (!pd.altKLines.some(l => l.line === line)) {
            pd.altKLines.push({ line, overOdds, underOdds, trueOverProb: trueOver });
          }
        } else if (market.key === 'pitcher_walks' || market.key === 'pitcher_walks_alternate') {
          if (!pd.walkLines.some(l => l.line === line)) {
            pd.walkLines.push({ line, overOdds, underOdds, trueOverProb: trueOver });
          }
        }
      }
    }
  }
  
  // Sort lines
  pitcherMap.forEach(pd => {
    pd.altKLines.sort((a, b) => a.line - b.line);
    pd.walkLines.sort((a, b) => a.line - b.line);
  });
  
  return pitcherMap;
}

// ── Step 5: Name matching (same logic as pitcherEdgeEngine.ts) ────────────────
function findMarketData(pitcherName, pitcherMarketMap) {
  // Direct match
  let marketData = pitcherMarketMap.get(pitcherName);
  if (marketData) return { marketData, matchType: 'DIRECT', matchedKey: pitcherName };
  
  const normTarget = normalize(pitcherName);
  const lastName = normTarget.split(' ').slice(-1)[0];
  
  for (const [key, val] of pitcherMarketMap.entries()) {
    const normKey = normalize(key);
    if (normKey === normTarget) return { marketData: val, matchType: 'NORMALIZED', matchedKey: key };
    
    const keyLastName = normKey.split(' ').slice(-1)[0];
    const keyFirstInitial = normKey.split(' ')[0]?.[0] ?? '';
    const targetFirstInitial = normTarget.split(' ')[0]?.[0] ?? '';
    if (keyLastName === lastName && keyFirstInitial === targetFirstInitial) {
      return { marketData: val, matchType: 'INITIAL_MATCH', matchedKey: key };
    }
  }
  
  return { marketData: null, matchType: 'NO_MATCH', matchedKey: null };
}

// ── Main ──────────────────────────────────────────────────────────────────────
const apiKey = getApiKey();
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  PITCHER PIPELINE TRACE — FULL END-TO-END DIAGNOSTIC');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log('STEP 1: Fetching today\'s MLB probable pitchers from Stats API...');
const mlbPitchers = await fetchMLBProbablePitchers();
console.log(`  → ${mlbPitchers.length} probable pitchers found\n`);

if (mlbPitchers.length === 0) {
  console.log('  ⚠ No probable pitchers found. Games may not have starters posted yet.');
  process.exit(0);
}

console.log('  MLB Probable Pitchers:');
for (const p of mlbPitchers) {
  console.log(`    ${p.fullName} (${p.team} vs ${p.opponent})`);
}

console.log('\nSTEP 2: Fetching MLB game events from Odds API...');
const events = await fetchMLBEvents(apiKey);
console.log(`  → ${events.length} events found\n`);

console.log('STEP 3: Fetching pitcher props for all events...');
const allBookmakers = [];
let apiCallCount = 0;
const chunks = [];
for (let i = 0; i < events.length; i += 5) chunks.push(events.slice(i, i + 5));

for (const chunk of chunks) {
  const results = await Promise.allSettled(chunk.map(e => fetchPitcherProps(apiKey, e.id)));
  apiCallCount += chunk.length;
  for (const r of results) {
    if (r.status === 'fulfilled') allBookmakers.push(...r.value);
  }
}
console.log(`  → Fetched ${apiCallCount} events, got bookmaker data from ${allBookmakers.length} bookmaker-event combos\n`);

console.log('STEP 4: Parsing pitcher data...');
const pitcherMarketMap = parsePitcherData(allBookmakers);
console.log(`  → Parsed ${pitcherMarketMap.size} pitchers in odds cache\n`);
console.log('  Odds API Cache Keys:');
for (const [name, pd] of pitcherMarketMap.entries()) {
  const kStr = pd.altKLines.map(l => `${l.line}K(${l.overOdds > 0 ? '+' : ''}${l.overOdds})`).join(', ');
  const wStr = pd.walkLines.map(l => `${l.line}BB(${l.overOdds > 0 ? '+' : ''}${l.overOdds})`).join(', ');
  console.log(`    "${name}" | K: [${kStr || 'none'}] | BB: [${wStr || 'none'}]`);
}

console.log('\nSTEP 5: Name matching — MLB names vs Odds API cache keys...');
console.log('─────────────────────────────────────────────────────────────');

let matchCount = 0;
let noMatchCount = 0;

for (const pitcher of mlbPitchers) {
  const { marketData, matchType, matchedKey } = findMarketData(pitcher.fullName, pitcherMarketMap);
  
  if (matchType === 'NO_MATCH') {
    noMatchCount++;
    console.log(`  ✗ NO MATCH: "${pitcher.fullName}" (${pitcher.team})`);
    // Show closest candidates
    const normTarget = normalize(pitcher.fullName);
    const lastName = normTarget.split(' ').slice(-1)[0];
    const candidates = [];
    for (const key of pitcherMarketMap.keys()) {
      const normKey = normalize(key);
      if (normKey.includes(lastName) || lastName.includes(normKey.split(' ').slice(-1)[0])) {
        candidates.push(key);
      }
    }
    if (candidates.length > 0) {
      console.log(`    Possible matches in cache: ${candidates.map(c => `"${c}"`).join(', ')}`);
    } else {
      console.log(`    No similar names in cache (pitcher may not have odds posted)`);
    }
  } else {
    matchCount++;
    const kCount = marketData.altKLines.length;
    const wCount = marketData.walkLines.length;
    console.log(`  ✓ ${matchType}: "${pitcher.fullName}" → "${matchedKey}" | ${kCount} K lines, ${wCount} BB lines`);
    
    // Show detailed odds for matched pitcher
    if (marketData.altKLines.length > 0) {
      const kLine = marketData.altKLines.find(l => l.line === marketData.mainKLine) || marketData.altKLines[0];
      const edge = 0.65 - kLine.trueOverProb; // example model prob
      console.log(`    Main K line: ${kLine.line} | Book: ${kLine.overOdds > 0 ? '+' : ''}${kLine.overOdds} | True prob: ${(kLine.trueOverProb * 100).toFixed(1)}% | hasMarketData: true`);
    }
  }
}

console.log('\n─────────────────────────────────────────────────────────────');
console.log(`MATCH SUMMARY: ${matchCount} matched, ${noMatchCount} unmatched out of ${mlbPitchers.length} MLB pitchers`);

if (noMatchCount > 0) {
  console.log('\n⚠ BREAK POINT IDENTIFIED: Name mismatch between MLB Stats API and Odds API');
  console.log('  The engine uses string matching only — no pitcher ID or event ID join.');
  console.log('  Unmatched pitchers will show: Book=—, Edge=0%, hasMarketData=false');
}

// ── Step 6: Deep trace for first matched pitcher ──────────────────────────────
const firstMatched = mlbPitchers.find(p => findMarketData(p.fullName, pitcherMarketMap).marketData);
if (firstMatched) {
  const { marketData, matchedKey } = findMarketData(firstMatched.fullName, pitcherMarketMap);
  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`  DEEP TRACE: ${firstMatched.fullName} (${firstMatched.team} vs ${firstMatched.opponent})`);
  console.log(`═══════════════════════════════════════════════════════════════`);
  console.log(`  Odds API key: "${matchedKey}"`);
  console.log(`  Main K line: ${marketData.mainKLine}`);
  console.log(`  Bookmaker: ${marketData.bookmaker}`);
  console.log('\n  All K Lines:');
  for (const kl of marketData.altKLines) {
    const fairOdds = probToAmerican(0.65); // example model prob
    const impliedStr = (kl.trueOverProb * 100).toFixed(1);
    console.log(`    ${kl.line}K | Book: ${kl.overOdds > 0 ? '+' : ''}${kl.overOdds} | Under: ${kl.underOdds > 0 ? '+' : ''}${kl.underOdds} | True prob: ${impliedStr}% | hasMarketData: ${kl.overOdds !== 0}`);
  }
  console.log('\n  All BB Lines:');
  if (marketData.walkLines.length === 0) {
    console.log('    (none — pitcher_walks not posted for this pitcher today)');
  }
  for (const wl of marketData.walkLines) {
    const impliedStr = (wl.trueOverProb * 100).toFixed(1);
    console.log(`    ${wl.line}BB | Book: ${wl.overOdds > 0 ? '+' : ''}${wl.overOdds} | Under: ${wl.underOdds > 0 ? '+' : ''}${wl.underOdds} | True prob: ${impliedStr}% | hasMarketData: ${wl.overOdds !== 0}`);
  }
}

// ── Step 7: Check active window ───────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  ACTIVE WINDOW CHECK');
console.log('═══════════════════════════════════════════════════════════════');
const now = new Date();
const etOffset = -4; // EDT
const etHour = (now.getUTCHours() + etOffset + 24) % 24;
const etMin = now.getUTCMinutes();
const inWindow = (etHour >= 9) && (etHour < 23 || (etHour === 23 && etMin <= 30));
console.log(`  Current ET time: ${etHour}:${String(etMin).padStart(2,'0')}`);
console.log(`  Active window (9AM–11:30PM ET): ${inWindow ? '✓ OPEN' : '✗ CLOSED — fetches are blocked!'}`);
if (!inWindow) {
  console.log('  ⚠ BREAK POINT: isWithinActiveWindow() returns false — fetchPitcherMarketData() returns empty map');
}

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  TRACE COMPLETE');
console.log('═══════════════════════════════════════════════════════════════\n');
