import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  Target,
  Loader2,
  Star,
  Brain,
  Zap,
  ChevronDown,
  ChevronUp,
  Info,
  CheckCircle2,
  BarChart3,
  Activity,
  Crosshair,
  Gauge,
} from "lucide-react";
import { useLocation } from "wouter";

// ─── Types ────────────────────────────────────────────────────────────────────
interface MatchupPlay {
  batter: { name: string; id: string; team: string; handedness: string };
  pitcher: { name: string; id: string; team: string };
  matchup: { vs: string };
  stats: { rc: number; hr: number; xb: number; oneB: number; bb: number; k: number };
  confidence: number;
  rank: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getConfidenceLevel(confidence: number) {
  if (confidence >= 85) return { label: "Elite", color: "text-emerald-400", bg: "bg-emerald-500/15", border: "border-emerald-500/30" };
  if (confidence >= 75) return { label: "Strong", color: "text-blue-400", bg: "bg-blue-500/15", border: "border-blue-500/30" };
  if (confidence >= 65) return { label: "Moderate", color: "text-amber-400", bg: "bg-amber-500/15", border: "border-amber-500/30" };
  return { label: "Watch", color: "text-slate-400", bg: "bg-slate-500/15", border: "border-slate-500/30" };
}

function getRCGrade(rc: number) {
  if (rc >= 35) return { grade: "A+", color: "text-emerald-400" };
  if (rc >= 28) return { grade: "A", color: "text-emerald-400" };
  if (rc >= 22) return { grade: "B+", color: "text-blue-400" };
  if (rc >= 18) return { grade: "B", color: "text-blue-400" };
  if (rc >= 15) return { grade: "C+", color: "text-amber-400" };
  return { grade: "C", color: "text-amber-400" };
}

function determinePropType(stats: MatchupPlay["stats"]): { type: string; line: number; reasoning: string } {
  const hitPotential = stats.oneB + stats.xb;
  const powerPotential = stats.hr + stats.xb;
  const runPotential = stats.bb + stats.oneB + stats.xb;

  if (hitPotential >= 18) {
    return { type: "HITS", line: 1.5, reasoning: `High contact rate (${stats.oneB} 1B + ${stats.xb} XBH expected). Strong plate discipline with ${stats.bb} BB rate.` };
  } else if (powerPotential >= 10) {
    return { type: "RBI", line: 1.5, reasoning: `Power profile (${stats.hr} HR + ${stats.xb} XBH). Drives in runs with extra-base authority.` };
  } else if (runPotential >= 20) {
    return { type: "RUNS", line: 0.5, reasoning: `Gets on base frequently (${stats.bb} BB + ${stats.oneB} 1B). High run-scoring probability.` };
  } else if (stats.hr >= 4) {
    return { type: "RBI", line: 0.5, reasoning: `Power threat (${stats.hr} HR rate). RBI upside in favorable matchup.` };
  } else {
    return { type: "HITS", line: 0.5, reasoning: `Contact-first approach (${stats.oneB} 1B). Solid hit probability vs this pitcher.` };
  }
}

// ─── Savant Metric Display ────────────────────────────────────────────────────
function SavantMetricCard({ icon: Icon, label, value, color, description }: {
  icon: any; label: string; value: string; color: string; description: string;
}) {
  return (
    <div className="text-center p-2 rounded-lg bg-slate-800/50 border border-slate-700/30 group relative">
      <div className="flex items-center justify-center gap-1 mb-0.5">
        <Icon size={10} style={{ color }} />
        <p className="text-[9px] text-slate-500 uppercase font-semibold">{label}</p>
      </div>
      <p className="text-sm font-bold" style={{ color }}>{value}</p>
      <p className="text-[8px] text-slate-600 mt-0.5">{description}</p>
    </div>
  );
}

// ─── Pick Card Component ──────────────────────────────────────────────────────
function PickCard({ pick, rank, savantData }: { pick: MatchupPlay; rank: number; savantData?: any }) {
  const [expanded, setExpanded] = useState(false);
  const [, navigate] = useLocation();
  const addFavoriteMutation = trpc.favorites.addFavorite.useMutation();
  const conf = getConfidenceLevel(pick.confidence);
  const rcGrade = getRCGrade(pick.stats.rc);
  const prop = determinePropType(pick.stats);

  const handleFavorite = () => {
    addFavoriteMutation.mutate({
      gameId: `ballpark_${pick.batter.id}`,
      playerId: parseInt(pick.batter.id) || rank,
      playerName: pick.batter.name,
      playerTeam: pick.batter.team,
      statType: prop.type.toLowerCase() as "hits" | "runs" | "rbi",
      prediction: "over",
      line: prop.line,
      confidence: pick.confidence,
      reasoning: prop.reasoning,
      gameDate: new Date(),
    });
  };

  return (
    <div className={`relative rounded-xl border ${conf.border} ${conf.bg} backdrop-blur-sm overflow-hidden transition-all duration-200 hover:shadow-lg hover:shadow-black/20`}>
      {/* Rank indicator */}
      <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-current opacity-60" style={{ color: conf.color.includes("emerald") ? "#34d399" : conf.color.includes("blue") ? "#60a5fa" : conf.color.includes("amber") ? "#fbbf24" : "#94a3b8" }} />

      <div className="p-5 pl-6">
        {/* Header Row */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${rank <= 3 ? "bg-amber-500/20 text-amber-400" : "bg-slate-700/50 text-slate-400"}`}>
              {rank}
            </div>
            <div>
              <h3 className="text-lg font-bold text-white leading-tight">{pick.batter.name}</h3>
              <p className="text-sm text-slate-400">
                {pick.batter.team} ({pick.batter.handedness}) vs {pick.pitcher.name} ({pick.matchup.vs})
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={`${conf.bg} ${conf.color} border ${conf.border} px-3 py-1 text-xs font-bold`}>
              {prop.type} O {prop.line}
            </Badge>
            <button
              onClick={handleFavorite}
              className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
            >
              <Star className="w-4 h-4 text-amber-400 hover:fill-amber-400 transition-colors" />
            </button>
          </div>
        </div>

        {/* Stats Row */}
        <div className="flex items-center gap-4 mb-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500 uppercase font-semibold">RC</span>
            <span className={`text-lg font-bold ${rcGrade.color}`}>{pick.stats.rc}</span>
            <span className={`text-xs font-bold ${rcGrade.color}`}>({rcGrade.grade})</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500 uppercase font-semibold">Conf</span>
            <span className={`text-lg font-bold ${conf.color}`}>{pick.confidence}%</span>
          </div>
          <div className="flex-1 h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${pick.confidence}%`,
                background: conf.color.includes("emerald") ? "#34d399" : conf.color.includes("blue") ? "#60a5fa" : conf.color.includes("amber") ? "#fbbf24" : "#94a3b8",
              }}
            />
          </div>
        </div>

        {/* Reasoning Preview */}
        <p className="text-sm text-slate-300 leading-relaxed mb-3">{prop.reasoning}</p>

        {/* Savant Quick Metrics (always visible) */}
        {savantData && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            <span className="text-[9px] px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 font-medium border border-blue-500/20">
              xwOBA {savantData.xwOBA.toFixed(3)}
            </span>
            <span className="text-[9px] px-2 py-0.5 rounded-md bg-orange-500/10 text-orange-400 font-medium border border-orange-500/20">
              HH% {savantData.hardHitPct.toFixed(0)}%
            </span>
            <span className="text-[9px] px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 font-medium border border-emerald-500/20">
              EV {savantData.exitVelocity.toFixed(0)} mph
            </span>
            <span className="text-[9px] px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-400 font-medium border border-purple-500/20">
              Barrel {savantData.barrelPct.toFixed(1)}%
            </span>
          </div>
        )}

