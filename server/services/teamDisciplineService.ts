/**
 * Team Discipline Service
 *
 * Fetches MLB team plate discipline statistics from the MLB Stats API and Fangraphs-style
 * endpoints, then computes:
 *   - Discipline Grade (A+ / A / B / C / D)
 *   - Prop Tendency Profiles (Walk, Strikeout, Pitch Count, Patient, Aggressive)
 *   - Team Matchup Score (TMS, 0-100) for a specific pitcher matchup
 *   - Auto-Boost adjustments (±0-5%) for walk/strikeout props
 *
 * Data is cached in-memory for 6 hours and persisted to the database daily.
 */

import { getDb } from "../db";
import { teamDisciplineProfiles } from "../../drizzle/schema";

const MLB_API = "https://statsapi.mlb.com/api/v1";
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

// ── MLB Team registry ──────────────────────────────────────────────────────────
export const MLB_TEAMS: Record<string, { id: number; name: string; abbr: string }> = {
  ARI: { id: 109, name: "Arizona Diamondbacks",    abbr: "ARI" },
  ATL: { id: 144, name: "Atlanta Braves",           abbr: "ATL" },
  BAL: { id: 110, name: "Baltimore Orioles",        abbr: "BAL" },
  BOS: { id: 111, name: "Boston Red Sox",           abbr: "BOS" },
  CHC: { id: 112, name: "Chicago Cubs",             abbr: "CHC" },
  CWS: { id: 145, name: "Chicago White Sox",        abbr: "CWS" },
  CIN: { id: 113, name: "Cincinnati Reds",          abbr: "CIN" },
  CLE: { id: 114, name: "Cleveland Guardians",      abbr: "CLE" },
  COL: { id: 115, name: "Colorado Rockies",         abbr: "COL" },
  DET: { id: 116, name: "Detroit Tigers",           abbr: "DET" },
  HOU: { id: 117, name: "Houston Astros",           abbr: "HOU" },
  KC:  { id: 118, name: "Kansas City Royals",       abbr: "KC"  },
  LAA: { id: 108, name: "Los Angeles Angels",       abbr: "LAA" },
  LAD: { id: 119, name: "Los Angeles Dodgers",      abbr: "LAD" },
  MIA: { id: 146, name: "Miami Marlins",            abbr: "MIA" },
  MIL: { id: 158, name: "Milwaukee Brewers",        abbr: "MIL" },
  MIN: { id: 142, name: "Minnesota Twins",          abbr: "MIN" },
  NYM: { id: 121, name: "New York Mets",            abbr: "NYM" },
  NYY: { id: 147, name: "New York Yankees",         abbr: "NYY" },
  OAK: { id: 133, name: "Oakland Athletics",        abbr: "OAK" },
  PHI: { id: 143, name: "Philadelphia Phillies",    abbr: "PHI" },
  PIT: { id: 134, name: "Pittsburgh Pirates",       abbr: "PIT" },
  SD:  { id: 135, name: "San Diego Padres",         abbr: "SD"  },
  SF:  { id: 137, name: "San Francisco Giants",     abbr: "SF"  },
  SEA: { id: 136, name: "Seattle Mariners",         abbr: "SEA" },
  STL: { id: 138, name: "St. Louis Cardinals",      abbr: "STL" },
  TB:  { id: 139, name: "Tampa Bay Rays",           abbr: "TB"  },
  TEX: { id: 140, name: "Texas Rangers",            abbr: "TEX" },
  TOR: { id: 141, name: "Toronto Blue Jays",        abbr: "TOR" },
  WSH: { id: 120, name: "Washington Nationals",     abbr: "WSH" },
};

// ── Types ──────────────────────────────────────────────────────────────────────
export type DisciplineGrade = "A+" | "A" | "B" | "C" | "D";

