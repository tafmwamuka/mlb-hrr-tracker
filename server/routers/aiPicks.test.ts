import { describe, it, expect } from "vitest";
import { rankAIPicks, getMockHRTargets, getMockParkFactors } from "../services/aiRankingService";

describe("AI Picks Ranking Service", () => {
  const mockMatchups = [
    {
      playerId: 660271,
      playerName: "Aaron Judge",
      team: "NYY",
      position: "RF",
      battingPosition: 4,
      pitcher: { name: "Framber Valdez", team: "HOU" },
      rc: 38,
      confidence: 88,
    },
    {
      playerId: 592450,
      playerName: "Juan Soto",
      team: "NYM",
      position: "LF",
      battingPosition: 3,
      pitcher: { name: "Kevin Gausman", team: "TOR" },
      rc: 42,
      confidence: 92,
    },
  ];

  const mockPlayers = new Map([
    [
      660271,
      {
        playerId: 660271,
        name: "Aaron Judge",
        team: "NYY",
        position: "RF",
        battingPosition: 4,
        stats: {
          hits: 45,
          runs: 38,
          rbi: 92,
          slg: 0.52,
          avg: 0.285,
          obp: 0.38,
          power: 0.185,
        },
      },
    ],
    [
      592450,
      {
        playerId: 592450,
        name: "Juan Soto",
        team: "NYM",
        position: "LF",
        battingPosition: 3,
        stats: {
          hits: 52,
          runs: 41,
          rbi: 88,
          slg: 0.545,
          avg: 0.31,
          obp: 0.42,
          power: 0.195,
        },
      },
    ],
  ]);

  describe("rankAIPicks", () => {
    it("should rank picks by overall score", () => {
      const picks = rankAIPicks(mockMatchups, mockPlayers, getMockHRTargets(), getMockParkFactors());

      expect(picks.length).toBeGreaterThan(0);
      expect(picks[0]).toHaveProperty("rank");
      expect(picks[0].rank).toBe(1);
    });

    it("should include all required fields", () => {
      const picks = rankAIPicks(mockMatchups, mockPlayers, getMockHRTargets(), getMockParkFactors());
      const pick = picks[0];

      expect(pick).toHaveProperty("rank");
      expect(pick).toHaveProperty("playerId");
      expect(pick).toHaveProperty("playerName");
      expect(pick).toHaveProperty("team");
      expect(pick).toHaveProperty("position");
      expect(pick).toHaveProperty("battingPosition");
      expect(pick).toHaveProperty("pitcher");
      expect(pick).toHaveProperty("confidence");
      expect(pick).toHaveProperty("prediction");
      expect(pick).toHaveProperty("line");
      expect(pick).toHaveProperty("overallScore");
      expect(pick).toHaveProperty("reasoning");
      expect(pick).toHaveProperty("factorBreakdown");
    });

    it("should only return OVER predictions", () => {
      const picks = rankAIPicks(mockMatchups, mockPlayers, getMockHRTargets(), getMockParkFactors());

      picks.forEach((pick) => {
        expect(pick.prediction).toBe("over");
      });
    });

    it("should include factor breakdown with all 6 factors", () => {
      const picks = rankAIPicks(mockMatchups, mockPlayers, getMockHRTargets(), getMockParkFactors());
      const pick = picks[0];

      expect(pick.factorBreakdown).toHaveProperty("rc");
      expect(pick.factorBreakdown).toHaveProperty("playerStats");
      expect(pick.factorBreakdown).toHaveProperty("parkFactors");
      expect(pick.factorBreakdown).toHaveProperty("hrTargets");
      expect(pick.factorBreakdown).toHaveProperty("pitcherMatchup");
      expect(pick.factorBreakdown).toHaveProperty("battingPosition");
    });

    it("should have valid confidence scores", () => {
      const picks = rankAIPicks(mockMatchups, mockPlayers, getMockHRTargets(), getMockParkFactors());

      picks.forEach((pick) => {
        expect(pick.confidence).toBeGreaterThan(0);
        expect(pick.confidence).toBeLessThanOrEqual(100);
      });
    });

    it("should have valid overall scores", () => {
      const picks = rankAIPicks(mockMatchups, mockPlayers, getMockHRTargets(), getMockParkFactors());

      picks.forEach((pick) => {
        expect(pick.overallScore).toBeGreaterThan(0);
        expect(pick.overallScore).toBeLessThanOrEqual(100);
      });
    });

    it("should rank picks in descending order by overall score", () => {
      const picks = rankAIPicks(mockMatchups, mockPlayers, getMockHRTargets(), getMockParkFactors());

      for (let i = 0; i < picks.length - 1; i++) {
        expect(picks[i].overallScore).toBeGreaterThanOrEqual(picks[i + 1].overallScore);
      }
    });

    it("should include reasoning for each pick", () => {
      const picks = rankAIPicks(mockMatchups, mockPlayers, getMockHRTargets(), getMockParkFactors());

      picks.forEach((pick) => {
        expect(pick.reasoning).toBeDefined();
        expect(typeof pick.reasoning).toBe("string");
        expect(pick.reasoning.length).toBeGreaterThan(0);
      });
    });

    it("should consider batting position in scoring", () => {
      const picks = rankAIPicks(mockMatchups, mockPlayers, getMockHRTargets(), getMockParkFactors());

      picks.forEach((pick) => {
        expect(pick.battingPosition).toBeGreaterThan(0);
        expect(pick.battingPosition).toBeLessThanOrEqual(9);
      });
    });

    it("should have valid factor percentages", () => {
      const picks = rankAIPicks(mockMatchups, mockPlayers, getMockHRTargets(), getMockParkFactors());
      const pick = picks[0];

      Object.values(pick.factorBreakdown).forEach((factor) => {
        expect(typeof factor).toBe("number");
        expect(factor).toBeGreaterThanOrEqual(0);
        expect(factor).toBeLessThanOrEqual(100);
      });
    });
  });

  describe("Mock Data Helpers", () => {
    it("should return valid HR Targets data", () => {
      const targets = getMockHRTargets();

      expect(targets instanceof Map).toBe(true);
      expect(targets.size).toBeGreaterThan(0);

      targets.forEach((target) => {
        expect(target).toHaveProperty("grade");
        expect(target).toHaveProperty("hrProbability");
        expect(target).toHaveProperty("threatScore");
      });
    });

    it("should return valid park factors data", () => {
      const parkFactors = getMockParkFactors();

      expect(parkFactors instanceof Map).toBe(true);
      expect(parkFactors.size).toBeGreaterThan(0);

      parkFactors.forEach((factor) => {
        expect(typeof factor).toBe("number");
        expect(factor).toBeGreaterThan(0.8);
        expect(factor).toBeLessThan(1.2);
      });
    });
  });
});
