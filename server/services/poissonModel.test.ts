import { describe, it, expect } from "vitest";
import {
  poissonPMF,
  poissonCDF,
  poissonOverProbability,
  calculateAlternateLines,
  findFairLine,
  calculateEdge,
  getPickQuality,
} from "./poissonModel";

describe("Poisson Probability Model", () => {
  describe("poissonPMF", () => {
    it("should return correct probability for P(X=0) when lambda=1", () => {
      // P(X=0) = e^(-1) ≈ 0.3679
      const result = poissonPMF(0, 1);
      expect(result).toBeCloseTo(0.3679, 3);
    });

    it("should return correct probability for P(X=1) when lambda=1", () => {
      // P(X=1) = e^(-1) * 1 ≈ 0.3679
      const result = poissonPMF(1, 1);
      expect(result).toBeCloseTo(0.3679, 3);
    });

    it("should return correct probability for P(X=2) when lambda=2", () => {
      // P(X=2) = e^(-2) * 4/2 ≈ 0.2707
      const result = poissonPMF(2, 2);
      expect(result).toBeCloseTo(0.2707, 3);
    });

    it("should return 0 for negative k", () => {
      expect(poissonPMF(-1, 2)).toBe(0);
    });

    it("should return 0 for lambda <= 0", () => {
      expect(poissonPMF(1, 0)).toBe(0);
      expect(poissonPMF(1, -1)).toBe(0);
    });
  });

  describe("poissonCDF", () => {
    it("should return P(X <= 0) correctly", () => {
      // P(X <= 0) = P(X=0) = e^(-2) ≈ 0.1353
      const result = poissonCDF(0, 2);
      expect(result).toBeCloseTo(0.1353, 3);
    });

    it("should return P(X <= 2) for lambda=2", () => {
      // P(X<=2) = P(0) + P(1) + P(2) ≈ 0.6767
      const result = poissonCDF(2, 2);
      expect(result).toBeCloseTo(0.6767, 3);
    });

    it("should return 1 for lambda <= 0", () => {
      expect(poissonCDF(5, 0)).toBe(1);
    });
  });

  describe("poissonOverProbability", () => {
    it("should calculate P(X > 2.5) = P(X >= 3) for lambda=2", () => {
      // P(X >= 3) = 1 - P(X <= 2) ≈ 1 - 0.6767 = 0.3233
      const result = poissonOverProbability(2.5, 2);
      expect(result).toBeCloseTo(0.3233, 3);
    });

    it("should calculate P(X > 1.5) = P(X >= 2) for lambda=2.5", () => {
      // P(X >= 2) = 1 - P(X <= 1) for lambda=2.5
      // P(X=0) = e^(-2.5) ≈ 0.0821, P(X=1) = 2.5 * e^(-2.5) ≈ 0.2052
      // P(X <= 1) ≈ 0.2873, P(X >= 2) ≈ 0.7127
      const result = poissonOverProbability(1.5, 2.5);
      expect(result).toBeCloseTo(0.7127, 3);
    });

    it("should return high probability for low line with high lambda", () => {
      // P(X > 0.5) with lambda=3 should be very high (nearly 1 - e^(-3))
      const result = poissonOverProbability(0.5, 3);
      expect(result).toBeGreaterThan(0.9);
    });

    it("should return low probability for high line with low lambda", () => {
      // P(X > 5.5) with lambda=2 should be very low
      const result = poissonOverProbability(5.5, 2);
      expect(result).toBeLessThan(0.05);
    });
  });

  describe("calculateAlternateLines", () => {
    it("should return lines in the 5-95% probability range", () => {
      const lines = calculateAlternateLines(2.5);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line.overProb).toBeGreaterThanOrEqual(0.05);
        expect(line.overProb).toBeLessThanOrEqual(0.95);
      }
    });

    it("should have decreasing over probability as line increases", () => {
      const lines = calculateAlternateLines(2.5);
      for (let i = 1; i < lines.length; i++) {
        expect(lines[i].overProb).toBeLessThan(lines[i - 1].overProb);
      }
    });

    it("should have overProb + underProb ≈ 1 for each line", () => {
      const lines = calculateAlternateLines(2.5);
      for (const line of lines) {
        expect(line.overProb + line.underProb).toBeCloseTo(1, 2);
      }
    });

    it("should produce realistic HRR alternate lines for lambda=2.5", () => {
      const lines = calculateAlternateLines(2.5);
      // Should include lines like 0.5, 1.5, 2.5, 3.5, 4.5
      const lineValues = lines.map(l => l.line);
      expect(lineValues).toContain(1.5);
      expect(lineValues).toContain(2.5);
      expect(lineValues).toContain(3.5);
    });
  });

  describe("findFairLine", () => {
    it("should find fair line close to lambda for typical values", () => {
      // For lambda=2.5, fair line should be around 2.5 (closest 0.5 increment)
      const fair = findFairLine(2.5);
      expect(fair).toBeGreaterThanOrEqual(1.5);
      expect(fair).toBeLessThanOrEqual(3.5);
    });

    it("should find fair line of 1.5 for lambda=2", () => {
      // P(X > 1.5) with lambda=2 ≈ 0.59, P(X > 2.5) ≈ 0.32
      // 1.5 is closer to 50%
      const fair = findFairLine(2);
      expect(fair).toBe(1.5);
    });
  });

  describe("calculateEdge", () => {
    it("should return positive edge when model prob > book prob", () => {
      expect(calculateEdge(0.65, 0.55)).toBeCloseTo(0.10, 5);
    });

    it("should return negative edge when model prob < book prob", () => {
      expect(calculateEdge(0.45, 0.55)).toBeCloseTo(-0.10, 5);
    });

    it("should return zero when probabilities match", () => {
      expect(calculateEdge(0.50, 0.50)).toBe(0);
    });
  });

  describe("getPickQuality", () => {
    // Integration Patch: PQS system — quality requires BOTH edge AND probability.
    it("should return strong for 70%+ prob with 4%+ edge", () => {
      expect(getPickQuality(0.10, 0.75)).toBe("strong");  // 75% prob, 10% edge
      expect(getPickQuality(0.04, 0.70)).toBe("strong");  // 70% prob, 4% edge
    });

    it("should return moderate for 60%+ prob with 2%+ edge", () => {
      expect(getPickQuality(0.06, 0.65)).toBe("moderate"); // 65% prob, 6% edge
      expect(getPickQuality(0.02, 0.60)).toBe("moderate"); // 60% prob, 2% edge
    });

    it("should return lean for 50%+ prob with 1%+ edge", () => {
      expect(getPickQuality(0.03, 0.55)).toBe("lean");  // 55% prob, 3% edge
      expect(getPickQuality(0.01, 0.50)).toBe("lean");  // 50% prob, 1% edge
    });

    it("should return lean for 60%+ prob even with negative edge", () => {
      expect(getPickQuality(-0.02, 0.65)).toBe("lean"); // 65% prob, -2% edge
    });

    it("should return avoid when probability is too low", () => {
      expect(getPickQuality(0.10, 0.45)).toBe("avoid"); // 45% prob — below 50% floor
      expect(getPickQuality(-0.05, 0.40)).toBe("avoid"); // 40% prob, negative edge
    });

    it("should return avoid when no overProb supplied and edge is low", () => {
      // No overProb: defaults to 50% — needs edge >= 0.01 to qualify as lean
      expect(getPickQuality(0.005)).toBe("avoid");
      expect(getPickQuality(-0.05)).toBe("avoid");
    });
  });

  describe("Realistic HRR scenarios", () => {
    it("should give ~60-70% over prob for elite hitter at O 1.5 (lambda=2.5)", () => {
      const prob = poissonOverProbability(1.5, 2.5);
      expect(prob).toBeGreaterThan(0.6);
      expect(prob).toBeLessThan(0.8);
    });

    it("should give ~30-40% over prob for average hitter at O 2.5 (lambda=2.0)", () => {
      const prob = poissonOverProbability(2.5, 2.0);
      expect(prob).toBeGreaterThan(0.25);
      expect(prob).toBeLessThan(0.45);
    });

    it("should give ~50% over prob when line equals lambda", () => {
      // When lambda=2.5, O 2.5 should be close to 50%
      const prob = poissonOverProbability(2.5, 2.5);
      expect(prob).toBeGreaterThan(0.40);
      expect(prob).toBeLessThan(0.60);
    });
  });
});
