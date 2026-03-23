"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSocket } from "@/hooks/use-socket";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TimelineEvent {
  agentRole: string;
  duration?: number;
  id: string;
  output?: string;
  status: "pending" | "running" | "success" | "failed";
  timestamp: string;
  toolName?: string;
  type:
    | "tool_call"
    | "tool_result"
    | "token"
    | "checkpoint"
    | "error"
    | "complete";
}

interface ExecutionTimelineProps {
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<
  TimelineEvent["status"],
  { dot: string; label: string; text: string }
> = {
  pending: {
    dot: "bg-zinc-400",
    label: "Pending",
    text: "text-zinc-400",
  },
  running: {
    dot: "bg-blue-400 animate-pulse",
    label: "Running",
    text: "text-blue-400",
  },
  success: {
    dot: "bg-green-400",
    label: "Success",
    text: "text-green-400",
  },
  failed: {
    dot: "bg-red-400",
    label: "Failed",
    text: "text-red-400",
  },
};

const TYPE_ICONS: Record<TimelineEvent["type"], string> = {
  tool_call:
    "M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085",
  tool_result: "M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  token:
    "M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z",
  checkpoint:
    "M3 3v1.5M3 21v-6m0 0 2.77-.693a9 9 0 0 1 6.208.682l.108.054a9 9 0 0 0 6.086.71l3.114-.732a48.524 48.524 0 0 1-.005-10.499l-3.11.732a9 9 0 0 1-6.085-.711l-.108-.054a9 9 0 0 0-6.208-.682L3 4.5M3 15V4.5",
  error:
    "M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z",
  complete:
    "M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z",
};

const TYPE_COLORS: Record<TimelineEvent["type"], string> = {
  tool_call: "text-violet-400",
  tool_result: "text-blue-400",
  token: "text-zinc-400",
  checkpoint: "text-yellow-400",
  error: "text-red-400",
  complete: "text-green-400",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTimestamp(ts: string): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExecutionTimeline({ sessionId }: ExecutionTimelineProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { on, isConnected, joinRoom, leaveRoom } = useSocket();

  // Join session room
  useEffect(() => {
    if (!isConnected) {
      return;
    }
    const room = `session:${sessionId}`;
    joinRoom(room);
    return () => {
      leaveRoom(room);
    };
  }, [sessionId, isConnected, joinRoom, leaveRoom]);

  // Listen for timeline events
  useEffect(() => {
    const cleanup = on("timeline:event", (...args: unknown[]) => {
      const data = args[0] as TimelineEvent;
      setEvents((prev) => [...prev, data]);
    });
    return cleanup;
  }, [on]);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  const handleClear = useCallback(() => {
    setEvents([]);
  }, []);

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between border-zinc-800 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            {isConnected && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            )}
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${
                isConnected ? "bg-green-500" : "bg-zinc-500"
              }`}
            />
          </span>
          <span className="font-medium text-xs text-zinc-300">
            Execution Timeline
          </span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
            {events.length} events
          </span>
        </div>
        {events.length > 0 && (
          <button
            className="text-[10px] text-zinc-500 hover:text-zinc-300"
            onClick={handleClear}
            type="button"
          >
            Clear
          </button>
        )}
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-auto" ref={scrollRef}>
        {events.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-xs text-zinc-600">
            Waiting for events...
          </div>
        ) : (
          <div className="relative pl-6">
            {/* Vertical line */}
            <div className="absolute top-0 bottom-0 left-[15px] w-px bg-zinc-800" />

            {events.map((event) => {
              const statusStyle = STATUS_STYLES[event.status];
              const typeColor = TYPE_COLORS[event.type];
              const iconPath = TYPE_ICONS[event.type];

              return (
                <div
                  className="relative flex items-start gap-3 py-2 pr-3"
                  key={event.id}
                >
                  {/* Dot */}
                  <div
                    className={`relative z-10 mt-1 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-zinc-950 ${statusStyle.dot}`}
                  />

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <svg
                        aria-hidden="true"
                        className={`h-3 w-3 shrink-0 ${typeColor}`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.5}
                        viewBox="0 0 24 24"
                      >
                        <path
                          d={iconPath}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                        {event.agentRole}
                      </span>
                      {event.toolName && (
                        <span className="font-medium font-mono text-[11px] text-zinc-200">
                          {event.toolName}
                        </span>
                      )}
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] ${statusStyle.text} bg-zinc-800`}
                      >
                        {statusStyle.label}
                      </span>
                      {event.duration !== undefined && (
                        <span className="ml-auto font-mono text-[10px] text-zinc-500">
                          {formatDuration(event.duration)}
                        </span>
                      )}
                    </div>

                    {/* Output preview */}
                    {event.output && (
                      <div className="mt-1 truncate font-mono text-[10px] text-zinc-500">
                        {event.output.slice(0, 120)}
                        {event.output.length > 120 ? "..." : ""}
                      </div>
                    )}

                    {/* Timestamp */}
                    <span className="mt-0.5 block text-[10px] text-zinc-600">
                      {formatTimestamp(event.timestamp)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export type { ExecutionTimelineProps, TimelineEvent };
