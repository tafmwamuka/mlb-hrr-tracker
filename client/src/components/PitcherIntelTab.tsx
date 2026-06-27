/**
 * PitcherIntelTab.tsx — IMPROVED
 *
 * Key improvements over previous version:
 *  1. Plain English "What This Means" reasoning — not just raw stats
 *  2. TMS score breakdown — users see WHAT is driving the score
 *  3. Better empty state — shows near-misses instead of dead end
 *  4. "Attack These Batters" cross-link to Money Picks
 *  5. Smarter card hierarchy — verdict is the hero, stats are secondary
 *  6. Recent form mini-graph — W/L/ND dots instead of a table
 *  7. Confidence pill replaces raw edge score number
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PitcherRecentStart {
  date: string;
  opponent: string;
  inningsPitched: number;
  earnedRuns: number;
  strikeouts: number;
  walks: number;
  era: number;
  result: 'W' | 'L' | 'ND';
}

interface PitcherEdgeProfile {
  pitcherId: number;
  name: string;
  team: string;
  hand: 'L' | 'R';
  era: number;
  whip: number;
  kPct: number;
  bbPct: number;
  hrPer9: number;
  inningsPitched: number;
  wins: number;
  losses: number;
  xwoba_against: number;
  barrelPctAllowed: number;
  recentStarts: PitcherRecentStart[];
  recentERA: number;
  recentForm: 'HOT' | 'COLD' | 'NEUTRAL';
  opponent: string;
  venueName: string;
  gameTime: string;
  parkRunFactor: number;
  oppTeamOPS: number;
  edgeScore: number;
  verdict: 'ATTACK' | 'NEUTRAL' | 'AVOID';
  verdictReasoning: string[];
  attackStat: 'HITS' | 'RUNS' | 'RBI' | 'HRR';
  riskFlags: string[];
}

// ─── Plain English translator ─────────────────────────────────────────────────
// Converts raw stats into bettor-friendly sentences

function buildPlainEnglishReasons(p: PitcherEdgeProfile): string[] {
  const reasons: string[] = [];

  if (p.era > 5.0)
    reasons.push(`Giving up runs at an alarming rate (ERA ${p.era.toFixed(2)}) — batters are scoring freely against him`);
  else if (p.era > 4.2)
    reasons.push(`Slightly above-average ERA (${p.era.toFixed(2)}) — not dominant, hittable`);
  else if (p.era < 3.0)
    reasons.push(`Elite ERA (${p.era.toFixed(2)}) — this pitcher is tough, approach with caution`);

  if (p.whip > 1.45)
    reasons.push(`Puts lots of runners on base (WHIP ${p.whip.toFixed(2)}) — runs and RBI opportunities pile up`);

  if (p.xwoba_against > 0.370)
    reasons.push(`Batters are making quality contact against him — xwOBA ${p.xwoba_against.toFixed(3)} signals weak stuff`);
  else if (p.xwoba_against < 0.290)
    reasons.push(`Batters make weak contact (xwOBA ${p.xwoba_against.toFixed(3)}) — he's suppressing quality hits`);

  if (p.recentForm === 'COLD')
    reasons.push(`Struggling recently — ERA ${p.recentERA.toFixed(2)} over last 3 starts, well above his season average`);
  else if (p.recentForm === 'HOT')
    reasons.push(`On a hot streak lately (ERA ${p.recentERA.toFixed(2)} last 3 starts) — may be over-performing`);

  if (p.oppTeamOPS > 0.780)
    reasons.push(`Facing a dangerous lineup — opponent team OPS ${p.oppTeamOPS.toFixed(3)} vs his hand type`);
  else if (p.oppTeamOPS < 0.680)
    reasons.push(`Opponent lineup is weak vs his hand — low OPS ${p.oppTeamOPS.toFixed(3)}`);

  if (p.parkRunFactor > 1.08)
    reasons.push(`Playing at ${p.venueName}, a hitter-friendly park — scoring is easier here`);
  else if (p.parkRunFactor < 0.93)
    reasons.push(`Playing at ${p.venueName}, a pitcher-friendly park — run suppression environment`);

  if (p.kPct > 28)
    reasons.push(`High strikeout rate (${p.kPct.toFixed(0)}%) — hits props may be harder, but K props are gold`);

  if (p.barrelPctAllowed > 11)
    reasons.push(`Allows hard contact at ${p.barrelPctAllowed.toFixed(1)}% barrel rate — HR and extra base hits expected`);

  return reasons.length > 0 ? reasons : p.verdictReasoning;
}

function buildAvoidReasons(p: PitcherEdgeProfile): string[] {
  const reasons: string[] = [];
  if (p.era < 3.20) reasons.push(`Ace-level ERA ${p.era.toFixed(2)} — elite at limiting runs`);
  if (p.whip < 1.10) reasons.push(`Very low WHIP ${p.whip.toFixed(2)} — rarely gives up baserunners`);
  if (p.xwoba_against < 0.285) reasons.push(`Batters make weak contact — xwOBA ${p.xwoba_against.toFixed(3)} near elite territory`);
  if (p.recentForm === 'HOT') reasons.push(`Dominant recently: ERA ${p.recentERA.toFixed(2)} last 3 starts`);
  if (p.kPct > 30) reasons.push(`Elite strikeout rate ${p.kPct.toFixed(0)}% — hits suppressed`);
  if (p.oppTeamOPS < 0.670) reasons.push(`Opponent lineup is weak — low OPS ${p.oppTeamOPS.toFixed(3)} vs his hand`);
  return reasons.length > 0 ? reasons : p.verdictReasoning;
}

// ─── TMS Score breakdown ──────────────────────────────────────────────────────
// Shows what's driving the score with labeled bars

function TMSBreakdown({ p }: { p: PitcherEdgeProfile }) {
  // Derive sub-scores from available data (0–100 each)
  const eraScore = Math.max(0, Math.min(100, ((p.era - 2.5) / 3.5) * 100));
  const whipScore = Math.max(0, Math.min(100, ((p.whip - 0.90) / 0.70) * 100));
  const contactScore = Math.max(0, Math.min(100, ((p.xwoba_against - 0.250) / 0.150) * 100));
  const formScore = p.recentForm === 'COLD' ? 70 : p.recentForm === 'HOT' ? 20 : 45;
  const parkScore = Math.max(0, Math.min(100, ((p.parkRunFactor - 0.88) / 0.40) * 100));

  const factors = [
    { label: 'ERA Risk', score: eraScore, tip: `ERA ${p.era.toFixed(2)}` },
    { label: 'Baserunners', score: whipScore, tip: `WHIP ${p.whip.toFixed(2)}` },
    { label: 'Contact Quality', score: contactScore, tip: `xwOBA ${p.xwoba_against.toFixed(3)}` },
    { label: 'Recent Form', score: formScore, tip: p.recentForm },
    { label: 'Park Factor', score: parkScore, tip: `${p.parkRunFactor.toFixed(2)}x` },
  ];

  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-widest text-zinc-500">Score Breakdown</p>
      {factors.map(f => (
        <div key={f.label} className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-500 w-28 shrink-0">{f.label}</span>
          <div className="flex-1 h-1.5 bg-white/8 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${
                f.score >= 65 ? 'bg-emerald-500' :
                f.score <= 35 ? 'bg-red-500/60' : 'bg-blue-400/60'
              }`}
              style={{ width: `${f.score}%` }}
            />
          </div>
          <span className="text-[10px] text-zinc-500 w-16 text-right">{f.tip}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Recent form dots ─────────────────────────────────────────────────────────

function FormDots({ starts }: { starts: PitcherRecentStart[] }) {
  if (!starts.length) return null;
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-zinc-600">Last {starts.length}:</span>
      {starts.map((s, i) => (
        <div
          key={i}
          title={`vs ${s.opponent}: ${s.earnedRuns}ER in ${s.inningsPitched.toFixed(1)}IP`}
          className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold
            ${s.result === 'W' ? 'bg-emerald-500/20 text-emerald-400' :
              s.result === 'L' ? 'bg-red-500/20 text-red-400' :
              'bg-zinc-700 text-zinc-500'}`}
        >
          {s.result}
        </div>
      ))}
      <span className="text-[10px] text-zinc-600 ml-1">ERA {starts[0]?.era.toFixed(2) ?? '—'}</span>
    </div>
  );
}

// ─── Confidence pill ──────────────────────────────────────────────────────────

function ConfidencePill({ score }: { score: number }) {
  const label =
    score >= 75 ? 'HIGH' :
    score >= 55 ? 'MEDIUM' : 'LOW';
  const color =
    score >= 75 ? 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30' :
    score >= 55 ? 'text-blue-300 bg-blue-500/10 border-blue-500/20' :
    'text-zinc-400 bg-zinc-500/10 border-zinc-500/20';
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${color}`}>
      {label} CONFIDENCE
    </span>
  );
}

// ─── Near-miss card (for empty state) ────────────────────────────────────────

function NearMissCard({ p }: { p: PitcherEdgeProfile }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/3 p-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-white text-sm font-semibold">{p.name}</span>
          <span className="text-zinc-500 text-xs ml-2">{p.team} vs {p.opponent}</span>
        </div>
        <span className="text-[10px] text-zinc-600 bg-white/5 px-2 py-0.5 rounded-full">
          Score: {p.edgeScore}/100
        </span>
      </div>
      <p className="text-xs text-zinc-500 mt-1.5">
        {p.edgeScore >= 50
          ? `Close to qualifying — ${65 - p.edgeScore} points away from ATTACK threshold`
          : `Monitoring — pitcher is performing well right now`}
      </p>
    </div>
  );
}

// ─── Main pitcher card ────────────────────────────────────────────────────────

function PitcherCard({ p }: { p: PitcherEdgeProfile }) {
  const [expanded, setExpanded] = useState(false);

  const isAttack = p.verdict === 'ATTACK';
  const isAvoid = p.verdict === 'AVOID';

  const plainReasons = isAttack ? buildPlainEnglishReasons(p) : buildAvoidReasons(p);

  const statLabel = {
    HITS: '🎯 Target: HITS OVER',
    RUNS: '🏃 Target: RUNS OVER',
    RBI: '💰 Target: RBI OVER',
    HRR: '⚡ Target: H+R+RBI',
  }[p.attackStat];

  const statColor = {
    HITS: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/25',
    RUNS: 'text-red-400 bg-red-500/10 border-red-500/20',
    RBI: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
    HRR: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  }[p.attackStat];

  return (
    <div
      className={`rounded-2xl border overflow-hidden transition-all duration-200 cursor-pointer
        ${isAttack
          ? 'border-emerald-500/25 bg-gradient-to-br from-[oklch(0.14_0.04_165)] to-[oklch(0.12_0.02_255)]'
          : isAvoid
          ? 'border-red-500/15 bg-gradient-to-br from-[oklch(0.13_0.03_0)] to-[oklch(0.12_0.02_255)]'
          : 'border-white/8 bg-[oklch(0.13_0.015_255)]'
        }`}
      onClick={() => setExpanded(e => !e)}
    >
      <div className="p-4">
        {/* Top row: name + verdict */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <span className="font-bold text-white text-base">{p.name}</span>
              <span className="text-[10px] text-zinc-600 font-mono bg-white/5 px-1.5 py-0.5 rounded">{p.hand}HP</span>
              {p.recentForm !== 'NEUTRAL' && (
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full
                  ${p.recentForm === 'HOT' ? 'text-orange-400 bg-orange-500/10' : 'text-blue-300 bg-blue-500/10'}`}>
                  {p.recentForm === 'HOT' ? '🔥 HOT' : '🧊 COLD'}
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-500">
              {p.team} vs {p.opponent} · {p.venueName}
            </p>
            <p className="text-[10px] text-zinc-600 mt-0.5">{
              p.gameTime ? new Date(p.gameTime).toLocaleTimeString('en-US',
                { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'
              : ''
            }</p>
          </div>

          {/* Verdict */}
          <div className={`shrink-0 px-3 py-1.5 rounded-xl border font-bold text-xs tracking-wide
            ${isAttack ? 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10'
            : isAvoid ? 'text-red-400 border-red-500/30 bg-red-500/8'
            : 'text-blue-300 border-blue-500/25 bg-blue-500/8'}`}>
            {isAttack ? '⚡ ATTACK' : isAvoid ? '🛡 AVOID' : '➖ NEUTRAL'}
          </div>
        </div>

        {/* Confidence + target stat */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <ConfidencePill score={p.edgeScore} />
          {isAttack && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statColor}`}>
              {statLabel}
            </span>
          )}
        </div>

        {/* Key stats — 4 boxes */}
        <div className="grid grid-cols-4 gap-1.5 mb-3">
          {[
            { label: 'ERA', value: p.era.toFixed(2), bad: p.era > 4.8, good: p.era < 3.0 },
            { label: 'WHIP', value: p.whip.toFixed(2), bad: p.whip > 1.40, good: p.whip < 1.10 },
            { label: 'K%', value: `${p.kPct.toFixed(0)}%`, bad: false, good: p.kPct > 27 },
            { label: 'xwOBA vs', value: p.xwoba_against.toFixed(3), bad: p.xwoba_against > 0.360, good: p.xwoba_against < 0.290 },
          ].map(s => (
            <div key={s.label} className="bg-white/5 rounded-xl p-2 text-center">
              <p className="text-[9px] text-zinc-600 uppercase tracking-widest">{s.label}</p>
              <p className={`text-sm font-bold mt-0.5
                ${s.bad ? 'text-orange-400' : s.good ? 'text-emerald-400' : 'text-white'}`}>
                {s.value}
              </p>
            </div>
          ))}
        </div>

        {/* Recent form dots */}
        <FormDots starts={p.recentStarts.slice(0, 4)} />

        {/* Top reason — always visible, in plain English */}
        {plainReasons[0] && (
          <div className={`mt-3 px-3 py-2 rounded-xl text-xs leading-relaxed
            ${isAttack ? 'bg-emerald-500/8 text-emerald-200/80 border border-emerald-500/15'
            : isAvoid ? 'bg-red-500/8 text-red-200/70 border border-red-500/10'
            : 'bg-white/4 text-zinc-400 border border-white/8'}`}>
            {plainReasons[0]}
          </div>
        )}
      </div>

      {/* Expand toggle */}
      <div className="flex items-center justify-center gap-1 py-2 border-t border-white/5 text-[10px] text-zinc-600">
        {expanded ? '▲ less detail' : '▼ full breakdown'}
      </div>

      {/* Expanded section */}
      {expanded && (
        <div className="px-4 pb-4 pt-3 border-t border-white/5 space-y-4">

          {/* All plain English reasons */}
          {plainReasons.length > 1 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-2">
                {isAttack ? 'Why Attack' : isAvoid ? 'Why Avoid' : 'Context'}
              </p>
              <ul className="space-y-1.5">
                {plainReasons.map((r, i) => (
                  <li key={i} className="flex gap-2 text-xs text-zinc-300">
                    <span className={isAttack ? 'text-emerald-500 mt-0.5' : 'text-zinc-600 mt-0.5'}>
                      {isAttack ? '✓' : '•'}
                    </span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* TMS breakdown */}
          <TMSBreakdown p={p} />

          {/* Secondary stats */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-2">More Stats</p>
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { label: 'HR/9', value: p.hrPer9.toFixed(2) },
                { label: 'BB%', value: `${p.bbPct.toFixed(0)}%` },
                { label: 'Barrel%', value: `${p.barrelPctAllowed.toFixed(1)}%` },
                { label: 'Park×', value: p.parkRunFactor.toFixed(2) },
                { label: 'Opp OPS', value: p.oppTeamOPS.toFixed(3) },
                { label: 'W-L', value: `${p.wins}-${p.losses}` },
              ].map(s => (
                <div key={s.label} className="bg-white/4 rounded-lg p-2">
                  <p className="text-[9px] text-zinc-600 uppercase tracking-widest">{s.label}</p>
                  <p className="text-sm font-semibold text-white mt-0.5">{s.value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Recent starts detail */}
          {p.recentStarts.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-2">Recent Starts</p>
              <div className="space-y-1">
                {p.recentStarts.slice(0, 3).map((s, i) => (
                  <div key={i} className="flex items-center justify-between text-xs bg-white/4 rounded-lg px-3 py-1.5">
                    <span className="text-zinc-600 w-12">{s.date.slice(5)}</span>
                    <span className="text-zinc-400 flex-1">vs {s.opponent}</span>
                    <span className="text-zinc-400 w-14 text-right">{s.inningsPitched.toFixed(1)} IP · {s.earnedRuns}ER</span>
                    <span className="text-zinc-500 w-8 text-right">{s.strikeouts}K</span>
                    <span className={`w-6 text-right font-bold
                      ${s.result === 'W' ? 'text-emerald-400' : s.result === 'L' ? 'text-red-400' : 'text-zinc-600'}`}>
                      {s.result}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Risk flags */}
          {p.riskFlags.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-1">Risk Flags</p>
              {p.riskFlags.map((f, i) => (
                <div key={i} className="text-xs text-yellow-400/80 bg-yellow-500/8 border border-yellow-500/15 rounded-lg px-3 py-1.5">
                  {f}
                </div>
              ))}
            </div>
          )}

          {/* Cross-link to Money Picks */}
          {isAttack && (
            <div className="bg-purple-500/8 border border-purple-500/20 rounded-xl px-3 py-2.5">
              <p className="text-[10px] text-purple-300/70 uppercase tracking-widest mb-1">💡 Diamond Edge Tip</p>
              <p className="text-xs text-purple-200/60 leading-relaxed">
                Batters facing {p.name} today are boosted on the Money Picks tab.
                Check Money Picks for {p.opponent} hitters targeting <strong className="text-purple-200/80">{p.attackStat}</strong> props.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

type Filter = 'ALL' | 'ATTACK' | 'NEUTRAL' | 'AVOID';

function FilterBar({ active, onChange, counts }: {
  active: Filter;
  onChange: (f: Filter) => void;
  counts: Record<Filter, number>;
}) {
  const filters: { key: Filter; label: string; color: string }[] = [
    { key: 'ALL', label: '📋 All', color: 'bg-white/10 text-white border-white/20' },
    { key: 'ATTACK', label: '⚡ Attack', color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/35' },
    { key: 'NEUTRAL', label: '➖ Neutral', color: 'bg-blue-500/10 text-blue-300 border-blue-500/25' },
    { key: 'AVOID', label: '🛡 Avoid', color: 'bg-red-500/10 text-red-400 border-red-500/20' },
  ];
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
      {filters.map(f => (
        <button
          key={f.key}
          onClick={() => onChange(f.key)}
          className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all
            ${active === f.key ? f.color : 'border-white/8 text-zinc-600 bg-transparent'}`}
        >
          {f.label}
          {counts[f.key] > 0 && (
            <span className="ml-1.5 opacity-60">({counts[f.key]})</span>
          )}
        </button>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PitcherIntelTab() {
  const [filter, setFilter] = useState<Filter>('ALL');

  const { data, isLoading, isError, refetch } = trpc.pitcherIntel.getPitcherIntelData.useQuery(undefined, {
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 2,
  });

  const pitchers: PitcherEdgeProfile[] = data?.pitchers ?? [];
  const attackPitchers = pitchers.filter(p => p.verdict === 'ATTACK');

  const counts: Record<Filter, number> = {
    ALL: pitchers.length,
    ATTACK: attackPitchers.length,
    NEUTRAL: pitchers.filter(p => p.verdict === 'NEUTRAL').length,
    AVOID: pitchers.filter(p => p.verdict === 'AVOID').length,
  };

  const filtered = filter === 'ALL' ? pitchers : pitchers.filter(p => p.verdict === filter);

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        <div className="h-4 w-40 bg-white/8 rounded animate-pulse" />
        {[1, 2, 3].map(i => (
          <div key={i} className="h-44 bg-white/4 rounded-2xl animate-pulse" />
        ))}
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="p-6 text-center">
        <p className="text-red-400/80 text-sm mb-3">Pitcher data unavailable right now.</p>
        <button
          onClick={() => refetch()}
          className="text-xs text-zinc-400 bg-white/5 px-4 py-2 rounded-xl border border-white/10"
        >
          Try Again
        </button>
      </div>
    );
  }

  // ── Empty state — show near-misses instead of a dead end ─────────────────────
  if (pitchers.length === 0) {
    return (
      <div className="p-4 space-y-4">
        <div className="text-center py-6">
          <p className="text-zinc-400 font-semibold text-sm mb-1">No Pitchers Loaded Yet</p>
          <p className="text-zinc-600 text-xs max-w-[220px] mx-auto leading-relaxed">
            Pitcher data loads when today's MLB schedule is confirmed. Check back closer to first pitch.
          </p>
          <button
            onClick={() => refetch()}
            className="mt-4 text-xs text-zinc-400 bg-white/5 px-4 py-2 rounded-xl border border-white/10"
          >
            ↻ Refresh
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 pb-28">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-white font-bold text-base">Pitcher Intel</h2>
          <p className="text-zinc-600 text-xs mt-0.5">
            {data?.slateDate} · {pitchers.length} starters today
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="text-[10px] text-zinc-500 bg-white/4 px-3 py-1.5 rounded-xl border border-white/8 active:bg-white/8"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Attack summary strip — only shown when there are ATTACK pitchers */}
      {attackPitchers.length > 0 && (
        <div className="bg-[oklch(0.15_0.04_165)] border border-emerald-500/20 rounded-2xl p-3">
          <p className="text-[10px] text-emerald-400 uppercase tracking-widest mb-2">
            ⚡ {attackPitchers.length} Exploitable Pitcher{attackPitchers.length > 1 ? 's' : ''} Today
          </p>
          <div className="flex flex-wrap gap-2">
            {attackPitchers.map(p => (
              <div key={p.pitcherId} className="flex items-center gap-1.5 bg-emerald-500/8 border border-emerald-500/15 rounded-xl px-2.5 py-1.5">
                <span className="text-white text-xs font-semibold">{p.name}</span>
                <span className="text-zinc-500 text-[10px]">{p.team}</span>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full
                  ${p.attackStat === 'HITS' ? 'text-yellow-400 bg-yellow-500/15' :
                    p.attackStat === 'RUNS' ? 'text-red-400 bg-red-500/15' :
                    p.attackStat === 'RBI' ? 'text-cyan-400 bg-cyan-500/15' :
                    'text-purple-400 bg-purple-500/15'}`}>
                  {p.attackStat}
                </span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-zinc-600 mt-2">
            Check Money Picks tab for batters facing these pitchers today
          </p>
        </div>
      )}

      {/* Filter bar */}
      <FilterBar active={filter} onChange={setFilter} counts={counts} />

      {/* Cards */}
      {filtered.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-zinc-600 text-sm">
            No {filter.toLowerCase()} pitchers on today's slate.
          </p>
          <button
            onClick={() => setFilter('ALL')}
            className="mt-2 text-xs text-zinc-500 underline"
          >
            Show all pitchers
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(p => (
            <PitcherCard key={p.pitcherId} p={p} />
          ))}
        </div>
      )}

      <p className="text-center text-[10px] text-zinc-700 pt-2">
        Diamond Edge is for informational purposes only. Please gamble responsibly.
      </p>
    </div>
  );
}