        {/* Expand Button */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {expanded ? "Less" : "Full Analysis (Savant + Ballpark)"}
        </button>

        {/* Expanded Details */}
        {expanded && (
          <div className="mt-4 pt-4 border-t border-white/5 space-y-4">
            {/* Savant Statcast Section */}
            {savantData && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Activity size={12} className="text-blue-400" />
                  <span className="text-xs font-bold text-blue-400">SAVANT STATCAST</span>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  <SavantMetricCard icon={Crosshair} label="xwOBA" value={savantData.xwOBA.toFixed(3)} color="#60a5fa" description="Expected wOBA" />
                  <SavantMetricCard icon={Activity} label="HH%" value={`${savantData.hardHitPct.toFixed(0)}%`} color="#f97316" description="Hard Hit Rate" />
                  <SavantMetricCard icon={Gauge} label="EV" value={`${savantData.exitVelocity.toFixed(0)}`} color="#34d399" description="Exit Velocity" />
                  <SavantMetricCard icon={Target} label="Brl%" value={`${savantData.barrelPct.toFixed(1)}%`} color="#a78bfa" description="Barrel Rate" />
                  <SavantMetricCard icon={TrendingUp} label="xBA" value={savantData.xBA.toFixed(3)} color="#fbbf24" description="Expected BA" />
                  <SavantMetricCard icon={Zap} label="xSLG" value={savantData.xSLG.toFixed(3)} color="#f472b6" description="Expected SLG" />
                </div>
                {/* Savant Factors */}
                {savantData.savantFactors && savantData.savantFactors.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {savantData.savantFactors.map((factor: string, i: number) => (
                      <span key={i} className="text-[9px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-300 border border-violet-500/20">
                        {factor}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Diamond Edge Section */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 size={12} className="text-emerald-400" />
                <span className="text-xs font-bold text-emerald-400">BALLPARK.COM RC BREAKDOWN</span>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                <div className="text-center p-2 rounded-lg bg-slate-800/50">
                  <p className="text-[9px] text-slate-500 uppercase font-semibold">HR</p>
                  <p className="text-sm font-bold text-red-400">{pick.stats.hr}</p>
                </div>
                <div className="text-center p-2 rounded-lg bg-slate-800/50">
                  <p className="text-[9px] text-slate-500 uppercase font-semibold">XBH</p>
                  <p className="text-sm font-bold text-orange-400">{pick.stats.xb}</p>
                </div>
                <div className="text-center p-2 rounded-lg bg-slate-800/50">
                  <p className="text-[9px] text-slate-500 uppercase font-semibold">1B</p>
                  <p className="text-sm font-bold text-blue-400">{pick.stats.oneB}</p>
                </div>
                <div className="text-center p-2 rounded-lg bg-slate-800/50">
                  <p className="text-[9px] text-slate-500 uppercase font-semibold">BB</p>
                  <p className="text-sm font-bold text-green-400">{pick.stats.bb}</p>
                </div>
                <div className="text-center p-2 rounded-lg bg-slate-800/50">
                  <p className="text-[9px] text-slate-500 uppercase font-semibold">K</p>
                  <p className="text-sm font-bold text-slate-400">{pick.stats.k}</p>
                </div>
                <div className="text-center p-2 rounded-lg bg-slate-800/50">
                  <p className="text-[9px] text-slate-500 uppercase font-semibold">RC</p>
                  <p className={`text-sm font-bold ${rcGrade.color}`}>{pick.stats.rc}</p>
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-500 italic">
              Combined analysis: Savant Statcast measures quality of contact and expected outcomes. Diamond Edge VS Gate measures matchup-specific offensive production. Together they provide the most complete picture.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Props() {
  const [, navigate] = useLocation();
  const { data: aiData, isLoading } = trpc.aiPicks.getComprehensivePicks.useQuery();
  // Use aiPicks as the source of truth (replaces legacy trpc.ballpark.getTodayMatchups)
  const matchups = aiData?.picks ?? [];

  // Build a map of savant data by player name for quick lookup
  const savantMap = new Map<string, any>();
  if (aiData?.picks) {
    for (const pick of aiData.picks) {
      if (pick.savantMetrics) {
        savantMap.set(pick.playerName.toLowerCase(), pick.savantMetrics);
      }
    }
  }

  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(180deg, oklch(0.11 0.025 255) 0%, oklch(0.09 0.020 255) 100%)" }}>
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-gradient-to-br from-violet-500 to-blue-600 rounded-xl shadow-lg shadow-violet-500/20">
                <Brain className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">AI Predictions</h1>
                <p className="text-sm text-slate-400">Savant Statcast + Diamond Edge VS Gate analysis</p>
              </div>
            </div>
            <button
              onClick={() => navigate("/favorites")}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 transition-all text-sm font-medium"
            >
              <Star className="w-4 h-4" />
              My Plays
            </button>
          </div>

          {/* How it works - updated with Savant */}
          <div className="rounded-xl bg-slate-800/30 border border-slate-700/50 p-4">
            <div className="flex items-start gap-3">
              <Info className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
              <div className="text-sm text-slate-400 leading-relaxed">
                <span className="text-slate-300 font-medium">How it works:</span> We combine{" "}
                <span className="text-blue-400">Baseball Savant Statcast</span> data (xwOBA, Hard Hit%, EV, Barrel%) with{" "}
                <span className="text-emerald-400">Diamond Edge VS Gate</span> xwOBA matchup analysis to identify the strongest OVER props.
                Savant measures quality of contact; VS Gate scores pitcher suppression vs batter xwOBA.
              </div>
            </div>
          </div>
        </div>

        {/* Data Source Summary */}
        <div className="mb-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl bg-slate-800/30 border border-slate-700/50 p-3 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <Activity className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-[10px] text-slate-500 uppercase font-semibold">Savant</span>
            </div>
            <p className="text-xs font-bold text-white">Statcast</p>
          </div>
          <div className="rounded-xl bg-slate-800/30 border border-slate-700/50 p-3 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <BarChart3 className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-[10px] text-slate-500 uppercase font-semibold">VS Gate</span>
            </div>
            <p className="text-xs font-bold text-white">xwOBA</p>
          </div>
          <div className="rounded-xl bg-slate-800/30 border border-slate-700/50 p-3 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <Target className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-[10px] text-slate-500 uppercase font-semibold">Method</span>
            </div>
            <p className="text-xs font-bold text-white">Combined</p>
          </div>
          <div className="rounded-xl bg-slate-800/30 border border-slate-700/50 p-3 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-violet-400" />
              <span className="text-[10px] text-slate-500 uppercase font-semibold">Type</span>
            </div>
            <p className="text-xs font-bold text-white">OVERS</p>
          </div>
        </div>

        {/* Picks List */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" />
            Today's Picks
          </h2>
          <span className="text-xs text-slate-500">{matchups.length} picks analyzed</span>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-violet-400" />
            <p className="text-sm text-slate-400">Analyzing Savant + Diamond Edge VS Gate data...</p>
          </div>
        ) : matchups.length > 0 ? (
          <div className="space-y-3">
            {matchups.map((pick: any, idx: number) => {
              // Map aiPicks format to MatchupPlay format for PickCard
              const mappedPick: MatchupPlay = {
                batter: { name: pick.playerName, id: String(pick.playerId ?? idx), team: pick.teamName ?? '', handedness: pick.batsHand ?? 'R' },
                pitcher: { name: pick.pitcherName ?? 'TBD', id: String(pick.pitcherId ?? 0), team: pick.opponentTeam ?? '' },
                matchup: { vs: `${pick.batsHand ?? 'R'} vs ${pick.pitcherHand ?? 'R'}` },
                stats: { rc: pick.overallScore ?? 0, hr: 0, xb: 0, oneB: 0, bb: 0, k: 0 },
                confidence: pick.confidence ?? 0,
                rank: idx + 1,
              };
              const savantData = savantMap.get(pick.playerName?.toLowerCase());
              return (
                <PickCard
                  key={`${pick.playerId ?? idx}-${idx}`}
                  pick={mappedPick}
                  rank={idx + 1}
                  savantData={savantData}
                />
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl bg-slate-800/30 border border-slate-700/50 p-12 text-center">
            <Brain className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400 mb-1">No matchups available yet</p>
            <p className="text-sm text-slate-500">Check back closer to game time for today's picks</p>
          </div>
        )}

        {/* Footer note */}
        <div className="mt-8 text-center">
          <p className="text-xs text-slate-600">
            All predictions are OVER props only. Data from Baseball Savant Statcast + Diamond Edge matchup analysis. Refreshed daily.
          </p>
        </div>
      </div>
    </div>
  );
}
