/**
 * PitcherEdgePicksClean.tsx
 *
 * Replaces PitcherEdgePicks.tsx
 *
 * Key UI changes:
 *  - Removes Fair odds column from all cards
 *  - Removes Grade badge from card header (moved to expanded only)
 *  - Removes TMS number from header (replaced with TMS bar in expanded)
 *  - Max 8 cards on main board
 *  - Leans hidden behind "Show X leans" button
 *  - Parlay-only picks in a separate clearly-labeled section
 *  - Header shows simple count, not "83 in archive"
 *  - "Why This Play" bullets cleaned up — no circular reasoning
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { RefreshCw, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PitcherPick {
  pitcherName: string;
  pitcherTeam: string;
  opponentTeam: string;
  pitcherHand: string;
  gameTime: string;
  propType: 'strikeouts' | 'walks';
  line: number;
  bookOdds: number;
  modelProbability: number;  // already %-scaled (e.g. 86.5)
  edge: number;              // already %-scaled (e.g. 45.4)
  tms: number;
  tier: string;
  hasDisciplineEdge: boolean;
  isDualEdge: boolean;
  qualifyingReasons: string[];
  riskFlags: string[];
  disciplineGrade: string | null;
  opponentKRate: number | null;
  opponentBBRate: number | null;
  isOfficialPlay: boolean;
  isLeanPlay: boolean;
  pricingPenaltyTier?: string;
  playCategory?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatOdds(odds: number): string {
  return odds >= 0 ? `+${odds}` : `${odds}`;
}

function formatTime(iso: string): string {
  if (!iso || iso === 'Invalid Date' || iso === 'null' || iso === 'undefined') return 'TBD';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 'TBD';
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York'
    }) + ' ET';
  } catch { return 'TBD'; }
}

function probColor(prob: number): string {
  if (prob >= 80) return 'text-emerald-400';
  if (prob >= 70) return 'text-blue-300';
  if (prob >= 60) return 'text-yellow-400';
  return 'text-zinc-400';
}

function oddsColor(odds: number): string {
  if (odds > 0) return 'text-emerald-400';   // positive odds = value
  if (odds >= -150) return 'text-white';
  if (odds >= -300) return 'text-yellow-400';
  return 'text-orange-400';                   // expensive but within single-bet range
}

/**
 * Clean qualifying reasons — remove circular bullets like
 * "Strong market value: +X% edge" (edge is already shown in header)
 * "Discipline Grade: B" (grade shown elsewhere)
 */
function cleanReasons(reasons: string[]): string[] {
  const remove = [
    'strong market value',
    'discipline grade',
    'dual edge',
    'edge',
  ];
  return reasons.filter(r =>
    !remove.some(bad => r.toLowerCase().includes(bad))
  ).slice(0, 3); // max 3 bullets
}

// ─── Single pick card ─────────────────────────────────────────────────────────

