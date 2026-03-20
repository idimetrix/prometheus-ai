"use client";

import { useCallback, useMemo, useState } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

type ReplayEventType =
  | "tool_call"
  | "file_change"
  | "text_output"
  | "error"
  | "checkpoint";

interface ReplayEvent {
  details: string;
  id: string;
  metadata?: Record<string, string>;
  timestamp: number;
  type: ReplayEventType;
}

interface SessionReplayProps {
  className?: string;
  duration: number;
  events: ReplayEvent[];
  onSeek?: (timestamp: number) => void;
  sessionId: string;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const EVENT_TYPE_COLOR: Record<ReplayEventType, string> = {
  checkpoint: "bg-purple-500",
  error: "bg-red-500",
  file_change: "bg-yellow-500",
  text_output: "bg-zinc-500",
  tool_call: "bg-blue-500",
};

const EVENT_TYPE_LABEL: Record<ReplayEventType, string> = {
  checkpoint: "Checkpoint",
  error: "Error",
  file_change: "File Change",
  text_output: "Output",
  tool_call: "Tool Call",
};

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function SessionReplay({
  sessionId,
  events,
  duration,
  onSeek,
  className = "",
}: SessionReplayProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<ReplayEventType | "all">("all");

  const filteredEvents = useMemo(
    () =>
      filterType === "all"
        ? events
        : events.filter((e) => e.type === filterType),
    [events, filterType]
  );

  const currentEvents = useMemo(
    () => filteredEvents.filter((e) => e.timestamp <= currentTime),
    [filteredEvents, currentTime]
  );

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId]
  );

  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const time = Number(e.target.value);
      setCurrentTime(time);
      onSeek?.(time);
    },
    [onSeek]
  );

  const handleEventClick = useCallback(
    (event: ReplayEvent) => {
      setSelectedEventId(event.id);
      setCurrentTime(event.timestamp);
      onSeek?.(event.timestamp);
    },
    [onSeek]
  );

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm text-zinc-200">
            Session Replay
          </h3>
          <span className="font-mono text-[10px] text-zinc-600">
            {sessionId}
          </span>
        </div>
        <span className="text-xs text-zinc-500">
          {events.length} events | {formatTime(duration)}
        </span>
      </div>

      {/* Timeline scrubber */}
      <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-zinc-500">
            {formatTime(currentTime)}
          </span>
          <input
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-zinc-800 accent-blue-500"
            max={duration}
            min={0}
            onChange={handleSliderChange}
            step={100}
            type="range"
            value={currentTime}
          />
          <span className="font-mono text-xs text-zinc-500">
            {formatTime(duration)}
          </span>
        </div>

        {/* Event markers on timeline */}
        <div className="relative mt-1 h-3">
          {events.map((event) => (
            <button
              className={`absolute top-0 h-3 w-1 rounded-full ${EVENT_TYPE_COLOR[event.type]} hover:scale-150`}
              key={event.id}
              onClick={() => handleEventClick(event)}
              style={{
                left:
                  duration > 0
                    ? `${(event.timestamp / duration) * 100}%`
                    : "0%",
              }}
              title={`${EVENT_TYPE_LABEL[event.type]}: ${event.details}`}
              type="button"
            />
          ))}
        </div>
      </div>

      {/* Type filters */}
      <div className="flex flex-wrap gap-1">
        {(
          [
            "all",
            "tool_call",
            "file_change",
            "text_output",
            "error",
            "checkpoint",
          ] as const
        ).map((type) => (
          <button
            className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs ${
              filterType === type
                ? "bg-blue-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
            key={type}
            onClick={() => setFilterType(type)}
            type="button"
          >
            {type !== "all" && (
              <div
                className={`h-1.5 w-1.5 rounded-full ${EVENT_TYPE_COLOR[type]}`}
              />
            )}
            {type === "all" ? "All" : EVENT_TYPE_LABEL[type]}
          </button>
        ))}
      </div>

      {/* Event list */}
      <div className="max-h-64 overflow-auto rounded-lg border border-zinc-700">
        {currentEvents.map((event) => (
          <button
            className={`flex w-full items-start gap-2 border-zinc-800 border-b px-3 py-2 text-left hover:bg-zinc-800/40 ${
              selectedEventId === event.id ? "bg-zinc-800/60" : ""
            }`}
            key={event.id}
            onClick={() => handleEventClick(event)}
            type="button"
          >
            <div
              className={`mt-1 h-2 w-2 shrink-0 rounded-full ${EVENT_TYPE_COLOR[event.type]}`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-zinc-500 uppercase">
                  {EVENT_TYPE_LABEL[event.type]}
                </span>
                <span className="font-mono text-[10px] text-zinc-600">
                  {formatTime(event.timestamp)}
                </span>
              </div>
              <span className="block truncate text-xs text-zinc-300">
                {event.details}
              </span>
            </div>
          </button>
        ))}
      </div>

      {/* Selected event detail */}
      {selectedEvent && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-3">
          <div className="flex items-center gap-2">
            <div
              className={`h-2 w-2 rounded-full ${EVENT_TYPE_COLOR[selectedEvent.type]}`}
            />
            <span className="font-medium text-xs text-zinc-300">
              {EVENT_TYPE_LABEL[selectedEvent.type]}
            </span>
            <span className="font-mono text-[10px] text-zinc-600">
              {formatTime(selectedEvent.timestamp)}
            </span>
          </div>
          <p className="mt-2 text-sm text-zinc-200">{selectedEvent.details}</p>
          {selectedEvent.metadata &&
            Object.keys(selectedEvent.metadata).length > 0 && (
              <div className="mt-2 flex flex-col gap-0.5">
                {Object.entries(selectedEvent.metadata).map(([key, value]) => (
                  <div className="flex gap-2 text-xs" key={key}>
                    <span className="text-zinc-500">{key}:</span>
                    <span className="font-mono text-zinc-400">{value}</span>
                  </div>
                ))}
              </div>
            )}
        </div>
      )}
    </div>
  );
}

export type { ReplayEvent, ReplayEventType, SessionReplayProps };
