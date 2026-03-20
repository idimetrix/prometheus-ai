"use client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CreditCounterProps {
  budget: number | null;
  consumed: number;
  costUsd: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BUDGET_WARNING_THRESHOLD = 0.8;
const BUDGET_DANGER_THRESHOLD = 0.95;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getBudgetColor(ratio: number): {
  bar: string;
  text: string;
  border: string;
} {
  if (ratio >= BUDGET_DANGER_THRESHOLD) {
    return {
      bar: "bg-red-500",
      text: "text-red-400",
      border: "border-red-500/30",
    };
  }
  if (ratio >= BUDGET_WARNING_THRESHOLD) {
    return {
      bar: "bg-yellow-500",
      text: "text-yellow-400",
      border: "border-yellow-500/30",
    };
  }
  return {
    bar: "bg-green-500",
    text: "text-green-400",
    border: "border-zinc-800",
  };
}

function formatUsd(amount: number): string {
  return `$${amount.toFixed(4)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CreditCounter({
  consumed,
  budget,
  costUsd,
}: CreditCounterProps) {
  const ratio = budget !== null && budget > 0 ? consumed / budget : 0;
  const colors = getBudgetColor(ratio);
  const percentage = Math.min(100, Math.round(ratio * 100));

  return (
    <div
      className={`rounded-lg border p-3 ${
        budget === null ? "border-zinc-800" : colors.border
      } bg-zinc-900/50`}
    >
      {/* Credits row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg
            aria-hidden="true"
            className="h-3.5 w-3.5 text-yellow-500"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M10.75 10.818a2.608 2.608 0 0 1-.873 1.214c-.546.44-1.276.673-2.133.673a4.21 4.21 0 0 1-1.279-.2 2.349 2.349 0 0 1-.96-.609 2.372 2.372 0 0 1-.535-.858A3.2 3.2 0 0 1 4.8 10c0-.668.167-1.241.502-1.72a3.41 3.41 0 0 1 1.316-1.125c.546-.29 1.14-.435 1.782-.435.68 0 1.265.152 1.754.456.49.304.855.71 1.095 1.218.24.509.36 1.07.36 1.684 0 .282-.031.558-.093.827-.062.27-.164.525-.306.766ZM10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />
          </svg>
          <span className="font-medium text-xs text-zinc-300">Credits</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-sm text-zinc-200">
            {consumed.toLocaleString()}
          </span>
          {budget !== null && (
            <span className="font-mono text-xs text-zinc-500">
              / {budget.toLocaleString()}
            </span>
          )}
        </div>
      </div>

      {/* Progress bar (when budget is set) */}
      {budget !== null && (
        <div className="mt-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className={`h-full rounded-full transition-all duration-300 ${colors.bar}`}
              style={{ width: `${percentage}%` }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className={`font-mono text-[10px] ${colors.text}`}>
              {percentage}% used
            </span>
            {budget - consumed > 0 && (
              <span className="font-mono text-[10px] text-zinc-500">
                {(budget - consumed).toLocaleString()} remaining
              </span>
            )}
          </div>
        </div>
      )}

      {/* USD cost */}
      <div className="mt-2 flex items-center justify-between border-zinc-800 border-t pt-2">
        <span className="text-[10px] text-zinc-500">Estimated cost</span>
        <span className="font-mono text-xs text-zinc-300">
          {formatUsd(costUsd)}
        </span>
      </div>
    </div>
  );
}

export type { CreditCounterProps };
