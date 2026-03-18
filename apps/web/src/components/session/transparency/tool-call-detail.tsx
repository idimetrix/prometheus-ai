"use client";

import { useMemo, useState } from "react";
import { useSessionStore } from "@/stores/session.store";

interface ToolCall {
  durationMs: number | null;
  id: string;
  input: Record<string, unknown> | null;
  output: string | null;
  status: "pending" | "success" | "error";
  timestamp: string;
  toolName: string;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: complex but well-structured logic
function extractToolCalls(
  events: Array<{
    id: string;
    type: string;
    data: Record<string, unknown>;
    timestamp: string;
  }>
): ToolCall[] {
  const calls: ToolCall[] = [];

  for (const event of events) {
    const data = event.data ?? {};

    if (
      event.type === "tool_call" ||
      (event.type === "agent_output" && typeof data.toolName === "string")
    ) {
      calls.push({
        id: event.id,
        toolName: String(data.toolName ?? "unknown"),
        input:
          (data.input as Record<string, unknown> | null) ??
          (data.toolInput as Record<string, unknown> | null) ??
          null,
        output: null,
        status: "pending",
        timestamp: event.timestamp,
        durationMs: null,
      });
    }

    if (event.type === "tool_result") {
      const matchName = String(data.toolName ?? "");
      // Match to the last pending call with same tool name
      for (let i = calls.length - 1; i >= 0; i--) {
        if (
          calls[i]?.toolName === matchName &&
          calls[i]?.status === "pending"
        ) {
          calls[i] = {
            ...(calls[i] as (typeof calls)[0]),
            output: data.output ? String(data.output) : null,
            status: data.error ? "error" : "success",
            durationMs:
              typeof data.durationMs === "number" ? data.durationMs : null,
          };
          break;
        }
      }
    }
  }

  return calls;
}

function ToolCallCard({ call }: { call: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  const statusBadge = {
    pending: { text: "Running", color: "text-amber-400 bg-amber-500/10" },
    success: { text: "Success", color: "text-green-400 bg-green-500/10" },
    error: { text: "Error", color: "text-red-400 bg-red-500/10" },
  }[call.status];

  return (
    <div className="rounded-lg border border-zinc-800/50 bg-zinc-950/50">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <svg
          aria-hidden="true"
          className={`h-3 w-3 shrink-0 text-zinc-600 transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            d="m8.25 4.5 7.5 7.5-7.5 7.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="font-medium font-mono text-blue-400 text-xs">
          {call.toolName}
        </span>
        <span
          className={`rounded px-1.5 py-0.5 font-medium text-[9px] ${statusBadge.color}`}
        >
          {statusBadge.text}
        </span>
        {call.durationMs !== null && (
          <span className="text-[9px] text-zinc-600">{call.durationMs}ms</span>
        )}
        <span className="ml-auto text-[9px] text-zinc-700">
          {new Date(call.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </span>
      </button>
      {expanded && (
        <div className="space-y-2 border-zinc-800/50 border-t px-3 py-2">
          {call.input && (
            <div>
              <div className="mb-1 font-medium text-[10px] text-zinc-500">
                Input
              </div>
              <pre className="max-h-32 overflow-auto rounded bg-zinc-900 p-2 text-[10px] text-zinc-400">
                {JSON.stringify(call.input, null, 2)}
              </pre>
            </div>
          )}
          {call.output && (
            <div>
              <div className="mb-1 font-medium text-[10px] text-zinc-500">
                Output
              </div>
              <pre className="max-h-32 overflow-auto rounded bg-zinc-900 p-2 text-[10px] text-zinc-400">
                {call.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ToolCallDetail() {
  const { events } = useSessionStore();
  const calls = useMemo(() => extractToolCalls(events), [events]);

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
            d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.049.58.025 1.193-.14 1.743"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="font-medium text-xs text-zinc-400">Tool Calls</span>
        <span className="ml-auto rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
          {calls.length}
        </span>
      </div>
      <div className="flex-1 overflow-auto p-2">
        {calls.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">
            No tool calls yet
          </div>
        ) : (
          <div className="space-y-1">
            {calls.map((call) => (
              <ToolCallCard call={call} key={call.id} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
