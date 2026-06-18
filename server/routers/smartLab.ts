/**
 * Diamond Smart Lab Router
 *
 * Provides two procedures:
 *   1. getSlateData — assembles structured Diamond Edge data for the AI layer
 *   2. analyzeSlate — sends structured data to the LLM and returns Smart Lab analysis
 *   3. chat — conversational AI assistant grounded in today's slate data
 *
 * Architecture: Diamond Edge backend calculates everything; AI interprets, explains,
 * and builds parlays. The AI never invents odds or probabilities.
 */

import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc";
import { getEnrichedMoneyPicks } from "../services/hrrPicksService";
import { invokeLLM } from "../_core/llm";
import { runPitcherEdgeEngine } from "../services/pitcherEdgeEngine";
import { fetchTodaysGames } from "../services/mlbLineupService";
import { computeTeamMatchupScore, getTeamDiscipline } from "../services/teamDisciplineService";

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

// ─── Router ───────────────────────────────────────────────────────────────────

export const smartLabRouter = router({

  /**
   * getSlateData — returns structured Diamond Edge data for the current slate.
   * This is the "source of truth" payload the AI layer works from.
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
    const [result, pitcherEdgeResult] = await Promise.all([
      getEnrichedMoneyPicks(),
      runPitcherEdgeEngine().catch(() => ({ picks: [], dualEdgePitchers: [], stackAlertGames: [] })),
    ]);

    const officialPicks = result.moneyPicks.map(pickToStructured);
    const topCandidates = (result.topCandidates ?? []).map(pickToStructured);
    const allPicks = officialPicks.length > 0 ? officialPicks : topCandidates;

    // Build pitcher edge context string
    const pitcherPicksSummary = (pitcherEdgeResult.picks ?? []).slice(0, 8).map((p: any) => ({
      pitcher: p.pitcherName,
      team: p.pitcherTeam,
      vs: p.opponentTeam,
      prop: (p.propType === 'strikeouts' ? 'K' : 'BB') + ' ' + p.line,
      odds: p.bookOdds,
      modelProb: Math.round(p.modelProbability * 10) / 10,
      edge: Math.round(p.edge * 10) / 10,
      tms: p.tms,
      tier: p.tier,
      disciplineEdge: p.hasDisciplineEdge,
      dualEdge: p.isDualEdge,
    }));
    const pitcherContext = pitcherPicksSummary.length > 0
      ? '\n\nPITCHER EDGE PICKS (' + pitcherPicksSummary.length + ' qualifying):\n' + JSON.stringify(pitcherPicksSummary, null, 2)
      : '';

    if (allPicks.length === 0) {
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

    const systemPrompt = `You are Diamond Smart Lab — an elite MLB betting intelligence terminal powered by the Diamond Edge predictive model.

CRITICAL RULES:
- You ONLY work with the structured Diamond Edge data provided. Never invent odds, probabilities, or stats.
- All hrrProbability, edge, bookOdds, and fairLine values come from the Diamond Edge model — treat them as authoritative.
- Sound analytical, sharp, and professional. Never hype or use generic gambling language.
- When building parlays, prefer players from DIFFERENT games to reduce correlation risk.
- For safe parlays: prioritize batting positions 1-4, high gameTotalOU, positive edge, low riskFlags.
- For upside parlays: allow higher lines (2.5+) and slightly lower scores but still positive edge.
- Always explain WHY a play qualifies using specific data points from the structured input.
- If riskFlags exist, always mention the most important one.
- Never force weak plays — if the slate is thin, say so honestly.`;

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
  "safeParlays": [
    {
      "type": "2-leg" | "3-leg",
      "legs": [
        { "playerName": "string", "team": "string", "line": number, "reason": "one-line reason" }
      ],
      "combinedProfile": "one sentence describing why these legs work together",
      "confidenceLabel": "HIGH" | "MEDIUM"
    }
  ],
  "upsideParlays": [
    {
      "type": "3-leg" | "4-leg",
      "legs": [
        { "playerName": "string", "team": "string", "line": number, "reason": "one-line reason" }
      ],
      "combinedProfile": "one sentence",
      "confidenceLabel": "MEDIUM" | "SPECULATIVE"
    }
  ],
  "slateInsights": "3-5 sentence analytical summary of today's slate: strongest environments, dangerous pitchers to target, weather boosts, weak bullpens, best overall edges",
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

    // Strip any markdown code fences if present
    const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

    let parsed: any = null;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // If JSON parsing fails, return a graceful fallback
      return {
        bestValuePlay: null,
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
   * Receives the user's message + conversation history, and responds
   * grounded in today's structured Diamond Edge slate data.
   */
  chat: publicProcedure
    .input(z.object({
      messages: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })),
    }))
    .mutation(async ({ input }) => {
      const result = await getEnrichedMoneyPicks();
      const officialPicks = result.moneyPicks.map(pickToStructured);
      const topCandidates = (result.topCandidates ?? []).map(pickToStructured);
      const allPicks = officialPicks.length > 0 ? officialPicks : topCandidates;

      // Try to get pitcher edge picks from the full engine first
      const pitcherEdgeForChat = await runPitcherEdgeEngine().catch(() => ({ picks: [] as any[] }));
      const pitcherChatSummary = (pitcherEdgeForChat.picks ?? []).slice(0, 6).map((p: any) => ({
        pitcher: p.pitcherName,
        vs: p.opponentTeam,
        prop: (p.propType === 'strikeouts' ? 'K' : 'BB') + ' ' + p.line,
        odds: p.bookOdds,
        modelProb: Math.round(p.modelProbability * 10) / 10,
        edge: Math.round(p.edge * 10) / 10,
        tier: p.tier,
      }));

      // Always build a pitcher matchup context from today's starting pitchers (fallback)
      let pitcherMatchupContext = '';
      try {
        const games = await fetchTodaysGames();
        const matchups: string[] = [];
        for (const game of games.slice(0, 12)) {
          const hp = game.homeTeam.probablePitcher;
          const ap = game.awayTeam.probablePitcher;
          if (!hp && !ap) continue;

          const [homeTms, awayTms, homeDisc, awayDisc] = await Promise.all([
            hp ? computeTeamMatchupScore({ opponentTeam: game.awayTeam.abbreviation, pitcherHand: 'R', propType: 'strikeouts' }).catch(() => null) : Promise.resolve(null),
            ap ? computeTeamMatchupScore({ opponentTeam: game.homeTeam.abbreviation, pitcherHand: 'R', propType: 'strikeouts' }).catch(() => null) : Promise.resolve(null),
            getTeamDiscipline(game.awayTeam.abbreviation).catch(() => null),
            getTeamDiscipline(game.homeTeam.abbreviation).catch(() => null),
          ]);

          if (hp) {
            matchups.push(`${hp.fullName} (${game.homeTeam.abbreviation}) vs ${game.awayTeam.abbreviation} | TMS: ${homeTms?.tms ?? 'N/A'} | Opp Discipline Grade: ${homeDisc?.disciplineGrade ?? 'N/A'}`);
          }
          if (ap) {
            matchups.push(`${ap.fullName} (${game.awayTeam.abbreviation}) vs ${game.homeTeam.abbreviation} | TMS: ${awayTms?.tms ?? 'N/A'} | Opp Discipline Grade: ${awayDisc?.disciplineGrade ?? 'N/A'}`);
          }
        }
        if (matchups.length > 0) {
          pitcherMatchupContext = '\n\nTODAY\'S STARTING PITCHERS (with Team Matchup Score and Opponent Discipline Grade):\n' + matchups.join('\n');
        }
      } catch {
        // silently skip if matchup data unavailable
      }

      const pitcherChatContext = pitcherChatSummary.length > 0
        ? '\n\nPITCHER EDGE PICKS:\n' + JSON.stringify(pitcherChatSummary, null, 2) + pitcherMatchupContext
        : pitcherMatchupContext;

      const slateContext = allPicks.length > 0
        ? `Today's Diamond Edge slate (${result.dataDate}):\n${JSON.stringify(allPicks, null, 2)}${pitcherChatContext}`
        : `No official picks qualify today (${result.dataDate}). Reasons: ${(result.emptySlateReasons ?? []).join(", ") || "lineups pending"}.${pitcherChatContext}`;

      const systemPrompt = `You are Diamond Smart Lab — an elite MLB betting intelligence terminal.

You have access to today's Diamond Edge model outputs. Answer the user's questions analytically and precisely.

RULES:
- Only reference data from the structured slate context below.
- Never invent odds, probabilities, or player stats.
- Be concise, analytical, and professional.
- For parlay requests: prefer different games, positive edge, batting positions 1-4.
- Always mention relevant risk flags when they exist.
- If asked about a player not in today's slate, say so clearly.

${slateContext}`;

      const llmMessages = [
        { role: "system" as const, content: systemPrompt },
        ...input.messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
      ];

      const llmResult = await invokeLLM({
        messages: llmMessages,
        maxTokens: 2048,
      });

      const rawContent = llmResult.choices[0]?.message?.content;
      const reply = typeof rawContent === "string" ? rawContent : "I couldn't generate a response. Please try again.";

      return { reply };
    }),
});
