/**
 * PitchersTab.tsx
 *
 * Diamond Edge — Pitchers Tab
 *
 * Shows today's starting pitchers ranked by exploitability.
 * Each card shows: verdict badge, key stats, recent form,
 * which stat to target, and risk flags.
 *
 * Connects to: trpc.pitcherIntel.getPitcherIntelData
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";

// ─── Types (mirror server) ────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function verdictColor(verdict: string) {
  if (verdict === 'ATTACK') return 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10';
  if (verdict === 'AVOID') return 'text-red-400 border-red-500/40 bg-red-500/10';
  return 'text-blue-300 border-blue-500/30 bg-blue-500/10';
}

function verdictIcon(verdict: string) {
  if (verdict === 'ATTACK') return '⚡';
  if (verdict === 'AVOID') return '🛡️';
  return '➖';
}

function statColor(stat: string) {
  if (stat === 'HITS') return 'text-yellow-400 bg-yellow-500/15';
  if (stat === 'RUNS') return 'text-red-400 bg-red-500/15';
  if (stat === 'RBI') return 'text-cyan-400 bg-cyan-500/15';
  return 'text-purple-400 bg-purple-500/15';
}

function formColor(form: string) {
  if (form === 'HOT') return 'text-orange-400';
  if (form === 'COLD') return 'text-blue-400';
  return 'text-zinc-400';
}

function formIcon(form: string) {
  if (form === 'HOT') return '🔥';
  if (form === 'COLD') return '🧊';
  return '➖';
}

function formatTime(iso: string) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET';
  } catch { return ''; }
}

function edgeBar(score: number) {
  const pct = Math.min(100, Math.max(0, score));
  const color =
    pct >= 65 ? 'bg-emerald-500' :
    pct <= 35 ? 'bg-red-500' : 'bg-blue-400';
  return (
    <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function RecentStartsRow({ starts }: { starts: PitcherRecentStart[] }) {
  return (
    <div className="mt-3 space-y-1">
      <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1.5">Last {starts.length} Starts</p>
      {starts.map((s, i) => (
        <div key={i} className="flex items-center justify-between text-xs text-zinc-300 bg-white/5 rounded px-2 py-1">
          <span className="text-zinc-500">{s.date.slice(5)}</span>
          <span>vs {s.opponent}</span>
          <span>{s.inningsPitched.toFixed(1)} IP</span>
          <span>{s.earnedRuns} ER</span>
          <span>{s.strikeouts}K</span>
          <span
            className={
              s.result === 'W' ? 'text-emerald-400 font-semibold' :
              s.result === 'L' ? 'text-red-400 font-semibold' : 'text-zinc-500'
            }
          >
            {s.result}
          </span>
        </div>
      ))}
    </div>
  );
}

function PitcherCard({ p }: { p: PitcherEdgeProfile }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`rounded-xl border transition-all duration-200 cursor-pointer
        ${p.verdict === 'ATTACK'
          ? 'border-emerald-500/30 bg-gradient-to-br from-emerald-950/40 to-zinc-900/80'
          : p.verdict === 'AVOID'
          ? 'border-red-500/20 bg-gradient-to-br from-red-950/30 to-zinc-900/80'
          : 'border-white/10 bg-zinc-900/60'
        }`}
      onClick={() => setExpanded(e => !e)}
    >
      {/* Header row */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          {/* Left: name + matchup */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-white text-base leading-tight">{p.name}</span>
              <span className="text-xs text-zinc-500 font-mono">{p.hand}HP</span>
              {p.recentForm !== 'NEUTRAL' && (
                <span className={`text-xs font-semibold ${formColor(p.recentForm)}`}>
                  {formIcon(p.recentForm)} {p.recentForm}
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              {p.team} vs {p.opponent} · {p.venueName} · {formatTime(p.gameTime)}
            </p>
          </div>

          {/* Right: verdict badge */}
          <div className={`shrink-0 px-2.5 py-1 rounded-lg border text-xs font-bold tracking-wide ${verdictColor(p.verdict)}`}>
            {verdictIcon(p.verdict)} {p.verdict}
          </div>
        </div>

        {/* Edge bar */}
        <div className="mt-3 flex items-center gap-2">
          <span className="text-[10px] text-zinc-500 uppercase tracking-widest w-14">Edge</span>
          <div className="flex-1">{edgeBar(p.edgeScore)}</div>
          <span className="text-xs font-mono text-zinc-300 w-8 text-right">{p.edgeScore}</span>
        </div>

        {/* Key stats row */}
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          {[
            { label: 'ERA', value: p.era.toFixed(2), highlight: p.era > 4.8 },
            { label: 'WHIP', value: p.whip.toFixed(2), highlight: p.whip > 1.40 },
            { label: 'K%', value: `${p.kPct.toFixed(0)}%`, highlight: p.kPct > 27 },
            { label: 'xwOBA', value: p.xwoba_against.toFixed(3), highlight: p.xwoba_against > 0.360 },
          ].map(stat => (
            <div key={stat.label} className="bg-white/5 rounded-lg p-2 text-center">
              <p className="text-[9px] text-zinc-500 uppercase tracking-widest">{stat.label}</p>
              <p className={`text-sm font-bold mt-0.5 ${stat.highlight ? 'text-orange-400' : 'text-white'}`}>
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        {/* Target stat pill */}
        {p.verdict === 'ATTACK' && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[10px] text-zinc-500 uppercase tracking-widest">Target Stat</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${statColor(p.attackStat)}`}>
              {p.attackStat === 'HRR' ? '⚡ H+R+RBI' :
               p.attackStat === 'HITS' ? '🎯 HITS OVER' :
               p.attackStat === 'RUNS' ? '🏃 RUNS OVER' : '💰 RBI OVER'}
            </span>
            <span className="text-xs text-zinc-500">vs {p.opponent}</span>
          </div>
        )}
      </div>

      {/* Expanded section */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-white/5 pt-3 space-y-3">

          {/* Reasoning */}
          {p.verdictReasoning.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1.5">
                {p.verdict === 'ATTACK' ? 'Why Attack' : p.verdict === 'AVOID' ? 'Why Avoid' : 'Context'}
              </p>
              <ul className="space-y-1">
                {p.verdictReasoning.map((r, i) => (
                  <li key={i} className="text-xs text-zinc-300 flex gap-1.5">
                    <span className="text-zinc-600 mt-0.5">•</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Secondary stats */}
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { label: 'HR/9', value: p.hrPer9.toFixed(2) },
              { label: 'BB%', value: `${p.bbPct.toFixed(0)}%` },
              { label: 'Barrel%', value: `${p.barrelPctAllowed.toFixed(1)}%` },
              { label: 'Park', value: p.parkRunFactor.toFixed(2) },
              { label: 'Opp OPS', value: p.oppTeamOPS.toFixed(3) },
              { label: 'IP', value: p.inningsPitched.toFixed(0) },
            ].map(s => (
              <div key={s.label} className="bg-white/5 rounded-lg p-2">
                <p className="text-[9px] text-zinc-500 uppercase tracking-widest">{s.label}</p>
                <p className="text-sm font-semibold text-white mt-0.5">{s.value}</p>
              </div>
            ))}
          </div>

          {/* Recent starts */}
          {p.recentStarts.length > 0 && <RecentStartsRow starts={p.recentStarts} />}

          {/* Risk flags */}
          {p.riskFlags.length > 0 && (
            <div className="space-y-1">
              {p.riskFlags.map((f, i) => (
                <p key={i} className="text-xs text-yellow-400/80 bg-yellow-500/10 rounded px-2 py-1">{f}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Expand hint */}
      <div className="px-4 pb-2 text-center">
        <span className="text-[10px] text-zinc-600">{expanded ? '▲ less' : '▼ details'}</span>
      </div>
    </div>
  );
}

// ─── Filter buttons ───────────────────────────────────────────────────────────

type Filter = 'ALL' | 'ATTACK' | 'NEUTRAL' | 'AVOID';

function FilterBar({ active, onChange, counts }: {
  active: Filter;
  onChange: (f: Filter) => void;
  counts: Record<Filter, number>;
}) {
  const filters: Filter[] = ['ALL', 'ATTACK', 'NEUTRAL', 'AVOID'];
  const colors: Record<Filter, string> = {
    ALL: 'bg-white/10 text-white',
    ATTACK: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40',
    NEUTRAL: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
    AVOID: 'bg-red-500/10 text-red-400 border-red-500/30',
  };
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {filters.map(f => (
        <button
          key={f}
          onClick={() => onChange(f)}
          className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all
            ${active === f
              ? (colors[f] + ' border-current')
              : 'border-white/10 text-zinc-500 bg-transparent'
            }`}
        >
          {f === 'ATTACK' ? '⚡' : f === 'AVOID' ? '🛡️' : f === 'NEUTRAL' ? '➖' : '📋'}{' '}
          {f} {counts[f] > 0 && <span className="ml-1 opacity-70">({counts[f]})</span>}
        </button>
      ))}
    </div>
  );
}

// ─── Main tab component ───────────────────────────────────────────────────────

export default function PitcherIntelTab() {
  const [filter, setFilter] = useState<Filter>('ALL');

  const { data, isLoading, isError, refetch } = trpc.pitcherIntel.getPitcherIntelData.useQuery(undefined, {
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 2,
  });

  const pitchers: PitcherEdgeProfile[] = data?.pitchers ?? [];

  const counts: Record<Filter, number> = {
    ALL: pitchers.length,
    ATTACK: pitchers.filter(p => p.verdict === 'ATTACK').length,
    NEUTRAL: pitchers.filter(p => p.verdict === 'NEUTRAL').length,
    AVOID: pitchers.filter(p => p.verdict === 'AVOID').length,
  };

  const filtered = filter === 'ALL' ? pitchers : pitchers.filter(p => p.verdict === filter);

  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        <div className="h-5 w-48 bg-white/10 rounded animate-pulse" />
        {[1, 2, 3].map(i => (
          <div key={i} className="h-40 bg-white/5 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6 text-center">
        <p className="text-red-400 text-sm">Failed to load pitcher data.</p>
        <button onClick={() => refetch()} className="mt-3 text-xs text-zinc-400 underline">
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 pb-24">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-white font-bold text-lg">Pitcher Intel</h2>
          <p className="text-zinc-500 text-xs">
            {data?.slateDate} · {pitchers.length} starters · Tap a card for details
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="text-xs text-zinc-400 bg-white/5 px-3 py-1.5 rounded-lg border border-white/10"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Top picks summary */}
      {(data?.topAttack?.length ?? 0) > 0 && (
        <div className="bg-emerald-950/40 border border-emerald-500/20 rounded-xl p-3">
          <p className="text-[10px] text-emerald-400 uppercase tracking-widest mb-2">⚡ Best Pitchers to Attack Today</p>
          <div className="flex flex-wrap gap-2">
            {(data?.topAttack ?? []).map(p => (
              <div key={p.pitcherId} className="flex items-center gap-1.5 bg-emerald-500/10 rounded-lg px-2.5 py-1.5">
                <span className="text-white text-xs font-semibold">{p.name}</span>
                <span className="text-zinc-500 text-xs">({p.team})</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${statColor(p.attackStat)}`}>
                  {p.attackStat}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter bar */}
      <FilterBar active={filter} onChange={setFilter} counts={counts} />

      {/* Pitcher cards */}
      {filtered.length === 0 ? (
        <div className="text-center py-10">
          <p className="text-zinc-500 text-sm">No {filter.toLowerCase()} pitchers on today's slate.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(p => (
            <PitcherCard key={p.pitcherId} p={p} />
          ))}
        </div>
      )}

      {/* Disclaimer */}
      <p className="text-center text-[10px] text-zinc-600 pt-2">
        Diamond Edge pitcher analysis is for informational purposes only. Please gamble responsibly.
      </p>
    </div>
  );
}
