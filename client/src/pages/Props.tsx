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
  // Determine best prop based on RC breakdown
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
    return { type: "HITS", line: 0.5, reasoning: `Contact-first approach (${stats.oneB} 1B). Solid hit probability vs ${stats.k < 20 ? "low-K" : "this"} pitcher.` };
  }
}

// ─── Pick Card Component ──────────────────────────────────────────────────────
function PickCard({ pick, rank }: { pick: MatchupPlay; rank: number }) {
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
            {/* Rank Badge */}
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${rank <= 3 ? "bg-amber-500/20 text-amber-400" : "bg-slate-700/50 text-slate-400"}`}>
              {rank}
            </div>
            {/* Player Info */}
            <div>
              <h3 className="text-lg font-bold text-white leading-tight">{pick.batter.name}</h3>
              <p className="text-sm text-slate-400">
                {pick.batter.team} ({pick.batter.handedness}) vs {pick.pitcher.name} ({pick.matchup.vs})
              </p>
            </div>
          </div>

          {/* Prop Badge */}
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
          {/* RC Score */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500 uppercase font-semibold">RC</span>
            <span className={`text-lg font-bold ${rcGrade.color}`}>{pick.stats.rc}</span>
            <span className={`text-xs font-bold ${rcGrade.color}`}>({rcGrade.grade})</span>
          </div>
          {/* Confidence */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500 uppercase font-semibold">Conf</span>
            <span className={`text-lg font-bold ${conf.color}`}>{pick.confidence}%</span>
          </div>
          {/* Confidence bar */}
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

        {/* Expand Button */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {expanded ? "Less" : "Ballpark Breakdown"}
        </button>

        {/* Expanded Details */}
        {expanded && (
          <div className="mt-4 pt-4 border-t border-white/5">
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
              <div className="text-center p-2 rounded-lg bg-slate-800/50">
                <p className="text-[10px] text-slate-500 uppercase font-semibold">HR</p>
                <p className="text-sm font-bold text-red-400">{pick.stats.hr}</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-slate-800/50">
                <p className="text-[10px] text-slate-500 uppercase font-semibold">XBH</p>
                <p className="text-sm font-bold text-orange-400">{pick.stats.xb}</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-slate-800/50">
                <p className="text-[10px] text-slate-500 uppercase font-semibold">1B</p>
                <p className="text-sm font-bold text-blue-400">{pick.stats.oneB}</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-slate-800/50">
                <p className="text-[10px] text-slate-500 uppercase font-semibold">BB</p>
                <p className="text-sm font-bold text-green-400">{pick.stats.bb}</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-slate-800/50">
                <p className="text-[10px] text-slate-500 uppercase font-semibold">K</p>
                <p className="text-sm font-bold text-slate-400">{pick.stats.k}</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-slate-800/50">
                <p className="text-[10px] text-slate-500 uppercase font-semibold">RC</p>
                <p className={`text-sm font-bold ${rcGrade.color}`}>{pick.stats.rc}</p>
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-3 italic">
              Data sourced from ballpark.com — RC (Runs Created) measures overall offensive contribution in this specific matchup.
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
  const { data: matchups, isLoading } = trpc.ballpark.getTodayMatchups.useQuery();

  return (
    <div className="min-h-screen bg-gradient-to-b from-[oklch(0.11_0.025_255)] to-[oklch(0.09_0.020_255)]">
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
                <p className="text-sm text-slate-400">Powered by ballpark.com matchup data</p>
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

          {/* How it works - compact */}
          <div className="rounded-xl bg-slate-800/30 border border-slate-700/50 p-4">
            <div className="flex items-start gap-3">
              <Info className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
              <div className="text-sm text-slate-400 leading-relaxed">
                <span className="text-slate-300 font-medium">How it works:</span> We analyze today's batter vs pitcher matchups from{" "}
                <span className="text-blue-400">ballpark.com</span>, ranking them by{" "}
                <span className="text-emerald-400 font-medium">Runs Created (RC)</span> — a composite stat measuring expected offensive output. Each pick includes the optimal OVER prop based on the player's contact, power, and plate discipline profile.
              </div>
            </div>
          </div>
        </div>

        {/* Performance Summary */}
        <div className="mb-6 grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-slate-800/30 border border-slate-700/50 p-3 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <BarChart3 className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-[10px] text-slate-500 uppercase font-semibold">Source</span>
            </div>
            <p className="text-sm font-bold text-white">Ballpark.com</p>
          </div>
          <div className="rounded-xl bg-slate-800/30 border border-slate-700/50 p-3 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <Target className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-[10px] text-slate-500 uppercase font-semibold">Method</span>
            </div>
            <p className="text-sm font-bold text-white">RC Ranked</p>
          </div>
          <div className="rounded-xl bg-slate-800/30 border border-slate-700/50 p-3 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-[10px] text-slate-500 uppercase font-semibold">Type</span>
            </div>
            <p className="text-sm font-bold text-white">OVERS Only</p>
          </div>
        </div>

        {/* Picks List */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" />
            Today's Top Picks
          </h2>
          <span className="text-xs text-slate-500">{matchups?.length || 0} matchups analyzed</span>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-violet-400" />
            <p className="text-sm text-slate-400">Analyzing today's matchups...</p>
          </div>
        ) : matchups && matchups.length > 0 ? (
          <div className="space-y-3">
            {matchups.map((pick: MatchupPlay) => (
              <PickCard key={`${pick.batter.id}-${pick.rank}`} pick={pick} rank={pick.rank} />
            ))}
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
            All predictions are OVER props only. Data refreshed daily from ballpark.com matchup analysis.
          </p>
        </div>
      </div>
    </div>
  );
}
