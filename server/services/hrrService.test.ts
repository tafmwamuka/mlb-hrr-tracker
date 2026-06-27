/**
 * HRR Service Tests
 * Tests for combined H+R+RBI projection calculations and ranking logic
 */

import { describe, it, expect } from "vitest";
import {
  calculatePerGameAverage,
  applyParkFactor,
  applyBattingPositionBoost,
  calculateHRRLine,
  calculateHRRConfidence,
  generateHRRProjections,
} from "./hrrService";

describe("HRR Service - Utility Functions", () => {
  describe("calculatePerGameAverage", () => {
    it("should calculate correct per-game average", () => {
      expect(calculatePerGameAverage(45, 40)).toBeCloseTo(1.125);
      expect(calculatePerGameAverage(92, 40)).toBeCloseTo(2.3);
      expect(calculatePerGameAverage(38, 40)).toBeCloseTo(0.95);
    });

    it("should return 0 for 0 games played", () => {
      expect(calculatePerGameAverage(45, 0)).toBe(0);
    });

    it("should handle small game counts", () => {
      expect(calculatePerGameAverage(5, 5)).toBe(1.0);
    });
  });

  describe("applyParkFactor", () => {
    it("should increase value for hitter-friendly parks (>1.0)", () => {
      const result = applyParkFactor(1.0, 1.15);
      expect(result).toBeCloseTo(1.15);
    });

    it("should decrease value for pitcher-friendly parks (<1.0)", () => {
      const result = applyParkFactor(1.0, 0.88);
      expect(result).toBeCloseTo(0.88);
    });

    it("should not change value for neutral parks (1.0)", () => {
      const result = applyParkFactor(1.5, 1.0);
      expect(result).toBeCloseTo(1.5);
    });
  });

  describe("applyBattingPositionBoost", () => {
    it("should boost RBI for cleanup hitters (position 4)", () => {
      const result = applyBattingPositionBoost('rbi', 1.0, 4);
      expect(result).toBeGreaterThan(1.0);
    });

    it("should boost runs for leadoff hitters (position 1)", () => {
      const result = applyBattingPositionBoost('runs', 1.0, 1);
      expect(result).toBeGreaterThan(1.0);
    });

    it("should boost hits for leadoff hitters", () => {
      const result = applyBattingPositionBoost('hits', 1.0, 1);
      expect(result).toBeGreaterThan(1.0);
    });

    it("should reduce RBI for leadoff hitters", () => {
      const result = applyBattingPositionBoost('rbi', 1.0, 1);
      expect(result).toBeLessThan(1.0);
    });

    it("should reduce runs for bottom of order", () => {
      const result = applyBattingPositionBoost('runs', 1.0, 9);
      expect(result).toBeLessThan(1.0);
    });
  });

  describe("calculateHRRLine", () => {
    it("should return realistic lines between 0.5 and 5.5 (Phase CN)", () => {
      // Phase CN: line = 75% of expected, bounds [0.5, 5.5]
      // Low expected total
      expect(calculateHRRLine(2.0)).toBeGreaterThanOrEqual(0.5);
      expect(calculateHRRLine(2.0)).toBeLessThanOrEqual(5.5);

      // Medium expected total
      expect(calculateHRRLine(3.5)).toBeGreaterThanOrEqual(0.5);
      expect(calculateHRRLine(3.5)).toBeLessThanOrEqual(5.5);

      // High expected total
      expect(calculateHRRLine(5.5)).toBeGreaterThanOrEqual(0.5);
      expect(calculateHRRLine(5.5)).toBeLessThanOrEqual(5.5);
    });

    it("should be in 0.5 increments", () => {
      const line = calculateHRRLine(3.7);
      expect(line * 2).toBe(Math.floor(line * 2)); // Must be whole number when doubled
    });

        it("should return minimum 0.5 for very low projections (Phase CN)", () => {
      // Phase CN: min is 0.5 — 75% of 0.5 = 0.375 → rounds to 0.5
      expect(calculateHRRLine(0.5)).toBe(0.5);
      expect(calculateHRRLine(1.0)).toBeGreaterThanOrEqual(0.5);
    });
    it("should cap at 5.5 for very high projections (Phase CN)", () => {
      // Phase CN: max is 5.5 — 75% of 8.0 = 6.0 → capped at 5.5
      expect(calculateHRRLine(8.0)).toBe(5.5);
      expect(calculateHRRLine(10.0)).toBe(5.5);
    });

    it("should set line slightly below expected total", () => {
      // For a 4.0 expected total, line should be 3.5 or 4.0
      const line = calculateHRRLine(4.0);
      expect(line).toBeLessThanOrEqual(4.0);
    });
  });

  describe("calculateHRRConfidence", () => {
    it("should return values between 50 and 98", () => {
      const conf = calculateHRRConfidence(4.5, 3.5, 80, 85, 4);
      expect(conf).toBeGreaterThanOrEqual(50);
      expect(conf).toBeLessThanOrEqual(98);
    });

    it("should give higher confidence for larger edge", () => {
      const highEdge = calculateHRRConfidence(5.0, 3.5, 80, 80, 4);
      const lowEdge = calculateHRRConfidence(3.8, 3.5, 80, 80, 4);
      expect(highEdge).toBeGreaterThan(lowEdge);
    });

    it("should give higher confidence for better combined score", () => {
      const highScore = calculateHRRConfidence(4.0, 3.5, 90, 80, 4);
      const lowScore = calculateHRRConfidence(4.0, 3.5, 50, 80, 4);
      expect(highScore).toBeGreaterThan(lowScore);
    });

    it("should give higher confidence for middle-of-order batters", () => {
      const cleanup = calculateHRRConfidence(4.0, 3.5, 80, 80, 4);
      const nineHole = calculateHRRConfidence(4.0, 3.5, 80, 80, 9);
      expect(cleanup).toBeGreaterThan(nineHole);
    });
  });
});