export interface TeamDisciplineData {
  teamAbbr: string;
  teamName: string;
  season: number;
  // Raw metrics (as decimals, e.g. 0.085 = 8.5%)
  walkRate: number;
  strikeoutRate: number;
  chaseRate: number;
  contactRate: number;
  zoneContactRate: number;
  swingStrikeRate: number;
  firstPitchSwingRate: number;
  pitchesPerPA: number;
  walkRateVsRHP: number;
  walkRateVsLHP: number;
  kRateVsRHP: number;
  kRateVsLHP: number;
  // Computed
  disciplineGrade: DisciplineGrade;
  disciplineScore: number;       // 0-100
  walkTendencyScore: number;     // 0-100
  strikeoutTendencyScore: number;
  pitchCountTendencyScore: number;
  patientScore: number;
  aggressiveScore: number;
  walkBoostBps: number;          // basis points ±500
  strikeoutBoostBps: number;
}

export interface TeamMatchupScore {
  tms: number;           // 0-100
  rating: "Elite" | "Strong" | "Playable" | "Reject";
  disciplineGrade: DisciplineGrade;
  disciplineScore: number;
  walkTendencyScore: number;
  strikeoutTendencyScore: number;
  hasDisciplineEdge: boolean;
  disciplineEdgeReason: string | null;
  walkBoostBps: number;
  strikeoutBoostBps: number;
  breakdown: {
    disciplineComponent: number;   // 0-40
    handednessComponent: number;   // 0-20
    recentFormComponent: number;   // 0-15
    parkComponent: number;         // 0-10
    weatherComponent: number;      // 0-10
    umpireComponent: number;       // 0-5
  };
}

// ── In-memory cache ────────────────────────────────────────────────────────────
let disciplineCache: Map<string, TeamDisciplineData> | null = null;
let cacheTs = 0;

