/**
 * picksSummary.test.ts
 *
 * Unit tests for GET /api/picks-summary
 * Validates response shape, field types, and cache header behaviour.
 * Mocks both upstream services so no real API calls are made.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── Mock upstream services ───────────────────────────────────────────────────

vi.mock("../services/hrrPicksService", () => ({
  getEnrichedMoneyPicks: vi.fn().mockResolvedValue({
    moneyPicks: [
      {
        playerName: "Aaron Judge",
        team: "NYY",
        pitcher: "Gerrit Cole",
        pitcherTeam: "HOU",
        expectedHits: 1.4,
        expectedRuns: 0.9,
        expectedRBI: 1.1,
        expectedTotal: 1.4,
        recommendedLine: 1.5,
        recommendedProb: 72,
        bookOdds: "-130",
        overProbability: 72,
        edge: 8.5,
        grade: "Strong",
        overallScore: 74,
        bestLineVerdict: "BEST LINE",
      },
    ],
    slateDate: "2026-06-28",
  }),
}));

vi.mock("../services/pitcherEdgeEngine", () => ({
  runPitcherEdgeEngine: vi.fn().mockResolvedValue({
    picks: [
      {
        pitcherName: "Gerrit Cole",
        pitcherTeam: "HOU",
        opponentTeam: "NYY",
        pitcherHand: "R",
        gameTime: "2026-06-28T18:05:00Z",
        propType: "strikeouts",
        line: 7.5,
        bookOdds: -145,
        fairOdds: -165,
        modelProbability: 0.68,
        impliedProbability: 0.59,
        edge: 0.09,
        pitcherEdgeScore: 78,
        tms: 72,
        tier: "OFFICIAL",
        hasDisciplineEdge: true,
        isDualEdge: false,
        qualifyingReasons: ["High K rate opponent"],
        riskFlags: [],
        disciplineGrade: "A",
        opponentKRate: 24.5,
        opponentBBRate: 8.2,
        historicalHitRate: 0.71,
        sampleSize: 12,
        isOfficialPlay: true,
        isLeanPlay: false,
        isProjectionOnly: false,
        hasMarketData: true,
        pricingPenaltyTier: "NONE",
        pricingPenaltyLabel: "",
        isUltraJuiced: false,
        adjustedEdgeScore: 78,
        actionabilityScore: 80,
        playCategory: "OFFICIAL_PLAY",
      },
    ],
    rejectedPlays: [],
  }),
}));

vi.mock("../services/pitcherPicksFilter", () => ({
  filterPitcherPicks: vi.fn().mockImplementation((picks: any[]) => ({
    officialPicks: picks,
    leanPicks: [],
    parlayOnlyPicks: [],
    modelOutliers: [],
    dualEdgePitchers: [],
    stackAlertGames: [],
    hasOfficialPlays: true,
    hasLeanPlays: false,
    rejectedPlays: [],
    counts: { official: picks.length, lean: 0, parlayOnly: 0, outliers: 0, total: picks.length },
  })),
}));

// ─── Build test app ───────────────────────────────────────────────────────────

async function buildApp() {
  const { default: picksSummaryRouter } = await import("./picksSummary");
  const app = express();
  app.use(express.json());
  app.use("/api/picks-summary", picksSummaryRouter);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/picks-summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with correct top-level shape", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/picks-summary");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("generatedAt");
    expect(res.body).toHaveProperty("slateDate");
    expect(res.body).toHaveProperty("hrrPicks");
    expect(res.body).toHaveProperty("pitcherPicks");
    expect(res.body).toHaveProperty("counts");
  });

  it("hrrPicks contains expected fields", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/picks-summary");

    expect(res.body.hrrPicks.length).toBeGreaterThan(0);
    const pick = res.body.hrrPicks[0];
    expect(pick).toHaveProperty("playerName");
    expect(pick).toHaveProperty("team");
    expect(pick).toHaveProperty("pitcher");
    expect(pick).toHaveProperty("line");
    expect(pick).toHaveProperty("modelProb");
    expect(pick).toHaveProperty("edge");
    expect(pick).toHaveProperty("grade");
    expect(pick).toHaveProperty("overallScore");
    expect(typeof pick.overallScore).toBe("number");
  });

  it("pitcherPicks contains expected fields", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/picks-summary");

    expect(res.body.pitcherPicks.length).toBeGreaterThan(0);
    const pick = res.body.pitcherPicks[0];
    expect(pick).toHaveProperty("pitcherName");
    expect(pick).toHaveProperty("propType");
    expect(pick).toHaveProperty("line");
    expect(pick).toHaveProperty("bookOdds");
    expect(pick).toHaveProperty("modelProb");
    expect(pick).toHaveProperty("edge");
    expect(pick).toHaveProperty("tms");
    expect(pick).toHaveProperty("isOfficialPlay");
    expect(pick.isOfficialPlay).toBe(true);
  });

  it("counts reflects the number of picks returned", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/picks-summary");

    expect(res.body.counts.hrr).toBe(res.body.hrrPicks.length);
    expect(res.body.counts.pitcher).toBe(res.body.pitcherPicks.length);
    expect(typeof res.body.counts.parlayOnly).toBe("number");
  });

  it("generatedAt is a valid ISO timestamp", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/picks-summary");

    const ts = new Date(res.body.generatedAt);
    expect(isNaN(ts.getTime())).toBe(false);
  });

  it("sets X-Cache header", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/picks-summary");
    expect(["HIT", "MISS"]).toContain(res.headers["x-cache"]);
  });
});
