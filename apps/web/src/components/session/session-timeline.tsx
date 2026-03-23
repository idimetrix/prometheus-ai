"use client";

import { useCallback, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TimelineEventType =
  | "file_change"
  | "tool_call"
  | "approval"
  | "error"
  | "reasoning"
  | "checkpoint"
  | "message";

export interface TimelineEvent {
  data?: Record<string, unknown>;
  description: string;
  id: string;
  timestamp: string;
  type: TimelineEventType;
}

interface SessionTimelineProps {
  events: TimelineEvent[];
  onSelectEvent?: (eventId: string) => void;
  selectedEventId?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EVENT_STYLES: Record<
  TimelineEventType,
  { color: string; dot: string; icon: string }
> = {
  file_change: {
    color: "text-blue-400",
    dot: "bg-blue-400",
    icon: "M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z",
  },
  tool_call: {
    color: "text-violet-400",
    dot: "bg-violet-400",
    icon: "M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085",
  },
  approval: {
    color: "text-yellow-400",
    dot: "bg-yellow-400",
    icon: "M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z",
  },
  error: {
    color: "text-red-400",
    dot: "bg-red-400",
    icon: "M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z",
  },
  reasoning: {
    color: "text-indigo-400",
    dot: "bg-indigo-400",
    icon: "M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18",
  },
  checkpoint: {
    color: "text-green-400",
    dot: "bg-green-400",
    icon: "M3 3v1.5M3 21v-6m0 0 2.77-.693a9 9 0 0 1 6.208.682l.108.054a9 9 0 0 0 6.086.71l3.114-.732a48.524 48.524 0 0 1-.005-10.499l-3.11.732a9 9 0 0 1-6.085-.711l-.108-.054a9 9 0 0 0-6.208-.682L3 4.5M3 15V4.5",
  },
  message: {
    color: "text-zinc-400",
    dot: "bg-zinc-400",
    icon: "M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z",
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SessionTimeline({
  events,
  onSelectEvent,
  selectedEventId,
}: SessionTimelineProps) {
  const [filter, setFilter] = useState<TimelineEventType | "all">("all");

  const filteredEvents = useMemo(() => {
    if (filter === "all") {
      return events;
    }
    return events.filter((e) => e.type === filter);
  }, [events, filter]);

  const handleSelect = useCallback(
    (id: string) => {
      onSelectEvent?.(id);
    },
    [onSelectEvent]
  );

  const filterOptions: Array<{
    label: string;
    value: TimelineEventType | "all";
  }> = [
    { value: "all", label: "All" },
    { value: "file_change", label: "Files" },
    { value: "tool_call", label: "Tools" },
    { value: "approval", label: "Approvals" },
    { value: "error", label: "Errors" },
    { value: "reasoning", label: "Reasoning" },
    { value: "checkpoint", label: "Checkpoints" },
  ];

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-1 border-zinc-800 border-b px-3 py-2">
        {filterOptions.map((opt) => (
          <button
            className={`rounded-full px-2 py-0.5 text-[10px] transition-colors ${
              filter === opt.value
                ? "bg-violet-500/20 text-violet-300"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            key={opt.value}
            onClick={() => setFilter(opt.value)}
            type="button"
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-auto">
        {filteredEvents.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-xs text-zinc-600">
            No events to display
          </div>
        ) : (
          <div className="relative pl-6">
            {/* Vertical line */}
            <div className="absolute top-0 bottom-0 left-[15px] w-px bg-zinc-800" />

            {filteredEvents.map((event) => {
              const style = EVENT_STYLES[event.type];
              const isSelected = event.id === selectedEventId;

              return (
                <button
                  className={`relative flex w-full items-start gap-3 py-2 pr-3 text-left transition-colors hover:bg-zinc-900/50 ${
                    isSelected ? "bg-violet-500/5" : ""
                  }`}
                  key={event.id}
                  onClick={() => handleSelect(event.id)}
                  type="button"
                >
                  {/* Dot */}
                  <div
                    className={`relative z-10 mt-1 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-zinc-950 ${style.dot}`}
                  />

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <svg
                        aria-hidden="true"
                        className={`h-3 w-3 shrink-0 ${style.color}`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.5}
                        viewBox="0 0 24 24"
                      >
                        <path
                          d={style.icon}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <span className="truncate text-xs text-zinc-300">
                        {event.description}
                      </span>
                    </div>
                    <span className="mt-0.5 block text-[10px] text-zinc-600">
                      {new Date(event.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
