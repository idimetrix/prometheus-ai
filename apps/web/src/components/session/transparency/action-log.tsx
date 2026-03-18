"use client";

import type { JSX } from "react";
import { useEffect, useMemo, useRef } from "react";
import { type SessionEvent, useSessionStore } from "@/stores/session.store";

type StepPhase =
  | "thinking"
  | "tool_select"
  | "executing"
  | "result"
  | "error"
  | "unknown";

interface ActionEntry {
  agentRole: string | null;
  detail: string | null;
  id: string;
  phase: StepPhase;
  summary: string;
  timestamp: string;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: complex but well-structured logic
function classifyEvent(event: SessionEvent): ActionEntry {
  const data = event.data ?? {};
  let phase: StepPhase = "unknown";
  let summary = event.type;
  let detail: string | null = null;

  switch (event.type) {
    case "reasoning":
      phase = "thinking";
      summary = "Reasoning";
      detail = String(data.content ?? data.thought ?? "");
      break;
    case "agent_output":
      if (
        typeof data.content === "string" &&
        data.content.startsWith("[THINK]")
      ) {
        phase = "thinking";
        summary = "Agent thinking";
        detail = data.content.replace("[THINK] ", "");
      } else if (typeof data.toolName === "string") {
        phase = "executing";
        summary = `Running tool: ${data.toolName}`;
        detail = data.toolInput
          ? JSON.stringify(data.toolInput, null, 2)
          : null;
      } else {
        phase = "result";
        summary = "Agent output";
        detail = String(data.content ?? "");
      }
      break;
    case "tool_call":
      phase = "tool_select";
      summary = `Selected tool: ${String(data.toolName ?? "unknown")}`;
      detail = data.input ? JSON.stringify(data.input, null, 2) : null;
      break;
    case "tool_result":
      phase = "result";
      summary = `Tool result: ${String(data.toolName ?? "unknown")}`;
      detail = data.output ? String(data.output).slice(0, 500) : null;
      break;
    case "task_status":
      phase = "result";
      summary = `Task status: ${String(data.status ?? "unknown")}`;
      break;
    case "file_diff":
    case "code_change":
      phase = "result";
      summary = `File changed: ${String(data.filePath ?? "unknown")}`;
      detail = data.diff ? String(data.diff).slice(0, 300) : null;
      break;
    case "plan_update":
      phase = "result";
      summary = "Plan updated";
      break;
    case "error":
      phase = "error";
      summary = "Error";
      detail = String(data.message ?? data.error ?? "");
      break;
    default:
      summary = event.type.replace(/_/g, " ");
      detail = JSON.stringify(data).slice(0, 200);
  }

  return {
    id: event.id,
    phase,
    agentRole: typeof data.agentRole === "string" ? data.agentRole : null,
    summary,
    detail,
    timestamp: event.timestamp,
  };
}

const PHASE_STYLES: Record<
  StepPhase,
  { icon: string; color: string; bg: string }
> = {
  thinking: { icon: "brain", color: "text-violet-400", bg: "bg-violet-500/10" },
  tool_select: { icon: "wrench", color: "text-blue-400", bg: "bg-blue-500/10" },
  executing: { icon: "play", color: "text-amber-400", bg: "bg-amber-500/10" },
  result: { icon: "check", color: "text-green-400", bg: "bg-green-500/10" },
  error: { icon: "x", color: "text-red-400", bg: "bg-red-500/10" },
  unknown: { icon: "dot", color: "text-zinc-400", bg: "bg-zinc-500/10" },
};

function PhaseIcon({ phase }: { phase: StepPhase }) {
  const style = PHASE_STYLES[phase];
  const iconMap: Record<string, JSX.Element> = {
    brain: (
      <svg
        aria-hidden="true"
        className={`h-3 w-3 ${style.color}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        viewBox="0 0 24 24"
      >
        <path
          d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
    wrench: (
      <svg
        aria-hidden="true"
        className={`h-3 w-3 ${style.color}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        viewBox="0 0 24 24"
      >
        <path
          d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.049.58.025 1.193-.14 1.743"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
    play: (
      <svg
        aria-hidden="true"
        className={`h-3 w-3 ${style.color}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        viewBox="0 0 24 24"
      >
        <path
          d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
    check: (
      <svg
        aria-hidden="true"
        className={`h-3 w-3 ${style.color}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
      >
        <path
          d="m4.5 12.75 6 6 9-13.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
    x: (
      <svg
        aria-hidden="true"
        className={`h-3 w-3 ${style.color}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
      >
        <path
          d="M6 18 18 6M6 6l12 12"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
    dot: (
      <div
        className={`h-1.5 w-1.5 rounded-full ${style.color.replace("text-", "bg-")}`}
      />
    ),
  };

  return (
    <div
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${style.bg}`}
    >
      {iconMap[style.icon]}
    </div>
  );
}

export function ActionLog() {
  const { events } = useSessionStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  const actions = useMemo(() => events.map(classifyEvent), [events]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-800 bg-zinc-900/50">
      <div className="flex items-center gap-2 border-zinc-800 border-b px-3 py-2">
        <svg
          aria-hidden="true"
          className="h-3.5 w-3.5 text-zinc-500"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="font-medium text-xs text-zinc-400">Action Log</span>
        <span className="ml-auto rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
          {actions.length} steps
        </span>
      </div>
      <div className="flex-1 overflow-auto p-2" ref={scrollRef}>
        {actions.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">
            No actions yet
          </div>
        ) : (
          <div className="space-y-1">
            {actions.map((action) => (
              <div
                className="group flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-800/30"
                key={action.id}
              >
                <PhaseIcon phase={action.phase} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-medium text-xs ${PHASE_STYLES[action.phase].color}`}
                    >
                      {action.summary}
                    </span>
                    {action.agentRole && (
                      <span className="rounded bg-zinc-800 px-1 py-0.5 text-[9px] text-zinc-500">
                        {action.agentRole}
                      </span>
                    )}
                    <span className="ml-auto text-[9px] text-zinc-700">
                      {new Date(action.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                  </div>
                  {action.detail && (
                    <pre className="mt-0.5 max-h-16 overflow-hidden truncate text-[10px] text-zinc-600 group-hover:max-h-40 group-hover:overflow-auto group-hover:whitespace-pre-wrap">
                      {action.detail}
                    </pre>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
