/**
 * Diamond Smart Lab Router
 *
 * Provides three procedures:
 *   1. getSlateData — assembles structured Diamond Edge data for the AI layer
 *   2. analyzeSlate — sends structured data to the LLM and returns Smart Lab analysis
 *   3. chat — conversational AI assistant grounded in today's full pitcher + hitter data
 *
 * Architecture: Diamond Edge backend calculates everything; AI interprets, explains,
 * and builds parlays. The AI never invents odds or probabilities.
 *
 * PITCHER CONTEXT: The chat procedure always builds a full pitcher analysis block for
 * every starting pitcher — regardless of whether live Odds API lines are available.
 * This includes: TMS, discipline grade, K rate, BB rate, expected Ks/BBs, model
 * probability for every alt line, market odds (when available), edge, fair odds,
 * confidence tier, and qualifying reasons. The AI can always answer pitcher questions.
 */

import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc";
import { getEnrichedMoneyPicks } from "../services/hrrPicksService";
import { invokeLLM } from "../_core/llm";
import { fetchTodaysGames } from "../services/mlbLineupService";
import { computeTeamMatchupScore, getTeamDiscipline } from "../services/teamDisciplineService";
import { fetchPitcherMarketData } from "../services/oddsApiService";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function edgeLabel(edge: number): string {
  if (edge >= 10) return "Strong positive edge";
  if (edge >= 5) return "Moderate positive edge";
  if (edge >= 0) return "Slight positive edge";
  return "Negative edge — caution";
}

function tierLabel(score: number): string {
  if (score >= 83) return "S-Tier (Elite)";
  if (score >= 74) return "A-Tier (Strong)";
  if (score >= 68) return "Lean";
  return "Watch";
}

/** Convert an EnrichedMoneyPick into the structured JSON the AI receives */
function pickToStructured(pick: any) {
  return {
    playerName: pick.playerName,
    team: pick.team,
    pitcher: pick.pitcher,
    pitcherTeam: pick.pitcherTeam,
    battingPosition: pick.battingPosition,
    recommendedLine: pick.recommendedLine,
    hrrProbability: Math.round(pick.recommendedProb),
    bookOdds: pick.bookOdds ?? null,
    fairLine: pick.fairLine ? Math.round(pick.fairLine) : null,
    edge: pick.edge != null ? Math.round(pick.edge) : null,
    edgeLabel: pick.edge != null ? edgeLabel(pick.edge) : null,
    overallScore: pick.overallScore,
    tier: tierLabel(pick.overallScore),
    projectedHits: pick.expectedHits,
    projectedRuns: pick.expectedRuns,
    projectedRBI: pick.expectedRBI,
    projectedTotal: pick.expectedTotal,
    gameTotalOU: pick.gameTotalOU ?? null,
    reasons: pick.reasons ?? [],
    riskFlags: pick.riskFlags ?? [],
    vsGrade: pick.vsGrade ?? null,
    primePosition: pick.primePosition ?? false,
    isBestBet: pick.isBestBet ?? false,
    leanTier: pick.leanTier ?? false,
    lineEvaluations: (pick.lineEvaluations ?? []).map((le: any) => ({
      line: le.line,
      bookOdds: le.bookOdds,
      modelProb: le.modelProb,
      edge: le.edge,
      verdict: le.verdict,
      riskGrade: le.riskGrade,
    })),
  };
}

// ─── Poisson helpers (mirrors pitcherEdgeEngine) ──────────────────────────────

function poissonOverProb(expectedValue: number, line: number): number {
  const k = Math.floor(line);
  let cdf = 0;
  let term = Math.exp(-expectedValue);
  cdf += term;
  for (let i = 1; i <= k; i++) {
    term *= expectedValue / i;
    cdf += term;
  }
  return Math.max(0.01, Math.min(0.99, 1 - cdf));
}

function estimateExpectedKs(opponentKRate: number, tms: number): number {
  const baseline = 5.5;
  const kRateAdj = (opponentKRate - 0.24) * 20;
  const tmsAdj = ((tms - 50) / 10) * 0.3;
  return Math.max(1, baseline + kRateAdj + tmsAdj);
}

function estimateExpectedBBs(opponentBBRate: number, tms: number): number {
  const baseline = 2.5;
  const bbRateAdj = (opponentBBRate - 0.09) * 30;
  const tmsAdj = ((tms - 50) / 10) * 0.15;
  return Math.max(0.5, baseline + bbRateAdj + tmsAdj);
}

