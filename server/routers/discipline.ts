/**
 * Discipline Router
 *
 * tRPC procedures for the Pitcher vs Team Discipline Database feature.
 * Exposes team discipline grades, TMS, leaderboards, and pitcher history.
 */

import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import {
  getAllTeamDisciplineData,
  getTeamDiscipline,
  computeTeamMatchupScore,
  getPropTendencyLeaderboards,
  type TeamDisciplineData,
  MLB_TEAMS,
} from "../services/teamDisciplineService";
import { detectDisciplineEdge } from "../services/disciplineEdgeDetector";
import { getDisciplineEdgeHistory, getPitcherHistory } from "../services/pitcherLearningEngine";
import { runPitcherEdgeEngine } from "../services/pitcherEdgeEngine";

// ── Serializable discipline data (for tRPC transport) ─────────────────────────
function serializeDisciplineData(d: TeamDisciplineData) {
  return {
    teamAbbr: d.teamAbbr,
    teamName: d.teamName,
    season: d.season,
    disciplineGrade: d.disciplineGrade,
    disciplineScore: d.disciplineScore,
    walkRate: Math.round(d.walkRate * 1000) / 10,       // as percentage e.g. 8.5
    strikeoutRate: Math.round(d.strikeoutRate * 1000) / 10,
    pitchesPerPA: Math.round(d.pitchesPerPA * 100) / 100,
    walkTendencyScore: d.walkTendencyScore,
    strikeoutTendencyScore: d.strikeoutTendencyScore,
    pitchCountTendencyScore: d.pitchCountTendencyScore,
    patientScore: d.patientScore,
    aggressiveScore: d.aggressiveScore,
    walkBoostBps: d.walkBoostBps,
    strikeoutBoostBps: d.strikeoutBoostBps,
    walkRateVsRHP: Math.round(d.walkRateVsRHP * 1000) / 10,
    walkRateVsLHP: Math.round(d.walkRateVsLHP * 1000) / 10,
    kRateVsRHP: Math.round(d.kRateVsRHP * 1000) / 10,
    kRateVsLHP: Math.round(d.kRateVsLHP * 1000) / 10,
  };
}

