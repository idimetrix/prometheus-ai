import { cn } from "../lib/utils";

interface BudgetAlertProps {
  budgetLimit: number;
  className?: string;
  currentCost: number;
  warningThreshold?: number;
}

function formatCost(usd: number): string {
  if (usd < 0.01) {
    return `$${usd.toFixed(4)}`;
  }
  return `$${usd.toFixed(2)}`;
}

export function BudgetAlert({
  currentCost,
  budgetLimit,
  warningThreshold = 0.8,
  className,
}: BudgetAlertProps) {
  const ratio = budgetLimit > 0 ? currentCost / budgetLimit : 0;
  const percentage = Math.min(100, Math.round(ratio * 100));
  const _isWarning = ratio >= warningThreshold && ratio < 1;
  const isExceeded = ratio >= 1;

  if (ratio < warningThreshold) {
    return null;
  }

  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        isExceeded
          ? "border-red-500/50 bg-red-500/10"
          : "border-yellow-500/50 bg-yellow-500/10",
        className
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "font-medium text-sm",
            isExceeded ? "text-red-400" : "text-yellow-400"
          )}
        >
          {isExceeded ? "Budget Exceeded" : "Budget Warning"}
        </span>
        <span className="font-mono text-xs">
          {formatCost(currentCost)} / {formatCost(budgetLimit)}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            isExceeded ? "bg-red-500" : "bg-yellow-500"
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>

      <p className="mt-1.5 text-[10px] text-muted-foreground">
        {isExceeded
          ? `Exceeded budget by ${formatCost(currentCost - budgetLimit)}`
          : `${percentage}% of budget used — ${formatCost(budgetLimit - currentCost)} remaining`}
      </p>
    </div>
  );
}
