/**
 * Position-based adjustments for prop predictions
 * Different positions have different expected stats due to:
 * - Plate appearances (PA) frequency
 * - Batting order position
 * - Defensive positioning
 * - Role in offense
 */

export type PlayerPosition = 
  | "C"   // Catcher
  | "1B"  // First Base
  | "2B"  // Second Base
  | "3B"  // Third Base
  | "SS"  // Shortstop
  | "LF"  // Left Field
  | "CF"  // Center Field
  | "RF"  // Right Field
  | "DH"  // Designated Hitter
  | "OF"; // Outfield (generic)

export interface PositionAdjustment {
  position: PlayerPosition;
  plateAppearanceMultiplier: number; // Relative to average (1.0 = average)
  hitsMultiplier: number;
  runsMultiplier: number;
  rbiMultiplier: number;
  description: string;
}

/**
 * Position adjustment factors based on historical MLB data
 * Multipliers represent deviation from league average
 */
const POSITION_ADJUSTMENTS: Record<PlayerPosition, PositionAdjustment> = {
  // Catchers: Fewer PA, lower totals
  C: {
    position: "C",
    plateAppearanceMultiplier: 0.75,
    hitsMultiplier: 0.75,
    runsMultiplier: 0.70,
    rbiMultiplier: 0.80,
    description: "Catcher - Fewer PA, lower totals due to defensive role",
  },

  // Infielders
  // 1B: More RBIs, more HRs, fewer runs
  "1B": {
    position: "1B",
    plateAppearanceMultiplier: 1.05,
    hitsMultiplier: 1.05,
    runsMultiplier: 1.00,
    rbiMultiplier: 1.15, // Corner infielders drive in runs
    description: "First Base - More RBIs, power hitter",
  },

  // 2B: Balanced, often leadoff/top of order
  "2B": {
    position: "2B",
    plateAppearanceMultiplier: 1.08,
    hitsMultiplier: 1.10,
    runsMultiplier: 1.15, // Often scores more
    rbiMultiplier: 0.95,
    description: "Second Base - More hits/runs, fewer RBIs",
  },

  // 3B: Similar to 1B, power position
  "3B": {
    position: "3B",
    plateAppearanceMultiplier: 1.05,
    hitsMultiplier: 1.05,
    runsMultiplier: 1.05,
    rbiMultiplier: 1.15,
    description: "Third Base - Power corner infielder",
  },

  // SS: Balanced, often top of order
  SS: {
    position: "SS",
    plateAppearanceMultiplier: 1.08,
    hitsMultiplier: 1.08,
    runsMultiplier: 1.10,
    rbiMultiplier: 0.95,
    description: "Shortstop - More hits/runs, fewer RBIs",
  },

  // Outfielders
  // LF/RF: Corner outfielders, more power
  LF: {
    position: "LF",
    plateAppearanceMultiplier: 1.05,
    hitsMultiplier: 1.05,
    runsMultiplier: 1.05,
    rbiMultiplier: 1.10,
    description: "Left Field - Corner outfielder, power",
  },

  RF: {
    position: "RF",
    plateAppearanceMultiplier: 1.05,
    hitsMultiplier: 1.05,
    runsMultiplier: 1.05,
    rbiMultiplier: 1.10,
    description: "Right Field - Corner outfielder, power",
  },

  // CF: Center fielder, often leadoff/top of order
  CF: {
    position: "CF",
    plateAppearanceMultiplier: 1.08,
    hitsMultiplier: 1.10,
    runsMultiplier: 1.15,
    rbiMultiplier: 0.90,
    description: "Center Field - Speed/leadoff type, more runs",
  },

  // Generic outfield
  OF: {
    position: "OF",
    plateAppearanceMultiplier: 1.05,
    hitsMultiplier: 1.05,
    runsMultiplier: 1.05,
    rbiMultiplier: 1.05,
    description: "Outfield - Average outfielder",
  },

  // DH: More RBIs, fewer runs (doesn't run bases)
  DH: {
    position: "DH",
    plateAppearanceMultiplier: 1.10,
    hitsMultiplier: 1.08,
    runsMultiplier: 0.85, // Doesn't run bases as much
    rbiMultiplier: 1.20, // Focused on driving in runs
    description: "Designated Hitter - More RBIs, fewer runs",
  },
};

/**
 * Get position adjustment for a player
 */
export function getPositionAdjustment(position: PlayerPosition): PositionAdjustment {
  return POSITION_ADJUSTMENTS[position] || POSITION_ADJUSTMENTS.OF;
}

/**
 * Apply position-based multiplier to a stat
 */
export function applyPositionMultiplier(
  stat: number,
  position: PlayerPosition,
  statType: "hits" | "runs" | "rbi" | "plateAppearances"
): number {
  const adjustment = getPositionAdjustment(position);

  const multiplierMap: Record<string, number> = {
    hits: adjustment.hitsMultiplier,
    runs: adjustment.runsMultiplier,
    rbi: adjustment.rbiMultiplier,
    plateAppearances: adjustment.plateAppearanceMultiplier,
  };

  const multiplier = multiplierMap[statType] || 1.0;
  return stat * multiplier;
}

/**
 * Calculate position-based confidence boost/penalty
 * Some positions have more predictable stats than others
 */
export function getPositionConfidenceAdjustment(position: PlayerPosition): number {
  // Positions with more predictable patterns get confidence boost
  const confidenceMap: Record<PlayerPosition, number> = {
    C: -5, // Catchers have more variable stats
    "1B": 5, // 1B stats are predictable (power hitter)
    "2B": 3, // 2B stats fairly predictable
    "3B": 5, // 3B stats predictable (power)
    SS: 2, // SS stats less predictable
    LF: 3, // Corner OF fairly predictable
    CF: 0, // CF stats variable
    RF: 3, // Corner OF fairly predictable
    DH: 8, // DH stats very predictable (focused role)
    OF: 0, // Generic OF, neutral
  };

  return confidenceMap[position] || 0;
}

/**
 * Fetch player position from MLB API
 */
export async function fetchPlayerPosition(playerId: number): Promise<PlayerPosition | null> {
  try {
    const response = await fetch(`https://statsapi.mlb.com/api/v1/people/${playerId}`);
    const data = await response.json();
    const person = data.people?.[0];

    // Try to get position from primaryPosition
    const primaryPosition = person?.primaryPosition?.abbreviation;
    if (primaryPosition && Object.keys(POSITION_ADJUSTMENTS).includes(primaryPosition)) {
      return primaryPosition as PlayerPosition;
    }

    return null;
  } catch (error) {
    console.error(`Failed to fetch position for ${playerId}:`, error);
    return null;
  }
}

/**
 * Get all position adjustments for reference
 */
export function getAllPositionAdjustments(): PositionAdjustment[] {
  return Object.values(POSITION_ADJUSTMENTS);
}
