"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReplayEvent, ReplayEventType } from "./replay-engine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EventLogProps {
  currentIndex: number;
  events: ReplayEvent[];
  onSelectEvent: (index: number) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EVENT_TYPE_LABELS: Record<string, string> = {
  message: "Message",
  file_change: "File Change",
  tool_call: "Tool Call",
  terminal_output: "Terminal",
  agent_output: "Agent Output",
  reasoning: "Reasoning",
  approval: "Approval",
  error: "Error",
  plan_update: "Plan Update",
  task_status: "Task Status",
  checkpoint: "Checkpoint",
};

const EVENT_TYPE_COLORS: Record<string, string> = {
  message: "bg-zinc-500",
  file_change: "bg-blue-500",
  tool_call: "bg-violet-500",
  terminal_output: "bg-green-500",
  agent_output: "bg-emerald-500",
  reasoning: "bg-indigo-500",
  approval: "bg-yellow-500",
  error: "bg-red-500",
  plan_update: "bg-purple-500",
  task_status: "bg-amber-500",
  checkpoint: "bg-orange-500",
};

const FILTERABLE_TYPES: ReplayEventType[] = [
  "file_change",
  "terminal_output",
  "agent_output",
  "tool_call",
  "error",
  "reasoning",
  "plan_update",
  "task_status",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getEventSummary(data: Record<string, unknown>): string {
  if (typeof data.content === "string") {
    return data.content.slice(0, 120);
  }
  if (typeof data.message === "string") {
    return data.message.slice(0, 120);
  }
  if (typeof data.filePath === "string") {
    return data.filePath;
  }
  if (typeof data.path === "string") {
    return String(data.path);
  }
  return JSON.stringify(data).slice(0, 120);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EventLog({
  events,
  currentIndex,
  onSelectEvent,
}: EventLogProps) {
  const [search, setSearch] = useState("");
  const [activeFilters, setActiveFilters] = useState<Set<ReplayEventType>>(
    () => new Set(FILTERABLE_TYPES)
  );
  const activeRef = useRef<HTMLButtonElement>(null);

  // Auto-scroll to current event
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  const toggleFilter = useCallback((type: ReplayEventType) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  const filteredEvents = useMemo(() => {
    const lowerSearch = search.toLowerCase();
    return events
      .map((event, idx) => ({ event, originalIndex: idx }))
      .filter(({ event }) => {
        if (!activeFilters.has(event.type)) {
          return false;
        }
        if (lowerSearch) {
          const summary = getEventSummary(event.data).toLowerCase();
          const typeLabel = (EVENT_TYPE_LABELS[event.type] ?? "").toLowerCase();
          return (
            summary.includes(lowerSearch) || typeLabel.includes(lowerSearch)
          );
        }
        return true;
      });
  }, [events, activeFilters, search]);

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Search */}
      <div className="border-zinc-800 border-b px-3 py-2">
        <input
          aria-label="Search events"
          className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 placeholder-zinc-600 focus:border-violet-500 focus:outline-none"
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search events..."
          type="text"
          value={search}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-1 border-zinc-800 border-b px-3 py-2">
        {FILTERABLE_TYPES.map((type) => (
          <button
            className={[
              "rounded px-2 py-0.5 text-[10px] transition-colors",
              activeFilters.has(type)
                ? `${EVENT_TYPE_COLORS[type]} text-white`
                : "bg-zinc-800 text-zinc-500",
            ].join(" ")}
            key={type}
            onClick={() => toggleFilter(type)}
            type="button"
          >
            {EVENT_TYPE_LABELS[type] ?? type}
          </button>
        ))}
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-auto">
        {filteredEvents.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-xs text-zinc-600">
            No matching events
          </div>
        ) : (
          <div className="space-y-0.5 p-2">
            {filteredEvents.map(({ event, originalIndex }) => {
              const isCurrent = originalIndex === currentIndex;
              const dotColor = EVENT_TYPE_COLORS[event.type] ?? "bg-zinc-500";

              return (
                <button
                  className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-zinc-900/50 ${
                    isCurrent
                      ? "bg-violet-500/10 ring-1 ring-violet-500/30"
                      : ""
                  }`}
                  key={event.id}
                  onClick={() => onSelectEvent(originalIndex)}
                  ref={isCurrent ? activeRef : undefined}
                  type="button"
                >
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotColor}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[10px] text-zinc-500">
                        {EVENT_TYPE_LABELS[event.type] ?? event.type}
                      </span>
                      <span className="text-[10px] text-zinc-700">
                        {new Date(event.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                      {event.agentRole && (
                        <span className="rounded bg-zinc-800 px-1 py-0.5 text-[9px] text-zinc-500">
                          {event.agentRole}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-zinc-400">
                      {getEventSummary(event.data)}
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-[9px] text-zinc-700">
                    #{originalIndex + 1}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
