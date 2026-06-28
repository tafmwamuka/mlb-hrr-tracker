/**
 * picksSummaryRoute.ts
 *
 * Public GET endpoint — no auth required.
 * Readable by Claude, external tools, or any browser.
 *
 * Endpoints:
 *   GET /api/picks-summary              → today's picks
 *   GET /api/picks-summary?date=2026-06-28  → specific date
 *   GET /api/picks-summary?date=yesterday   → yesterday's picks
 *
 * Add to server/_core/index.ts:
 *   import { registerPicksSummaryRoute } from '../routes/picksSummaryRoute';
 *   registerPicksSummaryRoute(app);
 *
 * SECURITY NOTE:
 *   This endpoint is intentionally public — it exposes the same
 *   data users see on the app. It does NOT expose internal scoring
 *   weights, model parameters, or user data.
 */

import type { Express, Request, Response } from 'express';
import { getEnrichedMoneyPicks } from '../services/hrrPicksService';
import { runPitcherEdgeEngine } from '../services/pitcherEdgeEngine';
import { filterPitcherPicks } from '../services/pitcherPicksFilter';
import { getDb } from '../db';
import { pickSnapshots } from '../../drizzle/schema';
import { and, gte, lte } from 'drizzle-orm';

// ─── Types ────────────────────────────────────────────────────────────────────

interface HRRPickSummary {
  rank: number;
  playerName: string;
  team: string;
  opponent: string;
  pitcher: string;
  battingPosition: number;
  propType: 'hits' | 'runs' | 'rbi' | 'hrr';
  line: number;
  bookOdds: number;
  modelProb: number;        // 0-100
  impliedProb: number;      // vig-free book %
  edge: number;             // model - implied (percentage points)
  ev: number | null;        // expected value %
  overallScore: number;     // matrix score 0-100
  grade: string;            // Elite / Strong / Lean
  tier: string;             // ELITE / STRONG / LEAN
  isOfficialPlay: boolean;
  lockStage: string;        // PRELIMINARY / LOCKING_SOON / LOCKED / FINAL
  gameTime: string;         // ISO timestamp
  recentForm: string | null; // e.g. "80% last 5"
  whyItQualifies: string[]; // plain English reasons
}

interface PitcherPickSummary {
  rank: number;
  pitcherName: string;
  team: string;
  opponent: string;
  propType: 'strikeouts' | 'walks';
  line: number;
  bookOdds: number;
  modelProb: number;
  impliedProb: number;
  edge: number;
  tms: number;
  disciplineGrade: string | null;
  tier: string;
  isOfficialPlay: boolean;
  isDualEdge: boolean;
  gameTime: string;
  qualifyingReasons: string[];
}

interface ParlayLeg {
  type: 'hrr' | 'pitcher';
  playerName: string;
  prop: string;            // e.g. "O 1.5 HRR" or "O 3.5 K"
  bookOdds: number;
  modelProb: number;
  edge: number;
  game: string;            // e.g. "NYY vs HOU"
  gameTime: string;
}

interface SuggestedParlay {
  legs: ParlayLeg[];
  combinedModelProb: number;   // product of individual probs
  estimatedParlayOdds: number; // American odds estimate
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  warning: string | null;
  reasoning: string;
}

interface PicksSummaryResponse {
  // Meta
  slateDate: string;
  generatedAt: string;
  dataSource: 'live' | 'historical' | 'empty';

  // HRR Money Picks
  officialHRRPicks: HRRPickSummary[];
  leanHRRPicks: HRRPickSummary[];

  // Pitcher Picks
  officialPitcherPicks: PitcherPickSummary[];
  parlayOnlyPitcherPicks: PitcherPickSummary[];

  // Pre-computed parlay suggestions
  suggestedParlays: SuggestedParlay[];

  // Counts
  counts: {
    officialHRR: number;
    leanHRR: number;
    officialPitcher: number;
    parlayOnlyPitcher: number;
    totalActionable: number;
  };

  // Performance (if historical date)
  historicalPerformance: {
    hrrHitRate: number | null;
    pitcherHitRate: number | null;
    totalPicks: number;
    totalHits: number;
  } | null;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function parseQueryDate(dateParam: string | undefined): string {
  const today = new Date();
  const etDate = new Date(today.toLocaleString('en-US', { timeZone: 'America/New_York' }));

  if (!dateParam || dateParam === 'today') {
    return etDate.toISOString().slice(0, 10);
  }

  if (dateParam === 'yesterday') {
    etDate.setDate(etDate.getDate() - 1);
    return etDate.toISOString().slice(0, 10);
  }

  // Validate YYYY-MM-DD format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (dateRegex.test(dateParam)) {
    const parsed = new Date(dateParam);
    if (!isNaN(parsed.getTime())) {
      return dateParam;
    }
  }

