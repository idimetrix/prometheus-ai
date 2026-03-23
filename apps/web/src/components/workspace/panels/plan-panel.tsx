"use client";

import { useSessionStore } from "@/stores/session.store";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-zinc-500/20 text-zinc-400",
  running: "bg-blue-500/20 text-blue-400",
  completed: "bg-green-500/20 text-green-400",
  failed: "bg-red-500/20 text-red-400",
};

const ROLE_COLORS: Record<string, string> = {
  architect: "bg-violet-500/20 text-violet-400",
  "backend-coder": "bg-blue-500/20 text-blue-400",
  "frontend-coder": "bg-cyan-500/20 text-cyan-400",
  "test-engineer": "bg-green-500/20 text-green-400",
  "security-auditor": "bg-red-500/20 text-red-400",
  discovery: "bg-amber-500/20 text-amber-400",
  "ci-loop": "bg-orange-500/20 text-orange-400",
};

const STATUS_ICONS: Record<string, string> = {
  pending: "\u25CB",
  running: "\u25D4",
  completed: "\u2713",
  failed: "\u2717",
};

function StatusBadge({ status }: { status: string }) {
  const colorClass = STATUS_COLORS[status] ?? "bg-zinc-500/20 text-zinc-400";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-[10px] ${colorClass}`}
    >
      <span>{STATUS_ICONS[status] ?? "\u25CB"}</span>
      {status}
    </span>
  );
}

function RoleTag({ role }: { role: string }) {
  const colorClass = ROLE_COLORS[role] ?? "bg-zinc-500/20 text-zinc-400";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 font-medium text-[10px] ${colorClass}`}
    >
      {role}
    </span>
  );
}

function ProgressBar({ status }: { status: string }) {
  const widths: Record<string, string> = {
    pending: "w-0",
    running: "w-1/2",
    completed: "w-full",
    failed: "w-full",
  };

  const colors: Record<string, string> = {
    pending: "bg-zinc-700",
    running: "bg-blue-500",
    completed: "bg-green-500",
    failed: "bg-red-500",
  };

  return (
    <div className="h-1 w-full rounded-full bg-zinc-800">
      <div
        className={`h-1 rounded-full transition-all duration-500 ${widths[status] ?? "w-0"} ${colors[status] ?? "bg-zinc-700"}`}
      />
    </div>
  );
}

export function PlanPanel() {
  const planSteps = useSessionStore((s) => s.planSteps);
  const updatePlanStep = useSessionStore((s) => s.updatePlanStep);

  const completedCount = planSteps.filter(
    (s) => s.status === "completed"
  ).length;
  const totalCount = planSteps.length;

  if (planSteps.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <div className="text-sm text-zinc-600">No plan yet</div>
        <div className="mt-1 text-xs text-zinc-700">
          Plan steps will appear when the agent begins planning
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-zinc-800 border-b px-3 py-2">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-xs text-zinc-400 uppercase tracking-wider">
            Plan
          </h3>
          <span className="text-xs text-zinc-500">
            {completedCount}/{totalCount}
          </span>
        </div>
        <div className="mt-2 h-1.5 w-full rounded-full bg-zinc-800">
          <div
            className="h-1.5 rounded-full bg-violet-500 transition-all duration-300"
            style={{
              width:
                totalCount > 0
                  ? `${(completedCount / totalCount) * 100}%`
                  : "0%",
            }}
          />
        </div>
      </div>

      {/* Steps */}
      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {planSteps.map((step) => (
          <div
            className={`rounded-md border p-3 ${
              step.status === "running"
                ? "border-blue-500/30 bg-blue-500/5"
                : "border-zinc-800 bg-zinc-900/50"
            }`}
            key={step.id}
          >
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-300">{step.title}</span>
                  <StatusBadge status={step.status} />
                </div>
                {step.description && (
                  <div className="mt-1 text-[11px] text-zinc-500">
                    {step.description}
                  </div>
                )}
                {typeof (step as unknown as Record<string, unknown>).role ===
                  "string" && (
                  <div className="mt-1.5">
                    <RoleTag
                      role={
                        (step as unknown as Record<string, unknown>)
                          .role as string
                      }
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="mt-2">
              <ProgressBar status={step.status} />
            </div>

            {/* Approval gate */}
            {step.status === "pending" && (
              <div className="mt-2 flex gap-2">
                <button
                  className="rounded-md bg-green-600/20 px-3 py-1 text-green-400 text-xs transition-colors hover:bg-green-600/30"
                  onClick={() => updatePlanStep(step.id, { status: "running" })}
                  type="button"
                >
                  Approve
                </button>
                <button
                  className="rounded-md bg-red-600/20 px-3 py-1 text-red-400 text-xs transition-colors hover:bg-red-600/30"
                  onClick={() => updatePlanStep(step.id, { status: "failed" })}
                  type="button"
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
