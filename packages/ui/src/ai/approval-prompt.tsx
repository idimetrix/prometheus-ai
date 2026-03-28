import { cn } from "../lib/utils";

type RiskLevel = "low" | "medium" | "high" | "critical";

interface ApprovalPromptProps {
  className?: string;
  context?: Record<string, unknown>;
  description: string;
  gateType: string;
  onApprove: () => void;
  onReject: () => void;
  riskLevel: RiskLevel;
}

const RISK_CONFIG: Record<
  RiskLevel,
  { bgColor: string; borderColor: string; label: string; textColor: string }
> = {
  low: {
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/30",
    textColor: "text-green-600",
    label: "Low Risk",
  },
  medium: {
    bgColor: "bg-yellow-500/10",
    borderColor: "border-yellow-500/30",
    textColor: "text-yellow-600",
    label: "Medium Risk",
  },
  high: {
    bgColor: "bg-orange-500/10",
    borderColor: "border-orange-500/30",
    textColor: "text-orange-600",
    label: "High Risk",
  },
  critical: {
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/30",
    textColor: "text-red-600",
    label: "Critical Risk",
  },
};

export function ApprovalPrompt({
  description,
  gateType,
  riskLevel,
  onApprove,
  onReject,
  context,
  className,
}: ApprovalPromptProps) {
  const risk = RISK_CONFIG[riskLevel];

  return (
    <div
      className={cn(
        "space-y-3 rounded-lg border p-4",
        risk.bgColor,
        risk.borderColor,
        className
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">Approval Required</span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 font-medium text-xs",
                risk.bgColor,
                risk.textColor
              )}
            >
              {risk.label}
            </span>
          </div>
          <div className="text-muted-foreground text-xs">Gate: {gateType}</div>
        </div>
      </div>

      {/* Description */}
      <p className="text-sm leading-relaxed">{description}</p>

      {/* Context details */}
      {context && Object.keys(context).length > 0 && (
        <div className="space-y-1 rounded border bg-background/50 p-2">
          <div className="font-medium text-muted-foreground text-xs">
            Details
          </div>
          {Object.entries(context).map(([key, value]) => (
            <div className="flex items-baseline gap-2 text-xs" key={key}>
              <span className="shrink-0 text-muted-foreground">{key}:</span>
              <span className="min-w-0 truncate">
                {typeof value === "string" ? value : JSON.stringify(value)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <button
          className="rounded-md bg-green-600 px-4 py-1.5 font-medium text-sm text-white transition-colors hover:bg-green-700"
          onClick={onApprove}
          type="button"
        >
          Approve
        </button>
        <button
          className="rounded-md border px-4 py-1.5 text-sm transition-colors hover:bg-muted"
          onClick={onReject}
          type="button"
        >
          Deny
        </button>
      </div>
    </div>
  );
}