async function fetchJSON(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": "DiamondEdge/1.0" },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

// ── Fetch team hitting stats from MLB Stats API ────────────────────────────────
async function fetchTeamHittingStats(teamId: number, season: number): Promise<{
  walkRate: number;
  strikeoutRate: number;
  pitchesPerPA: number;
  walkRateVsRHP: number;
  walkRateVsLHP: number;
  kRateVsRHP: number;
  kRateVsLHP: number;
}> {
  try {
    // Season totals
    const url = `${MLB_API}/teams/${teamId}/stats?stats=season&group=hitting&season=${season}`;
    const data = await fetchJSON(url) as {
      stats?: {
        splits?: {
          stat?: {
            plateAppearances?: number;
            baseOnBalls?: number;
            strikeOuts?: number;
            atBats?: number;
          };
        }[];
      }[];
    };
    const stat = data.stats?.[0]?.splits?.[0]?.stat;
    const pa = stat?.plateAppearances || 1;
    const bb = stat?.baseOnBalls || 0;
    const k = stat?.strikeOuts || 0;

    const walkRate = bb / pa;
    const strikeoutRate = k / pa;

    // Handedness splits
    let walkRateVsRHP = walkRate;
    let walkRateVsLHP = walkRate;
    let kRateVsRHP = strikeoutRate;
    let kRateVsLHP = strikeoutRate;

    try {
      const splitUrl = `${MLB_API}/teams/${teamId}/stats?stats=statSplits&group=hitting&season=${season}&sitCodes=vr,vl`;
      const splitData = await fetchJSON(splitUrl) as {
        stats?: {
          splits?: {
            split?: { description?: string };
            stat?: { plateAppearances?: number; baseOnBalls?: number; strikeOuts?: number };
          }[];
        }[];
      };
      const splits = splitData.stats?.[0]?.splits || [];
      for (const s of splits) {
        const desc = s.split?.description || "";
        const sPa = s.stat?.plateAppearances || 1;
        const sBb = s.stat?.baseOnBalls || 0;
        const sK = s.stat?.strikeOuts || 0;
        if (desc === "vs Right") { walkRateVsRHP = sBb / sPa; kRateVsRHP = sK / sPa; }
        if (desc === "vs Left")  { walkRateVsLHP = sBb / sPa; kRateVsLHP = sK / sPa; }
      }
    } catch { /* use season rates as fallback */ }

    return {
      walkRate,
      strikeoutRate,
      pitchesPerPA: 3.85, // MLB avg; real data would need Statcast
      walkRateVsRHP,
      walkRateVsLHP,
      kRateVsRHP,
      kRateVsLHP,
    };
  } catch {
    // Return league-average defaults on failure
    return {
      walkRate: 0.085,
      strikeoutRate: 0.225,
      pitchesPerPA: 3.85,
      walkRateVsRHP: 0.085,
      walkRateVsLHP: 0.085,
      kRateVsRHP: 0.225,
      kRateVsLHP: 0.225,
    };
  }
}

// ── Compute discipline grade from metrics ──────────────────────────────────────
function computeDisciplineGrade(walkRate: number, kRate: number, pitchesPerPA: number): {
  grade: DisciplineGrade;
  score: number;
  patientScore: number;
  aggressiveScore: number;
  walkTendencyScore: number;
  strikeoutTendencyScore: number;
  pitchCountTendencyScore: number;
  walkBoostBps: number;
  strikeoutBoostBps: number;
} {
  // League averages (2024-2026 approximate)
  const AVG_BB = 0.085;   // 8.5% walk rate
  const AVG_K  = 0.225;   // 22.5% K rate
  const AVG_P_PA = 3.85;  // 3.85 pitches per PA

  // Walk tendency: higher BB% = more walks for opposing pitchers
  // Scale: 0% = 0, 15%+ = 100
  const walkTendencyScore = Math.min(100, Math.round((walkRate / 0.15) * 100));

  // Strikeout tendency: higher K% = more Ks for opposing pitchers
  // Scale: 0% = 0, 35%+ = 100
  const strikeoutTendencyScore = Math.min(100, Math.round((kRate / 0.35) * 100));

  // Pitch count tendency: more pitches per PA = longer outings possible
  // Scale: 3.0 = 0, 4.5+ = 100
  const pitchCountTendencyScore = Math.min(100, Math.max(0, Math.round(((pitchesPerPA - 3.0) / 1.5) * 100)));

  // Patient score: combination of walk rate + pitches per PA
  const patientScore = Math.min(100, Math.round(
    (walkRate / AVG_BB) * 40 + (pitchesPerPA / AVG_P_PA) * 60
  ));

  // Aggressive score: low walk rate + low pitches per PA = aggressive hacker
  const aggressiveScore = Math.min(100, Math.max(0, Math.round(
    100 - ((walkRate / AVG_BB) * 40 + (pitchesPerPA / AVG_P_PA) * 60)
  )));

  // Overall discipline score (0-100)
  // High discipline = patient team = good for pitcher walk props
  // Low discipline = aggressive team = good for pitcher K props
  const bbDeviation = (walkRate - AVG_BB) / AVG_BB;   // positive = more walks than avg
  const kDeviation  = (kRate - AVG_K) / AVG_K;         // positive = more Ks than avg
  const pDeviation  = (pitchesPerPA - AVG_P_PA) / AVG_P_PA;

  // Discipline score: high = patient/disciplined, low = aggressive/hacky
  const disciplineScore = Math.min(100, Math.max(0, Math.round(
    50 + (bbDeviation * 25) + (pDeviation * 15) - (kDeviation * 10)
  )));

  // Grade thresholds
  let grade: DisciplineGrade;
  if (disciplineScore >= 75) grade = "A+";
  else if (disciplineScore >= 62) grade = "A";
  else if (disciplineScore >= 45) grade = "B";
  else if (disciplineScore >= 32) grade = "C";
  else grade = "D";

  // Auto-boost: elite walk teams get +2-5% walk boost, elite K teams get +2-5% K boost
  // Capped at 500 bps (5%)
  const walkBoostBps = walkTendencyScore >= 70
    ? Math.min(500, Math.round(((walkTendencyScore - 50) / 50) * 500))
    : walkTendencyScore <= 30
    ? Math.max(-500, Math.round(((walkTendencyScore - 50) / 50) * 500))
    : 0;

  const strikeoutBoostBps = strikeoutTendencyScore >= 70
    ? Math.min(500, Math.round(((strikeoutTendencyScore - 50) / 50) * 500))
    : strikeoutTendencyScore <= 30
    ? Math.max(-500, Math.round(((strikeoutTendencyScore - 50) / 50) * 500))
    : 0;

  return {
    grade,
    score: disciplineScore,
    patientScore,
    aggressiveScore,
    walkTendencyScore,
    strikeoutTendencyScore,
    pitchCountTendencyScore,
    walkBoostBps,
    strikeoutBoostBps,
  };
}

// ── Build full discipline data for a team ─────────────────────────────────────
async function buildTeamDisciplineData(abbr: string, season: number): Promise<TeamDisciplineData> {
  const team = MLB_TEAMS[abbr];
  if (!team) throw new Error(`Unknown team abbreviation: ${abbr}`);

  const stats = await fetchTeamHittingStats(team.id, season);
  const computed = computeDisciplineGrade(stats.walkRate, stats.strikeoutRate, stats.pitchesPerPA);

  // Approximate chase/contact/zone/swingStrike from K rate and walk rate
  // These are derived estimates since MLB Stats API doesn't expose Statcast team-level
  // plate discipline directly (would require Fangraphs scrape)
  const chaseRate = Math.max(0.20, Math.min(0.40, 0.30 - (stats.walkRate - 0.085) * 2));
  const contactRate = Math.max(0.70, Math.min(0.90, 0.80 + (1 - stats.strikeoutRate / 0.225) * 0.05));
  const zoneContactRate = Math.min(0.95, contactRate + 0.05);
  const swingStrikeRate = Math.max(0.05, Math.min(0.18, 0.115 + (stats.strikeoutRate - 0.225) * 0.3));
  const firstPitchSwingRate = Math.max(0.25, Math.min(0.45, 0.35 - (stats.walkRate - 0.085) * 1.5));

  return {
    teamAbbr: abbr,
    teamName: team.name,
    season,
    walkRate: stats.walkRate,
    strikeoutRate: stats.strikeoutRate,
    chaseRate,
    contactRate,
    zoneContactRate,
    swingStrikeRate,
    firstPitchSwingRate,
    pitchesPerPA: stats.pitchesPerPA,
    walkRateVsRHP: stats.walkRateVsRHP,
    walkRateVsLHP: stats.walkRateVsLHP,
    kRateVsRHP: stats.kRateVsRHP,
    kRateVsLHP: stats.kRateVsLHP,
    disciplineGrade: computed.grade,
    disciplineScore: computed.score,
    walkTendencyScore: computed.walkTendencyScore,
    strikeoutTendencyScore: computed.strikeoutTendencyScore,
    pitchCountTendencyScore: computed.pitchCountTendencyScore,
    patientScore: computed.patientScore,
    aggressiveScore: computed.aggressiveScore,
    walkBoostBps: computed.walkBoostBps,
    strikeoutBoostBps: computed.strikeoutBoostBps,
  };
}

// ── Load all teams (with cache) ────────────────────────────────────────────────
export async function getAllTeamDisciplineData(season?: number): Promise<Map<string, TeamDisciplineData>> {
  const s = season ?? new Date().getFullYear();

  if (disciplineCache && Date.now() - cacheTs < CACHE_TTL) {
    return disciplineCache;
  }

  // Try DB first
  try {
    const dbInst = await getDb();
    if (!dbInst) throw new Error('no db');
    const rows = await dbInst.select().from(teamDisciplineProfiles);
    if (rows.length >= 25) {
      const map = new Map<string, TeamDisciplineData>();
      for (const row of rows) {
        map.set(row.teamAbbr, {
          teamAbbr: row.teamAbbr,
          teamName: row.teamName,
          season: row.season,
          walkRate: (row.walkRatePct ?? 85) / 1000,
          strikeoutRate: (row.strikeoutRatePct ?? 225) / 1000,
          chaseRate: (row.chaseRatePct ?? 300) / 1000,
          contactRate: (row.contactRatePct ?? 800) / 1000,
          zoneContactRate: (row.zoneContactPct ?? 850) / 1000,
          swingStrikeRate: (row.swingStrikePct ?? 115) / 1000,
          firstPitchSwingRate: (row.firstPitchSwingPct ?? 350) / 1000,
          pitchesPerPA: (row.pitchesPerPA ?? 385) / 100,
          walkRateVsRHP: (row.walkRateVsRHP ?? 85) / 1000,
          walkRateVsLHP: (row.walkRateVsLHP ?? 85) / 1000,
          kRateVsRHP: (row.kRateVsRHP ?? 225) / 1000,
          kRateVsLHP: (row.kRateVsLHP ?? 225) / 1000,
          disciplineGrade: row.disciplineGrade,
          disciplineScore: row.disciplineScore,
          walkTendencyScore: row.walkTendencyScore ?? 50,
          strikeoutTendencyScore: row.strikeoutTendencyScore ?? 50,
          pitchCountTendencyScore: row.pitchCountTendencyScore ?? 50,
          patientScore: row.patientScore ?? 50,
          aggressiveScore: row.aggressiveScore ?? 50,
          walkBoostBps: row.walkBoostBps ?? 0,
          strikeoutBoostBps: row.strikeoutBoostBps ?? 0,
        });
      }
      disciplineCache = map;
      cacheTs = Date.now();
      return map;
    }
  } catch { /* fall through to live fetch */ }

  // Live fetch from MLB API
  const map = new Map<string, TeamDisciplineData>();
  const abbrs = Object.keys(MLB_TEAMS);

  // Fetch in batches of 5 to avoid hammering the API
  for (let i = 0; i < abbrs.length; i += 5) {
    const batch = abbrs.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map(abbr => buildTeamDisciplineData(abbr, s))
    );
    for (let j = 0; j < batch.length; j++) {
      const r = results[j];
      if (r.status === "fulfilled") {
        map.set(batch[j], r.value);
      }
    }
  }

  // Persist to DB
  try {
    const dbInst2 = await getDb();
    if (!dbInst2) throw new Error('no db');
    for (const data of Array.from(map.values())) {
      await dbInst2
        .insert(teamDisciplineProfiles)
        .values({
          teamAbbr: data.teamAbbr,
          teamName: data.teamName,
          season: data.season,
          walkRatePct: Math.round(data.walkRate * 1000),
          strikeoutRatePct: Math.round(data.strikeoutRate * 1000),
          chaseRatePct: Math.round(data.chaseRate * 1000),
          contactRatePct: Math.round(data.contactRate * 1000),
          zoneContactPct: Math.round(data.zoneContactRate * 1000),
          swingStrikePct: Math.round(data.swingStrikeRate * 1000),
          firstPitchSwingPct: Math.round(data.firstPitchSwingRate * 1000),
          pitchesPerPA: Math.round(data.pitchesPerPA * 100),
          walkRateVsRHP: Math.round(data.walkRateVsRHP * 1000),
          walkRateVsLHP: Math.round(data.walkRateVsLHP * 1000),
          kRateVsRHP: Math.round(data.kRateVsRHP * 1000),
          kRateVsLHP: Math.round(data.kRateVsLHP * 1000),
          disciplineGrade: data.disciplineGrade,
          disciplineScore: data.disciplineScore,
          walkTendencyScore: data.walkTendencyScore,
          strikeoutTendencyScore: data.strikeoutTendencyScore,
          pitchCountTendencyScore: data.pitchCountTendencyScore,
          patientScore: data.patientScore,
          aggressiveScore: data.aggressiveScore,
          walkBoostBps: data.walkBoostBps,
          strikeoutBoostBps: data.strikeoutBoostBps,
          lastFetchedAt: new Date(),
        })
        .onDuplicateKeyUpdate({
          set: {
            walkRatePct: Math.round(data.walkRate * 1000),
            strikeoutRatePct: Math.round(data.strikeoutRate * 1000),
            disciplineGrade: data.disciplineGrade,
            disciplineScore: data.disciplineScore,
            walkTendencyScore: data.walkTendencyScore,
            strikeoutTendencyScore: data.strikeoutTendencyScore,
            pitchCountTendencyScore: data.pitchCountTendencyScore,
            patientScore: data.patientScore,
            aggressiveScore: data.aggressiveScore,
            walkBoostBps: data.walkBoostBps,
            strikeoutBoostBps: data.strikeoutBoostBps,
            lastFetchedAt: new Date(),
          },
        });
    }
  } catch (e) {
    console.warn("[TeamDiscipline] DB persist failed:", e);
  }

  disciplineCache = map;
  cacheTs = Date.now();
  return map;
}