function probToAmericanOdds(prob: number): number {
  if (prob <= 0 || prob >= 1) return -110;
  if (prob >= 0.5) return Math.round(-(prob / (1 - prob)) * 100);
  return Math.round(((1 - prob) / prob) * 100);
}

function confidenceTier(modelProb: number, edge: number, tms: number): string {
  if (modelProb >= 0.72 && edge >= 0.12 && tms >= 75) return "🛡 ELITE";
  if (modelProb >= 0.65 && edge >= 0.07 && tms >= 65) return "✅ OFFICIAL";
  if (modelProb >= 0.60 && edge >= 0.05) return "📊 STRONG";
  if (modelProb >= 0.55 && edge >= 0.03) return "🔵 LEAN";
  return "⚠️ WATCH";
}

// ─── Full pitcher analysis builder ───────────────────────────────────────────

/**
 * Builds a rich analysis block for a single starting pitcher.
 * Always runs regardless of whether Odds API has live lines.
 * Includes: TMS, discipline grade, K/BB rates, expected Ks/BBs,
 * model probability for every standard alt line, market odds (when available),
 * edge per line, fair odds, confidence tier, qualifying reasons.
 */
async function buildPitcherAnalysis(params: {
  pitcherName: string;
  pitcherTeam: string;
  opponentTeam: string;
  gameTime: string;
  marketData: Map<string, any>;
}): Promise<Record<string, any>> {
  const { pitcherName, pitcherTeam, opponentTeam, gameTime, marketData } = params;

  // Fetch discipline + TMS in parallel for K and BB props
  const [kTmsResult, bbTmsResult, opponentDiscipline] = await Promise.all([
    computeTeamMatchupScore({ opponentTeam, pitcherHand: 'R', propType: 'strikeouts' }).catch(() => null),
    computeTeamMatchupScore({ opponentTeam, pitcherHand: 'R', propType: 'walks' }).catch(() => null),
    getTeamDiscipline(opponentTeam).catch(() => null),
  ]);

  const kTms = kTmsResult?.tms ?? 50;
  const bbTms = bbTmsResult?.tms ?? 50;
  const disciplineGrade = opponentDiscipline?.disciplineGrade ?? 'B';
  const opponentKRate = opponentDiscipline?.strikeoutRate ?? 0.24;
  const opponentBBRate = opponentDiscipline?.walkRate ?? 0.09;
  const strikeoutTendencyScore = opponentDiscipline?.strikeoutTendencyScore ?? 50;
  const walkTendencyScore = opponentDiscipline?.walkTendencyScore ?? 50;
  const hasDisciplineEdge = kTmsResult?.hasDisciplineEdge ?? false;
  const disciplineEdgeReason = kTmsResult?.disciplineEdgeReason ?? null;

  // Expected counts from model
  const expectedKs = estimateExpectedKs(opponentKRate, kTms);
  const expectedBBs = estimateExpectedBBs(opponentBBRate, bbTms);

  // Market data for this pitcher (may be null if Odds API has no lines)
  const market = marketData.get(pitcherName) ?? null;

  // ── Build K lines analysis ─────────────────────────────────────────────────
  // Standard alt lines to always evaluate (even without market data)
  const standardKLines = [3.5, 4.5, 5.5, 6.5, 7.5];
  const kLinesAnalysis: Array<Record<string, any>> = [];

  for (const line of standardKLines) {
    const modelProb = poissonOverProb(expectedKs, line);
    const fairOdds = probToAmericanOdds(modelProb);

    // Find matching market line if available
    const marketLine = market?.altKLines?.find((l: any) => l.line === line) ?? null;
    const bookOdds = marketLine?.overOdds ?? null;
    const impliedProb = marketLine?.trueOverProb ?? null;
    const edge = impliedProb !== null ? Math.round((modelProb - impliedProb) * 1000) / 10 : null;
    const tier = impliedProb !== null
      ? confidenceTier(modelProb, (modelProb - impliedProb), kTms)
      : (modelProb >= 0.65 ? "✅ MODEL STRONG" : modelProb >= 0.55 ? "🔵 MODEL LEAN" : "⚠️ MODEL WEAK");

    kLinesAnalysis.push({
      line,
      modelProbability: Math.round(modelProb * 1000) / 10,  // as %
      fairOdds,
      bookOdds,
      impliedProbability: impliedProb !== null ? Math.round(impliedProb * 1000) / 10 : null,
      edge,
      tier,
      hasMarketData: bookOdds !== null,
    });
  }

  // Main K line from market (if available)
  const mainKLine = market?.mainKLine ?? null;
  const mainKOdds = market?.mainKOverOdds ?? null;

  // ── Build BB lines analysis ────────────────────────────────────────────────
  const standardBBLines = [0.5, 1.5, 2.5];
  const bbLinesAnalysis: Array<Record<string, any>> = [];

  for (const line of standardBBLines) {
    const modelProb = poissonOverProb(expectedBBs, line);
    const fairOdds = probToAmericanOdds(modelProb);

    const marketLine = market?.walkLines?.find((l: any) => l.line === line) ?? null;
    const bookOdds = marketLine?.overOdds ?? null;
    const impliedProb = marketLine?.trueOverProb ?? null;
    const edge = impliedProb !== null ? Math.round((modelProb - impliedProb) * 1000) / 10 : null;
    const tier = impliedProb !== null
      ? confidenceTier(modelProb, (modelProb - impliedProb), bbTms)
      : (modelProb >= 0.65 ? "✅ MODEL STRONG" : modelProb >= 0.55 ? "🔵 MODEL LEAN" : "⚠️ MODEL WEAK");

    bbLinesAnalysis.push({
      line,
      modelProbability: Math.round(modelProb * 1000) / 10,
      fairOdds,
      bookOdds,
      impliedProbability: impliedProb !== null ? Math.round(impliedProb * 1000) / 10 : null,
      edge,
      tier,
      hasMarketData: bookOdds !== null,
    });
  }

  // ── Build qualifying reasons ───────────────────────────────────────────────
  const reasons: string[] = [];
  if (opponentKRate >= 0.26) reasons.push(`Opponent K rate: ${(opponentKRate * 100).toFixed(1)}% vs RHP (above average)`);
  else if (opponentKRate >= 0.23) reasons.push(`Opponent K rate: ${(opponentKRate * 100).toFixed(1)}% vs RHP (near average)`);
  else reasons.push(`Opponent K rate: ${(opponentKRate * 100).toFixed(1)}% vs RHP (below average — caution on K props)`);

  reasons.push(`Opponent Discipline Grade: ${disciplineGrade}`);
  reasons.push(`Strikeout Tendency Score: ${strikeoutTendencyScore}/100`);
  reasons.push(`Walk Tendency Score: ${walkTendencyScore}/100`);

  if (kTms >= 70) reasons.push(`Strong K Matchup Score: ${kTms}/100`);
  else if (kTms >= 55) reasons.push(`Moderate K Matchup Score: ${kTms}/100`);
  else reasons.push(`Weak K Matchup Score: ${kTms}/100 — below threshold`);

  if (hasDisciplineEdge && disciplineEdgeReason) reasons.push(`💎 DISCIPLINE EDGE: ${disciplineEdgeReason}`);

  return {
    pitcherName,
    pitcherTeam,
    opponentTeam,
    gameTime,
    hasMarketData: market !== null,
    // Matchup scores
    kTms,
    bbTms,
    kTmsRating: kTmsResult?.rating ?? 'Playable',
    bbTmsRating: bbTmsResult?.rating ?? 'Playable',
    // Opponent discipline
    disciplineGrade,
    opponentKRate: Math.round(opponentKRate * 1000) / 10,
    opponentBBRate: Math.round(opponentBBRate * 1000) / 10,
    strikeoutTendencyScore,
    walkTendencyScore,
    hasDisciplineEdge,
    disciplineEdgeReason,
    // Model projections
    expectedKs: Math.round(expectedKs * 10) / 10,
    expectedBBs: Math.round(expectedBBs * 10) / 10,
    // Main market line (if available)
    mainKLine,
    mainKOdds,
    // All K lines with model analysis
    kLines: kLinesAnalysis,
    // All BB lines with model analysis
    bbLines: bbLinesAnalysis,
    // Qualifying reasons
    reasons,
  };
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const smartLabRouter = router({

  /**
   * getSlateData — returns structured Diamond Edge data for the current slate.
   */
  getSlateData: publicProcedure.query(async () => {
    const result = await getEnrichedMoneyPicks();

    const officialPicks = result.moneyPicks.map(pickToStructured);
    const topCandidates = (result.topCandidates ?? []).map(pickToStructured);

    return {
      dataDate: result.dataDate,
      lineupsPending: result.lineupsPending,
      hasOddsData: result.hasOddsData,
      isStaleSlate: result.isStaleSlate,
      firstPitchTime: result.firstPitchTime,
      emptySlateReasons: result.emptySlateReasons ?? [],
      officialPicks,
      topCandidates,
      pickCount: officialPicks.length,
    };
  }),

  /**
   * analyzeSlate — sends structured slate data to the LLM and returns a full
   * Smart Lab analysis: best value play, safe parlays, upside parlays, slate
   * insights, and risk summary. All grounded in real Diamond Edge data.
   */
  analyzeSlate: publicProcedure.mutation(async () => {
    const [result, games, marketData] = await Promise.all([
      getEnrichedMoneyPicks(),
      fetchTodaysGames().catch(() => []),
      fetchPitcherMarketData().catch(() => new Map()),
    ]);

    const officialPicks = result.moneyPicks.map(pickToStructured);
    const topCandidates = (result.topCandidates ?? []).map(pickToStructured);
    const allPicks = officialPicks.length > 0 ? officialPicks : topCandidates;

    // Build full pitcher analyses for all starters
    const pitcherAnalyses: Array<Record<string, any>> = [];
    for (const game of games.slice(0, 12)) {
      const hp = game.homeTeam.probablePitcher;
      const ap = game.awayTeam.probablePitcher;
      if (hp) {
        const analysis = await buildPitcherAnalysis({
          pitcherName: hp.fullName,
          pitcherTeam: game.homeTeam.abbreviation,
          opponentTeam: game.awayTeam.abbreviation,
          gameTime: game.gameTime,
          marketData,
        }).catch(() => null);
        if (analysis) pitcherAnalyses.push(analysis);
      }
      if (ap) {
        const analysis = await buildPitcherAnalysis({
          pitcherName: ap.fullName,
          pitcherTeam: game.awayTeam.abbreviation,
          opponentTeam: game.homeTeam.abbreviation,
          gameTime: game.gameTime,
          marketData,
        }).catch(() => null);
        if (analysis) pitcherAnalyses.push(analysis);
      }
    }

    // Sort pitchers by K TMS descending
    pitcherAnalyses.sort((a, b) => (b.kTms ?? 0) - (a.kTms ?? 0));

    const pitcherContext = pitcherAnalyses.length > 0
      ? `\n\nTODAY'S PITCHER ANALYSIS (${pitcherAnalyses.length} starters, sorted by K TMS):\n${JSON.stringify(pitcherAnalyses, null, 2)}`
      : '';

    if (allPicks.length === 0 && pitcherAnalyses.length === 0) {
      return {
        bestValuePlay: null,
        safeParlays: [],
        upsideParlays: [],
        slateInsights: "Today's slate has no qualifying plays yet. Check back closer to first pitch when lineups are confirmed.",
        riskSummary: "",
        isEmptySlate: true,
        emptySlateReasons: result.emptySlateReasons ?? [],
        generatedAt: new Date().toISOString(),
      };
    }

    const slateJson = JSON.stringify(allPicks, null, 2) + pitcherContext;
    const isPartialSlate = officialPicks.length === 0;

    const systemPrompt = `You are Diamond Smart Lab — the central intelligence engine of Diamond Edge, an elite MLB betting analytics platform.

CRITICAL RULES:
- You ONLY work with the structured Diamond Edge data provided. Never invent odds, probabilities, or stats.
- All hrrProbability, edge, bookOdds, fairLine, modelProbability, kTms, bbTms, and disciplineGrade values come from the Diamond Edge model — treat them as authoritative.
- Sound analytical, sharp, and professional. Never hype or use generic gambling language.
- When building parlays, prefer players from DIFFERENT games to reduce correlation risk.
- For safe parlays: prioritize batting positions 1-4, high gameTotalOU, positive edge, low riskFlags.
- For upside parlays: allow higher lines (2.5+) and slightly lower scores but still positive edge.
- Always explain WHY a play qualifies using specific data points from the structured input.
- If riskFlags exist, always mention the most important one.
- Never force weak plays — if the slate is thin, say so honestly.

PITCHER ANALYSIS RULES:
- For each pitcher in PITCHER DATA, kLines contains model probabilities for every alt K line (3.5–7.5). bbLines contains model probabilities for BB lines (0.5–2.5).
- kTms ≥ 70 = strong K matchup. kTms ≥ 55 = moderate. kTms < 55 = weak.
- disciplineGrade D or C = undisciplined hitters — favors K props.
- disciplineGrade A or A+ = disciplined hitters — favors BB props, caution on K props.
- hasDisciplineEdge = true means 💎 DISCIPLINE EDGE is confirmed — this is a premium signal.
- For topPitcherPlays: select the 2-4 best K props AND 1-2 best BB props from the pitcher data. Use modelProbability from kLines/bbLines. Prefer lines where hasMarketData is true (live odds exist) but still include model-only plays with a note.
- For each pitcher play: state the line, modelProbability, bookOdds (or 'Model only — no live line'), edge (or 'N/A'), and the top 2 qualifying reasons from the reasons array.`;

    const userPrompt = `Today's Diamond Edge slate data (${result.dataDate}):

${slateJson}

${isPartialSlate ? "NOTE: No official picks qualified today. These are the top near-miss candidates — analyze with appropriate caution.\n\n" : ""}

Please provide a complete Diamond Smart Lab analysis in the following JSON structure:

{
  "bestValuePlay": {
    "playerName": "string",
    "team": "string",
    "line": number,
    "reason": "2-3 sentence analytical explanation of why this is the best value play",
    "edgeSummary": "one-line edge/odds summary",
    "keyRiskFlag": "most important risk flag or null"
  },
  "topPitcherPlays": [
    {
      "pitcherName": "string",
      "pitcherTeam": "string",
      "opponentTeam": "string",
      "propType": "strikeouts" | "walks",
      "line": number,
      "modelProbability": number,
      "bookOdds": "string (e.g. -145 or 'Model only — no live line')",
      "edge": "string (e.g. '+12.3%' or 'N/A')",
      "tier": "string (confidence tier from data)",
      "kTms": number,
      "disciplineGrade": "string",
      "hasDisciplineEdge": boolean,
      "topReasons": ["reason 1", "reason 2"],
      "altLines": [
        { "line": number, "modelProbability": number, "bookOdds": "string or null", "edge": "string or null" }
      ]
    }
  ],
  "safeParlays": [
    {
      "type": "2-leg" | "3-leg",
      "legs": [
        { "playerName": "string", "team": "string", "line": number, "reason": "one-line reason", "propType": "hitter" | "strikeouts" | "walks" }
      ],
      "combinedProfile": "one sentence describing why these legs work together",
      "confidenceLabel": "HIGH" | "MEDIUM"
    }
  ],
  "upsideParlays": [
    {
      "type": "3-leg" | "4-leg",
      "legs": [
        { "playerName": "string", "team": "string", "line": number, "reason": "one-line reason", "propType": "hitter" | "strikeouts" | "walks" }
      ],
      "combinedProfile": "one sentence",
      "confidenceLabel": "MEDIUM" | "SPECULATIVE"
    }
  ],
  "slateInsights": "3-5 sentence analytical summary of today's slate: strongest K/BB environments, top pitcher matchups, dangerous pitchers to target, weather boosts, weak bullpens, best overall edges across both hitter and pitcher props",
  "riskSummary": "2-3 sentences about the main risks on today's slate"
}

Return ONLY valid JSON. No markdown, no code fences.`;

    const llmResult = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      maxTokens: 4096,
    });

    const rawContent = llmResult.choices[0]?.message?.content;
    const content = typeof rawContent === "string" ? rawContent : "";

    const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

    let parsed: any = null;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return {
        bestValuePlay: null,
        topPitcherPlays: [],
        safeParlays: [],
        upsideParlays: [],
        slateInsights: content || "Analysis unavailable — please try again.",
        riskSummary: "",
        isEmptySlate: isPartialSlate,
        emptySlateReasons: result.emptySlateReasons ?? [],
        generatedAt: new Date().toISOString(),
      };
    }

    return {
      bestValuePlay: parsed.bestValuePlay ?? null,
      topPitcherPlays: parsed.topPitcherPlays ?? [],
      safeParlays: parsed.safeParlays ?? [],
      upsideParlays: parsed.upsideParlays ?? [],
      slateInsights: parsed.slateInsights ?? "",
      riskSummary: parsed.riskSummary ?? "",
      isEmptySlate: isPartialSlate,
      emptySlateReasons: result.emptySlateReasons ?? [],
      generatedAt: new Date().toISOString(),
    };
  }),

  /**
   * chat — conversational AI assistant for the Smart Lab.
   *
   * PITCHER CONTEXT: Always builds a full analysis block for every starting pitcher
   * including TMS, discipline grade, K/BB rates, expected counts, model probability
   * for every alt line (3.5–7.5 Ks, 0.5–2.5 BBs), market odds when available,
   * edge per line, fair odds, and confidence tier.
   *
   * The AI can always answer: "5 Ks for Kevin Gausman?", "Best strikeout play?",
   * "Safest pitcher parlay?", "Show me all Dual Edge pitchers." etc.
   */
  chat: publicProcedure
    .input(z.object({
      messages: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })),
    }))
    .mutation(async ({ input }) => {
      // Fetch all data in parallel
      const [result, games, marketData] = await Promise.all([
        getEnrichedMoneyPicks(),
        fetchTodaysGames().catch(() => [] as any[]),
        fetchPitcherMarketData().catch(() => new Map<string, any>()),
      ]);

      const officialPicks = result.moneyPicks.map(pickToStructured);
      const topCandidates = (result.topCandidates ?? []).map(pickToStructured);
      const allPicks = officialPicks.length > 0 ? officialPicks : topCandidates;

      // ── Build full pitcher analysis for every starting pitcher ────────────
      const pitcherAnalyses: Array<Record<string, any>> = [];
      const pitcherLookup = new Map<string, Record<string, any>>();

      for (const game of games.slice(0, 15)) {
        const slots = [
          { pitcher: game.homeTeam.probablePitcher, pitcherTeam: game.homeTeam.abbreviation, opponentTeam: game.awayTeam.abbreviation },
          { pitcher: game.awayTeam.probablePitcher, pitcherTeam: game.awayTeam.abbreviation, opponentTeam: game.homeTeam.abbreviation },
        ];

        for (const slot of slots) {
          if (!slot.pitcher) continue;
          const analysis = await buildPitcherAnalysis({
            pitcherName: slot.pitcher.fullName,
            pitcherTeam: slot.pitcherTeam,
            opponentTeam: slot.opponentTeam,
            gameTime: game.gameTime,
            marketData,
          }).catch(() => null);

          if (analysis) {
            pitcherAnalyses.push(analysis);
            // Index by full name and last name for fuzzy lookup
            pitcherLookup.set(slot.pitcher.fullName.toLowerCase(), analysis);
            const lastName = slot.pitcher.fullName.split(' ').slice(-1)[0].toLowerCase();
            pitcherLookup.set(lastName, analysis);
          }
        }
      }

      // Sort by K TMS descending so AI sees best matchups first
      pitcherAnalyses.sort((a, b) => (b.kTms ?? 0) - (a.kTms ?? 0));

      // ── Build context strings ─────────────────────────────────────────────
      const hitterContext = allPicks.length > 0
        ? `TODAY'S HITTER PICKS (${result.dataDate}):\n${JSON.stringify(allPicks, null, 2)}`
        : `No official hitter picks qualify today (${result.dataDate}). Reasons: ${(result.emptySlateReasons ?? []).join(", ") || "lineups pending"}.`;

      const pitcherContext = pitcherAnalyses.length > 0
        ? `\n\n${'='.repeat(60)}\nTODAY'S PITCHER ANALYSIS — FULL DATA (${pitcherAnalyses.length} starters)\n${'='.repeat(60)}\n\nFor each pitcher you have:\n- kTms: K Matchup Score (0-100). ≥70 = strong, ≥55 = moderate, <55 = weak\n- bbTms: Walk Matchup Score (0-100)\n- disciplineGrade: Opponent plate discipline (A+=elite, A=strong, B=average, C=below avg, D=poor)\n- opponentKRate: Opponent K% vs RHP\n- expectedKs: Model-projected K count for this start\n- expectedBBs: Model-projected BB count for this start\n- kLines: Array of K prop lines (3.5–7.5) with model probability, fair odds, book odds (if available), edge, and confidence tier\n- bbLines: Array of BB prop lines (0.5–2.5) with same structure\n- hasDisciplineEdge: true = 💎 DISCIPLINE EDGE confirmed\n\nPITCHER DATA:\n${JSON.stringify(pitcherAnalyses, null, 2)}`
        : '\n\nNo starting pitchers confirmed for today yet.';

      const slateContext = hitterContext + pitcherContext;

      // ── System prompt ─────────────────────────────────────────────────────
      const systemPrompt = `You are Diamond Smart Lab — the central intelligence engine of Diamond Edge, an elite MLB betting analytics platform.

You have FULL ACCESS to today's complete pitcher and hitter data. You MUST NEVER say you lack access to pitcher probabilities, strikeout models, walk models, or market odds. All data is in the context below.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PITCHER QUESTION RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

When asked about a specific pitcher (e.g. "5 Ks for Kevin Gausman?"):
1. Find the pitcher in the PITCHER DATA below by name
2. Look at their kLines array — find the entry where line = 5 (or the closest)
3. Report: modelProbability, bookOdds (if available), impliedProbability (if available), edge (if available), fairOdds, tier
4. Use kTms, disciplineGrade, opponentKRate, hasDisciplineEdge, expectedKs for supporting analysis
5. Give a clear YES/NO recommendation with the exact response format below

RESPONSE FORMAT for pitcher prop questions:
---
[PITCHER NAME]
[X]+ Strikeouts (or Walks)

Model Probability: [X]%
Market Odds: [odds] (or "No live line — model only")
Implied Probability: [X]% (or "N/A")
Edge: [+X%] (or "N/A — no market line")
Fair Odds: [odds]
Confidence: [tier from data]

Why:
✅ [reason from data — e.g. opponent K rate]
✅ [reason from data — e.g. discipline grade]
✅ [reason from data — e.g. TMS score]
✅ [reason from data — e.g. discipline edge if applicable]

Alt Lines Available:
[List ALL kLines entries with their modelProbability, bookOdds/fairOdds, and tier]

Recommendation: YES / LEAN YES / LEAN NO / NO
[1-2 sentence explanation]
---

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INTERPRETATION GUIDE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

kTms (K Matchup Score):
- ≥80: Elite matchup — top K prop environment
- 70-79: Strong matchup — recommend K props
- 55-69: Moderate — lean K props if other signals align
- <55: Weak — avoid K props unless exceptional edge

disciplineGrade (opponent plate discipline):
- D or C: Undisciplined hitters — strong K prop environment
- B: Average — neutral
- A or A+: Disciplined hitters — favors walk props, caution on K props

hasDisciplineEdge = true: 💎 DISCIPLINE EDGE — 2+ signals align, auto-boost applies

When live market odds are NOT available (hasMarketData: false):
- Still give the model probability and fair odds
- State "No live line — model only" for market odds
- Still make a recommendation based on model probability and matchup signals
- NEVER say you lack access to probabilities

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONVERSATIONAL CAPABILITIES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You can answer all of these natively:
- "Best strikeout play today?" → Find pitcher with highest kTms + best model prob on main K line
- "Best walk prop today?" → Find pitcher with highest bbTms + best model prob on main BB line
- "Safest pitcher prop?" → Find highest model probability across all lines (prefer lines with market data)
- "Would you play Gausman 5 Ks?" → Full analysis with alt lines
- "Which pitcher has the highest probability today?" → Rank by expectedKs / model prob on 4.5 line
- "Give me the safest pitcher parlay" → 2-3 legs with highest model probs from different games
- "Which Pitcher Edge plays support today's Money Picks?" → Cross-reference hitter picks with pitcher matchups
- "Show me all Dual Edge pitchers" → Find pitchers where both K and BB lines show strong model probs
- "Give me all alt lines for [pitcher]" → List full kLines and bbLines arrays

For parlay requests: prefer legs from DIFFERENT games, highest model probabilities, positive edge when available.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HITTER QUESTION RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For hitter questions: use the Diamond Edge picks with edge, probability, tier, and lineEvaluations data.
For parlay requests mixing pitchers and hitters: combine the best from both datasets.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GENERAL RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- Be concise, analytical, and professional
- Never invent numbers — only use values from the data
- If a pitcher is not in today's data, say so clearly
- Always mention risk flags when they exist
- Sound like a sharp bettor, not a generic chatbot

${slateContext}`;

      const llmMessages = [
        { role: "system" as const, content: systemPrompt },
        ...input.messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
      ];

      const llmResult = await invokeLLM({
        messages: llmMessages,
        maxTokens: 3000,
      });

      const rawContent = llmResult.choices[0]?.message?.content;
      const reply = typeof rawContent === "string" ? rawContent : "I couldn't generate a response. Please try again.";

      return { reply };
    }),
});
