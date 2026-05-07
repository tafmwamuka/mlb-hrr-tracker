import { Info } from "lucide-react";

/**
 * Tip banner suggesting users play picks as HRR combined for a safer bet
 * at the same line value suggested by the system.
 */
export function SaferPlayTip() {
  return (
    <div
      className="mx-4 mt-3 mb-1 rounded-lg px-3 py-2.5 flex items-start gap-2.5 border"
      style={{
        background: "oklch(0.82 0.17 85 / 6%)",
        borderColor: "oklch(0.82 0.17 85 / 20%)",
      }}
    >
      <Info size={16} className="shrink-0 mt-0.5" style={{ color: "oklch(0.82 0.17 85)" }} />
      <p className="text-xs leading-relaxed" style={{ color: "oklch(0.70 0.08 85)" }}>
        <span className="font-semibold" style={{ color: "oklch(0.82 0.17 85)" }}>Safer play tip:</span>{" "}
        Play these picks as HRR combined (Hits + Runs + RBI) at the same line value for a safer bet.
      </p>
    </div>
  );
}
