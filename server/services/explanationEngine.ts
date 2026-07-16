/**
 * explanationEngine.ts — PHASE 4
 *
 * Every official pick must answer five questions automatically.
 * RULE: if the engine cannot generate ≥2 genuine "why" bullets,
 * the pick DOES NOT QUALIFY. Explanation failure = qualification failure.
 *
 * Location: server/services/explanationEngine.ts
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PickExplanation {
  qualifies: boolean;           // false if <2 genuine bullets — blocks the pick
  whyBullets: string[];         // plain English, 2-4 bullets
  biggestRisk: string;          // always exactly one
  numbers: {
    modelProb: number;
    bookProbVigFree: number | null;
    edge: number | null;
    odds: string | null;
  };
  confidence: { level: 'HIGH' | 'MEDIUM' | 'LOW'; detail: string };
  trackRecord: string | null;   // filled once Phase 2 data exists
}

export interface ExplainInput {
  playerName: string;
  battingPosition?: number;
  pitcher?: { name?: string; era?: number; whip?: number; kPct?: number; hand?: string };

  // HQS (Layer 4) — replaces the never-deployed CQI fields
  hqs?: number;
  hqsComponents?: { contact: number; quality: number; power: number };
  hqsFlags?: string[];          // already-generated notes from calculateHQS
  hrrProfile?: 'HRR_PRIME' | 'HRR_SOLID' | null;

  // VS Gate (batter-vs-this-pitcher) — new since the VS-GATE-3 deploy
  vsGateScore?: number;         // 0-10
  vsGateTier?: string;
  isDamageMatchup?: boolean;    // barrel-on-barrel flag
  vsReasoning?: string[];       // already-generated notes from computeVSGate

  envGrade?: 'A' | 'B' | 'C' | 'D';
  envLabel?: string;
  gameTotalOU?: number | null;
  parkFactor?: number;
  platoonEdge?: boolean;
  batterHand?: string;
  recentFormScore?: number;
  last5HitRate?: number | null;
  formNote?: string | null;     // from gateFormByContactQuality, if deployed
  modelProb: number;            // 0-100
  bookOdds?: number | null;
  bookProbVigFree?: number | null;
  edge?: number | null;
  qualifyingFactorCount?: number;   // of 5
  similarPicksRecord?: { w: number; l: number } | null;
}

// ─── Bullet generators — each returns a bullet only when GENUINELY true ───────

/**
 * VS Gate and HQS already generate their own reasoning strings at score time
 * (vsReasoning, hqsFlags). Rather than re-derive them, pull the best 1-2 from
 * each — they're already validated, plain-English, and computed from the
 * live pipeline rather than reconstructed here from raw numbers.
 */
function vsGateBullet(i: ExplainInput): string | null {
  if (i.isDamageMatchup) {
    return `Barrel-on-barrel matchup — elite contact hitter vs a pitcher who leaks hard contact`;
  }
  if (i.vsReasoning && i.vsReasoning.length > 0) {
    return i.vsReasoning[0];
  }
  return null;
}

function hqsBullet(i: ExplainInput): string | null {
  if (i.hrrProfile === 'HRR_PRIME') {
    return `PropFinder HRR PRIME profile — elite contact, quality, and power combined`;
  }
  if (i.hrrProfile === 'HRR_SOLID') {
    return `PropFinder HRR SOLID profile — strong all-around hitting metrics`;
  }
  if (i.hqsFlags && i.hqsFlags.length > 0) {
    // hqsFlags already filters out neutral/uninteresting notes at source
    return i.hqsFlags[0];
  }
  if ((i.hqsComponents?.quality ?? 0) >= 72 && (i.hqsComponents?.power ?? 0) >= 65) {
    return `Strong quality-of-contact profile (HQS ${i.hqs ?? '—'})`;
  }
  return null;
}

function pitcherBullet(i: ExplainInput): string | null {
  const p = i.pitcher;
  if (!p) return null;
  if ((p.era ?? 0) >= 5.0)
    return `Facing a leaky starter — ${p.name ?? 'opposing pitcher'} carries a ${p.era!.toFixed(2)} ERA${p.whip ? ` and ${p.whip.toFixed(2)} WHIP` : ''}`;
  if ((p.era ?? 0) >= 4.4)
    return `Hittable matchup — ${p.name ?? 'starter'}'s ${p.era!.toFixed(2)} ERA leaves the door open`;
  if ((p.whip ?? 0) >= 1.45)
    return `${p.name ?? 'Starter'} puts constant traffic on base (WHIP ${p.whip!.toFixed(2)}) — run and RBI chances stack`;
  return null;
}

function lineupBullet(i: ExplainInput): string | null {
  const spot = i.battingPosition;
  if (spot == null) return null;
  if (spot <= 2) return `Top-of-lineup spot (#${spot}) — maximum plate appearances and run-scoring chances`;
  if (spot <= 5) return `Heart of the order (#${spot}) — prime RBI position`;
  return null;
}

