"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionEventType =
  | "message"
  | "file_change"
  | "tool_call"
  | "terminal_output"
  | "reasoning"
  | "approval"
  | "error";

export interface SessionEvent {
  data: Record<string, unknown>;
  id: string;
  timestamp: string;
  type: SessionEventType;
}

interface SessionReplayProps {
  events: SessionEvent[];
  sessionId: string;
}

type PlaybackSpeed = 0.5 | 1 | 2 | 4;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPEEDS: PlaybackSpeed[] = [0.5, 1, 2, 4];

const EVENT_TYPE_LABELS: Record<SessionEventType, string> = {
  message: "Message",
  file_change: "File Change",
  tool_call: "Tool Call",
  terminal_output: "Terminal",
  reasoning: "Reasoning",
  approval: "Approval",
  error: "Error",
};

const EVENT_TYPE_COLORS: Record<SessionEventType, string> = {
  message: "bg-zinc-500",
  file_change: "bg-blue-500",
  tool_call: "bg-violet-500",
  terminal_output: "bg-green-500",
  reasoning: "bg-indigo-500",
  approval: "bg-yellow-500",
  error: "bg-red-500",
};

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
  return JSON.stringify(data).slice(0, 120);
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ALL_TYPES: SessionEventType[] = [
  "message",
  "file_change",
  "tool_call",
  "terminal_output",
  "reasoning",
  "approval",
  "error",
];

export function SessionReplay({
  sessionId: _sessionId,
  events,
}: SessionReplayProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [activeFilters, setActiveFilters] = useState<Set<SessionEventType>>(
    () => new Set(ALL_TYPES)
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const filteredEvents = useMemo(
    () => events.filter((e) => activeFilters.has(e.type)),
    [events, activeFilters]
  );

  const toggleFilter = useCallback((type: SessionEventType) => {
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

  // Compute relative timestamps from first event
  const firstTimestamp = events[0]
    ? new Date(events[0].timestamp).getTime()
    : 0;
  const lastEvent = events.at(-1);
  const lastTimestamp = lastEvent ? new Date(lastEvent.timestamp).getTime() : 0;
  const totalDuration = lastTimestamp - firstTimestamp;

  const currentEvent = events[currentIndex];
  const currentTimeMs = currentEvent
    ? new Date(currentEvent.timestamp).getTime() - firstTimestamp
    : 0;

  const progress =
    totalDuration > 0 ? (currentTimeMs / totalDuration) * 100 : 0;

  // Playback logic
  useEffect(() => {
    if (!isPlaying || currentIndex >= events.length - 1) {
      if (currentIndex >= events.length - 1) {
        setIsPlaying(false);
      }
      return;
    }

    const nextEvent = events[currentIndex + 1];
    if (!(nextEvent && currentEvent)) {
      return;
    }

    const currentTs = new Date(currentEvent.timestamp).getTime();
    const nextTs = new Date(nextEvent.timestamp).getTime();
    const delay = Math.max(50, (nextTs - currentTs) / speed);

    timerRef.current = setTimeout(() => {
      setCurrentIndex((prev) => prev + 1);
    }, delay);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [isPlaying, currentIndex, speed, events, currentEvent]);

  const handlePlayPause = useCallback(() => {
    if (currentIndex >= events.length - 1) {
      setCurrentIndex(0);
      setIsPlaying(true);
    } else {
      setIsPlaying((p) => !p);
    }
  }, [currentIndex, events.length]);

  const handleScrub = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    setCurrentIndex(value);
    setIsPlaying(false);
  }, []);

  const handleSpeedChange = useCallback(() => {
    setSpeed((prev) => {
      const idx = SPEEDS.indexOf(prev);
      return SPEEDS[(idx + 1) % SPEEDS.length] ?? 1;
    });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) {
        return;
      }
      switch (e.key) {
        case " ":
          e.preventDefault();
          handlePlayPause();
          break;
        case "ArrowRight":
          setCurrentIndex((p) => Math.min(p + 1, filteredEvents.length - 1));
          setIsPlaying(false);
          break;
        case "ArrowLeft":
          setCurrentIndex((p) => Math.max(p - 1, 0));
          setIsPlaying(false);
          break;
        case "s":
          handleSpeedChange();
          break;
        case "Home":
          setCurrentIndex(0);
          setIsPlaying(false);
          break;
        case "End":
          setCurrentIndex(filteredEvents.length - 1);
          setIsPlaying(false);
          break;
        default:
          break;
      }
    };
    const el = containerRef.current;
    if (el) {
      el.addEventListener("keydown", handler);
      return () => el.removeEventListener("keydown", handler);
    }
  }, [handlePlayPause, handleSpeedChange, filteredEvents.length]);

  if (events.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-950 text-xs text-zinc-600">
        No events to replay
      </div>
    );
  }

  // Visible events up to current index
  const visibleEvents = filteredEvents.slice(0, currentIndex + 1);

  return (
    <div className="flex h-full flex-col bg-zinc-950" ref={containerRef}>
      {/* Event type filters */}
      <div className="flex flex-wrap gap-1 border-zinc-800 border-b px-3 py-2">
        {ALL_TYPES.map((type) => (
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
            {EVENT_TYPE_LABELS[type]}
          </button>
        ))}
      </div>

      {/* Event display area */}
      <div className="flex-1 overflow-auto p-3">
        <div className="space-y-1.5">
          {visibleEvents.map((event, idx) => {
            const isCurrent = idx === currentIndex;
            const dotColor = EVENT_TYPE_COLORS[event.type] ?? "bg-zinc-500";

            return (
              <div
                className={`flex items-start gap-2 rounded px-2 py-1 transition-colors ${
                  isCurrent ? "bg-violet-500/10" : ""
                }`}
                key={event.id}
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
                  </div>
                  <div className="mt-0.5 truncate text-xs text-zinc-400">
                    {getEventSummary(event.data)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Playback controls */}
      <div className="border-zinc-800 border-t px-4 py-3">
        {/* Timeline scrubber */}
        <div className="mb-2 flex items-center gap-2">
          <span className="font-mono text-[10px] text-zinc-500">
            {formatTime(currentTimeMs)}
          </span>
          <input
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-zinc-800 accent-violet-500"
            max={filteredEvents.length - 1}
            min={0}
            onChange={handleScrub}
            type="range"
            value={currentIndex}
          />
          <span className="font-mono text-[10px] text-zinc-500">
            {formatTime(totalDuration)}
          </span>
        </div>

        {/* Progress bar with event markers */}
        <div className="relative mb-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-violet-500 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Control buttons */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Play/Pause */}
            <button
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600 text-white hover:bg-violet-500"
              onClick={handlePlayPause}
              type="button"
            >
              {isPlaying ? (
                <svg
                  aria-hidden="true"
                  className="h-4 w-4"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
              ) : (
                <svg
                  aria-hidden="true"
                  className="h-4 w-4"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            {/* Speed control */}
            <button
              className="rounded border border-zinc-700 px-2 py-1 font-mono text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              onClick={handleSpeedChange}
              type="button"
            >
              {speed}x
            </button>
          </div>

          {/* Event counter */}
          <span className="text-[10px] text-zinc-600">
            Event {currentIndex + 1} / {filteredEvents.length}
          </span>
        </div>
      </div>
    </div>
  );
}