// ── Get a single team's discipline data ───────────────────────────────────────
export async function getTeamDiscipline(teamAbbr: string): Promise<TeamDisciplineData | null> {
  const all = await getAllTeamDisciplineData();
  return all.get(teamAbbr.toUpperCase()) ?? null;
}

// ── Compute Team Matchup Score (TMS) for a pitcher vs opponent ────────────────
export async function computeTeamMatchupScore(params: {
  opponentTeam: string;
  pitcherHand: "L" | "R" | "S";
  propType: "strikeouts" | "walks" | "outs" | "innings" | "hits_allowed" | "earned_runs";
  parkFactor?: number;        // 1.0 = neutral
  weatherScore?: number;      // 0-10 (10 = ideal pitching conditions)
  umpireKRate?: number;       // umpire's historical K rate (0-1)
  opponentRecentForm?: number; // 0-100 (100 = team is hot offensively)
}): Promise<TeamMatchupScore> {
  const { opponentTeam, pitcherHand, propType, parkFactor = 1.0, weatherScore = 5, umpireKRate, opponentRecentForm = 50 } = params;

  const discipline = await getTeamDiscipline(opponentTeam);
  if (!discipline) {
    return {
      tms: 50,
      rating: "Playable",
      disciplineGrade: "B",
      disciplineScore: 50,
      walkTendencyScore: 50,
      strikeoutTendencyScore: 50,
      hasDisciplineEdge: false,
      disciplineEdgeReason: null,
      walkBoostBps: 0,
      strikeoutBoostBps: 0,
      breakdown: { disciplineComponent: 20, handednessComponent: 10, recentFormComponent: 7, parkComponent: 5, weatherComponent: 5, umpireComponent: 3 },
    };
  }

  // ── Component 1: Discipline (0-40 pts) ────────────────────────────────────
  // For strikeout props: high K tendency = better matchup
  // For walk props: high walk tendency = better matchup
  let disciplineComponent: number;
  if (propType === "strikeouts") {
    disciplineComponent = Math.round((discipline.strikeoutTendencyScore / 100) * 40);
  } else if (propType === "walks") {
    disciplineComponent = Math.round((discipline.walkTendencyScore / 100) * 40);
  } else {
    // For other props, use overall discipline score inversely (less disciplined = more hits/runs)
    disciplineComponent = Math.round(((100 - discipline.disciplineScore) / 100) * 40);
  }

  // ── Component 2: Handedness splits (0-20 pts) ─────────────────────────────
  // Use handedness-specific K/walk rates
  let handednessComponent = 10; // neutral default
  if (propType === "strikeouts") {
    const kRate = pitcherHand === "L" ? discipline.kRateVsLHP : discipline.kRateVsRHP;
    handednessComponent = Math.min(20, Math.round((kRate / 0.30) * 20));
  } else if (propType === "walks") {
    const bbRate = pitcherHand === "L" ? discipline.walkRateVsLHP : discipline.walkRateVsRHP;
    handednessComponent = Math.min(20, Math.round((bbRate / 0.12) * 20));
  }

  // ── Component 3: Recent form (0-15 pts) ───────────────────────────────────
  // Hot offensive team = worse matchup for pitcher props (fewer Ks, more walks)
  const recentFormComponent = propType === "strikeouts" || propType === "walks"
    ? Math.round(((100 - opponentRecentForm) / 100) * 15)
    : Math.round((opponentRecentForm / 100) * 15);

  // ── Component 4: Park factor (0-10 pts) ───────────────────────────────────
  // Pitcher-friendly park (< 1.0) = better for K/walk props
  const parkComponent = propType === "strikeouts" || propType === "walks"
    ? Math.min(10, Math.max(0, Math.round((1.15 - parkFactor) / 0.25 * 10)))
    : Math.min(10, Math.max(0, Math.round((parkFactor - 0.85) / 0.30 * 10)));

  // ── Component 5: Weather (0-10 pts) ──────────────────────────────────────
  const weatherComponent = Math.round((weatherScore / 10) * 10);

  // ── Component 6: Umpire (0-5 pts) ────────────────────────────────────────
  let umpireComponent = 2; // neutral
  if (umpireKRate !== undefined) {
    if (propType === "strikeouts") {
      umpireComponent = Math.min(5, Math.round((umpireKRate / 0.30) * 5));
    } else if (propType === "walks") {
      umpireComponent = Math.min(5, Math.max(0, Math.round((1 - umpireKRate / 0.30) * 5)));
    }
  }

  const tms = Math.min(100, disciplineComponent + handednessComponent + recentFormComponent + parkComponent + weatherComponent + umpireComponent);

  const rating: TeamMatchupScore["rating"] =
    tms >= 90 ? "Elite" :
    tms >= 80 ? "Strong" :
    tms >= 70 ? "Playable" :
    "Reject";

  // ── Discipline Edge detection ──────────────────────────────────────────────
  let hasDisciplineEdge = false;
  let disciplineEdgeReason: string | null = null;

  if (propType === "strikeouts" && discipline.strikeoutTendencyScore >= 70 && tms >= 75) {
    hasDisciplineEdge = true;
    disciplineEdgeReason = `${discipline.teamAbbr} ranks in the top tier for strikeout tendency (${discipline.strikeoutTendencyScore}/100) — elite K opportunity`;
  } else if (propType === "walks" && discipline.walkTendencyScore >= 70 && tms >= 75) {
    hasDisciplineEdge = true;
    disciplineEdgeReason = `${discipline.teamAbbr} is an elite walk-drawing team (${discipline.walkTendencyScore}/100) — strong walk prop opportunity`;
  } else if (propType === "strikeouts" && discipline.strikeoutTendencyScore >= 65 && discipline.walkTendencyScore >= 65 && tms >= 70) {
    hasDisciplineEdge = true;
    disciplineEdgeReason = `${discipline.teamAbbr} creates Dual Edge opportunities — high K tendency (${discipline.strikeoutTendencyScore}) and walk tendency (${discipline.walkTendencyScore})`;
  }

  return {
    tms,
    rating,
    disciplineGrade: discipline.disciplineGrade,
    disciplineScore: discipline.disciplineScore,
    walkTendencyScore: discipline.walkTendencyScore,
    strikeoutTendencyScore: discipline.strikeoutTendencyScore,
    hasDisciplineEdge,
    disciplineEdgeReason,
    walkBoostBps: discipline.walkBoostBps,
    strikeoutBoostBps: discipline.strikeoutBoostBps,
    breakdown: {
      disciplineComponent,
      handednessComponent,
      recentFormComponent,
      parkComponent,
      weatherComponent,
      umpireComponent,
    },
  };
}

