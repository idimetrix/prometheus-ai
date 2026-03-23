"use client";

import { useMemo } from "react";
import { useSessionStore } from "@/stores/session.store";

interface PipelinePhase {
  id: string;
  label: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
}

const DEFAULT_PHASES: PipelinePhase[] = [
  { id: "discovery", label: "Discovery", status: "pending" },
  { id: "architecture", label: "Architect", status: "pending" },
  { id: "planning", label: "Planner", status: "pending" },
  { id: "spec_first", label: "Spec", status: "pending" },
  { id: "coding", label: "Coder", status: "pending" },
  { id: "testing", label: "Test", status: "pending" },
  { id: "ci_loop", label: "CI", status: "pending" },
  { id: "security", label: "Security", status: "pending" },
  { id: "deploy", label: "Deploy", status: "pending" },
];

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-zinc-800 text-zinc-500 border-zinc-700",
  running: "bg-blue-500/10 text-blue-400 border-blue-500 animate-pulse",
  completed: "bg-green-500/10 text-green-400 border-green-500",
  failed: "bg-red-500/10 text-red-400 border-red-500",
  skipped: "bg-zinc-800 text-zinc-600 border-zinc-700",
};

interface PipelineViewProps {
  sessionId: string;
}

export function PipelineView({ sessionId: _sessionId }: PipelineViewProps) {
  const { events } = useSessionStore();

  const phases = useMemo(() => {
    const phaseMap = new Map(DEFAULT_PHASES.map((p) => [p.id, { ...p }]));

    for (const event of events) {
      if (event.type === "plan_update") {
        const data = event.data as { phase?: string; status?: string };
        if (data.phase && phaseMap.has(data.phase)) {
          const phase = phaseMap.get(data.phase);
          if (phase && data.status) {
            phase.status = data.status as PipelinePhase["status"];
          }
        }
      }
    }

    return Array.from(phaseMap.values());
  }, [events]);

  return (
    <div className="flex items-center gap-1 overflow-x-auto px-4 py-3">
      {phases.map((phase, i) => (
        <div className="flex items-center" key={phase.id}>
          <div
            className={`flex items-center justify-center rounded-lg border px-3 py-1.5 font-medium text-xs transition-all ${STATUS_STYLES[phase.status] ?? ""}`}
          >
            {phase.status === "running" && (
              <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-blue-400" />
            )}
            {phase.status === "completed" && (
              <span className="mr-1.5">&#10003;</span>
            )}
            {phase.status === "failed" && (
              <span className="mr-1.5">&#10007;</span>
            )}
            {phase.label}
          </div>
          {i < phases.length - 1 && (
            <div
              className={`mx-1 h-px w-4 ${
                phase.status === "completed" ? "bg-green-500" : "bg-zinc-700"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}