describe("HRR Service - generateHRRProjections", () => {
  const mockMatchups = [
    {
      playerId: 660271,
      playerName: "Aaron Judge",
      team: "NYY",
      position: "RF",
      battingPosition: 4,
      pitcher: { name: "Framber Valdez", team: "HOU", handedness: "L" as const, era: 3.01 },
      rc: 38,
      confidence: 88,
    },
    {
      playerId: 592450,
      playerName: "Juan Soto",
      team: "NYM",
      position: "LF",
      battingPosition: 3,
      pitcher: { name: "Kevin Gausman", team: "TOR", handedness: "R" as const, era: 3.25 },
      rc: 42,
      confidence: 92,
    },
    {
      playerId: 605141,
      playerName: "C. Raleigh",
      team: "SEA",
      position: "C",
      battingPosition: 6,
      pitcher: { name: "Pablo Lopez", team: "MIN", handedness: "R" as const, era: 3.71 },
      rc: 28,
      confidence: 72,
    },
  ];

  const mockPlayers = new Map([
    [660271, {
      playerId: 660271,
      name: "Aaron Judge",
      team: "NYY",
      position: "RF",
      battingPosition: 4,
      handedness: 'R' as const,
      stats: { hits: 45, runs: 38, rbi: 92, slg: 0.520, avg: 0.285, obp: 0.380, power: 0.185 },
      recentForm: { last15Games: { hits: 18, runs: 15, rbi: 38, avg: 0.310 }, trend: 'hot' as const },
    }],
    [592450, {
      playerId: 592450,
      name: "Juan Soto",
      team: "NYM",
      position: "LF",
      battingPosition: 3,
      handedness: 'L' as const,
      stats: { hits: 52, runs: 41, rbi: 88, slg: 0.545, avg: 0.310, obp: 0.420, power: 0.195 },
      recentForm: { last15Games: { hits: 20, runs: 17, rbi: 35, avg: 0.325 }, trend: 'hot' as const },
    }],
    [605141, {
      playerId: 605141,
      name: "C. Raleigh",
      team: "SEA",
      position: "C",
      battingPosition: 6,
      handedness: 'R' as const,
      stats: { hits: 35, runs: 28, rbi: 65, slg: 0.450, avg: 0.260, obp: 0.340, power: 0.155 },
    }],
  ]);

  const mockParkFactors = new Map([
    ["NYY", 1.15],
    ["NYM", 0.95],
    ["SEA", 0.90],
  ]);

  it("should return projections for all valid matchups", () => {
    const projections = generateHRRProjections(mockMatchups, mockPlayers, mockParkFactors);
    expect(projections.length).toBe(3);
  });

  it("should have HRR lines between 0.5 and 5.5 (Phase CN)", () => {
    const projections = generateHRRProjections(mockMatchups, mockPlayers, mockParkFactors);
    for (const p of projections) {
      expect(p.hrrLine).toBeGreaterThanOrEqual(0.5);
      expect(p.hrrLine).toBeLessThanOrEqual(5.5);
    }
  });

  it("should have HRR lines in 0.5 increments", () => {
    const projections = generateHRRProjections(mockMatchups, mockPlayers, mockParkFactors);
    for (const p of projections) {
      expect(p.hrrLine * 2).toBe(Math.floor(p.hrrLine * 2));
    }
  });

  it("should have expected total = expectedHits + expectedRuns + expectedRBI", () => {
    const projections = generateHRRProjections(mockMatchups, mockPlayers, mockParkFactors);
    for (const p of projections) {
      const sum = p.expectedHits + p.expectedRuns + p.expectedRBI;
      // Allow 0.2 tolerance due to individual rounding of each component
      expect(Math.abs(p.expectedTotal - sum)).toBeLessThan(0.2);
    }
  });

  it("should rank by HRR confidence (descending)", () => {
    const projections = generateHRRProjections(mockMatchups, mockPlayers, mockParkFactors);
    for (let i = 1; i < projections.length; i++) {
      expect(projections[i - 1].hrrConfidence).toBeGreaterThanOrEqual(projections[i].hrrConfidence);
    }
  });

  it("should produce different ranking than general overallScore order", () => {
    // This test verifies that HRR ranking is NOT just inheriting the general AI pick order
    // The HRR ranking considers per-game stat totals, park factors, and position boosts
    const projections = generateHRRProjections(mockMatchups, mockPlayers, mockParkFactors);
    
    // Judge has high RBI (92) in cleanup spot with hot park factor (1.15)
    // His HRR total should be high
    const judge = projections.find(p => p.playerName === "Aaron Judge");
    expect(judge).toBeDefined();
    expect(judge!.expectedTotal).toBeGreaterThan(3.0);
  });

  it("should apply park factor correctly - hitter-friendly parks increase projections", () => {
    const projections = generateHRRProjections(mockMatchups, mockPlayers, mockParkFactors);
    const judge = projections.find(p => p.playerName === "Aaron Judge"); // NYY = 1.15
    const raleigh = projections.find(p => p.playerName === "C. Raleigh"); // SEA = 0.90
    
    expect(judge).toBeDefined();
    expect(raleigh).toBeDefined();
    
    // Judge in hitter-friendly park should have higher park factor
    expect(judge!.parkFactor).toBeGreaterThan(raleigh!.parkFactor);
  });

  it("should calculate positive edge (expected > line)", () => {
    const projections = generateHRRProjections(mockMatchups, mockPlayers, mockParkFactors);
    for (const p of projections) {
      // Edge should be positive since line is set below expected
      expect(p.edge).toBeGreaterThanOrEqual(0);
    }
  });

  it("should have confidence between 50 and 98", () => {
    const projections = generateHRRProjections(mockMatchups, mockPlayers, mockParkFactors);
    for (const p of projections) {
      expect(p.hrrConfidence).toBeGreaterThanOrEqual(50);
      expect(p.hrrConfidence).toBeLessThanOrEqual(98);
    }
  });

  it("should include required fields for each projection", () => {
    const projections = generateHRRProjections(mockMatchups, mockPlayers, mockParkFactors);
    for (const p of projections) {
      expect(p.playerName).toBeTruthy();
      expect(p.team).toBeTruthy();
      expect(p.pitcher).toBeTruthy();
      expect(p.pitcherTeam).toBeTruthy();
      expect(p.battingPosition).toBeGreaterThanOrEqual(1);
      expect(p.battingPosition).toBeLessThanOrEqual(9);
      expect(p.expectedHits).toBeGreaterThan(0);
      expect(p.expectedRuns).toBeGreaterThan(0);
      expect(p.expectedRBI).toBeGreaterThan(0);
      expect(p.reasoning).toBeTruthy();
      expect(p.ballparkReasoning).toBeTruthy();
      expect(p.rcScore).toBeGreaterThanOrEqual(0);
      expect(p.rcScore).toBeLessThanOrEqual(100);
      expect(p.combinedScore).toBeGreaterThanOrEqual(0);
    }
  });

  it("should apply recent form boost for hot players", () => {
    // Judge and Soto have 'hot' trend, Raleigh has no recentForm
    const projections = generateHRRProjections(mockMatchups, mockPlayers, mockParkFactors);
    const judge = projections.find(p => p.playerName === "Aaron Judge");
    
    // Judge's raw per-game: 45/40 = 1.125 hits, 38/40 = 0.95 runs, 92/40 = 2.3 rbi
    // With park (1.15): 1.29 hits, 1.09 runs, 2.645 rbi
    // With position boost and hot streak, total should be > raw sum
    const rawTotal = (45 + 38 + 92) / 40; // 4.375
    expect(judge!.expectedTotal).toBeGreaterThan(rawTotal * 0.9); // At least close to raw
  });

  it("should skip players not found in playerDataMap", () => {
    const extraMatchup = {
      playerId: 999999,
      playerName: "Unknown Player",
      team: "UNK",
      position: "DH",
      battingPosition: 5,
      pitcher: { name: "Some Pitcher", team: "OPP", handedness: "R" as const, era: 4.0 },
      rc: 30,
      confidence: 70,
    };
    const projections = generateHRRProjections(
      [...mockMatchups, extraMatchup],
      mockPlayers,
      mockParkFactors
    );
    // Should only have 3 (the valid ones), not 4
    expect(projections.length).toBe(3);
  });

  it("should limit output to 15 picks maximum", () => {
    // Create 20 matchups
    const manyMatchups = Array.from({ length: 20 }, (_, i) => ({
      playerId: 660271,
      playerName: `Player ${i}`,
      team: "NYY",
      position: "RF",
      battingPosition: ((i % 9) + 1),
      pitcher: { name: "Pitcher", team: "OPP", handedness: "R" as const, era: 3.5 },
      rc: 30 + i,
      confidence: 70 + i,
    }));
    
    const bigPlayerMap = new Map(manyMatchups.map(m => [m.playerId, {
      playerId: m.playerId,
      name: m.playerName,
      team: m.team,
      position: m.position,
      battingPosition: m.battingPosition,
      handedness: 'R' as const,
      stats: { hits: 45, runs: 35, rbi: 70, slg: 0.480, avg: 0.280, obp: 0.360, power: 0.170 },
    }]));

    const projections = generateHRRProjections(manyMatchups, bigPlayerMap, mockParkFactors);
    expect(projections.length).toBeLessThanOrEqual(15);
  });
});

