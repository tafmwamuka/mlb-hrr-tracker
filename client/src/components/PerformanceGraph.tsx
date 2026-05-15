/**
 * PerformanceGraph — compact SVG sparkline showing H/R/RBI per game
 * for the last 5 games. Each game is a grouped bar column.
 * A trend polyline overlays the total HRR per game.
 */

interface GameEntry {
  date: string;
  hits: number;
  runs: number;
  rbi: number;
  atBats: number;
  homeRuns: number;
}

interface PerformanceGraphProps {
  games: GameEntry[];
  statType?: 'hits' | 'runs' | 'rbi'; // Highlight this stat
  expectedLine?: number; // The recommended line (draw as dashed horizontal)
}

const H_COLOR  = "oklch(0.82 0.17 85)";   // gold
const R_COLOR  = "oklch(0.68 0.22 25)";   // coral
const RBI_COLOR = "oklch(0.72 0.18 165)"; // emerald
const HR_COLOR  = "oklch(0.65 0.22 300)"; // purple for HR dots

const W = 280;
const H = 96;
const PAD_L = 20;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 28; // room for date labels
const CHART_W = W - PAD_L - PAD_R;
const CHART_H = H - PAD_T - PAD_B;

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
  } catch {
    return dateStr.slice(5); // fallback: MM-DD
  }
}