  // Fallback to today
  return etDate.toISOString().slice(0, 10);
}

function isToday(dateStr: string): boolean {
  const today = new Date();
  const etDate = new Date(today.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return dateStr === etDate.toISOString().slice(0, 10);
}

function isFutureDate(dateStr: string): boolean {
  const today = new Date();
  const etDate = new Date(today.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const todayStr = etDate.toISOString().slice(0, 10);
  return dateStr > todayStr;
}

// ─── Parlay suggestion engine ─────────────────────────────────────────────────

function buildParlayOdds(prob1: number, prob2: number): number {
  // Combined probability
  const combined = (prob1 / 100) * (prob2 / 100);
  // Convert to American odds
  if (combined >= 0.5) {
    return Math.round(-(combined / (1 - combined)) * 100);
  } else {
    return Math.round(((1 - combined) / combined) * 100);
  }
}

function suggestBestParlays(
  hrrPicks: HRRPickSummary[],
  pitcherPicks: PitcherPickSummary[]
): SuggestedParlay[] {
  const suggestions: SuggestedParlay[] = [];

  // Get game identifiers to avoid same-game parlays
  const getGame = (p: HRRPickSummary | PitcherPickSummary) => {
    if ('team' in p && 'opponent' in p) {
      const teams = [p.team, p.opponent].sort();
      return teams.join('_');
    }
    return '';
  };

  // Build all candidate legs
  const hrrLegs: ParlayLeg[] = hrrPicks
    .filter(p => p.isOfficialPlay && p.modelProb >= 65)
    .map((p, i) => ({
      type: 'hrr' as const,
      playerName: p.playerName,
      prop: `O ${p.line} ${p.propType.toUpperCase()}`,
      bookOdds: p.bookOdds,
      modelProb: p.modelProb,
      edge: p.edge,
      game: `${p.team} vs ${p.opponent}`,
      gameTime: p.gameTime,
      _gameKey: getGame(p),
      _rank: i,
    }));

  const pitcherLegs: ParlayLeg[] = pitcherPicks
    .filter(p => p.isOfficialPlay && p.modelProb >= 65 && p.bookOdds > -300)
    .map((p, i) => ({
      type: 'pitcher' as const,
      playerName: p.pitcherName,
      prop: `O ${p.line} ${p.propType === 'strikeouts' ? 'K' : 'BB'}`,
      bookOdds: p.bookOdds,
      modelProb: p.modelProb,
      edge: p.edge,
      game: `${p.team} vs ${p.opponent}`,
      gameTime: p.gameTime,
      _gameKey: `${p.team}_${p.opponent}`,
      _rank: i,
    }));

  const allLegs = [...hrrLegs, ...pitcherLegs] as Array<ParlayLeg & { _gameKey: string; _rank: number }>;

  // Find best 2-leg combinations from DIFFERENT games
  for (let i = 0; i < allLegs.length; i++) {
    for (let j = i + 1; j < allLegs.length; j++) {
      const leg1 = allLegs[i];
      const leg2 = allLegs[j];

      // Skip same-game parlays
      if (leg1._gameKey && leg2._gameKey && leg1._gameKey === leg2._gameKey) continue;

      const combinedProb = (leg1.modelProb / 100) * (leg2.modelProb / 100) * 100;
      const parlayOdds = buildParlayOdds(leg1.modelProb, leg2.modelProb);

      const confidence: 'HIGH' | 'MEDIUM' | 'LOW' =
        combinedProb >= 55 ? 'HIGH' :
        combinedProb >= 45 ? 'MEDIUM' : 'LOW';

      // Warning for correlated legs
      let warning: string | null = null;
      if (leg1.type === 'hrr' && leg2.type === 'pitcher') {
        const hrrLeg = leg1;
        const pitLeg = leg2;
        // Check if batter is facing that pitcher
        const hrrGame = (hrrLeg as any).game || '';
        const pitGame = (pitLeg as any).game || '';
        if (hrrGame === pitGame || leg1._gameKey === leg2._gameKey) {
          warning = 'Same game — correlated legs increase variance';
        }
      }

      const reasoning = `${leg1.playerName} (${leg1.modelProb.toFixed(0)}% model) + ${leg2.playerName} (${leg2.modelProb.toFixed(0)}% model) = ${combinedProb.toFixed(0)}% combined probability`;

      suggestions.push({
        legs: [
          { type: leg1.type, playerName: leg1.playerName, prop: leg1.prop, bookOdds: leg1.bookOdds, modelProb: leg1.modelProb, edge: leg1.edge, game: leg1.game, gameTime: leg1.gameTime },
          { type: leg2.type, playerName: leg2.playerName, prop: leg2.prop, bookOdds: leg2.bookOdds, modelProb: leg2.modelProb, edge: leg2.edge, game: leg2.game, gameTime: leg2.gameTime },
        ],
        combinedModelProb: Math.round(combinedProb * 10) / 10,
        estimatedParlayOdds: parlayOdds,
        confidence,
        warning,
        reasoning,
      });
    }
  }

  // Sort by combined probability descending, return top 3
  suggestions.sort((a, b) => b.combinedModelProb - a.combinedModelProb);
  return suggestions.slice(0, 3);
}

// ─── Historical lookup ────────────────────────────────────────────────────────

async function getHistoricalPicks(dateStr: string): Promise<PicksSummaryResponse | null> {
  try {
    const startOfDay = new Date(`${dateStr}T00:00:00.000Z`);
    const endOfDay = new Date(`${dateStr}T23:59:59.999Z`);

    const db = await getDb();
    if (!db) return null;
    const rows = await db
      .select()
      .from(pickSnapshots)
      .where(
        and(
          gte(pickSnapshots.createdAt, startOfDay),
          lte(pickSnapshots.createdAt, endOfDay)
        )
      );

    if (!rows.length) return null;

    // Compute hit rates
    const hrrRows = rows.filter((r: any) => r.market === 'hrr' || r.market === 'hits' || r.market === 'runs' || r.market === 'rbi');
    const pitcherRows = rows.filter((r: any) => r.market === 'pitcher' || r.market === 'strikeouts' || r.market === 'walks');
    const hrrHits = hrrRows.filter((r: any) => r.result === 'hit').length;
    const pitcherHits = pitcherRows.filter((r: any) => r.result === 'hit').length;

    // Map DB rows to summary format
    const officialHRR: HRRPickSummary[] = hrrRows.map((r: any, i: number) => ({
      rank: i + 1,
      playerName: r.playerName,
      team: r.team,
      opponent: r.opponent ?? '',
      pitcher: r.pitcher ?? '',
      battingPosition: r.battingPosition ?? 0,
      propType: r.propType,
      line: r.line,
      bookOdds: r.bookOdds,
      modelProb: r.modelProb,
      impliedProb: r.impliedProb ?? 0,
      edge: r.edge ?? 0,
      ev: r.ev ?? null,
      overallScore: r.overallScore ?? 0,
      grade: r.grade ?? '',
      tier: r.tier ?? '',
      isOfficialPlay: r.isOfficialPlay ?? true,
      lockStage: 'FINAL',
      gameTime: r.gameTime ?? '',
      recentForm: r.recentForm ?? null,
      whyItQualifies: r.qualifyingReasons ?? [],
    }));

    const officialPitcher: PitcherPickSummary[] = pitcherRows.map((r: any, i: number) => ({
      rank: i + 1,
      pitcherName: r.playerName,
      team: r.team,
      opponent: r.opponent ?? '',
      propType: r.propType,
      line: r.line,
      bookOdds: r.bookOdds,
      modelProb: r.modelProb,
      impliedProb: r.impliedProb ?? 0,
      edge: r.edge ?? 0,
      tms: r.tms ?? 0,
      disciplineGrade: r.disciplineGrade ?? null,
      tier: r.tier ?? '',
      isOfficialPlay: r.isOfficialPlay ?? true,
      isDualEdge: r.isDualEdge ?? false,
      gameTime: r.gameTime ?? '',
      qualifyingReasons: r.qualifyingReasons ?? [],
    }));

    return {
      slateDate: dateStr,
      generatedAt: new Date().toISOString(),
      dataSource: 'historical',
      officialHRRPicks: officialHRR,
      leanHRRPicks: [],
      officialPitcherPicks: officialPitcher,
      parlayOnlyPitcherPicks: [],
      suggestedParlays: suggestBestParlays(officialHRR, officialPitcher),
      counts: {
        officialHRR: officialHRR.length,
        leanHRR: 0,
        officialPitcher: officialPitcher.length,
        parlayOnlyPitcher: 0,
        totalActionable: officialHRR.length + officialPitcher.length,
      },
      historicalPerformance: {
        hrrHitRate: hrrRows.length > 0 ? Math.round((hrrHits / hrrRows.length) * 1000) / 10 : null,
        pitcherHitRate: pitcherRows.length > 0 ? Math.round((pitcherHits / pitcherRows.length) * 1000) / 10 : null,
        totalPicks: rows.length,
        totalHits: hrrHits + pitcherHits,
      },
    };
  } catch (e) {
    console.error('[PicksSummary] Historical lookup failed:', e);
    return null;
  }
}

// ─── Main route handler ───────────────────────────────────────────────────────

export function registerPicksSummaryRoute(app: Express): void {
  app.get('/api/picks-summary', async (req: Request, res: Response) => {
    try {
      const dateParam = req.query.date as string | undefined;
      const slateDate = parseQueryDate(dateParam);

      // Set CORS headers — allow Claude and any browser to read this
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'public, max-age=120'); // cache 2 mins

      // Future date — no data yet
      if (isFutureDate(slateDate)) {
        const response: PicksSummaryResponse = {
          slateDate,
          generatedAt: new Date().toISOString(),
          dataSource: 'empty',
          officialHRRPicks: [],
          leanHRRPicks: [],
          officialPitcherPicks: [],
          parlayOnlyPitcherPicks: [],
          suggestedParlays: [],
          counts: { officialHRR: 0, leanHRR: 0, officialPitcher: 0, parlayOnlyPitcher: 0, totalActionable: 0 },
          historicalPerformance: null,
        };
        return res.json(response);
      }

      // Past date — serve from DB
      if (!isToday(slateDate)) {
        const historical = await getHistoricalPicks(slateDate);
        if (historical) return res.json(historical);

        // No historical data found
        return res.json({
          slateDate,
          generatedAt: new Date().toISOString(),
          dataSource: 'empty',
          officialHRRPicks: [],
          leanHRRPicks: [],
          officialPitcherPicks: [],
          parlayOnlyPitcherPicks: [],
          suggestedParlays: [],
          counts: { officialHRR: 0, leanHRR: 0, officialPitcher: 0, parlayOnlyPitcher: 0, totalActionable: 0 },
          historicalPerformance: null,
        });
      }

      // Today — fetch live data in parallel
      const [hrrResult, pitcherResult] = await Promise.allSettled([
        getEnrichedMoneyPicks(),
        runPitcherEdgeEngine(),
      ]);

      // Process HRR picks — getEnrichedMoneyPicks returns HRRPicksResult, extract moneyPicks array
      const rawHRR: any[] = hrrResult.status === 'fulfilled' ? (hrrResult.value?.moneyPicks ?? []) : [];
      const officialHRR: HRRPickSummary[] = rawHRR
        .filter((p: any) => p.isOfficialPlay || p.overallScore >= 68)
        .slice(0, 8)
        .map((p: any, i: number) => ({
          rank: i + 1,
          playerName: p.playerName ?? '',
          team: p.team ?? '',
          opponent: p.opponent ?? p.opposingTeam ?? '',
          pitcher: p.pitcher ?? p.opposingPitcher ?? '',
          battingPosition: p.battingPosition ?? p.lineupSpot ?? 0,
          propType: p.statType ?? p.propType ?? 'hits',
          line: p.recommendedLine ?? p.line ?? 0.5,
          bookOdds: p.bookOdds ?? p.odds ?? 0,
          modelProb: Math.round((p.overProbability ?? p.modelProb ?? 0.5) * (p.overProbability < 2 ? 100 : 1)),
          impliedProb: Math.round((p.impliedProbability ?? 0) * 100) / 100,
          edge: Math.round((p.edge ?? 0) * (p.edge < 2 ? 100 : 1) * 10) / 10,
          ev: p.expectedValue ?? null,
          overallScore: p.overallScore ?? 0,
          grade: p.pickGrade ?? p.grade ?? '',
          tier: p.tier ?? (p.overallScore >= 80 ? 'ELITE' : p.overallScore >= 68 ? 'STRONG' : 'LEAN'),
          isOfficialPlay: p.isOfficialPlay ?? false,
          lockStage: p.lockStage ?? 'PRELIMINARY',
          gameTime: p.gameTime ?? p.game?.gameDate ?? '',
          recentForm: p.last5HitRate ? `${Math.round(p.last5HitRate * 100)}% last 5` : null,
          whyItQualifies: p.qualifyingReasons ?? p.reasonsForPick ?? [],
        }));

      const leanHRR: HRRPickSummary[] = rawHRR
        .filter((p: any) => !p.isOfficialPlay && p.overallScore >= 60 && p.overallScore < 68)
        .slice(0, 4)
        .map((p: any, i: number) => ({
          rank: i + 1,
          playerName: p.playerName ?? '',
          team: p.team ?? '',
          opponent: p.opponent ?? '',
          pitcher: p.pitcher ?? '',
          battingPosition: p.battingPosition ?? 0,
          propType: p.statType ?? 'hits',
          line: p.recommendedLine ?? 0.5,
          bookOdds: p.bookOdds ?? 0,
          modelProb: Math.round((p.overProbability ?? 0.5) * 100),
          impliedProb: 0,
          edge: Math.round((p.edge ?? 0) * 100 * 10) / 10,
          ev: null,
          overallScore: p.overallScore ?? 0,
          grade: 'Lean',
          tier: 'LEAN',
          isOfficialPlay: false,
          lockStage: p.lockStage ?? 'PRELIMINARY',
          gameTime: p.gameTime ?? '',
          recentForm: null,
          whyItQualifies: [],
        }));

      // Process pitcher picks
      const rawPitcher = pitcherResult.status === 'fulfilled' ? pitcherResult.value : null;
      const filteredPitcher = rawPitcher ? filterPitcherPicks(rawPitcher.picks ?? [], rawPitcher.rejectedPlays ?? []) : null;

      const officialPitcher: PitcherPickSummary[] = (filteredPitcher?.officialPicks ?? [])
        .map((p: any, i: number) => ({
          rank: i + 1,
          pitcherName: p.pitcherName ?? '',
          team: p.pitcherTeam ?? '',
          opponent: p.opponentTeam ?? '',
          propType: p.propType ?? 'strikeouts',
          line: p.line ?? 0,
          bookOdds: p.bookOdds ?? 0,
          modelProb: Math.round(p.modelProbability * (p.modelProbability < 2 ? 100 : 1)),
          impliedProb: Math.round(p.impliedProbability * (p.impliedProbability < 2 ? 100 : 1)),
          edge: Math.round(p.edge * (p.edge < 2 ? 100 : 1) * 10) / 10,
          tms: p.tms ?? 0,
          disciplineGrade: p.disciplineGrade ?? null,
          tier: p.tier ?? 'OFFICIAL',
          isOfficialPlay: p.isOfficialPlay ?? false,
          isDualEdge: p.isDualEdge ?? false,
          gameTime: p.gameTime ?? '',
          qualifyingReasons: p.qualifyingReasons ?? [],
        }));

      const parlayOnlyPitcher: PitcherPickSummary[] = (filteredPitcher?.parlayOnlyPicks ?? [])
        .map((p: any, i: number) => ({
          rank: i + 1,
          pitcherName: p.pitcherName ?? '',
          team: p.pitcherTeam ?? '',
          opponent: p.opponentTeam ?? '',
          propType: p.propType ?? 'strikeouts',
          line: p.line ?? 0,
          bookOdds: p.bookOdds ?? 0,
          modelProb: Math.round(p.modelProbability * (p.modelProbability < 2 ? 100 : 1)),
          impliedProb: Math.round(p.impliedProbability * (p.impliedProbability < 2 ? 100 : 1)),
          edge: Math.round(p.edge * (p.edge < 2 ? 100 : 1) * 10) / 10,
          tms: p.tms ?? 0,
          disciplineGrade: p.disciplineGrade ?? null,
          tier: 'PARLAY_ONLY',
          isOfficialPlay: false,
          isDualEdge: p.isDualEdge ?? false,
          gameTime: p.gameTime ?? '',
          qualifyingReasons: [],
        }));

      // Build parlay suggestions
      const suggestedParlays = suggestBestParlays(officialHRR, officialPitcher);

      const response: PicksSummaryResponse = {
        slateDate,
        generatedAt: new Date().toISOString(),
        dataSource: 'live',
        officialHRRPicks: officialHRR,
        leanHRRPicks: leanHRR,
        officialPitcherPicks: officialPitcher,
        parlayOnlyPitcherPicks: parlayOnlyPitcher,
        suggestedParlays,
        counts: {
          officialHRR: officialHRR.length,
          leanHRR: leanHRR.length,
          officialPitcher: officialPitcher.length,
          parlayOnlyPitcher: parlayOnlyPitcher.length,
          totalActionable: officialHRR.length + officialPitcher.length,
        },
        historicalPerformance: null,
      };

      return res.json(response);

    } catch (error) {
      console.error('[PicksSummary] Error:', error);
      return res.status(500).json({
        error: 'Failed to generate picks summary',
        slateDate: parseQueryDate(req.query.date as string),
        generatedAt: new Date().toISOString(),
      });
    }
  });

  console.log('[PicksSummary] Public endpoint registered: GET /api/picks-summary');
}
