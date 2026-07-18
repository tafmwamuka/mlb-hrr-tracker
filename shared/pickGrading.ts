/**
 * shared/pickGrading.ts
 *
 * Single source of truth for the hit/miss grading rule used across all
 * result-verification paths (autoGradeResults, progressiveTrackingService,
 * results router, pitcherLearningEngine, prop-model).
 *
 * Rule:
 *   - Half-point lines (1.5, 2.5, 3.5 …): no push is possible, so
 *     the bet wins only when actual STRICTLY EXCEEDS the line.
 *   - Whole-number lines (1, 2, 3 …): a push (actual === line) counts
 *     as a win, so actual >= line is the correct test.
 *
 * Both `(line * 2) % 2 !== 0` and `!Number.isInteger(line)` are
 * mathematically equivalent for all half-integer prop lines; we use
 * Number.isInteger because it reads as plain English.
 */

/**
 * Returns true when an OVER prop at `line` is a HIT given `actual` result.
 *
 * @param actual - The player's real stat total for the game.
 * @param line   - The prop line (e.g. 1.5, 2, 2.5, 3).
 */
export function gradePickResult(actual: number, line: number): boolean {
  const isHalfLine = !Number.isInteger(line);
  return isHalfLine ? actual > line : actual >= line;
}
