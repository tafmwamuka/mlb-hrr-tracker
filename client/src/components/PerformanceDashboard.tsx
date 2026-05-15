/**
 * Performance Dashboard — Diamond Edge
 * Shows model hit rates, ROI tracking, and results transparency.
 */

import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { TrendingUp, Target, BarChart3, Shield, Award, Zap } from "lucide-react";

function StatBar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="h-2 rounded-full overflow-hidden" style={{ background: "oklch(0.20 0.02 255)" }}>
      <motion.div
        className="h-full rounded-full"
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        style={{ background: color }}
      />
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
  color,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
  icon: React.ElementType;
}) {
  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-2"
      style={{ background: "oklch(0.14 0.022 255)", border: "1px solid oklch(1 0 0 / 8%)" }}
    >
      <div className="flex items-center gap-2">
        <Icon size={14} style={{ color }} />
        <span className="text-[10px] font-bold tracking-widest uppercase text-[oklch(0.45_0.015_255)]">{label}</span>
      </div>
      <div className="text-3xl font-bold font-stat" style={{ color }}>{value}</div>
      {sub && <div className="text-[10px] text-[oklch(0.45_0.015_255)]">{sub}</div>}
    </div>
  );
}

export function PerformanceDashboard() {
  const { data: stats, isLoading: statsLoading } = trpc.results.getHitRateStats.useQuery(undefined, {
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const { data: yesterday } = trpc.results.getYesterdayResults.useQuery(undefined, {
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });

  if (statsLoading) {
    return (
      <div className="p-4 space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="animate-pulse h-24 rounded-2xl" style={{ background: "oklch(0.14 0.022 255)" }} />
        ))}
      </div>
    );
  }

  const s = stats?.stats;
  const overallRate = s?.overallHitRate ?? 0;
  const totalPredictions = s?.totalPredictions ?? 0;
  const totalHits = s?.totalHits ?? 0;
  const hitsRate = (s?.byStatType as any)?.hits ?? 0;
  const runsRate = (s?.byStatType as any)?.runs ?? 0;
  const rbiRate = (s?.byStatType as any)?.rbi ?? 0;

  const rateColor = overallRate >= 65 ? "oklch(0.72 0.18 165)" : overallRate >= 50 ? "oklch(0.82 0.17 85)" : "oklch(0.68 0.22 25)";

  return (
    <div className="p-4 space-y-4 pb-32">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <BarChart3 size={16} style={{ color: "oklch(0.72 0.18 165)" }} />
        <h2 className="text-white font-bold text-base tracking-tight" style={{ fontFamily: "'Inter', sans-serif" }}>
          Performance Dashboard
        </h2>
      </div>
      <p className="text-[10px] text-[oklch(0.45_0.015_255)] -mt-2">
        All-time model accuracy — updated after each game day
      </p>

      {/* Key metrics grid */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          label="Overall Hit Rate"
          value={totalPredictions > 0 ? `${overallRate}%` : "—"}
          sub={totalPredictions > 0 ? `${totalHits}/${totalPredictions} plays hit` : "No data yet"}
          color={rateColor}
          icon={Target}
        />
        <MetricCard
          label="Yesterday"
          value={yesterday?.hasActuals ? `${yesterday.hitRate}%` : "—"}
          sub={yesterday?.hasActuals ? `${yesterday.totalHits}/${yesterday.totalWithActuals ?? yesterday.totalPlays} plays` : "No results yet"}
          color={yesterday?.hasActuals && (yesterday.hitRate ?? 0) >= 60 ? "oklch(0.72 0.18 165)" : "oklch(0.82 0.17 85)"}
          icon={TrendingUp}
        />
      </div>

      {/* Stat-type breakdown */}
      {totalPredictions > 0 && (
        <div
          className="rounded-2xl p-4"
          style={{ background: "oklch(0.14 0.022 255)", border: "1px solid oklch(1 0 0 / 8%)" }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Zap size={13} style={{ color: "oklch(0.82 0.17 85)" }} />
            <span className="text-[10px] font-bold tracking-widest uppercase text-[oklch(0.45_0.015_255)]">Hit Rate by Stat Type</span>
          </div>
          <div className="space-y-3">
            {[
              { label: "Hits (H)", rate: hitsRate, color: "oklch(0.82 0.17 85)" },
              { label: "Runs (R)", rate: runsRate, color: "oklch(0.68 0.22 25)" },
              { label: "RBI", rate: rbiRate, color: "oklch(0.72 0.18 165)" },
            ].map(({ label, rate, color }) => (
              <div key={label}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-semibold text-[oklch(0.55_0.015_255)]">{label}</span>
                  <span className="text-[10px] font-bold" style={{ color }}>{rate > 0 ? `${rate}%` : "—"}</span>
                </div>
                {rate > 0 && <StatBar value={rate} color={color} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tier performance (informational) */}
      <div
        className="rounded-2xl p-4"
        style={{ background: "oklch(0.14 0.022 255)", border: "1px solid oklch(1 0 0 / 8%)" }}
      >
        <div className="flex items-center gap-2 mb-3">
          <Award size={13} style={{ color: "oklch(0.82 0.17 85)" }} />
          <span className="text-[10px] font-bold tracking-widest uppercase text-[oklch(0.45_0.015_255)]">Tier System</span>
        </div>
        <div className="space-y-2">
          {[
            { tier: "S", label: "S Tier (83+)", desc: "Highest confidence — model's strongest plays", color: "oklch(0.82 0.17 85)" },
            { tier: "A", label: "A Tier (74–82)", desc: "Strong plays — solid edge with favorable conditions", color: "oklch(0.72 0.18 165)" },
            { tier: "B", label: "Lean (68–73)", desc: "Borderline plays — informational, lower confidence", color: "oklch(0.72 0.10 220)" },
          ].map(({ tier, label, desc, color }) => (
            <div key={tier} className="flex items-start gap-3">
              <div
                className="w-7 h-7 rounded-lg shrink-0 flex items-center justify-center font-stat font-bold text-xs"
                style={{ background: `${color}15`, border: `1px solid ${color}40`, color }}
              >
                {tier}
              </div>
              <div>
                <div className="text-[11px] font-bold text-white">{label}</div>
                <div className="text-[9px] text-[oklch(0.45_0.015_255)] leading-tight">{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Transparency statement */}
      <div
        className="rounded-2xl p-4"
        style={{ background: "oklch(0.13 0.022 255)", border: "1px solid oklch(1 0 0 / 6%)" }}
      >
        <div className="flex items-start gap-2">
          <Shield size={13} className="mt-0.5 shrink-0" style={{ color: "oklch(0.72 0.18 165)" }} />
          <div>
            <div className="text-[10px] font-bold text-white mb-1">Model Transparency</div>
            <p className="text-[9px] text-[oklch(0.45_0.015_255)] leading-relaxed">
              Diamond Edge uses a 10-factor Poisson model combining Statcast xwOBA, rolling contact metrics,
              projected plate appearances, pitcher matchup, park factors, weather, bullpen fatigue, and betting edge.
              Results are tracked automatically from MLB boxscores. All picks are pre-game projections — actual outcomes
              depend on game conditions. Always bet responsibly.
            </p>
          </div>
        </div>
      </div>

      {/* No data state */}
      {totalPredictions === 0 && (
        <div className="text-center py-8">
          <BarChart3 size={32} className="mx-auto mb-3" style={{ color: "oklch(0.35 0.015 255)" }} />
          <p className="text-[oklch(0.45_0.015_255)] text-sm font-semibold">No historical data yet</p>
          <p className="text-[oklch(0.35_0.015_255)] text-xs mt-1">Results will appear here after game days complete</p>
        </div>
      )}
    </div>
  );
}
