import { cn } from "../lib/utils";

interface ModelBreakdown {
  costUsd: number;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

interface CostTrackerProps {
  className?: string;
  costUsd: number;
  modelBreakdown?: ModelBreakdown[];
  refreshInterval?: number;
  sessionId: string;
  tokensIn: number;
  tokensOut: number;
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return String(count);
}

function formatCost(usd: number): string {
  if (usd < 0.01) {
    return `$${usd.toFixed(4)}`;
  }
  return `$${usd.toFixed(2)}`;
}

export function CostTracker({
  sessionId: _sessionId,
  tokensIn,
  tokensOut,
  costUsd,
  modelBreakdown,
  refreshInterval: _refreshInterval,
  className,
}: CostTrackerProps) {
  const totalTokens = tokensIn + tokensOut;

  return (
    <div className={cn("space-y-3 rounded-lg border p-4", className)}>
      {/* Live token counter */}
      <div className="flex items-center justify-between">
        <span className="font-medium text-sm">Token Usage</span>
        <span className="font-mono text-muted-foreground text-xs">
          {formatTokens(totalTokens)} total
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-md border p-2">
          <div className="text-[10px] text-muted-foreground">Input</div>
          <div className="font-mono font-semibold text-sm">
            {formatTokens(tokensIn)}
          </div>
        </div>
        <div className="rounded-md border p-2">
          <div className="text-[10px] text-muted-foreground">Output</div>
          <div className="font-mono font-semibold text-sm">
            {formatTokens(tokensOut)}
          </div>
        </div>
      </div>

      {/* Cost in USD */}
      <div className="flex items-center justify-between border-t pt-3">
        <span className="text-muted-foreground text-xs">Estimated Cost</span>
        <span className="font-mono font-semibold text-lg">
          {formatCost(costUsd)}
        </span>
      </div>

      {/* Model breakdown bar */}
      {modelBreakdown && modelBreakdown.length > 0 && (
        <div className="space-y-2 border-t pt-3">
          <span className="text-muted-foreground text-xs">Model Breakdown</span>
          <div className="flex h-2 overflow-hidden rounded-full bg-zinc-800">
            {modelBreakdown.map((m) => {
              const pct = costUsd > 0 ? (m.costUsd / costUsd) * 100 : 0;
              return (
                <div
                  className="bg-violet-500 first:rounded-l-full last:rounded-r-full"
                  key={m.model}
                  style={{ width: `${pct}%` }}
                  title={`${m.model}: ${formatCost(m.costUsd)}`}
                />
              );
            })}
          </div>
          <div className="space-y-1">
            {modelBreakdown.map((m) => (
              <div
                className="flex items-center justify-between text-[10px]"
                key={m.model}
              >
                <span className="truncate text-muted-foreground">
                  {m.model}
                </span>
                <span className="font-mono">{formatCost(m.costUsd)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
