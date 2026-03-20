"use client";

import { useMemo, useState } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

type TaskStatus = "pending" | "running" | "completed" | "failed" | "skipped";

interface PlanTask {
  dependsOn?: string[];
  description: string;
  id: string;
  label: string;
  status: TaskStatus;
}

interface PlanPhase {
  id: string;
  label: string;
  tasks: PlanTask[];
}

interface PlanViewerProps {
  className?: string;
  onTaskClick?: (taskId: string) => void;
  phases: PlanPhase[];
  title?: string;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const STATUS_ICON: Record<TaskStatus, string> = {
  completed: "[done]",
  failed: "[fail]",
  pending: "[ ]",
  running: "[...]",
  skipped: "[skip]",
};

const STATUS_COLOR: Record<TaskStatus, string> = {
  completed: "text-green-400",
  failed: "text-red-400",
  pending: "text-zinc-500",
  running: "text-blue-400 animate-pulse",
  skipped: "text-zinc-600",
};

function computePhaseProgress(tasks: PlanTask[]): number {
  if (tasks.length === 0) {
    return 0;
  }
  const done = tasks.filter(
    (t) => t.status === "completed" || t.status === "skipped"
  ).length;
  return Math.round((done / tasks.length) * 100);
}

/* -------------------------------------------------------------------------- */
/*  Sub-components                                                             */
/* -------------------------------------------------------------------------- */

function TaskRow({
  task,
  onClick,
}: {
  task: PlanTask;
  onClick?: (id: string) => void;
}) {
  return (
    <button
      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-zinc-800/60"
      onClick={() => onClick?.(task.id)}
      type="button"
    >
      <span className={`font-mono text-xs ${STATUS_COLOR[task.status]}`}>
        {STATUS_ICON[task.status]}
      </span>
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm text-zinc-200">
          {task.label}
        </span>
        <span className="block truncate text-xs text-zinc-500">
          {task.description}
        </span>
      </div>
    </button>
  );
}

function PhaseSection({
  phase,
  onTaskClick,
}: {
  phase: PlanPhase;
  onTaskClick?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const progress = useMemo(
    () => computePhaseProgress(phase.tasks),
    [phase.tasks]
  );

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900/40">
      {/* Phase header */}
      <button
        className="flex w-full items-center justify-between px-3 py-2"
        onClick={() => setExpanded((v) => !v)}
        type="button"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">{expanded ? "v" : ">"}</span>
          <span className="font-medium text-sm text-zinc-200">
            {phase.label}
          </span>
          <span className="text-xs text-zinc-500">
            ({phase.tasks.length} tasks)
          </span>
        </div>
        <span className="text-xs text-zinc-400">{progress}%</span>
      </button>

      {/* Progress bar */}
      <div className="mx-3 h-1 overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-blue-500 transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Tasks */}
      {expanded && (
        <div className="flex flex-col gap-0.5 px-2 py-2">
          {phase.tasks.map((task) => (
            <TaskRow key={task.id} onClick={onTaskClick} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main Component                                                             */
/* -------------------------------------------------------------------------- */

export function PlanViewer({
  phases,
  title = "Execution Plan",
  onTaskClick,
  className = "",
}: PlanViewerProps) {
  const totalTasks = phases.reduce((sum, p) => sum + p.tasks.length, 0);
  const completedTasks = phases.reduce(
    (sum, p) =>
      sum +
      p.tasks.filter((t) => t.status === "completed" || t.status === "skipped")
        .length,
    0
  );

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm text-zinc-200">{title}</h3>
        <span className="text-xs text-zinc-500">
          {completedTasks}/{totalTasks} tasks
        </span>
      </div>

      {/* Phases */}
      <div className="flex flex-col gap-2">
        {phases.map((phase) => (
          <PhaseSection
            key={phase.id}
            onTaskClick={onTaskClick}
            phase={phase}
          />
        ))}
      </div>
    </div>
  );
}

export type { PlanPhase, PlanTask, TaskStatus };
