"use client";

import { useEffect, useMemo, useRef } from "react";
import { useSessionStore } from "@/stores/session.store";

interface TimelineEntry {
  color: string;
  detail?: string;
  id: string;
  label: string;
  relativeMs: number;
  timestamp: string;
  type: string;
}

const TYPE_COLORS: Record<string, string> = {
  reasoning: "bg-violet-500",
  agent_output: "bg-blue-500",
  tool_call: "bg-amber-500",
  tool_result: "bg-green-500",
  file_diff: "bg-cyan-500",
  code_change: "bg-cyan-500",
  file_change: "bg-teal-500",
  plan_update: "bg-indigo-500",
  task_status: "bg-emerald-500",
  error: "bg-red-500",
  checkpoint: "bg-yellow-500",
  confidence: "bg-purple-500",
  credit_update: "bg-orange-500",
};

const TYPE_LABELS: Record<string, string> = {
  reasoning: "Thinking",
  agent_output: "Output",
  tool_call: "Tool Call",
  tool_result: "Tool Result",
  file_diff: "File Diff",
  code_change: "Code Change",
  file_change: "File Change",
  plan_update: "Plan Update",
  task_status: "Status",
  error: "Error",
  checkpoint: "Checkpoint",
  confidence: "Confidence",
  credit_update: "Credits",
};

function extractEventDetail(
  type: string,
  data: Record<string, unknown>
): string | undefined {
  if (type === "tool_call" && data.tool) {
    return `${data.tool}(${JSON.stringify(data.args ?? {}).slice(0, 60)})`;
  }
  if (type === "tool_result" && data.tool) {
    return `${data.tool}: ${data.success ? "ok" : "failed"}`;
  }
  if (type === "file_change" && data.filePath) {
    return String(data.filePath);
  }
  if (type === "confidence") {
    return `Score: ${Number(data.confidence ?? data.score ?? 0).toFixed(2)}`;
  }
  if (type === "reasoning" && data.content) {
    return String(data.content).slice(0, 80);
  }
  if (type === "checkpoint") {
    return String(data.reason ?? data.checkpointType ?? "");
  }
  if (type === "error" && data.error) {
    return String(
      typeof data.error === "string"
        ? data.error
        : ((data.error as Record<string, unknown>).message ?? "")
    ).slice(0, 80);
  }
  return undefined;
}

export function TimelineView() {
  const { events } = useSessionStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  const timeline = useMemo(() => {
    if (events.length === 0) {
      return [];
    }

    const baseTime = new Date(events[0]?.timestamp ?? 0).getTime();

    return events.map((event): TimelineEntry => {
      const data = event.data as Record<string, unknown>;
      const detail = extractEventDetail(event.type, data);

      return {
        id: event.id,
        type: event.type,
        label: TYPE_LABELS[event.type] ?? event.type.replace(/_/g, " "),
        timestamp: event.timestamp,
        relativeMs: new Date(event.timestamp).getTime() - baseTime,
        color: TYPE_COLORS[event.type] ?? "bg-zinc-500",
        detail,
      };
    });
  }, [events]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  const totalDuration =
    timeline.length > 0 ? (timeline.at(-1)?.relativeMs ?? 0) : 0;

  const formatDuration = (ms: number) => {
    if (ms < 1000) {
      return `${ms}ms`;
    }
    if (ms < 60_000) {
      return `${(ms / 1000).toFixed(1)}s`;
    }
    return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
  };

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
            d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="font-medium text-xs text-zinc-400">Timeline</span>
        {totalDuration > 0 && (
          <span className="ml-auto text-[10px] text-zinc-600">
            Total: {formatDuration(totalDuration)}
          </span>
        )}
      </div>
      <div className="flex-1 overflow-auto p-3" ref={scrollRef}>
        {timeline.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">
            No events yet
          </div>
        ) : (
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute top-0 bottom-0 left-[7px] w-px bg-zinc-800" />

            <div className="space-y-2">
              {timeline.map((entry, i) => {
                const gap =
                  i > 0
                    ? entry.relativeMs - (timeline[i - 1]?.relativeMs ?? 0)
                    : 0;

                return (
                  <div key={entry.id}>
                    {/* Show time gap if > 500ms */}
                    {gap > 500 && (
                      <div className="ml-4 py-0.5 text-[9px] text-zinc-700">
                        +{formatDuration(gap)}
                      </div>
                    )}
                    <div className="flex items-start gap-3">
                      <div
                        className={`mt-1 h-[15px] w-[15px] shrink-0 rounded-full border-2 border-zinc-900 ${entry.color}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-[11px] text-zinc-300">
                            {entry.label}
                          </span>
                          <span className="text-[9px] text-zinc-700">
                            {new Date(entry.timestamp).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            })}
                          </span>
                          <span className="text-[9px] text-zinc-700">
                            +{formatDuration(entry.relativeMs)}
                          </span>
                        </div>
                        {entry.detail && (
                          <div className="mt-0.5 truncate text-[10px] text-zinc-500">
                            {entry.detail}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
