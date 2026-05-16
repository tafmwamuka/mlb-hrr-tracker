/**
 * DataHealthBar — Issue 6
 * Collapsible status strip showing live data source health:
 * Lineups / Odds / Statcast / Bullpen + last updated time
 */

import { useState } from "react";
import { CheckCircle2, AlertTriangle, Clock, ChevronDown, Activity } from "lucide-react";

interface EnrichmentStatus {
  lineups: 'ok' | 'pending' | 'failed';
  odds: 'ok' | 'partial' | 'pending' | 'failed';
  statcast: 'ok' | 'partial' | 'failed';
  streaks: 'ok' | 'partial' | 'failed';
  dayNight: 'ok' | 'partial' | 'failed';
  bullpen: 'ok' | 'partial' | 'failed';
  isPartialEnrichment: boolean;
  lastUpdated: string;
}

interface DataHealthBarProps {
  enrichmentStatus?: EnrichmentStatus | null;
}

function StatusDot({ status }: { status: 'ok' | 'partial' | 'pending' | 'failed' | undefined }) {
  if (!status || status === 'ok') {
    return <CheckCircle2 size={10} style={{ color: 'oklch(0.72 0.18 165)' }} />;
  }
  if (status === 'partial' || status === 'pending') {
    return <AlertTriangle size={10} style={{ color: 'oklch(0.82 0.17 85)' }} />;
  }
  return <AlertTriangle size={10} style={{ color: 'oklch(0.68 0.22 25)' }} />;
}

function StatusLabel({ status }: { status: 'ok' | 'partial' | 'pending' | 'failed' | undefined }) {
  if (!status || status === 'ok') return <span style={{ color: 'oklch(0.72 0.18 165)' }} className="text-[9px] font-semibold">LIVE</span>;
  if (status === 'partial') return <span style={{ color: 'oklch(0.82 0.17 85)' }} className="text-[9px] font-semibold">PARTIAL</span>;
  if (status === 'pending') return <span style={{ color: 'oklch(0.82 0.17 85)' }} className="text-[9px] font-semibold">LOADING</span>;
  return <span style={{ color: 'oklch(0.68 0.22 25)' }} className="text-[9px] font-semibold">OFFLINE</span>;
}

export function DataHealthBar({ enrichmentStatus }: DataHealthBarProps) {
  const [expanded, setExpanded] = useState(false);

  if (!enrichmentStatus) return null;

  const overallOk = !enrichmentStatus.isPartialEnrichment;
  const lastUpdated = (() => {
    try {
      const d = new Date(enrichmentStatus.lastUpdated);
      const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
      if (diffMin < 1) return 'Just now';
      if (diffMin < 60) return `${diffMin}m ago`;
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } catch { return 'Unknown'; }
  })();

  const sources = [
    { label: 'Lineups', status: enrichmentStatus.lineups },
    { label: 'Odds', status: enrichmentStatus.odds },
    { label: 'Statcast', status: enrichmentStatus.statcast },
    { label: 'Bullpen', status: enrichmentStatus.bullpen },
  ] as const;

  const warningCount = sources.filter(s => s.status !== 'ok').length;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: overallOk
          ? 'oklch(0.14 0.03 165 / 0.4)'
          : 'oklch(0.14 0.04 60 / 0.35)',
        border: `1px solid ${overallOk ? 'oklch(0.72 0.18 165 / 25%)' : 'oklch(0.82 0.17 85 / 30%)'}`,
      }}
    >
      {/* Collapsed header */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 gap-2"
      >
        <div className="flex items-center gap-2">
          <Activity size={11} style={{ color: overallOk ? 'oklch(0.72 0.18 165)' : 'oklch(0.82 0.17 85)' }} />
          <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: overallOk ? 'oklch(0.72 0.18 165)' : 'oklch(0.82 0.17 85)' }}>
            {overallOk ? 'All Data Sources Live' : `${warningCount} Source${warningCount > 1 ? 's' : ''} Partial`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Compact status dots */}
          <div className="flex items-center gap-1">
            {sources.map(s => (
              <StatusDot key={s.label} status={s.status} />
            ))}
          </div>
          <div className="flex items-center gap-1">
            <Clock size={9} style={{ color: 'oklch(0.40 0.015 255)' }} />
            <span className="text-[9px] text-[oklch(0.40_0.015_255)]">{lastUpdated}</span>
          </div>
          <ChevronDown
            size={11}
            className="transition-transform"
            style={{
              color: 'oklch(0.45 0.015 255)',
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
          />
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-3 pb-3 grid grid-cols-2 gap-2">
          {sources.map(s => (
            <div
              key={s.label}
              className="flex items-center justify-between px-2 py-1.5 rounded-lg"
              style={{ background: 'oklch(1 0 0 / 4%)' }}
            >
              <span className="text-[10px] text-[oklch(0.60_0.015_255)] font-medium">{s.label}</span>
              <div className="flex items-center gap-1">
                <StatusDot status={s.status} />
                <StatusLabel status={s.status} />
              </div>
            </div>
          ))}
          {enrichmentStatus.isPartialEnrichment && (
            <div className="col-span-2 mt-1 text-[9px] text-[oklch(0.50_0.015_255)] leading-relaxed">
              Advanced enrichment is still loading. Picks are generated from available data — scores may improve as more data arrives.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