function PitcherPickCard({
  pick,
  isParlayOnly = false,
}: {
  pick: PitcherPick;
  isParlayOnly?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const propLabel = pick.propType === 'strikeouts' ? 'K' : 'BB';
  const cleanedReasons = cleanReasons(pick.qualifyingReasons);

  const borderColor =
    pick.isOfficialPlay ? 'border-[oklch(0.55_0.25_280)]' :
    isParlayOnly ? 'border-yellow-500/30' :
    'border-white/10';

  const bgColor =
    pick.isOfficialPlay ? 'bg-[oklch(0.15_0.05_280)]' :
    isParlayOnly ? 'bg-yellow-950/30' :
    'bg-white/3';

  return (
    <div className={`rounded-2xl border ${borderColor} ${bgColor} overflow-hidden`}>
      <div className="px-4 pt-3 pb-2">

        {/* Tier badges — simplified */}
        <div className="flex items-center gap-1.5 flex-wrap mb-2">
          {pick.isOfficialPlay && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[oklch(0.55_0.25_280)] text-white">
              🔥 OFFICIAL
            </span>
          )}
          {isParlayOnly && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
              🔗 PARLAY ONLY
            </span>
          )}
          {pick.isDualEdge && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-400 border border-orange-500/25">
              ⚡ DUAL
            </span>
          )}
          {pick.hasDisciplineEdge && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300">
              💎 EDGE
            </span>
          )}
        </div>

        {/* Pitcher + prop — the two most important things */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-base leading-tight">{pick.pitcherName}</p>
            <p className="text-zinc-500 text-xs mt-0.5">
              {pick.pitcherTeam} vs {pick.opponentTeam} · {formatTime(pick.gameTime)}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-yellow-400 font-bold text-xl leading-tight">
              {pick.line}+ {propLabel}
            </p>
            <p className="text-zinc-500 text-[10px]">
              {pick.propType === 'strikeouts' ? 'Strikeouts' : 'Walks'} Over
            </p>
          </div>
        </div>

        {/* Key numbers — 3 only: Model %, Book odds, Edge */}
        <div className="flex items-center gap-0 divide-x divide-white/8 mb-3">
          <div className="flex-1 text-center pr-3">
            <p className={`text-lg font-bold leading-none ${probColor(pick.modelProbability)}`}>
              {pick.modelProbability.toFixed(1)}%
            </p>
            <p className="text-[9px] text-zinc-600 mt-0.5">Model</p>
          </div>
          <div className="flex-1 text-center px-3">
            <p className={`text-lg font-bold leading-none ${oddsColor(pick.bookOdds)}`}>
              {formatOdds(pick.bookOdds)}
            </p>
            <p className="text-[9px] text-zinc-600 mt-0.5">Book</p>
          </div>
          <div className="flex-1 text-center pl-3">
            <p className={`text-lg font-bold leading-none ${pick.edge > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {pick.edge > 0 ? '+' : ''}{pick.edge.toFixed(1)}%
            </p>
            <p className="text-[9px] text-zinc-600 mt-0.5">Edge</p>
          </div>
        </div>

        {/* Top reason — one line, plain English */}
        {cleanedReasons[0] && (
          <p className="text-xs text-zinc-400 leading-relaxed">
            {cleanedReasons[0]}
          </p>
        )}

        {/* Parlay only warning */}
        {isParlayOnly && (
          <div className="mt-2 flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-yellow-500/8 border border-yellow-500/15">
            <AlertTriangle size={10} className="text-yellow-400 shrink-0" />
            <p className="text-[10px] text-yellow-400/80">
              Odds too expensive for single bet. Use as parlay leg only.
            </p>
          </div>
        )}
      </div>

      {/* Expand toggle */}
      <button
        className="w-full flex items-center justify-center gap-1 py-2 border-t border-white/5 text-[10px] text-zinc-600"
        onClick={() => setExpanded(e => !e)}
      >
        {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        {expanded ? 'less' : 'details'}
      </button>

      {/* Expanded section */}
      {expanded && (
        <div className="px-4 pb-4 pt-3 border-t border-white/5 space-y-3">

          {/* All reasons */}
          {cleanedReasons.length > 0 && (
            <div>
              <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1.5">Why This Play</p>
              <ul className="space-y-1">
                {cleanedReasons.map((r, i) => (
                  <li key={i} className="flex gap-1.5 text-xs text-zinc-300">
                    <span className="text-emerald-500 mt-0.5">✓</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Opponent profile — the actually useful data */}
          {(pick.opponentKRate !== null || pick.opponentBBRate !== null) && (
            <div>
              <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1.5">Opponent</p>
              <div className="flex gap-4">
                {pick.opponentKRate !== null && (
                  <div className="bg-white/4 rounded-lg px-3 py-2">
                    <p className="text-[9px] text-zinc-600">K Rate</p>
                    <p className="text-sm font-bold text-white">{pick.opponentKRate.toFixed(1)}%</p>
                  </div>
                )}
                {pick.opponentBBRate !== null && (
                  <div className="bg-white/4 rounded-lg px-3 py-2">
                    <p className="text-[9px] text-zinc-600">BB Rate</p>
                    <p className="text-sm font-bold text-white">{pick.opponentBBRate.toFixed(1)}%</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TMS bar — moved to expanded */}
          <div>
            <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1.5">
              Team Matchup Score
            </p>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-white/8 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    pick.tms >= 70 ? 'bg-emerald-500' :
                    pick.tms >= 55 ? 'bg-blue-400' : 'bg-zinc-500'
                  }`}
                  style={{ width: `${pick.tms}%` }}
                />
              </div>
              <span className="text-xs text-zinc-400 w-8 text-right">{pick.tms}/100</span>
            </div>
          </div>

          {/* Grade — moved to expanded */}
          {pick.disciplineGrade && (
            <p className="text-xs text-zinc-500">
              Discipline Grade: <span className="font-semibold text-zinc-300">{pick.disciplineGrade}</span>
            </p>
          )}

          {/* Risk flags */}
          {pick.riskFlags.length > 0 && (
            <div className="space-y-1">
              {pick.riskFlags.slice(0, 2).map((f, i) => (
                <div key={i} className="flex gap-1.5 text-xs text-yellow-400/70 bg-yellow-500/8 rounded-lg px-2 py-1.5">
                  <AlertTriangle size={10} className="shrink-0 mt-0.5" />
                  <span>{f}</span>
                </div>
              ))}
            </div>
          )}

          <p className="text-[10px] text-zinc-700">
            For informational purposes only. Always bet responsibly.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PitcherEdgePicksClean() {
  const [showLeans, setShowLeans] = useState(false);
  const [showParlays, setShowParlays] = useState(false);

  const { data, isLoading, refetch, isFetching } = trpc.discipline.getPitcherEdgePicks.useQuery(
    undefined,
    { staleTime: 10 * 60 * 1000 }
  );

  const officialPicks: PitcherPick[] = data?.picks ?? [];
  const parlayPicks: PitcherPick[] = (data as any)?.parlayOnlyPicks ?? [];
  const leanPicks: PitcherPick[] = (data as any)?.leanPicks ?? [];
  const counts = (data as any)?.counts ?? {};

  if (isLoading) {
    return (
      <div className="px-4 py-4 space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-36 rounded-2xl bg-white/4 animate-pulse" />
        ))}
      </div>
    );
  }

  if (officialPicks.length === 0 && parlayPicks.length === 0) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-zinc-400 font-semibold text-sm mb-1">No Pitcher Picks Today</p>
        <p className="text-zinc-600 text-xs max-w-[200px] mx-auto leading-relaxed">
          No pitcher props meet the minimum thresholds right now. Check back closer to first pitch.
        </p>
        <button
          onClick={() => refetch()}
          className="mt-4 flex items-center gap-1.5 mx-auto text-zinc-500 text-xs"
        >
          <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 pb-4 space-y-4">

      {/* Header — clean count, no archive noise */}
      <div className="flex items-center justify-between pt-1">
        <div>
          <p className="text-white font-bold text-base">Pitcher Edge Lab</p>
          <p className="text-zinc-600 text-xs">
            {counts.official ?? officialPicks.length} official picks today
            {counts.parlayOnly > 0 && ` · ${counts.parlayOnly} parlay-only`}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1 text-zinc-500 text-xs"
          disabled={isFetching}
        >
          <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Official picks — max 8, deduped */}
      {officialPicks.length > 0 && (
        <div className="space-y-3">
          <p className="text-[10px] text-zinc-600 uppercase tracking-widest">
            🔥 Official Plays · Tracked in Results
          </p>
          {officialPicks.map((pick, i) => (
            <PitcherPickCard key={`official-${i}`} pick={pick} />
          ))}
        </div>
      )}

      {/* Parlay-only section — separate, clearly labeled */}
      {parlayPicks.length > 0 && (
        <div className="space-y-3">
          <button
            className="flex items-center justify-between w-full"
            onClick={() => setShowParlays(v => !v)}
          >
            <p className="text-[10px] text-yellow-500/70 uppercase tracking-widest">
              🔗 Parlay Only ({parlayPicks.length})
            </p>
            {showParlays ? <ChevronUp size={12} className="text-zinc-600" /> : <ChevronDown size={12} className="text-zinc-600" />}
          </button>
          {showParlays && (
            <div className="space-y-3">
              <div className="px-3 py-2 rounded-xl bg-yellow-500/8 border border-yellow-500/15">
                <p className="text-[10px] text-yellow-400/70 leading-relaxed">
                  These picks have high model probability but expensive odds. Not suitable as standalone single bets — use as legs in a parlay only.
                </p>
              </div>
              {parlayPicks.map((pick, i) => (
                <PitcherPickCard key={`parlay-${i}`} pick={pick} isParlayOnly />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Lean picks — collapsed by default */}
      {leanPicks.length > 0 && (
        <div>
          <button
            className="flex items-center gap-2 text-zinc-600 text-xs"
            onClick={() => setShowLeans(v => !v)}
          >
            {showLeans ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            Show {leanPicks.length} lean pick{leanPicks.length !== 1 ? 's' : ''} (not in official results)
          </button>
          {showLeans && (
            <div className="space-y-3 mt-3">
              {leanPicks.map((pick, i) => (
                <PitcherPickCard key={`lean-${i}`} pick={pick} />
              ))}
            </div>
          )}
        </div>
      )}

      {data?.generatedAt && (
        <p className="text-center text-[10px] text-zinc-700">
          Updated {new Date(data.generatedAt).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
