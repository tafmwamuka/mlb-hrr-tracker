/**
 * picksSummary.ts
 *
 * Public REST route: GET /api/picks-summary
 *
 * Returns today's top official HRR batter picks and pitcher edge picks as
 * plain JSON — no authentication required.  Designed for external consumers
 * (Discord bots, widgets, automation scripts) that don't speak tRPC.
 *
 * Response shape:
 * {
 *   generatedAt: string,          // ISO timestamp
 *   slateDate: string,            // "YYYY-MM-DD"
 *   hrrPicks: HRRPickSummary[],   // top official batter picks (≤6)
 *   pitcherPicks: PitcherPickSummary[], // official pitcher picks (≤8)
 *   counts: { hrr: number, pitcher: number, parlayOnly: number }
 * }
 */

import { Router } from "express";
import { getEnrichedMoneyPicks } from "../services/hrrPicksService";
import { runPitcherEdgeEngine } from "../services/pitcherEdgeEngine";
import { filterPitcherPicks } from "../services/pitcherPicksFilter";

const router = Router();

// ─── Lightweight summary shapes (no internal scoring internals) ───────────────

interface HRRPickSummary {
  playerName: string;
  team: string;
  pitcher: string;
  pitcherTeam: string;
  statType: string;           // "hits" | "runs" | "rbi"
  line: number;               // recommended over line
  bookOdds: number | null;    // American odds
  modelProb: number;          // 0-100
  edge: number;               // model edge %
  grade: string;              // "Elite" | "Strong" | "Lean"
  overallScore: number;
  bestLineVerdict: string | null;
}

interface PitcherPickSummary {
  pitcherName: string;
  pitcherTeam: string;
  opponentTeam: string;
  propType: "strikeouts" | "walks";
  line: number;
  bookOdds: number;
  modelProb: number;          // 0-100
  edge: number;               // 0-100
  tms: number;                // Team Matchup Score 0-100
  tier: string;
  isOfficialPlay: boolean;
}

// ─── In-memory cache (5 min TTL) ─────────────────────────────────────────────

let cache: { payload: object; ts: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000;

// ─── Route ────────────────────────────────────────────────────────────────────

router.get("/", async (_req, res) => {
  try {
    // Serve from cache if fresh
    if (cache && Date.now() - cache.ts < CACHE_TTL) {
      res.setHeader("X-Cache", "HIT");
      res.setHeader("Content-Type", "application/json");
      return res.json(cache.payload);
    }

    // Run both pipelines in parallel
    const [hrrResult, pitcherResult] = await Promise.allSettled([
      getEnrichedMoneyPicks(),
      runPitcherEdgeEngine(),
    ]);

    // ── HRR batter picks ──────────────────────────────────────────────────────
    const hrrPicks: HRRPickSummary[] = [];
    if (hrrResult.status === "fulfilled") {
      const picks = hrrResult.value.moneyPicks ?? [];
      for (const p of picks.slice(0, 6)) {
        // Determine primary stat type from the pick's expected values
        const statType =
          p.expectedRBI >= p.expectedHits && p.expectedRBI >= p.expectedRuns
            ? "rbi"
            : p.expectedRuns >= p.expectedHits
            ? "runs"
            : "hits";

        hrrPicks.push({
          playerName: p.playerName,
          team: p.team,
          pitcher: p.pitcher,
          pitcherTeam: p.pitcherTeam,
          statType,
          line: p.recommendedLine,
          bookOdds:
            p.bookOdds != null ? Number(p.bookOdds) : null,
          modelProb: Math.round(p.overProbability * 10) / 10,
          edge: Math.round(p.edge * 10) / 10,
          grade: p.grade ?? (p.overallScore >= 80 ? "Elite" : p.overallScore >= 68 ? "Strong" : "Lean"),
          overallScore: Math.round(p.overallScore),
          bestLineVerdict: p.bestLineVerdict ?? null,
        });
      }
    }

    // ── Pitcher picks ─────────────────────────────────────────────────────────
    const pitcherPicks: PitcherPickSummary[] = [];
    if (pitcherResult.status === "fulfilled") {
      const filtered = filterPitcherPicks(
        pitcherResult.value.picks,
        pitcherResult.value.rejectedPlays
      );
      for (const p of filtered.officialPicks) {
        pitcherPicks.push({
          pitcherName: p.pitcherName,
          pitcherTeam: p.pitcherTeam,
          opponentTeam: p.opponentTeam,
          propType: p.propType,
          line: p.line,
          bookOdds: p.bookOdds,
          modelProb: Math.round(p.modelProbability * 10) / 10,
          edge: Math.round(p.edge * 10) / 10,
          tms: Math.round(p.tms),
          tier: p.tier,
          isOfficialPlay: p.isOfficialPlay,
        });
      }
    }

    // ── Parlay-only pitcher count ─────────────────────────────────────────────
    let parlayOnlyCount = 0;
    if (pitcherResult.status === "fulfilled") {
      const filtered = filterPitcherPicks(
        pitcherResult.value.picks,
        pitcherResult.value.rejectedPlays
      );
      parlayOnlyCount = filtered.counts.parlayOnly;
    }

    const payload = {
      generatedAt: new Date().toISOString(),
      slateDate:
        hrrResult.status === "fulfilled"
          ? hrrResult.value.slateDate
          : new Date().toISOString().slice(0, 10),
      hrrPicks,
      pitcherPicks,
      counts: {
        hrr: hrrPicks.length,
        pitcher: pitcherPicks.length,
        parlayOnly: parlayOnlyCount,
      },
    };

    // Cache and respond
    cache = { payload, ts: Date.now() };
    res.setHeader("X-Cache", "MISS");
    res.setHeader("Content-Type", "application/json");
    return res.json(payload);
  } catch (err) {
    console.error("[/api/picks-summary] Error:", err);
    return res.status(500).json({
      error: "Failed to generate picks summary",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