export function PerformanceGraph({ games, statType, expectedLine }: PerformanceGraphProps) {
  if (!games || games.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-xl"
        style={{ height: H, background: "oklch(0.12 0.018 255)", border: "1px solid oklch(1 0 0 / 6%)" }}
      >
        <span className="text-[10px] text-[oklch(0.38_0.015_255)]">No game log data</span>
      </div>
    );
  }

  // Show last 5 games, oldest → newest (left → right)
  const display = [...games].reverse().slice(-5);
  const n = display.length;
  if (n === 0) return null;

  // Max value for Y-axis scaling (at least 4 so bars aren't huge for 0-stat games)
  const maxVal = Math.max(4, ...display.map(g => g.hits + g.runs + g.rbi));

  // Column width and spacing
  const colW = CHART_W / n;
  const barGroupW = colW * 0.72;
  const barW = barGroupW / 3;

  // Y helper: value → SVG y coordinate (0 at bottom = PAD_T + CHART_H)
  const yOf = (val: number) => PAD_T + CHART_H - (val / maxVal) * CHART_H;

  // Total HRR per game for trend line
  const totals = display.map(g => g.hits + g.runs + g.rbi);
  const trendPoints = totals.map((t, i) => {
    const cx = PAD_L + i * colW + colW / 2;
    return `${cx},${yOf(t)}`;
  }).join(" ");

  // Y-axis labels (0, midpoint, max)
  const yLabels = [0, Math.round(maxVal / 2), maxVal];

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[9px] font-bold tracking-widest uppercase" style={{ color: "oklch(0.45 0.015 255)" }}>
          Last {n} Games — H / R / RBI
        </span>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-[9px]" style={{ color: H_COLOR }}>
            <span className="w-2 h-2 rounded-sm inline-block" style={{ background: H_COLOR }} /> H
          </span>
          <span className="flex items-center gap-1 text-[9px]" style={{ color: R_COLOR }}>
            <span className="w-2 h-2 rounded-sm inline-block" style={{ background: R_COLOR }} /> R
          </span>
          <span className="flex items-center gap-1 text-[9px]" style={{ color: RBI_COLOR }}>
            <span className="w-2 h-2 rounded-sm inline-block" style={{ background: RBI_COLOR }} /> RBI
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ display: "block", overflow: "visible" }}
      >
        {/* Background */}
        <rect x={0} y={0} width={W} height={H} rx={8} fill="oklch(0.12 0.018 255)" />

        {/* Y-axis grid lines + labels */}
        {yLabels.map((v) => {
          const y = yOf(v);
          return (
            <g key={v}>
              <line
                x1={PAD_L} y1={y} x2={W - PAD_R} y2={y}
                stroke="oklch(1 0 0 / 8%)" strokeWidth={0.5} strokeDasharray="3 3"
              />
              <text
                x={PAD_L - 3} y={y + 3}
                textAnchor="end"
                fontSize={7}
                fill="oklch(0.38 0.015 255)"
              >
                {v}
              </text>
            </g>
          );
        })}

        {/* Expected line (dashed) */}
        {expectedLine !== undefined && expectedLine <= maxVal && (
          <line
            x1={PAD_L} y1={yOf(expectedLine)} x2={W - PAD_R} y2={yOf(expectedLine)}
            stroke="oklch(0.72 0.18 165 / 60%)" strokeWidth={1} strokeDasharray="4 3"
          />
        )}

        {/* Bars per game */}
        {display.map((g, i) => {
          const colX = PAD_L + i * colW;
          const groupX = colX + (colW - barGroupW) / 2;

          // Highlight the active stat type
          const hOpacity = !statType || statType === 'hits' ? 1 : 0.45;
          const rOpacity = !statType || statType === 'runs' ? 1 : 0.45;
          const rbiOpacity = !statType || statType === 'rbi' ? 1 : 0.45;

          return (
            <g key={i}>
              {/* Hits bar */}
              {g.hits > 0 && (
                <rect
                  x={groupX}
                  y={yOf(g.hits)}
                  width={barW - 1}
                  height={(g.hits / maxVal) * CHART_H}
                  fill={H_COLOR}
                  opacity={hOpacity}
                  rx={1}
                />
              )}
              {/* Runs bar */}
              {g.runs > 0 && (
                <rect
                  x={groupX + barW}
                  y={yOf(g.runs)}
                  width={barW - 1}
                  height={(g.runs / maxVal) * CHART_H}
                  fill={R_COLOR}
                  opacity={rOpacity}
                  rx={1}
                />
              )}
              {/* RBI bar */}
              {g.rbi > 0 && (
                <rect
                  x={groupX + barW * 2}
                  y={yOf(g.rbi)}
                  width={barW - 1}
                  height={(g.rbi / maxVal) * CHART_H}
                  fill={RBI_COLOR}
                  opacity={rbiOpacity}
                  rx={1}
                />
              )}
              {/* HR dot above bars */}
              {g.homeRuns > 0 && (
                <>
                  <circle
                    cx={colX + colW / 2}
                    cy={yOf(Math.max(g.hits, g.runs, g.rbi)) - 5}
                    r={3}
                    fill={HR_COLOR}
                  />
                  <text
                    x={colX + colW / 2}
                    y={yOf(Math.max(g.hits, g.runs, g.rbi)) - 9}
                    textAnchor="middle"
                    fontSize={6}
                    fill={HR_COLOR}
                  >
                    HR
                  </text>
                </>
              )}
              {/* Date label */}
              <text
                x={colX + colW / 2}
                y={H - 4}
                textAnchor="middle"
                fontSize={7.5}
                fill="oklch(0.42 0.015 255)"
              >
                {formatDate(g.date)}
              </text>
            </g>
          );
        })}

        {/* Trend polyline (total HRR) */}
        {n > 1 && (
          <polyline
            points={trendPoints}
            fill="none"
            stroke="oklch(0.85 0.10 255 / 50%)"
            strokeWidth={1.2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* Trend dots */}
        {totals.map((t, i) => {
          const cx = PAD_L + i * colW + colW / 2;
          const cy = yOf(t);
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={2}
              fill="white"
              opacity={0.6}
            />
          );
        })}
      </svg>

      {/* Per-game totals row */}
      <div className="flex mt-1" style={{ paddingLeft: PAD_L, paddingRight: PAD_R }}>
        {display.map((g, i) => {
          const total = g.hits + g.runs + g.rbi;
          const isGood = total >= (expectedLine ?? 3);
          return (
            <div
              key={i}
              className="text-center text-[9px] font-bold"
              style={{
                flex: 1,
                color: isGood ? "oklch(0.72 0.18 165)" : "oklch(0.45 0.015 255)",
              }}
            >
              {total}
            </div>
          );
        })}
      </div>
    </div>
  );
}
