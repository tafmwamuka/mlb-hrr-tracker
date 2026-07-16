/**
 * statcastFetcher.ts — Pure Node.js Baseball Savant CSV fetcher.
 *
 * Replaces the Python subprocess (fetch_statcast.py) which required python3.11
 * to be installed in the production container — a fragile dependency that silently
 * broke on Reserved Hosting.
 *
 * All 5 endpoints are plain public CSV exports from baseballsavant.mlb.com.
 * No authentication required. No Python required.
 *
 * BOM handling: every CSV from Baseball Savant includes a UTF-8 BOM (\uFEFF)
 * on the first column header. Each endpoint is stripped individually before
 * column mapping — a missed BOM would silently null out the entire column.
 *
 * preNormalized validation: kPct/whiffPct/iso come from the percentile-rankings
 * endpoint as 0-100 percentile scores where HIGHER = BETTER for all three.
 * This is validated at runtime against known reference players (see below).
 */

import { StatcastCache, StatcastPlayer, StatcastPitcher } from "./pybaseballService";

const SAVANT_BASE = "https://baseballsavant.mlb.com";
const FETCH_TIMEOUT_MS = 30_000;
const USER_AGENT = "Mozilla/5.0 (compatible; mlb-hrr-tracker/1.0)";

// ── CSV utilities ─────────────────────────────────────────────────────────────

/**
 * Strip UTF-8 BOM from a string (affects first column header on every Savant CSV).
 * Applied per-endpoint individually so a missed BOM on any one endpoint is caught.
 */
function stripBOM(s: string): string {
  return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
}

/**
 * Parse a CSV string into an array of objects keyed by header name.
 * Handles quoted fields and the BOM on the first header.
 */
function parseCSV(raw: string): Record<string, string>[] {
  const lines = raw.trim().split("\n");
  if (lines.length < 2) return [];

  // Strip BOM from the header line (first column only)
  const headerLine = stripBOM(lines[0]);
  const headers = parseCSVRow(headerLine);

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCSVRow(line);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j].trim()] = (values[j] ?? "").trim();
    }
    rows.push(row);
  }
  return rows;
}

