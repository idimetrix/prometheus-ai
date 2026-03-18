"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface ReplayEvent {
  agentRole?: string | null;
  data: unknown;
  id: string;
  timestamp: string;
  type: string;
}

interface SessionReplayProps {
  events: ReplayEvent[];
  sessionId: string;
}

type PlaybackState = "stopped" | "playing" | "paused";

/**
 * Session Replay — replay past agent sessions step by step.
 * Shows a timeline scrubber with play/pause/speed controls.
 */
export function SessionReplay({ events, sessionId }: SessionReplayProps) {
  const [playbackState, setPlaybackState] = useState<PlaybackState>("stopped");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [visibleEvents, setVisibleEvents] = useState<ReplayEvent[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const sortedEvents = [...events].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const totalEvents = sortedEvents.length;
  const progress = totalEvents > 0 ? (currentIndex / totalEvents) * 100 : 0;

  const currentEvent = sortedEvents[currentIndex];

  // Calculate delay between events based on actual timestamps
  const getDelay = useCallback(
    (index: number): number => {
      if (index >= totalEvents - 1) {
        return 0;
      }
      const current = new Date(sortedEvents[index]?.timestamp).getTime();
      const next = new Date(sortedEvents[index + 1]?.timestamp).getTime();
      const realDelay = next - current;
      // Cap at 3 seconds, minimum 100ms, adjusted by speed
      return Math.max(100, Math.min(3000, realDelay)) / speed;
    },
    [sortedEvents, totalEvents, speed]
  );

  const advance = useCallback(() => {
    setCurrentIndex((prev) => {
      const next = prev + 1;
      if (next >= totalEvents) {
        setPlaybackState("stopped");
        return prev;
      }
      setVisibleEvents((ve) => [...ve, sortedEvents[next]!]);
      return next;
    });
  }, [totalEvents, sortedEvents]);

  // Playback loop
  useEffect(() => {
    if (playbackState !== "playing") {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      return;
    }

    const scheduleNext = () => {
      const delay = getDelay(currentIndex);
      timerRef.current = setTimeout(() => {
        advance();
        scheduleNext();
      }, delay);
    };

    scheduleNext();

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [playbackState, currentIndex, advance, getDelay]);

  // Auto-scroll on new events
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, []);

  const play = () => {
    if (currentIndex >= totalEvents - 1) {
      // Restart from beginning
      setCurrentIndex(0);
      setVisibleEvents([sortedEvents[0]!].filter(Boolean));
    }
    setPlaybackState("playing");
  };

  const pause = () => setPlaybackState("paused");

  const stop = () => {
    setPlaybackState("stopped");
    setCurrentIndex(0);
    setVisibleEvents([]);
  };

  const seekTo = (index: number) => {
    const clamped = Math.max(0, Math.min(index, totalEvents - 1));
    setCurrentIndex(clamped);
    setVisibleEvents(sortedEvents.slice(0, clamped + 1));
  };

  const stepForward = () => {
    if (currentIndex < totalEvents - 1) {
      const next = currentIndex + 1;
      setCurrentIndex(next);
      setVisibleEvents((ve) => [...ve, sortedEvents[next]!]);
    }
  };

  const stepBackward = () => {
    if (currentIndex > 0) {
      const prev = currentIndex - 1;
      setCurrentIndex(prev);
      setVisibleEvents(sortedEvents.slice(0, prev + 1));
    }
  };

  const formatTime = (timestamp: string) => {
    const d = new Date(timestamp);
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const getEventColor = (type: string) => {
    const colors: Record<string, string> = {
      agent_output: "bg-blue-500",
      file_change: "bg-green-500",
      plan_update: "bg-purple-500",
      task_status: "bg-yellow-500",
      terminal_output: "bg-gray-500",
      error: "bg-red-500",
      checkpoint: "bg-orange-500",
      credit_update: "bg-cyan-500",
      reasoning: "bg-indigo-500",
    };
    return colors[type] ?? "bg-gray-400";
  };

  return (
    <div className="flex h-full flex-col rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between border-zinc-200 border-b px-4 py-2 dark:border-zinc-700">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm dark:text-zinc-200">
            Session Replay
          </span>
          <span className="text-xs text-zinc-500">{sessionId}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span>
            {currentIndex + 1} / {totalEvents} events
          </span>
          {currentEvent && (
            <span className="text-zinc-400">
              {formatTime(currentEvent.timestamp)}
            </span>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 border-zinc-200 border-b px-4 py-2 dark:border-zinc-700">
        {/* Playback buttons */}
        <button
          className="rounded bg-zinc-100 px-2 py-1 text-xs hover:bg-zinc-200 disabled:opacity-30 dark:bg-zinc-800 dark:hover:bg-zinc-700"
          disabled={currentIndex === 0}
          onClick={stepBackward}
        >
          ⏮
        </button>
        {playbackState === "playing" ? (
          <button
            className="rounded bg-yellow-100 px-3 py-1 text-xs text-yellow-700 hover:bg-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400"
            onClick={pause}
          >
            ⏸ Pause
          </button>
        ) : (
          <button
            className="rounded bg-green-100 px-3 py-1 text-green-700 text-xs hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400"
            onClick={play}
          >
            ▶ Play
          </button>
        )}
        <button
          className="rounded bg-zinc-100 px-2 py-1 text-xs hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
          onClick={stop}
        >
          ⏹
        </button>
        <button
          className="rounded bg-zinc-100 px-2 py-1 text-xs hover:bg-zinc-200 disabled:opacity-30 dark:bg-zinc-800 dark:hover:bg-zinc-700"
          disabled={currentIndex >= totalEvents - 1}
          onClick={stepForward}
        >
          ⏭
        </button>

        {/* Speed control */}
        <div className="ml-4 flex items-center gap-1">
          <span className="text-xs text-zinc-500">Speed:</span>
          {[0.5, 1, 2, 5].map((s) => (
            <button
              className={`rounded px-2 py-0.5 text-xs ${
                speed === s
                  ? "bg-blue-500 text-white"
                  : "bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
              }`}
              key={s}
              onClick={() => setSpeed(s)}
            >
              {s}x
            </button>
          ))}
        </div>

        {/* Progress bar */}
        <div className="ml-4 flex-1">
          <input
            className="h-1 w-full cursor-pointer appearance-none rounded-lg bg-zinc-200 accent-blue-500 dark:bg-zinc-700"
            max={Math.max(0, totalEvents - 1)}
            min={0}
            onChange={(e) => seekTo(Number(e.target.value))}
            type="range"
            value={currentIndex}
          />
        </div>
      </div>

      {/* Event timeline */}
      <div className="flex-1 space-y-1 overflow-y-auto p-4" ref={containerRef}>
        {visibleEvents.length === 0 && (
          <div className="py-8 text-center text-sm text-zinc-400">
            Press Play to start the replay
          </div>
        )}
        {visibleEvents.map((event, idx) => (
          <div
            className={`flex items-start gap-2 rounded px-2 py-1 text-xs ${
              idx === visibleEvents.length - 1
                ? "border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20"
                : ""
            }`}
            key={event.id || idx}
          >
            <span className="whitespace-nowrap font-mono text-zinc-400">
              {formatTime(event.timestamp)}
            </span>
            <span
              className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${getEventColor(event.type)}`}
            />
            <span className="whitespace-nowrap font-medium text-zinc-600 dark:text-zinc-300">
              {event.type}
            </span>
            {event.agentRole && (
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800">
                {event.agentRole}
              </span>
            )}
            <span className="truncate text-zinc-500 dark:text-zinc-400">
              {typeof event.data === "string"
                ? event.data.slice(0, 120)
                : JSON.stringify(event.data).slice(0, 120)}
            </span>
          </div>
        ))}
      </div>

      {/* Footer with progress */}
      <div className="border-zinc-200 border-t px-4 py-1 dark:border-zinc-700">
        <div className="h-1 w-full rounded-full bg-zinc-200 dark:bg-zinc-700">
          <div
            className="h-1 rounded-full bg-blue-500 transition-all duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
