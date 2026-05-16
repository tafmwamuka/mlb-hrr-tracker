import { motion, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { Star, TrendingUp, Zap, Target, Crown, ChevronDown, BarChart3, Flame } from "lucide-react";
import { useState } from "react";
import { SaferPlayTip } from "@/components/SaferPlayTip";

const STAT_CONFIG = {
  hits: { label: "HITS", icon: TrendingUp, color: "oklch(0.82 0.17 85)", abbr: "H/O", gradient: "from-amber-500/20 to-yellow-500/5" },
  runs: { label: "RUNS", icon: Zap, color: "oklch(0.68 0.22 25)", abbr: "R/O", gradient: "from-red-500/20 to-orange-500/5" },
  rbi: { label: "RBI", icon: Target, color: "oklch(0.72 0.18 165)", abbr: "RBI/O", gradient: "from-emerald-500/20 to-teal-500/5" },
};

function ConfidencePill({ value, color }: { value: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-12 h-1.5 rounded-full bg-[oklch(1_0_0/8%)] overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </div>
      <span className="text-[10px] font-stat font-bold" style={{ color }}>{value}%</span>
    </div>
  );
}

function SavantBadge({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className={`px-2 py-1 rounded text-center ${good ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-[oklch(1_0_0/4%)] border border-[oklch(1_0_0/8%)]'}`}>
      <div className="text-[8px] text-[oklch(0.45_0.015_255)] uppercase">{label}</div>
      <div className={`text-[11px] font-stat font-bold ${good ? 'text-emerald-400' : 'text-white'}`}>{value}</div>
    </div>
  );
}

function PlayCard({ pick, index }: { pick: any; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const [favorited, setFavorited] = useState(false);
  const statConfig = STAT_CONFIG[pick.statType as keyof typeof STAT_CONFIG] || STAT_CONFIG.hits;
  const StatIcon = statConfig.icon;
  const isTop3 = index < 3;
  const rank = index + 1;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03, duration: 0.3 }}
      className="relative"
    >
      <div
        className={`rounded-xl border overflow-hidden transition-all ${isTop3 ? 'border-[oklch(1_0_0/15%)]' : 'border-[oklch(1_0_0/8%)]'}`}
        style={{ background: isTop3 ? 'linear-gradient(145deg, oklch(0.15 0.025 255), oklch(0.12 0.020 255))' : 'oklch(0.13 0.020 255)' }}
      >
        {/* Top accent for top 3 */}
        {isTop3 && <div className={`h-0.5 w-full bg-gradient-to-r ${statConfig.gradient}`} />}

        {/* Main row - always visible */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full p-3 text-left"
        >
          <div className="flex items-center gap-3">
            {/* Rank */}
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${isTop3 ? 'ring-1 ring-white/10' : ''}`}
              style={{ background: `${statConfig.color}20`, color: statConfig.color }}
            >
              {isTop3 ? <Crown size={13} /> : <span className="text-xs font-bold">{rank}</span>}
            </div>

            {/* Player info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-white text-sm truncate">{pick.playerName}</span>
                <span className="text-[10px] text-[oklch(0.45_0.015_255)]">{pick.team} vs {pick.pitcherTeam}</span>
              </div>
              <div className="text-[11px] text-[oklch(0.50_0.015_255)] truncate">
                vs {pick.pitcher} ({pick.pitcherTeam}) • Bat #{pick.battingPosition}
              </div>
            </div>

            {/* Prop badge */}
            <div
              className="px-2 py-1 rounded-md text-[11px] font-bold flex items-center gap-1 shrink-0"
              style={{ background: `${statConfig.color}20`, color: statConfig.color }}
            >
              <StatIcon size={11} />
              {statConfig.abbr} {pick.line}
            </div>

            {/* Confidence */}
            <div className="shrink-0 w-14 text-right">
              <div className="font-stat text-sm font-bold" style={{ color: statConfig.color }}>{pick.confidence}%</div>
              <div className="text-[9px] text-[oklch(0.40_0.015_255)]">conf.</div>
            </div>

            {/* Expand arrow */}
            <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }} className="shrink-0">
              <ChevronDown size={14} className="text-[oklch(0.40_0.015_255)]" />
            </motion.div>
          </div>

          {/* Quick stats row */}
          <div className="flex items-center gap-3 mt-2 pl-10 flex-wrap">
            {/* Odds badge */}
            {pick.odds?.overOdds && (
              <span className="text-[10px] font-bold" style={{ color: "oklch(0.82 0.17 85)" }}>
                {pick.odds.overOdds}
                {pick.odds.provider && (
                  <span className="text-[9px] text-[oklch(0.45_0.015_255)] ml-0.5">
                    {pick.odds.provider}
                  </span>
                )}
              </span>
            )}
            {/* Day/night split */}
            {pick.dayNightSplit && (
              <span className="text-[10px]" style={{ color: pick.dayNightSplit.favorable ? "oklch(0.72 0.18 165)" : "oklch(0.50 0.015 255)" }}>
                {pick.dayNightSplit.gameTimeType === 'day' ? '☀️' : '🌙'} {pick.dayNightSplit.splitAvg?.toFixed(3)}
                {pick.dayNightSplit.splitBoost > 0.05 ? ' 🌟' : pick.dayNightSplit.splitBoost < -0.05 ? ' ⚠️' : ''}
              </span>
            )}
            {/* Streak info */}
            {pick.streakInfo?.streakType === 'hot' && pick.streakInfo.streakLength >= 3 && (
              <span className="text-[10px] font-bold" style={{ color: "oklch(0.82 0.17 85)" }}>
                🔥 {pick.streakInfo.streakLength}-game
              </span>
            )}
            {pick.streakInfo?.streakType === 'cold' && (
              <span className="text-[10px] font-bold" style={{ color: "oklch(0.65 0.12 240)" }}>
                ❄️ Cold
              </span>
            )}

            {/* Prime Position badge */}
            {pick.primePosition && (
              <span
                className="text-[10px] font-bold"
                style={{ color: "oklch(0.85 0.18 55)" }}
                title={pick.primePositionFactors ? [
                  pick.primePositionFactors.platoonAdvantage ? '✓ Platoon' : '✗ Platoon',
                  pick.primePositionFactors.pitcherMatchup ? '✓ Pitcher' : '✗ Pitcher',
                  pick.primePositionFactors.battingPositionStrong ? '✓ Bat pos' : '✗ Bat pos',
                  pick.primePositionFactors.dayNightFavorable ? '✓ Split' : '✗ Split',
                ].join(' | ') : '3+ favorable factors'}
              >
                🎯 Prime {pick.primePositionFactors?.favorableCount ?? '3+'}/4
              </span>
            )}
            {pick.savantMetrics && (
              <>
                <span className="text-[10px] text-[oklch(0.50_0.015_255)]">
                  xwOBA <span className={`font-stat font-bold ${pick.savantMetrics.xwOBA >= 0.350 ? 'text-emerald-400' : 'text-white'}`}>{pick.savantMetrics.xwOBA.toFixed(3)}</span>
                </span>
                <span className="text-[10px] text-[oklch(0.50_0.015_255)]">
                  EV <span className={`font-stat font-bold ${pick.savantMetrics.exitVelocity >= 90 ? 'text-emerald-400' : 'text-white'}`}>{pick.savantMetrics.exitVelocity.toFixed(1)}</span>
                </span>
              </>
            )}
            {pick.combinedScore && (
              <span className="text-[10px] ml-auto">
                <span className="text-[oklch(0.45_0.015_255)]">Score </span>
                <span className="font-stat font-bold text-amber-400">{pick.combinedScore}</span>
              </span>
            )}
          </div>
        </button>

        {/* Expanded detail */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden"
            >
              <div className="px-3 pb-3 pt-1 space-y-3 border-t border-[oklch(1_0_0/6%)]">
                {/* Reasoning */}
                <div className="p-2.5 rounded-lg bg-[oklch(1_0_0/3%)]">
                  <div className="flex items-start gap-2">
                    <BarChart3 size={12} className="text-blue-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-[oklch(0.65_0.015_255)] leading-relaxed">{pick.reasoning}</p>
                  </div>
                </div>

                {/* Ballpark reasoning */}
                {pick.ballparkReasoning && (
                  <div className="p-2.5 rounded-lg bg-[oklch(1_0_0/2%)] border-l-2" style={{ borderColor: statConfig.color }}>
                    <p className="text-[11px] text-[oklch(0.55_0.015_255)] leading-relaxed italic">{pick.ballparkReasoning}</p>
                  </div>
                )}

                {/* Savant Metrics Grid */}
                {pick.savantMetrics && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <Flame size={11} className="text-orange-400" />
                      <span className="text-[10px] font-bold text-white uppercase tracking-wider">Statcast Metrics</span>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      <SavantBadge label="xwOBA" value={pick.savantMetrics.xwOBA.toFixed(3)} good={pick.savantMetrics.xwOBA >= 0.350} />
                      <SavantBadge label="Hard Hit%" value={`${pick.savantMetrics.hardHitPct.toFixed(1)}%`} good={pick.savantMetrics.hardHitPct >= 44} />
                      <SavantBadge label="Exit Velo" value={pick.savantMetrics.exitVelocity.toFixed(1)} good={pick.savantMetrics.exitVelocity >= 90} />
                      <SavantBadge label="Barrel%" value={`${pick.savantMetrics.barrelPct.toFixed(1)}%`} good={pick.savantMetrics.barrelPct >= 10} />
                      <SavantBadge label="xBA" value={pick.savantMetrics.xBA.toFixed(3)} good={pick.savantMetrics.xBA >= 0.270} />
                      <SavantBadge label="xSLG" value={pick.savantMetrics.xSLG.toFixed(3)} good={pick.savantMetrics.xSLG >= 0.450} />
                      <SavantBadge label="K%" value={`${pick.savantMetrics.kPct.toFixed(1)}%`} good={pick.savantMetrics.kPct <= 20} />
                      <SavantBadge label="BB%" value={`${pick.savantMetrics.bbPct.toFixed(1)}%`} good={pick.savantMetrics.bbPct >= 10} />
                    </div>

                    {/* Savant factors */}
                    {pick.savantMetrics.savantFactors && pick.savantMetrics.savantFactors.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {pick.savantMetrics.savantFactors.map((factor: string, i: number) => (
                          <span key={i} className="text-[9px] px-1.5 py-0.5 rounded-full bg-orange-500/10 text-orange-300 border border-orange-500/20">
                            {factor}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Alt Line Options */}
                {pick.alternateLines && pick.alternateLines.length > 0 && (
                  <div>
                    <div className="text-[10px] font-bold text-[oklch(0.45_0.015_255)] uppercase tracking-wider mb-1.5">Alt Lines</div>
                    <div className="flex flex-wrap gap-1.5">
                      {pick.alternateLines.map((alt: { line: number; overProb: number; underProb: number }, i: number) => {
                        const isMain = alt.line === pick.line;
                        const altColor = alt.overProb >= 85 ? 'oklch(0.72 0.18 165)' : alt.overProb >= 75 ? 'oklch(0.78 0.16 140)' : 'oklch(0.82 0.17 85)';
                        return (
                          <div
                            key={i}
                            className="px-2.5 py-1.5 rounded-lg text-center"
                            style={{
                              background: isMain ? `${altColor}20` : 'oklch(0.16 0.02 255)',
                              border: `1px solid ${isMain ? `${altColor}40` : 'oklch(1 0 0 / 8%)'}`,
                            }}
                          >
                            <div className="text-[9px] text-[oklch(0.45_0.015_255)]">Over {alt.line}</div>
                            <div className="text-[12px] font-stat font-bold" style={{ color: altColor }}>{alt.overProb}%</div>
                            {isMain && <div className="text-[8px] text-[oklch(0.45_0.015_255)] mt-0.5">main</div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Factor breakdown mini */}
                <div className="flex items-center gap-2 flex-wrap">
                  {pick.factorBreakdown && (
                    <>
                      <span className="text-[9px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-300 border border-blue-500/20">RC {pick.factorBreakdown.rc}</span>
                      <span className="text-[9px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">Park {pick.factorBreakdown.parkFactors}</span>
                      <span className="text-[9px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-300 border border-red-500/20">HR Tgt {pick.factorBreakdown.hrTargets}</span>
                      <span className="text-[9px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20">Matchup {pick.factorBreakdown.pitcherMatchup}</span>
                    </>
                  )}
                </div>

                {/* Favorite button */}
                <button
                  onClick={(e) => { e.stopPropagation(); setFavorited(!favorited); }}
                  className={`w-full py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                    favorited ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-[oklch(1_0_0/4%)] text-[oklch(0.55_0.015_255)] border border-[oklch(1_0_0/8%)] hover:bg-[oklch(1_0_0/6%)]'
                  }`}
                >
                  <Star size={12} className={favorited ? 'fill-current' : ''} />
                  {favorited ? 'Saved to Favorites' : 'Add to Favorites'}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

export function AllPlaysTab() {
  const { data: aiPicksData, isLoading } = trpc.aiPicks.getComprehensivePicks.useQuery(undefined, {
    refetchInterval: 5 * 60 * 1000, // Auto-refresh every 5 minutes for new lineups
    staleTime: 2 * 60 * 1000, // Consider data fresh for 2 minutes
  });

  const todayDate = (() => {
    const dateStr = aiPicksData?.dataDate;
    if (dateStr) {
      const d = new Date(dateStr + 'T12:00:00');
      return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    }
    return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  })();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <motion.div
            className="w-12 h-12 rounded-full border-2 border-transparent mx-auto mb-3"
            style={{ borderTopColor: "oklch(0.82 0.17 85)", borderRightColor: "oklch(0.72 0.18 165)" }}
            animate={{ rotate: 360 }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
          />
          <p className="text-sm text-[oklch(0.50_0.015_255)]">Loading all plays...</p>
          <p className="text-[10px] text-[oklch(0.35_0.015_255)] mt-1">Combining Diamond Edge VS Gate + Savant data</p>
        </div>
      </div>
    );
  }

  const picks = aiPicksData?.picks || [];

  const lineupSource = (aiPicksData as any)?.lineupSource ?? 'projected';
  const isProjected = lineupSource === 'projected';

  // Handle truly empty state (no data at all)
  if ((aiPicksData as any)?.lineupsPending) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <div className="w-14 h-14 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ background: "oklch(0.18 0.03 255)" }}>
          <TrendingUp size={24} style={{ color: "oklch(0.82 0.17 85)" }} />
        </div>
        <p className="text-white font-semibold mb-1">Loading Projected Lineups...</p>
        <p className="text-sm text-[oklch(0.45_0.015_255)] text-center max-w-xs">
          Building picks from today's probable pitchers and historical batting orders.
        </p>
        <p className="text-[oklch(0.40_0.015_255)] text-xs mt-2">{todayDate}</p>
        <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: "oklch(0.14 0.022 255)", border: "1px solid oklch(1 0 0 / 8%)" }}>
          <div className="w-2 h-2 rounded-full bg-[oklch(0.82_0.17_85)] animate-pulse" />
          <span className="text-[oklch(0.55_0.015_255)] text-[10px]">Refreshes automatically</span>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pb-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between py-2">
        <div>
          <h3 className="text-sm font-bold text-white">{picks.length} Plays Available</h3>
          <p className="text-[10px] text-[oklch(0.45_0.015_255)]">{todayDate} · Tap any play for full analysis</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Lineup source badge */}
          <div
            className="flex items-center gap-1 px-2 py-1 rounded-md border text-[9px] font-bold tracking-wide"
            style={isProjected
              ? { background: "oklch(0.20 0.08 60 / 0.3)", border: "1px solid oklch(0.75 0.15 60 / 0.5)", color: "oklch(0.82 0.17 85)" }
              : { background: "oklch(0.15 0.08 165 / 0.3)", border: "1px solid oklch(0.72 0.18 165 / 0.5)", color: "oklch(0.72 0.18 165)" }
            }
          >
            <div className={`w-1.5 h-1.5 rounded-full ${isProjected ? 'bg-[oklch(0.82_0.17_85)] animate-pulse' : 'bg-[oklch(0.72_0.18_165)]'}`} />
            {isProjected ? 'PROJECTED' : 'CONFIRMED'}
          </div>
          <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-[oklch(1_0_0/4%)] border border-[oklch(1_0_0/8%)]">
            <Flame size={10} className="text-orange-400" />
            <span className="text-[9px] text-[oklch(0.55_0.015_255)]">Savant + RC</span>
          </div>
        </div>
      </div>

      <SaferPlayTip />

      {/* All pick cards */}
      <div className="space-y-2">
        {picks.slice(0, 20).map((pick: any, idx: number) => (
          <PlayCard key={pick.playerId || idx} pick={pick} index={idx} />
        ))}
      </div>

      {/* Footer */}
      <div className="text-center py-3">
        <p className="text-[10px] text-[oklch(0.35_0.015_255)]">
          All picks are OVER props • Combined: Diamond Edge VS Gate + Baseball Savant Statcast
        </p>
      </div>
    </div>
  );
}
