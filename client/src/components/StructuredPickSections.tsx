/**
 * Structured Output Sections for Money Picks
 * Renders: Safe Plays, High Upside Ladders, Correlated Stacks,
 *          Game Environment Summary, Removed/Expired Plays
 */
import { useMemo } from "react";
import { Shield, TrendingUp, Zap, Target, X, BarChart2 } from "lucide-react";

interface PickLike {
  playerName: string;
  team: string;
  pitcherTeam: string;
  battingPosition: number;
  overallScore?: number;
  recommendedLine: number;
  recommendedProb: number;
  edge: number;
  riskFlags?: string[];
  reasons?: string[];
  gameTime?: string | null;
  gameTotalOU?: number | null;
  parkFactor?: number;
  isEarlyLocked?: boolean;
  pickStatus?: string;
}

interface RemovedPick {
  playerName: string;
  team: string;
  reason: string;
  removedAt?: string | null;
}

interface Props {
  picks: PickLike[];
  removedPicks?: RemovedPick[];
}

function isSameGame(a: PickLike, b: PickLike): boolean {
  return a.team === b.team || a.pitcherTeam === b.pitcherTeam ||
    (a.gameTime != null && b.gameTime != null && a.gameTime === b.gameTime);
}

// ── Safe Plays: high floor, low risk flags, edge > 0 ────────────────────────
function SafePlaysSection({ picks }: { picks: PickLike[] }) {
  const safePicks = useMemo(() =>
    picks
      .filter(p => (p.riskFlags?.length ?? 0) === 0 && p.edge >= 0 && (p.overallScore ?? 0) >= 68)
      .sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0))
      .slice(0, 3),
    [picks]
  );

  if (safePicks.length === 0) return null;

  return (
    <div className="rounded-2xl overflow-hidden border" style={{ background: "oklch(0.13 0.022 255)", borderColor: "oklch(0.72 0.18 165 / 20%)" }}>
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "oklch(1 0 0 / 6%)" }}>
        <Shield size={13} style={{ color: "oklch(0.72 0.18 165)" }} />
        <span className="text-xs font-bold tracking-widest uppercase" style={{ color: "oklch(0.72 0.18 165)" }}>Safest HRR Plays</span>
        <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded font-bold" style={{ background: "oklch(0.72 0.18 165 / 12%)", color: "oklch(0.72 0.18 165)" }}>LOW RISK</span>
      </div>
      <div className="divide-y" style={{ borderColor: "oklch(1 0 0 / 5%)" }}>
        {safePicks.map((p, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-2.5">
            <div className="text-[10px] font-bold w-4 text-center" style={{ color: "oklch(0.72 0.18 165)" }}>#{i + 1}</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white truncate">{p.playerName}</div>
              <div className="text-[10px] text-[oklch(0.45_0.015_255)]">{p.team} vs {p.pitcherTeam} · Bat #{p.battingPosition}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm font-bold" style={{ color: "oklch(0.72 0.18 165)" }}>HRR O {p.recommendedLine}</div>
              <div className="text-[10px] text-[oklch(0.50_0.015_255)]">{p.recommendedProb}% · {p.edge > 0 ? `+${p.edge}%` : `${p.edge}%`}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── High Upside Ladders: S-tier, high ceiling, may have risk flags ───────────
function HighUpsideSection({ picks }: { picks: PickLike[] }) {
  const highUpside = useMemo(() =>
    picks
      .filter(p => (p.overallScore ?? 0) >= 78 && p.edge >= 3)
      .sort((a, b) => (b.edge - a.edge) || ((b.overallScore ?? 0) - (a.overallScore ?? 0)))
      .slice(0, 3),
    [picks]
  );

  if (highUpside.length === 0) return null;

  return (
    <div className="rounded-2xl overflow-hidden border" style={{ background: "oklch(0.13 0.022 255)", borderColor: "oklch(0.82 0.17 85 / 20%)" }}>
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "oklch(1 0 0 / 6%)" }}>
        <Zap size={13} style={{ color: "oklch(0.82 0.17 85)" }} />
        <span className="text-xs font-bold tracking-widest uppercase" style={{ color: "oklch(0.82 0.17 85)" }}>High-Upside HRR Ladders</span>
        <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded font-bold" style={{ background: "oklch(0.82 0.17 85 / 12%)", color: "oklch(0.82 0.17 85)" }}>HIGH CEILING</span>
      </div>
      <div className="divide-y" style={{ borderColor: "oklch(1 0 0 / 5%)" }}>
        {highUpside.map((p, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-2.5">
            <div className="text-[10px] font-bold w-4 text-center" style={{ color: "oklch(0.82 0.17 85)" }}>#{i + 1}</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white truncate">{p.playerName}</div>
              <div className="text-[10px] text-[oklch(0.45_0.015_255)]">{p.team} vs {p.pitcherTeam}</div>
              {(p.riskFlags?.length ?? 0) > 0 && (
                <div className="text-[9px] mt-0.5" style={{ color: "oklch(0.68 0.22 25)" }}>
                  ⚠️ {p.riskFlags!.slice(0, 2).join(' · ')}
                </div>
              )}
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm font-bold" style={{ color: "oklch(0.82 0.17 85)" }}>HRR O {p.recommendedLine}</div>
              <div className="text-[10px]" style={{ color: "oklch(0.82 0.17 85)" }}>+{p.edge}% edge</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Correlated Stacks: 2+ picks from same game ───────────────────────────────
function StacksSection({ picks }: { picks: PickLike[] }) {
  const stacks = useMemo(() => {
    const gameMap = new Map<string, PickLike[]>();
    picks.forEach(p => {
      const key = `${p.team}|${p.pitcherTeam}|${p.gameTime ?? ''}`;
      if (!gameMap.has(key)) gameMap.set(key, []);
      gameMap.get(key)!.push(p);
    });
    return Array.from(gameMap.entries())
      .filter(([, players]) => players.length >= 2)
      .map(([, players]) => players.sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0)));
  }, [picks]);

  if (stacks.length === 0) return null;

  return (
    <div className="rounded-2xl overflow-hidden border" style={{ background: "oklch(0.13 0.022 255)", borderColor: "oklch(0.72 0.10 220 / 20%)" }}>
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "oklch(1 0 0 / 6%)" }}>
        <Target size={13} style={{ color: "oklch(0.72 0.10 220)" }} />
        <span className="text-xs font-bold tracking-widest uppercase" style={{ color: "oklch(0.72 0.10 220)" }}>Best Correlated HRR Stacks</span>
        <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded font-bold" style={{ background: "oklch(0.72 0.10 220 / 12%)", color: "oklch(0.72 0.10 220)" }}>CORRELATED</span>
      </div>
      <div className="divide-y" style={{ borderColor: "oklch(1 0 0 / 5%)" }}>
        {stacks.map((players, si) => (
          <div key={si} className="px-4 py-2.5">
            <div className="text-[9px] font-bold tracking-widest uppercase mb-1.5" style={{ color: "oklch(0.72 0.10 220)" }}>
              {players[0].team} Stack · {players.length} plays
              {players[0].gameTotalOU != null && <span className="ml-2 text-[oklch(0.45_0.015_255)]">O/U {players[0].gameTotalOU}</span>}
            </div>
            <div className="space-y-1">
              {players.map((p, pi) => (
                <div key={pi} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-[oklch(0.45_0.015_255)] w-4">#{p.battingPosition}</span>
                    <span className="text-xs font-semibold text-white">{p.playerName}</span>
                  </div>
                  <span className="text-[10px] font-bold" style={{ color: "oklch(0.72 0.10 220)" }}>HRR O {p.recommendedLine}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Game Environment Summary ─────────────────────────────────────────────────
function GameEnvironmentSection({ picks }: { picks: PickLike[] }) {
  const gameEnvs = useMemo(() => {
    const seen = new Set<string>();
    return picks
      .filter(p => {
        const key = `${p.team}|${p.pitcherTeam}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(p => {
        const ou = p.gameTotalOU;
        const pf = p.parkFactor ?? 1.0;
        let grade = 'C';
        let gradeColor = 'oklch(0.68 0.22 25)';
        let envLabel = 'Pitcher Leaning';
        let score = 0;
        if (ou != null) {
          if (ou >= 10) score += 3;
          else if (ou >= 9) score += 2;
          else if (ou >= 8) score += 1;
          else if (ou < 7) score -= 1;
        }
        if (pf >= 1.10) score += 2;
        else if (pf >= 1.05) score += 1;
        else if (pf <= 0.90) score -= 2;
        else if (pf <= 0.95) score -= 1;
        if (score >= 5) { grade = 'A+'; gradeColor = 'oklch(0.82 0.17 85)'; envLabel = 'Elite HR Environment'; }
        else if (score >= 3) { grade = 'A'; gradeColor = 'oklch(0.72 0.18 165)'; envLabel = 'Strong Offense Env'; }
        else if (score >= 1) { grade = 'B'; gradeColor = 'oklch(0.72 0.10 220)'; envLabel = 'Neutral Environment'; }
        else if (score >= -1) { grade = 'C'; gradeColor = 'oklch(0.68 0.22 25)'; envLabel = 'Pitcher Leaning'; }
        else { grade = 'D'; gradeColor = 'oklch(0.55 0.015 255)'; envLabel = 'Poor Offense Env'; }
        return { team: p.team, opponent: p.pitcherTeam, ou, pf, grade, gradeColor, envLabel };
      });
  }, [picks]);

  if (gameEnvs.length === 0) return null;

  return (
    <div className="rounded-2xl overflow-hidden border" style={{ background: "oklch(0.13 0.022 255)", borderColor: "oklch(1 0 0 / 8%)" }}>
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "oklch(1 0 0 / 6%)" }}>
        <BarChart2 size={13} style={{ color: "oklch(0.55 0.015 255)" }} />
        <span className="text-xs font-bold tracking-widest uppercase text-[oklch(0.55_0.015_255)]">Game Environment Grades</span>
      </div>
      <div className="divide-y" style={{ borderColor: "oklch(1 0 0 / 5%)" }}>
        {gameEnvs.map((env, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-2.5">
            <div className="text-xl font-black w-8 shrink-0" style={{ color: env.gradeColor }}>{env.grade}</div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-white">{env.team} vs {env.opponent}</div>
              <div className="text-[9px] text-[oklch(0.45_0.015_255)]">{env.envLabel}</div>
            </div>
            <div className="text-right shrink-0 text-[9px] text-[oklch(0.45_0.015_255)]">
              {env.ou != null && <div>O/U {env.ou}</div>}
              {env.pf !== 1.0 && <div>Park {((env.pf - 1) * 100).toFixed(0)}%</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Removed / Expired Plays ──────────────────────────────────────────────────
function RemovedPlaysSection({ removedPicks }: { removedPicks: RemovedPick[] }) {
  if (removedPicks.length === 0) return null;

  return (
    <div className="rounded-2xl overflow-hidden border opacity-70" style={{ background: "oklch(0.12 0.018 255)", borderColor: "oklch(0.68 0.22 25 / 20%)" }}>
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "oklch(1 0 0 / 6%)" }}>
        <X size={13} style={{ color: "oklch(0.68 0.22 25)" }} />
        <span className="text-xs font-bold tracking-widest uppercase" style={{ color: "oklch(0.68 0.22 25)" }}>Removed / Expired Plays</span>
        <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded font-bold" style={{ background: "oklch(0.68 0.22 25 / 10%)", color: "oklch(0.68 0.22 25)" }}>{removedPicks.length}</span>
      </div>
      <div className="divide-y" style={{ borderColor: "oklch(1 0 0 / 5%)" }}>
        {removedPicks.map((p, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-2.5">
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-[oklch(0.55_0.015_255)] line-through truncate">{p.playerName}</div>
              <div className="text-[9px] text-[oklch(0.40_0.015_255)]">{p.team}</div>
            </div>
            <div className="text-[9px] text-right shrink-0" style={{ color: "oklch(0.68 0.22 25)" }}>
              {p.reason}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main export ──────────────────────────────────────────────────────────────
export function StructuredPickSections({ picks, removedPicks = [] }: Props) {
  return (
    <div className="space-y-3 mt-2">
      <SafePlaysSection picks={picks} />
      <HighUpsideSection picks={picks} />
      <StacksSection picks={picks} />
      <GameEnvironmentSection picks={picks} />
      <RemovedPlaysSection removedPicks={removedPicks} />
    </div>
  );
}