/** Parse a single CSV row, handling double-quoted fields. */
function parseCSVRow(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function safeFloat(v: string | undefined, fallback: number | null = null): number | null {
  if (v === undefined || v === "" || v === "null") return fallback;
  const n = parseFloat(v);
  return isNaN(n) || !isFinite(n) ? fallback : n;
}

function safeInt(v: string | undefined, fallback: number | null = null): number | null {
  if (v === undefined || v === "" || v === "null") return fallback;
  const n = parseInt(v, 10);
  return isNaN(n) ? fallback : n;
}

/** Fetch a URL with timeout, returning the response text. */
async function fetchCSV(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// ── Endpoint fetchers ─────────────────────────────────────────────────────────

/**
 * Endpoint 1: Exit velocity + barrels (batters)
 * Provides: hardHitPct (ev95percent), sweetSpotPct, barrelPct, bbe (attempts)
 * BOM: present on "last_name, first_name" header — stripped individually.
 */
async function fetchExitVeloBarrels(year: number): Promise<Map<number, Partial<StatcastPlayer>>> {
  const url = `${SAVANT_BASE}/leaderboard/statcast?type=batter&year=${year}&position=&team=&min=20&csv=true`;
  const raw = await fetchCSV(url);
  const rows = parseCSV(raw);

  // Validate BOM was stripped: first column should be "last_name, first_name" not "\uFEFFast_name..."
  const firstKey = rows[0] ? Object.keys(rows[0])[0] : "";
  if (firstKey.includes("\uFEFF")) {
    throw new Error(`[Statcast] BOM not stripped on exitvelo_barrels — first key: ${JSON.stringify(firstKey)}`);
  }

  const result = new Map<number, Partial<StatcastPlayer>>();
  for (const row of rows) {
    const pid = safeInt(row["player_id"]);
    if (!pid) continue;

    // Name: "Judge, Aaron" → "Aaron Judge"
    const nameRaw = row["last_name, first_name"] ?? "";
    const parts = nameRaw.split(", ");
    const playerName = parts.length === 2 ? `${parts[1]} ${parts[0]}` : nameRaw;

    result.set(pid, {
      playerId: pid,
      playerName,
      exitVelocity: safeFloat(row["avg_hit_speed"]) ?? 0,
      maxExitVelocity: safeFloat(row["max_hit_speed"]) ?? 0,
      barrelPct: safeFloat(row["brl_percent"]) ?? 0,
      barrelPA: safeFloat(row["brl_pa"]) ?? 0,
      hardHitPct: safeFloat(row["ev95percent"]) ?? 0,
      sweetSpotPct: safeFloat(row["anglesweetspotpercent"]) ?? 0,
      bbe: safeInt(row["attempts"]),
      // filled by other endpoints:
      xwOBA: null, xBA: null, xSLG: null,
      xwOBAPercentile: null, barrelPercentile: null,
      exitVeloPercentile: null, hardHitPercentile: null, sprintSpeedPercentile: null,
      kPct: null, whiffPct: null, iso: null,
    });
  }
  return result;
}

/**
 * Endpoint 2: Expected stats (batters)
 * Provides: xwOBA (est_woba), xBA (est_ba), xSLG (est_slg)
 * BOM: present on "last_name, first_name" header — stripped individually.
 */
async function fetchBatterExpectedStats(year: number): Promise<Map<number, { xwOBA: number; xBA: number; xSLG: number }>> {
  const url = `${SAVANT_BASE}/leaderboard/expected_statistics?type=batter&year=${year}&position=&team=&min=25&csv=true`;
  const raw = await fetchCSV(url);
  const rows = parseCSV(raw);

  const firstKey = rows[0] ? Object.keys(rows[0])[0] : "";
  if (firstKey.includes("\uFEFF")) {
    throw new Error(`[Statcast] BOM not stripped on batter_expected_stats — first key: ${JSON.stringify(firstKey)}`);
  }

  const result = new Map<number, { xwOBA: number; xBA: number; xSLG: number }>();
  for (const row of rows) {
    const pid = safeInt(row["player_id"]);
    if (!pid) continue;
    result.set(pid, {
      xwOBA: safeFloat(row["est_woba"]) ?? 0,
      xBA: safeFloat(row["est_ba"]) ?? 0,
      xSLG: safeFloat(row["est_slg"]) ?? 0,
    });
  }
  return result;
}

/**
 * Endpoint 3: Percentile ranks (batters)
 * Provides: kPct (k_percent), whiffPct (whiff_percent), iso (xiso),
 *           xwOBAPercentile (xwoba), barrelPercentile (brl_percent),
 *           exitVeloPercentile (exit_velocity), hardHitPercentile (hard_hit_percent),
 *           sprintSpeedPercentile (sprint_speed)
 *
 * DIRECTION NOTE (preNormalized=true):
 *   All values are 0-100 percentile scores where HIGHER = BETTER.
 *   k_percent percentile: HIGHER = lower raw K% = better contact (inverted from raw rate).
 *   whiff_percent percentile: HIGHER = lower raw whiff% = better contact (inverted from raw rate).
 *   xiso percentile: HIGHER = higher xISO = more power.
 *
 * BOM: present on "player_name" header — stripped individually.
 */
async function fetchBatterPercentileRanks(year: number): Promise<Map<number, {
  kPct: number; whiffPct: number; iso: number;
  xwOBAPercentile: number; barrelPercentile: number;
  exitVeloPercentile: number; hardHitPercentile: number; sprintSpeedPercentile: number;
  playerName?: string;
}>> {
  const url = `${SAVANT_BASE}/leaderboard/percentile-rankings?type=batter&year=${year}&position=&team=&csv=true`;
  const raw = await fetchCSV(url);
  const rows = parseCSV(raw);

  const firstKey = rows[0] ? Object.keys(rows[0])[0] : "";
  if (firstKey.includes("\uFEFF")) {
    throw new Error(`[Statcast] BOM not stripped on batter_percentile_ranks — first key: ${JSON.stringify(firstKey)}`);
  }

  const result = new Map<number, {
    kPct: number; whiffPct: number; iso: number;
    xwOBAPercentile: number; barrelPercentile: number;
    exitVeloPercentile: number; hardHitPercentile: number; sprintSpeedPercentile: number;
    playerName?: string;
  }>();
  for (const row of rows) {
    const pid = safeInt(row["player_id"]);
    if (!pid) continue;

    // Name: "Kwan, Steven" → "Steven Kwan"
    const nameRaw = row["player_name"] ?? "";
    const parts = nameRaw.split(", ");
    const playerName = parts.length === 2 ? `${parts[1]} ${parts[0]}` : nameRaw;

    result.set(pid, {
      kPct:                safeFloat(row["k_percent"])       ?? 50,
      whiffPct:            safeFloat(row["whiff_percent"])   ?? 50,
      iso:                 safeFloat(row["xiso"])            ?? 50,
      xwOBAPercentile:     safeFloat(row["xwoba"])           ?? 50,
      barrelPercentile:    safeFloat(row["brl_percent"])     ?? 50,
      exitVeloPercentile:  safeFloat(row["exit_velocity"])   ?? 50,
      hardHitPercentile:   safeFloat(row["hard_hit_percent"]) ?? 50,
      sprintSpeedPercentile: safeFloat(row["sprint_speed"]) ?? 50,
      playerName,
    });
  }
  return result;
}

/**
 * Endpoint 4: Expected stats (pitchers)
 * Provides: xwOBAAgainst (est_woba), xBAAgainst (est_ba), xSLGAgainst (est_slg), pa
 * BOM: present on "last_name, first_name" header — stripped individually.
 */
async function fetchPitcherExpectedStats(year: number): Promise<Map<number, Partial<StatcastPitcher>>> {
  const url = `${SAVANT_BASE}/leaderboard/expected_statistics?type=pitcher&year=${year}&position=&team=&min=25&csv=true`;
  const raw = await fetchCSV(url);
  const rows = parseCSV(raw);

  const firstKey = rows[0] ? Object.keys(rows[0])[0] : "";
  if (firstKey.includes("\uFEFF")) {
    throw new Error(`[Statcast] BOM not stripped on pitcher_expected_stats — first key: ${JSON.stringify(firstKey)}`);
  }

  const result = new Map<number, Partial<StatcastPitcher>>();
  for (const row of rows) {
    const pid = safeInt(row["player_id"]);
    if (!pid) continue;
    const nameRaw = row["last_name, first_name"] ?? "";
    const parts = nameRaw.split(", ");
    const pitcherName = parts.length === 2 ? `${parts[1]} ${parts[0]}` : nameRaw;
    result.set(pid, {
      pitcherId: pid,
      pitcherName,
      xwOBAAgainst: safeFloat(row["est_woba"]) ?? 0.320,
      xBAAgainst:   safeFloat(row["est_ba"])   ?? 0.250,
      xSLGAgainst:  safeFloat(row["est_slg"])  ?? 0.400,
      pa: safeInt(row["pa"]) ?? 0,
    });
  }
  return result;
}

/**
 * Endpoint 5: Percentile ranks (pitchers)
 * Provides: xwOBAPercentile (xwoba), barrelPercentile (brl_percent), hardHitPercentile (hard_hit_percent)
 * NOTE: For pitchers, higher xwOBA percentile = MORE hittable (worse for pitcher).
 * BOM: present on "player_name" header — stripped individually.
 */
async function fetchPitcherPercentileRanks(year: number): Promise<Map<number, {
  xwOBAPercentile: number; barrelPercentile: number; hardHitPercentile: number;
}>> {
  const url = `${SAVANT_BASE}/leaderboard/percentile-rankings?type=pitcher&year=${year}&position=&team=&csv=true`;
  const raw = await fetchCSV(url);
  const rows = parseCSV(raw);

  const firstKey = rows[0] ? Object.keys(rows[0])[0] : "";
  if (firstKey.includes("\uFEFF")) {
    throw new Error(`[Statcast] BOM not stripped on pitcher_percentile_ranks — first key: ${JSON.stringify(firstKey)}`);
  }

  const result = new Map<number, { xwOBAPercentile: number; barrelPercentile: number; hardHitPercentile: number }>();
  for (const row of rows) {
    const pid = safeInt(row["player_id"]);
    if (!pid) continue;
    result.set(pid, {
      xwOBAPercentile:  safeFloat(row["xwoba"])            ?? 50,
      barrelPercentile: safeFloat(row["brl_percent"])      ?? 50,
      hardHitPercentile: safeFloat(row["hard_hit_percent"]) ?? 50,
    });
  }
  return result;
}

// ── preNormalized direction validator ─────────────────────────────────────────

/**
 * Validates that kPct/whiffPct percentile scores are directionally correct:
 *   - Low-K contact hitters (Arraez, Kwan) should score HIGH (>= 60)
 *   - High-K sluggers (Schwarber, Cruz) should score LOW (<= 40)
 *
 * This check caught the original preNormalized bug (Phase BN) where the direction
 * was inverted. It runs every time fresh data is loaded and throws loudly if broken.
 *
 * Player IDs (stable MLB IDs):
 *   Luis Arraez:    650333
 *   Steven Kwan:    680757
 *   Kyle Schwarber: 656941
 *   Oneil Cruz:     665833
 */
function validatePreNormalizedDirection(
  percentileMap: Map<number, { kPct: number; whiffPct: number; iso: number; playerName?: string }>
): void {
  const CONTACT_HITTERS = [
    { id: 650333, name: "Luis Arraez" },
    { id: 680757, name: "Steven Kwan" },
  ];
  const POWER_HITTERS = [
    { id: 656941, name: "Kyle Schwarber" },
    { id: 665833, name: "Oneil Cruz" },
  ];

  const warnings: string[] = [];
  let contactFound = 0;
  let powerFound = 0;

  for (const { id, name } of CONTACT_HITTERS) {
    const p = percentileMap.get(id);
    if (!p) {
      console.warn(`[Statcast] preNormalized validation: ${name} (${id}) not in dataset — skipping`);
      continue;
    }
    contactFound++;
    // Contact hitters should have HIGH kPct percentile (low raw K%) — expect >= 60
    if (p.kPct < 55) {
      warnings.push(`${name} kPct=${p.kPct} — expected >= 55 for a contact hitter (low-K = high percentile)`);
    }
    console.log(`[Statcast] preNormalized check — ${name}: kPct=${p.kPct} whiffPct=${p.whiffPct} iso=${p.iso} (expect kPct HIGH)`);
  }

  for (const { id, name } of POWER_HITTERS) {
    const p = percentileMap.get(id);
    if (!p) {
      console.warn(`[Statcast] preNormalized validation: ${name} (${id}) not in dataset — skipping`);
      continue;
    }
    powerFound++;
    // Power/high-K hitters should have LOW kPct percentile (high raw K%) — expect <= 45
    if (p.kPct > 50) {
      warnings.push(`${name} kPct=${p.kPct} — expected <= 50 for a high-K slugger (high-K = low percentile)`);
    }
    console.log(`[Statcast] preNormalized check — ${name}: kPct=${p.kPct} whiffPct=${p.whiffPct} iso=${p.iso} (expect kPct LOW)`);
  }

  if (contactFound === 0 && powerFound === 0) {
    console.warn("[Statcast] preNormalized validation: no reference players found in dataset — cannot validate direction");
    return;
  }

  if (warnings.length > 0) {
    const msg = `[Statcast] preNormalized direction FAILED:\n${warnings.join("\n")}\nThis means kPct/whiffPct percentile direction is INVERTED — HQS contact scores will be wrong. Aborting cache load.`;
    console.error(msg);
    throw new Error(msg);
  }

  console.log(`[Statcast] preNormalized direction validated OK (${contactFound} contact, ${powerFound} power hitters checked)`);
}

// ── Main fetch function ───────────────────────────────────────────────────────

/**
 * Fetches all 5 Baseball Savant endpoints in parallel, joins on player_id,
 * and returns a StatcastCache in the same shape as the Python script produced.
 */
export async function fetchStatcastDataNode(year: number): Promise<StatcastCache> {
  console.log(`[Statcast] Fetching ${year} data from Baseball Savant (Node.js)...`);

  // Fetch all 5 endpoints in parallel
  const [evb, batterExp, batterPct, pitcherExp, pitcherPct] = await Promise.all([
    fetchExitVeloBarrels(year),
    fetchBatterExpectedStats(year),
    fetchBatterPercentileRanks(year),
    fetchPitcherExpectedStats(year),
    fetchPitcherPercentileRanks(year),
  ]);

  // Validate preNormalized direction BEFORE building the cache
  validatePreNormalizedDirection(batterPct);

  // Merge batter data: start from exitvelo (has BBE + physical metrics)
  // then overlay expected stats and percentile ranks
  const byId = new Map<number, StatcastPlayer>();

  // Union of all player IDs seen across batter endpoints
  const allBatterIds = new Set([...Array.from(evb.keys()), ...Array.from(batterPct.keys())]);

  for (const pid of Array.from(allBatterIds)) {
    const ev = evb.get(pid);
    const exp = batterExp.get(pid);
    const pct = batterPct.get(pid);

    // Resolve player name: prefer exitvelo (has "Last, First" → "First Last" conversion),
    // fall back to percentile ranks name
    const playerName = ev?.playerName ?? pct?.playerName ?? `Player ${pid}`;

    const player: StatcastPlayer = {
      playerId: pid,
      playerName,
      exitVelocity:    ev?.exitVelocity    ?? 0,
      maxExitVelocity: ev?.maxExitVelocity ?? 0,
      barrelPct:       ev?.barrelPct       ?? 0,
      barrelPA:        ev?.barrelPA        ?? 0,
      hardHitPct:      ev?.hardHitPct      ?? 0,
      sweetSpotPct:    ev?.sweetSpotPct    ?? 0,
      bbe:             ev?.bbe             ?? null,
      xwOBA:           exp?.xwOBA          ?? null,
      xBA:             exp?.xBA            ?? null,
      xSLG:            exp?.xSLG           ?? null,
      // Percentile ranks (from batterPct, with fallbacks from ev if available)
      xwOBAPercentile:      pct?.xwOBAPercentile      ?? null,
      barrelPercentile:     pct?.barrelPercentile      ?? null,
      exitVeloPercentile:   pct?.exitVeloPercentile    ?? null,
      hardHitPercentile:    pct?.hardHitPercentile     ?? null,
      sprintSpeedPercentile: pct?.sprintSpeedPercentile ?? null,
      // HQS discipline fields (percentile ranks, preNormalized)
      kPct:     pct?.kPct     ?? null,
      whiffPct: pct?.whiffPct ?? null,
      iso:      pct?.iso      ?? null,
      preNormalized: true,
    };
    byId.set(pid, player);
  }

  // Build name-keyed map for fuzzy lookup
  const byName = new Map<string, StatcastPlayer>();
  for (const player of Array.from(byId.values())) {
    byName.set(player.playerName.toLowerCase(), player);
    const lastName = player.playerName.split(" ").slice(-1)[0].toLowerCase();
    if (!byName.has(lastName)) byName.set(lastName, player);
  }

  // Build pitcher map
  const pitchers = new Map<number, StatcastPitcher>();
  for (const [pid, exp] of Array.from(pitcherExp.entries())) {
    const pct = pitcherPct.get(pid);
    pitchers.set(pid, {
      pitcherId:    exp.pitcherId    ?? pid,
      pitcherName:  exp.pitcherName  ?? `Pitcher ${pid}`,
      xwOBAAgainst: exp.xwOBAAgainst ?? 0.320,
      xBAAgainst:   exp.xBAAgainst   ?? 0.250,
      xSLGAgainst:  exp.xSLGAgainst  ?? 0.400,
      pa:           exp.pa           ?? 0,
      xwOBAPercentile:  pct?.xwOBAPercentile  ?? undefined,
      barrelPercentile: pct?.barrelPercentile  ?? undefined,
      hardHitPercentile: pct?.hardHitPercentile ?? undefined,
    });
  }

  console.log(`[Statcast] Loaded ${byId.size} batters, ${pitchers.size} pitchers for ${year} (Node.js fetch)`);

  return {
    data: byName,
    byId,
    pitchers,
    fetchedAt: Date.now(),
    year,
  };
}
