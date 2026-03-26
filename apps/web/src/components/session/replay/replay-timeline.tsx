"use client";

import { useCallback, useMemo } from "react";
import type { PlaybackSpeed, ReplayEvent, ReplayState } from "./replay-engine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReplayTimelineProps {
  events: ReplayEvent[];
  isPlaying: boolean;
  onPlayPause: () => void;
  onSeek: (index: number) => void;
  onSpeedChange: (speed: PlaybackSpeed) => void;
  speed: PlaybackSpeed;
  state: ReplayState;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPEEDS: PlaybackSpeed[] = [1, 2, 4, 8];

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReplayTimeline({
  events,
  state,
  isPlaying,
  speed,
  onPlayPause,
  onSeek,
  onSpeedChange,
}: ReplayTimelineProps) {
  const progress =
    state.totalDurationMs > 0
      ? (state.currentTimeMs / state.totalDurationMs) * 100
      : 0;

  // Compute event density for the heatmap visualization
  const densityBuckets = useMemo(() => {
    if (events.length === 0 || state.totalDurationMs === 0) {
      return [];
    }

    const bucketCount = 50;
    const buckets = new Array<number>(bucketCount).fill(0);
    const firstEvent = events[0];
    if (!firstEvent) {
      return [];
    }
    const firstTs = new Date(firstEvent.timestamp).getTime();

    for (const event of events) {
      const evtTs = new Date(event.timestamp).getTime();
      const relativeMs = evtTs - firstTs;
      const bucketIdx = Math.min(
        Math.floor((relativeMs / state.totalDurationMs) * bucketCount),
        bucketCount - 1
      );
      buckets[bucketIdx] = (buckets[bucketIdx] ?? 0) + 1;
    }

    const maxDensity = Math.max(...buckets, 1);
    return buckets.map((count) => count / maxDensity);
  }, [events, state.totalDurationMs]);

  // Event markers on the timeline
  const eventMarkers = useMemo(() => {
    if (events.length === 0 || state.totalDurationMs === 0) {
      return [];
    }

    const firstEvent = events[0];
    if (!firstEvent) {
      return [];
    }
    const firstTs = new Date(firstEvent.timestamp).getTime();
    return events.map((event, idx) => {
      const evtTs = new Date(event.timestamp).getTime();
      const positionPct = ((evtTs - firstTs) / state.totalDurationMs) * 100;
      return { event, idx, positionPct };
    });
  }, [events, state.totalDurationMs]);

  const handleScrub = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onSeek(Number(e.target.value));
    },
    [onSeek]
  );

  const handleSpeedCycle = useCallback(() => {
    const idx = SPEEDS.indexOf(speed);
    const nextSpeed = SPEEDS[(idx + 1) % SPEEDS.length] ?? 1;
    onSpeedChange(nextSpeed);
  }, [speed, onSpeedChange]);

  return (
    <div className="border-zinc-800 border-b bg-zinc-950 px-4 py-3">
      {/* Density heatmap */}
      {densityBuckets.length > 0 && (
        <div className="mb-2 flex h-3 gap-px overflow-hidden rounded">
          {Array.from(densityBuckets.entries()).map(([pos, density]) => (
            <div
              className="flex-1 rounded-sm transition-colors"
              key={`bucket-${pos}`}
              style={{
                backgroundColor: `rgba(139, 92, 246, ${0.1 + density * 0.6})`,
              }}
            />
          ))}
        </div>
      )}

      {/* Event markers on timeline */}
      <div className="relative mb-2 h-2">
        {eventMarkers.map(({ event, idx, positionPct }) => {
          const color = EVENT_TYPE_COLORS[event.type] ?? "bg-zinc-500";
          const isActive = idx === state.currentIndex;
          return (
            <button
              aria-label={`Event ${idx + 1}: ${event.type}`}
              className={`absolute top-0 h-2 w-1 rounded-full transition-transform ${color} ${
                isActive
                  ? "scale-150 ring-1 ring-white"
                  : "opacity-60 hover:opacity-100"
              }`}
              key={event.id}
              onClick={() => onSeek(idx)}
              style={{ left: `${positionPct}%` }}
              type="button"
            />
          );
        })}
      </div>

      {/* Scrubber */}
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-[10px] text-zinc-500">
          {formatTime(state.currentTimeMs)}
        </span>
        <input
          aria-label="Playback position"
          className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-zinc-800 accent-violet-500"
          max={Math.max(0, events.length - 1)}
          min={0}
          onChange={handleScrub}
          type="range"
          value={state.currentIndex}
        />
        <span className="font-mono text-[10px] text-zinc-500">
          {formatTime(state.totalDurationMs)}
        </span>
      </div>

      {/* Progress bar */}
      <div className="relative mb-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-violet-500 transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Play/Pause */}
          <button
            aria-label={isPlaying ? "Pause" : "Play"}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600 text-white hover:bg-violet-500"
            onClick={onPlayPause}
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

          {/* Step backward */}
          <button
            aria-label="Previous event"
            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
            disabled={state.currentIndex === 0}
            onClick={() => onSeek(Math.max(0, state.currentIndex - 1))}
            type="button"
          >
            <svg
              aria-hidden="true"
              className="h-3 w-3"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
            </svg>
          </button>

          {/* Step forward */}
          <button
            aria-label="Next event"
            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
            disabled={state.currentIndex >= events.length - 1}
            onClick={() =>
              onSeek(Math.min(events.length - 1, state.currentIndex + 1))
            }
            type="button"
          >
            <svg
              aria-hidden="true"
              className="h-3 w-3"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
            </svg>
          </button>

          {/* Speed control */}
          <button
            aria-label={`Playback speed: ${speed}x`}
            className="rounded border border-zinc-700 px-2 py-1 font-mono text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            onClick={handleSpeedCycle}
            type="button"
          >
            {speed}x
          </button>
        </div>

        {/* Event counter */}
        <span className="text-[10px] text-zinc-600">
          Event {state.currentIndex + 1} / {events.length}
        </span>
      </div>
    </div>
  );
}