function environmentBullet(i: ExplainInput): string | null {
  if (i.envGrade === 'A')
    return `A-grade offensive environment${i.gameTotalOU ? ` — game total ${i.gameTotalOU}` : ''}${i.parkFactor && i.parkFactor >= 1.06 ? `, hitter-friendly park (${i.parkFactor.toFixed(2)}x)` : ''}`;
  if (i.gameTotalOU != null && i.gameTotalOU >= 9.5)
    return `High-scoring game script — books set the total at ${i.gameTotalOU}`;
  return null;
}

function platoonBullet(i: ExplainInput): string | null {
  if (i.platoonEdge && i.pitcher?.hand)
    return `Platoon advantage — ${i.batterHand === 'S' ? 'switch hitter' : `${i.batterHand}HB`} vs ${i.pitcher.hand}HP`;
  return null;
}

function formBullet(i: ExplainInput): string | null {
  if (i.formNote?.includes('Skill-backed')) return i.formNote;
  if ((i.last5HitRate ?? 0) >= 80 && (i.hqsComponents?.quality ?? 0) >= 55)
    return `Hot and real — ${i.last5HitRate}% hit rate last 5 with the contact quality to back it`;
  return null;
}

// ─── Risk generator — always produces exactly one ─────────────────────────────

function biggestRisk(i: ExplainInput): string {
  const risks: Array<[number, string]> = [];
  if ((i.pitcher?.kPct ?? 0) >= 26)
    risks.push([3, `${i.pitcher?.name ?? 'Opposing pitcher'} strikes out ${i.pitcher!.kPct!.toFixed(0)}% of batters — whiff risk is real`]);
  if (i.formNote?.includes('discounted'))
    risks.push([3, i.formNote]);
  if ((i.last5HitRate ?? 100) <= 30)
    risks.push([2, `Cold recent form — ${i.last5HitRate}% hit rate over last 5 games`]);
  if (i.envGrade === 'C' || i.envGrade === 'D')
    risks.push([2, `${i.envLabel ?? 'Pitcher-leaning environment'} — this game had to clear a stricter gate`]);
  if ((i.parkFactor ?? 1) <= 0.94)
    risks.push([1, `Pitcher-friendly park suppresses offense (${i.parkFactor!.toFixed(2)}x)`]);
  if (i.bookOdds != null && i.bookOdds <= -200)
    risks.push([1, `Priced at ${i.bookOdds} — thin margin for error on a juiced line`]);

  if (risks.length === 0)
    return `Baseball variance — even ${i.modelProb.toFixed(0)}% picks miss ${(100 - i.modelProb).toFixed(0)}% of the time`;
  risks.sort((a, b) => b[0] - a[0]);
  return risks[0][1];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function explainPick(i: ExplainInput): PickExplanation {
  const candidates = [
    vsGateBullet(i),      // batter-vs-this-pitcher — the most specific signal available
    hqsBullet(i),         // Layer 4 quality/power, or PropFinder profile badge
    pitcherBullet(i),
    lineupBullet(i),
    environmentBullet(i),
    platoonBullet(i),
    formBullet(i),
  ].filter((b): b is string => b !== null);

  const whyBullets = candidates.slice(0, 4);

  // THE RULE: <2 genuine bullets → pick does not qualify
  const qualifies = whyBullets.length >= 2;

  const factorCount = i.qualifyingFactorCount ?? whyBullets.length;
  const confidence =
    factorCount >= 4 && i.modelProb >= 72
      ? { level: 'HIGH' as const, detail: `${factorCount} of 5 qualifying factors present, ${i.modelProb.toFixed(0)}% model probability` }
      : factorCount >= 3
      ? { level: 'MEDIUM' as const, detail: `${factorCount} qualifying factors, ${i.modelProb.toFixed(0)}% model probability` }
      : { level: 'LOW' as const, detail: `Only ${factorCount} qualifying factors — borderline play` };

  const trackRecord = i.similarPicksRecord && (i.similarPicksRecord.w + i.similarPicksRecord.l) >= 15
    ? `Similar picks: ${i.similarPicksRecord.w}-${i.similarPicksRecord.l} (${Math.round((i.similarPicksRecord.w / (i.similarPicksRecord.w + i.similarPicksRecord.l)) * 100)}%)`
    : null;

  return {
    qualifies,
    whyBullets,
    biggestRisk: biggestRisk(i),
    numbers: {
      modelProb: Math.round(i.modelProb * 10) / 10,
      bookProbVigFree: i.bookProbVigFree ?? null,
      edge: i.edge ?? null,
      odds: i.bookOdds != null ? (i.bookOdds > 0 ? `+${i.bookOdds}` : `${i.bookOdds}`) : null,
    },
    confidence,
    trackRecord,
  };
}

/*
 * INTEGRATION (qualificationPipeline.ts, Stage 6):
 *
 *   const explanation = explainPick({ ...pickContext });
 *   if (!explanation.qualifies) {
 *     drop('6-Explanation', p, 'Could not generate 2+ genuine qualifying reasons');
 *     continue;
 *   }
 *   p.explanation = explanation;   // frontend renders whyBullets/risk/confidence
 *
 * This kills the whyItQualifies:[] bug permanently — an unexplainable pick is not a pick.
 */