// ── Get prop tendency leaderboards ────────────────────────────────────────────
export async function getPropTendencyLeaderboards(): Promise<{
  topWalkTeams: TeamDisciplineData[];
  topStrikeoutTeams: TeamDisciplineData[];
  mostPatientTeams: TeamDisciplineData[];
  mostAggressiveTeams: TeamDisciplineData[];
  dualEdgeTeams: TeamDisciplineData[];
}> {
  const all = await getAllTeamDisciplineData();
  const teams = Array.from(all.values());

  const topWalkTeams = [...teams].sort((a, b) => b.walkTendencyScore - a.walkTendencyScore).slice(0, 10);
  const topStrikeoutTeams = [...teams].sort((a, b) => b.strikeoutTendencyScore - a.strikeoutTendencyScore).slice(0, 10);
  const mostPatientTeams = [...teams].sort((a, b) => b.patientScore - a.patientScore).slice(0, 10);
  const mostAggressiveTeams = [...teams].sort((a, b) => b.aggressiveScore - a.aggressiveScore).slice(0, 10);
  const dualEdgeTeams = [...teams]
    .filter(t => t.walkTendencyScore >= 55 && t.strikeoutTendencyScore >= 55)
    .sort((a, b) => (b.walkTendencyScore + b.strikeoutTendencyScore) - (a.walkTendencyScore + a.strikeoutTendencyScore))
    .slice(0, 8);

  return { topWalkTeams, topStrikeoutTeams, mostPatientTeams, mostAggressiveTeams, dualEdgeTeams };
}

// ── Invalidate cache (call after DB update) ───────────────────────────────────
export function invalidateDisciplineCache(): void {
  disciplineCache = null;
  cacheTs = 0;
}
