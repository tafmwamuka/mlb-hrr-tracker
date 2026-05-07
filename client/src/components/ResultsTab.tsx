import { Trophy, TrendingUp, Zap, Target, CheckCircle, XCircle, Clock, AlertCircle, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { SaferPlayTip } from "@/components/SaferPlayTip";

const STAT_CONFIG = {
  hits: { label: "Hits", icon: TrendingUp, color: "oklch(0.82_0.17_85)" },
  runs: { label: "Runs", icon: Zap, color: "oklch(0.68_0.22_25)" },
  rbi: { label: "RBI", icon: Target, color: "oklch(0.72_0.18_165)" },
};

export function ResultsTab() {
  const { data: resultsData, isLoading } = trpc.results.getYesterdayResults.useQuery();
  const { data: statsData } = trpc.results.getHitRateStats.useQuery();

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <motion.div
            className="w-12 h-12 rounded-full border-2 border-transparent border-t-[oklch(0.68_0.22_25)] mx-auto mb-4"
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          />
          <div className="animate-pulse text-[oklch(0.50_0.015_255)]">Loading yesterday's results...</div>
        </div>
      </div>
    );
  }

  const results = resultsData?.results || [];
  const hasActuals = resultsData?.hasActuals || false;
  const hitRate = resultsData?.hitRate || 0;
  const dateStr = resultsData?.date || "";

  // Format date for display
  const formatDate = (dateStr: string) => {
    if (!dateStr) return "Yesterday";
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  };

  if (!resultsData?.success || results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <Trophy size={48} className="text-[oklch(0.40_0.015_255)] mb-3" />
        <p className="text-[oklch(0.50_0.015_255)] text-center text-sm mb-2">
          No predictions found for yesterday
        </p>
        <p className="text-[oklch(0.35_0.015_255)] text-center text-xs max-w-[280px]">
          AI picks are stored daily by the scheduled task. Results will appear here the next morning after games are played.
        </p>
      </div>
    );
  }

  // Sort results by stat priority: Hits > Runs > RBI (RBI is riskiest)
  const STAT_PRIORITY: Record<string, number> = { hits: 3, runs: 2, rbi: 1 };
  const sortedResults = [...results].sort((a: any, b: any) => {
    return (STAT_PRIORITY[b.statType] || 0) - (STAT_PRIORITY[a.statType] || 0);
  });

  // Separate results into resolved (have actuals) and pending
  const resolvedResults = sortedResults.filter((r: any) => r.actualValue !== null);
  const pendingResults = sortedResults.filter((r: any) => r.actualValue === null);
  const hitCount = resolvedResults.filter((r: any) => r.hit === true).length;

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 pb-6">
      <SaferPlayTip />

      {/* Summary Card */}
      <motion.div
        className="mb-5 rounded-xl p-4 border"
        style={{
          background: "linear-gradient(135deg, oklch(0.82_0.17_85/10%), oklch(0.72_0.18_165/10%))",
          borderColor: "oklch(0.82_0.17_85/30%)",
        }}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-lg font-bold text-white mb-1">Yesterday's Picks</h3>
            <p className="text-sm text-[oklch(0.50_0.015_255)]">{formatDate(dateStr)}</p>
          </div>
          <div className="text-right">
            {hasActuals ? (
              <>
                <div className="text-3xl font-bold text-[oklch(0.82_0.17_85)]">{hitRate}%</div>
                <div className="text-xs text-[oklch(0.50_0.015_255)]">Hit Rate</div>
              </>
            ) : (
              <>
                <div className="text-2xl font-bold text-[oklch(0.60_0.10_85)]">--</div>
                <div className="text-xs text-[oklch(0.50_0.015_255)]">Pending</div>
              </>
            )}
          </div>
        </div>

        {/* Hit rate bar */}
        {hasActuals && (
          <div className="w-full bg-[oklch(1_0_0/8%)] rounded-full h-3 overflow-hidden mb-3">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-[oklch(0.82_0.17_85)] to-[oklch(0.72_0.18_165)]"
              initial={{ width: 0 }}
              animate={{ width: `${hitRate}%` }}
              transition={{ delay: 0.2, duration: 0.8 }}
            />
          </div>
        )}

        <div className="flex items-center justify-between text-xs text-[oklch(0.50_0.015_255)]">
          <span>
            {hasActuals
              ? `${hitCount} of ${resolvedResults.length} plays hit`
              : `${results.length} predictions made • awaiting game results`}
          </span>
          {pendingResults.length > 0 && hasActuals && (
            <span className="text-[oklch(0.60_0.10_85)]">
              {pendingResults.length} pending
            </span>
          )}
        </div>
      </motion.div>

      {/* Overall Stats Card (if we have historical data) */}
      {statsData?.success && statsData.stats.totalPredictions > 0 && (
        <motion.div
          className="mb-5 rounded-xl p-3 border border-[oklch(1_0_0/10%)] bg-[oklch(0.14_0.022_255)]"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <h4 className="text-xs font-bold text-[oklch(0.50_0.015_255)] uppercase tracking-wider mb-2">
            All-Time Stats
          </h4>
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center">
              <div className="text-lg font-bold text-white">{statsData.stats.overallHitRate}%</div>
              <div className="text-[10px] text-[oklch(0.40_0.015_255)]">Overall</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-white">{statsData.stats.totalPredictions}</div>
              <div className="text-[10px] text-[oklch(0.40_0.015_255)]">Total Picks</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-white">{statsData.stats.last7Days}%</div>
              <div className="text-[10px] text-[oklch(0.40_0.015_255)]">Last 7 Days</div>
            </div>
          </div>
          {/* Per-stat breakdown */}
          <div className="flex gap-3 mt-2 pt-2 border-t border-[oklch(1_0_0/6%)]">
            {(["hits", "runs", "rbi"] as const).map((stat) => {
              const cfg = STAT_CONFIG[stat];
              const rate = statsData.stats.byStatType[stat];
              return (
                <div key={stat} className="flex items-center gap-1 text-xs">
                  <div className="w-2 h-2 rounded-full" style={{ background: cfg.color }} />
                  <span className="text-[oklch(0.50_0.015_255)]">{cfg.label}:</span>
                  <span className="font-bold text-white">{rate}%</span>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Resolved Results */}
      {resolvedResults.length > 0 && (
        <div className="space-y-2 mb-5">
          <h4 className="text-sm font-bold text-white px-1 mb-2 flex items-center gap-2">
            <CheckCircle size={14} className="text-[oklch(0.72_0.18_165)]" />
            Completed ({resolvedResults.length})
          </h4>
          {resolvedResults.map((play: any, idx: number) => {
            const statConfig = STAT_CONFIG[play.stat as keyof typeof STAT_CONFIG];
            const Icon = statConfig.icon;

            return (
              <motion.div
                key={`${play.id}-${play.stat}`}
                className="rounded-lg p-3 border"
                style={{
                  background: play.hit ? "oklch(0.72_0.18_165/8%)" : "oklch(0.68_0.22_25/8%)",
                  borderColor: play.hit ? "oklch(0.72_0.18_165/25%)" : "oklch(0.68_0.22_25/25%)",
                }}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.04 }}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Icon size={14} style={{ color: statConfig.color }} />
                      <span className="font-bold text-white text-sm">{play.playerName}</span>
                    </div>
                    <div className="text-xs text-[oklch(0.50_0.015_255)]">
                      {play.stat.toUpperCase()} OVER {play.line}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {play.hit ? (
                      <div className="flex items-center gap-1 bg-[oklch(0.72_0.18_165/15%)] rounded-full px-2 py-0.5">
                        <CheckCircle size={14} className="text-[oklch(0.72_0.18_165)]" />
                        <span className="text-xs font-bold text-[oklch(0.72_0.18_165)]">HIT</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 bg-[oklch(0.68_0.22_25/15%)] rounded-full px-2 py-0.5">
                        <XCircle size={14} className="text-[oklch(0.68_0.22_25)]" />
                        <span className="text-xs font-bold text-[oklch(0.68_0.22_25)]">MISS</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Result details */}
                <div className="flex items-center gap-2 text-xs">
                  <div className="bg-[oklch(1_0_0/5%)] rounded px-2 py-1">
                    <span className="text-[oklch(0.45_0.015_255)]">Line:</span>
                    <span className="font-bold text-white ml-1">{play.line}</span>
                  </div>
                  <div className="bg-[oklch(1_0_0/5%)] rounded px-2 py-1">
                    <span className="text-[oklch(0.45_0.015_255)]">Actual:</span>
                    <span
                      className="font-bold ml-1"
                      style={{ color: play.hit ? "oklch(0.72_0.18_165)" : "oklch(0.68_0.22_25)" }}
                    >
                      {play.actualValue}
                    </span>
                  </div>
                  <div className="bg-[oklch(1_0_0/5%)] rounded px-2 py-1">
                    <span className="text-[oklch(0.45_0.015_255)]">Conf:</span>
                    <span className="font-bold text-white ml-1">{play.confidence}%</span>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Pending Results */}
      {pendingResults.length > 0 && (
        <div className="space-y-2 mb-5">
          <h4 className="text-sm font-bold text-white px-1 mb-2 flex items-center gap-2">
            <Clock size={14} className="text-[oklch(0.60_0.10_85)]" />
            Awaiting Results ({pendingResults.length})
          </h4>
          {pendingResults.map((play: any, idx: number) => {
            const statConfig = STAT_CONFIG[play.stat as keyof typeof STAT_CONFIG];
            const Icon = statConfig.icon;

            return (
              <motion.div
                key={`${play.id}-${play.stat}-pending`}
                className="rounded-lg p-3 border border-[oklch(1_0_0/10%)] bg-[oklch(0.14_0.022_255)]"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.04 }}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Icon size={14} style={{ color: statConfig.color }} />
                      <span className="font-bold text-white text-sm">{play.playerName}</span>
                    </div>
                    <div className="text-xs text-[oklch(0.50_0.015_255)]">
                      {play.stat.toUpperCase()} OVER {play.line} • {play.confidence}% confidence
                    </div>
                  </div>
                  <div className="flex items-center gap-1 bg-[oklch(0.60_0.10_85/15%)] rounded-full px-2 py-0.5">
                    <AlertCircle size={12} className="text-[oklch(0.60_0.10_85)]" />
                    <span className="text-[10px] font-bold text-[oklch(0.60_0.10_85)]">PENDING</span>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Footer note */}
      <div className="text-center text-[oklch(0.32_0.015_255)] text-[10px] pb-4 px-4">
        Results update automatically each morning via scheduled task
      </div>
    </div>
  );
}