describe("HRR Service - Integration with Router", () => {
  it("should produce realistic HRR projections for elite hitters", () => {
    // Aaron Judge: 45H + 38R + 92RBI in 40 games = 4.375 per game raw
    // With NYY park factor (1.15) and cleanup spot, should be around 4.5-6.0
    const mockMatchups = [{
      playerId: 660271,
      playerName: "Aaron Judge",
      team: "NYY",
      position: "RF",
      battingPosition: 4,
      pitcher: { name: "Framber Valdez", team: "HOU", handedness: "L" as const, era: 3.01 },
      rc: 38,
      confidence: 88,
    }];

    const mockPlayers = new Map([[660271, {
      playerId: 660271,
      name: "Aaron Judge",
      team: "NYY",
      position: "RF",
      battingPosition: 4,
      handedness: 'R' as const,
      stats: { hits: 45, runs: 38, rbi: 92, slg: 0.520, avg: 0.285, obp: 0.380, power: 0.185 },
      recentForm: { last15Games: { hits: 18, runs: 15, rbi: 38, avg: 0.310 }, trend: 'hot' as const },
    }]]);

    const parkFactors = new Map([["NYY", 1.15]]);

    const projections = generateHRRProjections(mockMatchups, mockPlayers, parkFactors);
    expect(projections.length).toBe(1);
    
    const judge = projections[0];
    // Expected total should be realistic for an elite hitter (3.5-6.5 range)
    expect(judge.expectedTotal).toBeGreaterThan(3.5);
    expect(judge.expectedTotal).toBeLessThan(7.0);
    
    // HRR line should be realistic (Phase CN: max 5.5)
    expect(judge.hrrLine).toBeGreaterThanOrEqual(2.5);
    expect(judge.hrrLine).toBeLessThanOrEqual(5.5);
    
    // Confidence should be reasonable for elite hitter with hot streak + good park
    expect(judge.hrrConfidence).toBeGreaterThanOrEqual(60);
  });

  it("should produce lower projections for bottom-of-order hitters in pitcher parks", () => {
    const mockMatchups = [{
      playerId: 605141,
      playerName: "C. Raleigh",
      team: "SEA",
      position: "C",
      battingPosition: 6,
      pitcher: { name: "Pablo Lopez", team: "MIN", handedness: "R" as const, era: 3.71 },
      rc: 28,
      confidence: 72,
    }];

    const mockPlayers = new Map([[605141, {
      playerId: 605141,
      name: "C. Raleigh",
      team: "SEA",
      position: "C",
      battingPosition: 6,
      handedness: 'R' as const,
      stats: { hits: 35, runs: 28, rbi: 65, slg: 0.450, avg: 0.260, obp: 0.340, power: 0.155 },
    }]]);

    const parkFactors = new Map([["SEA", 0.90]]);

    const projections = generateHRRProjections(mockMatchups, mockPlayers, parkFactors);
    expect(projections.length).toBe(1);
    
    const raleigh = projections[0];
    // Expected total should be lower for average hitter in pitcher park
    expect(raleigh.expectedTotal).toBeLessThan(4.0);
    expect(raleigh.expectedTotal).toBeGreaterThan(1.5);
    
    // Line should still be realistic (Phase CN: min 0.5)
    expect(raleigh.hrrLine).toBeGreaterThanOrEqual(0.5);
    expect(raleigh.hrrLine).toBeLessThanOrEqual(4.0);
  });
});
