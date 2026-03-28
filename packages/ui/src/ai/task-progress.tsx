import { cn } from "../lib/utils";

type TaskPhase = "planning" | "coding" | "testing" | "deploying" | "complete";

interface TaskProgressProps {
  className?: string;
  completedSteps: number;
  currentPhase: TaskPhase;
  estimatedTimeRemaining?: string;
  filesChanged?: number;
  totalSteps: number;
}

const PHASE_CONFIG: Record<
  TaskPhase,
  { color: string; icon: string; label: string }
> = {
  planning: { color: "bg-purple-500", icon: "📋", label: "Planning" },
  coding: { color: "bg-blue-500", icon: "💻", label: "Coding" },
  testing: { color: "bg-yellow-500", icon: "🧪", label: "Testing" },
  deploying: { color: "bg-orange-500", icon: "🚀", label: "Deploying" },
  complete: { color: "bg-green-500", icon: "✓", label: "Complete" },
};

const PHASE_ORDER: TaskPhase[] = [
  "planning",
  "coding",
  "testing",
  "deploying",
  "complete",
];

export function TaskProgress({
  currentPhase,
  totalSteps,
  completedSteps,
  filesChanged,
  estimatedTimeRemaining,
  className,
}: TaskProgressProps) {
  const config = PHASE_CONFIG[currentPhase];
  const progressPercent =
    totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
  const currentPhaseIndex = PHASE_ORDER.indexOf(currentPhase);

  return (
    <div className={cn("space-y-3 rounded-lg border p-3", className)}>
      {/* Phase badge and step counter */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-white text-xs",
              config.color
            )}
          >
            <span>{config.icon}</span>
            {config.label}
          </span>
        </div>
        <span className="text-muted-foreground text-xs">
          {completedSteps}/{totalSteps} steps
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            config.color
          )}
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Phase indicators */}
      <div className="flex items-center justify-between gap-1">
        {PHASE_ORDER.map((phase, index) => {
          const phaseConf = PHASE_CONFIG[phase];
          const isActive = index === currentPhaseIndex;
          const isCompleted = index < currentPhaseIndex;

          let phaseBarClass = "bg-muted";
          if (isCompleted) {
            phaseBarClass = "bg-green-500";
          } else if (isActive) {
            phaseBarClass = cn(phaseConf.color, "animate-pulse");
          }

          return (
            <div
              className="flex flex-1 flex-col items-center gap-0.5"
              key={phase}
            >
              <div className={cn("h-1.5 w-full rounded-full", phaseBarClass)} />
              <span
                className={cn(
                  "text-[10px]",
                  isActive
                    ? "font-medium text-foreground"
                    : "text-muted-foreground"
                )}
              >
                {phaseConf.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Footer stats */}
      <div className="flex items-center gap-3 text-muted-foreground text-xs">
        {filesChanged !== undefined && filesChanged > 0 && (
          <span>
            {filesChanged} file{filesChanged === 1 ? "" : "s"} changed
          </span>
        )}
        {estimatedTimeRemaining && (
          <span className="ml-auto">~{estimatedTimeRemaining} remaining</span>
        )}
      </div>
    </div>
  );
}
