import * as React from "react";
import { cn } from "../lib/utils";

interface PlanStep {
  id: string;
  title: string;
  description?: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  substeps?: PlanStep[];
}

interface PlanProps {
  steps: PlanStep[];
  className?: string;
}

const STATUS_ICONS: Record<PlanStep["status"], string> = {
  pending: "○",
  running: "◉",
  completed: "●",
  failed: "✕",
  skipped: "⊘",
};

const STATUS_COLORS: Record<PlanStep["status"], string> = {
  pending: "text-muted-foreground",
  running: "text-blue-500 animate-pulse",
  completed: "text-green-500",
  failed: "text-red-500",
  skipped: "text-zinc-400",
};

export function Plan({ steps, className }: PlanProps) {
  return (
    <div className={cn("space-y-1", className)}>
      {steps.map((step, i) => (
        <PlanStepItem key={step.id} step={step} index={i} />
      ))}
    </div>
  );
}

function PlanStepItem({ step, index }: { step: PlanStep; index: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-start gap-2 py-1">
        <span className={cn("text-sm mt-0.5", STATUS_COLORS[step.status])}>
          {STATUS_ICONS[step.status]}
        </span>
        <div className="flex-1 min-w-0">
          <div className={cn(
            "text-sm font-medium",
            step.status === "completed" && "line-through text-muted-foreground",
            step.status === "skipped" && "text-muted-foreground",
          )}>
            {index + 1}. {step.title}
          </div>
          {step.description && (
            <div className="text-xs text-muted-foreground mt-0.5">{step.description}</div>
          )}
        </div>
      </div>
      {step.substeps && step.substeps.length > 0 && (
        <div className="ml-6 border-l pl-3">
          {step.substeps.map((sub, i) => (
            <PlanStepItem key={sub.id} step={sub} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