export const disciplineRouter = router({
  // ── Get all 30 team discipline grades ──────────────────────────────────────
  getAllTeamGrades: publicProcedure.query(async () => {
    const all = await getAllTeamDisciplineData();
    const teams = Array.from(all.values()).map(serializeDisciplineData);
    // Sort by discipline score descending
    teams.sort((a, b) => b.disciplineScore - a.disciplineScore);
    return teams;
  }),

  // ── Get a single team's discipline profile ─────────────────────────────────
  getTeamProfile: publicProcedure
    .input(z.object({ teamAbbr: z.string() }))
    .query(async ({ input }) => {
      const data = await getTeamDiscipline(input.teamAbbr);
      if (!data) return null;
      return serializeDisciplineData(data);
    }),

  // ── Get prop tendency leaderboards ─────────────────────────────────────────
  getLeaderboards: publicProcedure.query(async () => {
    const boards = await getPropTendencyLeaderboards();
    return {
      topWalkTeams: boards.topWalkTeams.map(serializeDisciplineData),
      topStrikeoutTeams: boards.topStrikeoutTeams.map(serializeDisciplineData),
      mostPatientTeams: boards.mostPatientTeams.map(serializeDisciplineData),
      mostAggressiveTeams: boards.mostAggressiveTeams.map(serializeDisciplineData),
      dualEdgeTeams: boards.dualEdgeTeams.map(serializeDisciplineData),
    };
  }),

  // ── Compute TMS for a pitcher vs opponent ──────────────────────────────────
  getTeamMatchupScore: publicProcedure
    .input(z.object({
      opponentTeam: z.string(),
      pitcherHand: z.enum(["L", "R", "S"]),
      propType: z.enum(["strikeouts", "walks", "outs", "innings", "hits_allowed", "earned_runs"]),
      parkFactor: z.number().optional(),
      weatherScore: z.number().optional(),
      umpireKRate: z.number().optional(),
      opponentRecentForm: z.number().optional(),
    }))
    .query(async ({ input }) => {
      return await computeTeamMatchupScore(input);
    }),

  // ── Run full discipline edge detection for a pitcher prop ──────────────────
  detectEdge: publicProcedure
    .input(z.object({
      pitcherName: z.string(),
      pitcherId: z.number().optional(),
      pitcherTeam: z.string(),
      opponentTeam: z.string(),
      pitcherHand: z.enum(["L", "R", "S"]),
      propType: z.enum(["strikeouts", "walks", "outs", "innings", "hits_allowed", "earned_runs"]),
      bookOdds: z.number(),
      modelProbability: z.number(),
      line: z.number(),
      parkFactor: z.number().optional(),
      weatherScore: z.number().optional(),
      umpireKRate: z.number().optional(),
      opponentRecentForm: z.number().optional(),
    }))
    .query(async ({ input }) => {
      const result = await detectDisciplineEdge(input);
      return {
        hasDisciplineEdge: result.hasDisciplineEdge,
        edgeReason: result.edgeReason,
        edgeStrength: result.edgeStrength,
        tms: result.tms,
        autoBoostBps: result.autoBoostBps,
        boostedProbability: Math.round(result.boostedProbability * 1000) / 10, // as %
        signals: result.signals,
        historicalAdjustment: result.historicalAdjustment,
      };
    }),

  // ── Get Discipline Edge history (recent recommendations that fired edge) ───
  getEdgeHistory: publicProcedure.query(async () => {
    const rows = await getDisciplineEdgeHistory(20);
    return rows.map(r => ({
      id: r.id,
      gameDate: r.gameDate,
      pitcherName: r.pitcherName,
      pitcherTeam: r.pitcherTeam,
      opponentTeam: r.opponentTeam,
      propType: r.propType,
      pitcherHand: r.pitcherHand,
      bookOdds: r.bookOdds,
      line: r.line != null ? r.line / 10 : null,
      projection: r.projection != null ? r.projection / 10 : null,
      result: r.result,
      actualValue: r.actualValue != null ? r.actualValue / 10 : null,
      tms: r.tms,
      disciplineGrade: r.disciplineGrade,
    }));
  }),

  // ── Get pitcher recommendation history ─────────────────────────────────────
  getPitcherHistory: publicProcedure
    .input(z.object({ pitcherName: z.string() }))
    .query(async ({ input }) => {
      const rows = await getPitcherHistory(input.pitcherName, 50);
      return rows.map(r => ({
        id: r.id,
        gameDate: r.gameDate,
        opponentTeam: r.opponentTeam,
        propType: r.propType,
        line: r.line != null ? r.line / 10 : null,
        projection: r.projection != null ? r.projection / 10 : null,
        result: r.result,
        actualValue: r.actualValue != null ? r.actualValue / 10 : null,
        tms: r.tms,
        disciplineGrade: r.disciplineGrade,
        disciplineEdge: r.disciplineEdge === 1,
      }));
    }),

  // ── Get today's starting pitchers with TMS scores ─────────────────────────
  getTodayPitcherMatchups: publicProcedure.query(async () => {
    try {
      const { fetchTodaysGames } = await import("../services/mlbLineupService");
      const games = await fetchTodaysGames();

      const results: Array<{
        gameId: number;
        gameTime: string;
        homeTeam: string;
        awayTeam: string;
        homePitcher: { name: string; hand: string; tms: Awaited<ReturnType<typeof computeTeamMatchupScore>> | null } | null;
        awayPitcher: { name: string; hand: string; tms: Awaited<ReturnType<typeof computeTeamMatchupScore>> | null } | null;
      }> = [];

      for (const game of games) {
        const homePitcherData = game.homeTeam.probablePitcher;
        const awayPitcherData = game.awayTeam.probablePitcher;

        const [homeTms, awayTms] = await Promise.all([
          homePitcherData
            ? computeTeamMatchupScore({
                opponentTeam: game.awayTeam.abbreviation,
                pitcherHand: "R" as "L" | "R" | "S",
                propType: "strikeouts",
              })
            : null,
          awayPitcherData
            ? computeTeamMatchupScore({
                opponentTeam: game.homeTeam.abbreviation,
                pitcherHand: "R" as "L" | "R" | "S",
                propType: "strikeouts",
              })
            : null,
        ]);

        results.push({
          gameId: game.gamePk,
          gameTime: game.gameTime,
          homeTeam: game.homeTeam.abbreviation,
          awayTeam: game.awayTeam.abbreviation,
          homePitcher: homePitcherData
            ? { name: homePitcherData.fullName, hand: "R", tms: homeTms }
            : null,
          awayPitcher: awayPitcherData
            ? { name: awayPitcherData.fullName, hand: "R", tms: awayTms }
            : null,
        });
      }

      return results;
    } catch (e) {
      console.warn("[Discipline] getTodayPitcherMatchups failed:", e);
      return [];
    }
  }),

  /**
   * Get today's Pitcher Edge picks — Official Money Picks, Elite Safety,
   * Best Value, Dual Edge, and Stack Alert tiers.
   */
  getPitcherEdgePicks: publicProcedure.query(async () => {
    try {
      const result = await runPitcherEdgeEngine();
      return {
        picks: result.picks.map(p => ({
          pitcherName: p.pitcherName,
          pitcherTeam: p.pitcherTeam,
          opponentTeam: p.opponentTeam,
          pitcherHand: p.pitcherHand,
          gameTime: p.gameTime,
          propType: p.propType,
          line: p.line,
          bookOdds: p.bookOdds,
          fairOdds: p.fairOdds,
          modelProbability: Math.round(p.modelProbability * 1000) / 10,  // as %
          impliedProbability: Math.round(p.impliedProbability * 1000) / 10,
          edge: Math.round(p.edge * 1000) / 10,
          pitcherEdgeScore: p.pitcherEdgeScore,
          tms: p.tms,
          tier: p.tier,
          hasDisciplineEdge: p.hasDisciplineEdge,
          isDualEdge: p.isDualEdge,
          qualifyingReasons: p.qualifyingReasons,
          riskFlags: p.riskFlags,
          disciplineGrade: p.disciplineGrade,
          opponentKRate: p.opponentKRate !== null ? Math.round(p.opponentKRate * 1000) / 10 : null,
          opponentBBRate: p.opponentBBRate !== null ? Math.round(p.opponentBBRate * 1000) / 10 : null,
          historicalHitRate: p.historicalHitRate !== null ? Math.round(p.historicalHitRate) : null,
          sampleSize: p.sampleSize,
          isOfficialPlay: p.isOfficialPlay,
          isLeanPlay: p.isLeanPlay,
          isProjectionOnly: p.isProjectionOnly,
          hasMarketData: p.hasMarketData,
          pricingPenaltyTier: p.pricingPenaltyTier,
          pricingPenaltyLabel: p.pricingPenaltyLabel,
          isUltraJuiced: p.isUltraJuiced,
          adjustedEdgeScore: p.adjustedEdgeScore,
          actionabilityScore: p.actionabilityScore,
          playCategory: p.playCategory,
        })),
        dualEdgePitchers: result.dualEdgePitchers,
        stackAlertGames: result.stackAlertGames,
        hasOfficialPlays: result.hasOfficialPlays,
        hasLeanPlays: result.hasLeanPlays,
        generatedAt: new Date().toISOString(),
        /** Rejected plays with diagnostic data — for transparency panel */
        rejectedPlays: result.rejectedPlays.map(r => ({
          pitcherName: r.pitcherName,
          pitcherTeam: r.pitcherTeam,
          opponentTeam: r.opponentTeam,
          propType: r.propType,
          line: r.line,
          modelProbability: Math.round(r.modelProbability * 1000) / 10,  // as %
          requiredThreshold: Math.round(r.requiredThreshold * 1000) / 10,  // as %
          rejectionReasons: r.rejectionReasons,
          rejectionSummary: r.rejectionSummary,
          supportingFactors: r.supportingFactors,
          requiredFactors: r.requiredFactors,
          hasMarketData: r.hasMarketData,
          edge: r.edge !== null ? Math.round(r.edge * 1000) / 10 : null,
        })),
      };
    } catch (e) {
      console.warn("[Discipline] getPitcherEdgePicks failed:", e);
      return { picks: [], dualEdgePitchers: [], stackAlertGames: [], hasOfficialPlays: false, hasLeanPlays: false, generatedAt: new Date().toISOString(), rejectedPlays: [] };
    }
  }),
});
