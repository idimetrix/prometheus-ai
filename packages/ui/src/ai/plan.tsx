import { cn } from "../lib/utils";

interface PlanStep {
  description?: string;
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  substeps?: PlanStep[];
  title: string;
}

interface PlanProps {
  className?: string;
  steps: PlanStep[];
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
        <PlanStepItem index={i} key={step.id} step={step} />
      ))}
    </div>
  );
}

function PlanStepItem({ step, index }: { step: PlanStep; index: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-start gap-2 py-1">
        <span className={cn("mt-0.5 text-sm", STATUS_COLORS[step.status])}>
          {STATUS_ICONS[step.status]}
        </span>
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "font-medium text-sm",
              step.status === "completed" &&
                "text-muted-foreground line-through",
              step.status === "skipped" && "text-muted-foreground"
            )}
          >
            {index + 1}. {step.title}
          </div>
          {step.description && (
            <div className="mt-0.5 text-muted-foreground text-xs">
              {step.description}
            </div>
          )}
        </div>
      </div>
      {step.substeps && step.substeps.length > 0 && (
        <div className="ml-6 border-l pl-3">
          {step.substeps.map((sub, i) => (
            <PlanStepItem index={i} key={sub.id} step={sub} />
          ))}
        </div>
      )}
    </div>
  );
}
