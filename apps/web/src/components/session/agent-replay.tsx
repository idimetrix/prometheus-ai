"use client";

import { Badge, Button, Card } from "@prometheus/ui";
import {
  ChevronLeft,
  ChevronRight,
  FastForward,
  GitBranch,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export type ReplayEventType =
  | "thinking"
  | "tool_call"
  | "code_generation"
  | "file_edit"
  | "terminal"
  | "message"
  | "error"
  | "decision";

export interface ReplayEvent {
  codeGenerated?: string;
  data: Record<string, unknown>;
  id: string;
  thinking?: string;
  timestamp: string;
  toolInput?: Record<string, unknown>;
  toolName?: string;
  toolOutput?: string;
  type: ReplayEventType;
}

interface AgentReplayProps {
  events: ReplayEvent[];
  onForkFromHere?: (eventIndex: number, newInstructions: string) => void;
  sessionId: string;
}

type PlaybackSpeed = 1 | 2 | 5 | 10;

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

const SPEEDS: PlaybackSpeed[] = [1, 2, 5, 10];

const EVENT_TYPE_CONFIG: Record<
  ReplayEventType,
  { color: string; label: string }
> = {
  thinking: { label: "Thinking", color: "bg-indigo-500" },
  tool_call: { label: "Tool Call", color: "bg-violet-500" },
  code_generation: { label: "Code Gen", color: "bg-emerald-500" },
  file_edit: { label: "File Edit", color: "bg-blue-500" },
  terminal: { label: "Terminal", color: "bg-green-500" },
  message: { label: "Message", color: "bg-zinc-500" },
  error: { label: "Error", color: "bg-red-500" },
  decision: { label: "Decision", color: "bg-amber-500" },
};

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function getEventTitle(event: ReplayEvent): string {
  if (event.toolName) {
    return `Tool: ${event.toolName}`;
  }
  if (typeof event.data.title === "string") {
    return event.data.title;
  }
  if (typeof event.data.message === "string") {
    return event.data.message.slice(0, 80);
  }
  return EVENT_TYPE_CONFIG[event.type].label;
}

function getTimelineItemClass(isCurrent: boolean, isPast: boolean): string {
  if (isCurrent) {
    return "bg-violet-500/15 ring-1 ring-violet-500/30";
  }
  if (isPast) {
    return "opacity-60 hover:bg-zinc-800/50";
  }
  return "opacity-40 hover:bg-zinc-800/50";
}

function getEventPreview(event: ReplayEvent): string {
  if (event.thinking) {
    return event.thinking.slice(0, 200);
  }
  if (event.codeGenerated) {
    return event.codeGenerated.slice(0, 200);
  }
  if (event.toolOutput) {
    return event.toolOutput.slice(0, 200);
  }
  if (typeof event.data.content === "string") {
    return event.data.content.slice(0, 200);
  }
  return JSON.stringify(event.data).slice(0, 200);
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function AgentReplay({
  sessionId: _sessionId,
  events,
  onForkFromHere,
}: AgentReplayProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [forkInstructions, setForkInstructions] = useState("");
  const [showForkInput, setShowForkInput] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventListRef = useRef<HTMLDivElement>(null);

  const currentEvent = events[currentIndex];

  // Timestamps
  const firstTs = events[0] ? new Date(events[0].timestamp).getTime() : 0;
  const lastEvent = events.at(-1);
  const lastTs = lastEvent
    ? new Date(String(lastEvent.timestamp)).getTime()
    : 0;
  const totalDuration = lastTs - firstTs;
  const currentTimeMs = currentEvent
    ? new Date(currentEvent.timestamp).getTime() - firstTs
    : 0;
  const progress =
    totalDuration > 0 ? (currentTimeMs / totalDuration) * 100 : 0;

  // Auto-scroll timeline to current event
  useEffect(() => {
    const el = eventListRef.current;
    if (!el) {
      return;
    }
    const activeItem = el.querySelector(`[data-event-index="${currentIndex}"]`);
    if (activeItem) {
      activeItem.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [currentIndex]);

  // Playback loop
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

  const handleSpeedCycle = useCallback(() => {
    setSpeed((prev) => {
      const idx = SPEEDS.indexOf(prev);
      return SPEEDS[(idx + 1) % SPEEDS.length] ?? 1;
    });
  }, []);

  const handleStepBack = useCallback(() => {
    setCurrentIndex((p) => Math.max(0, p - 1));
    setIsPlaying(false);
  }, []);

  const handleStepForward = useCallback(() => {
    setCurrentIndex((p) => Math.min(events.length - 1, p + 1));
    setIsPlaying(false);
  }, [events.length]);

  const handleReset = useCallback(() => {
    setCurrentIndex(0);
    setIsPlaying(false);
  }, []);

  const handleScrub = useCallback((value: number[]) => {
    setCurrentIndex(value[0] ?? 0);
    setIsPlaying(false);
  }, []);

  const handleFork = useCallback(() => {
    if (onForkFromHere && forkInstructions.trim()) {
      onForkFromHere(currentIndex, forkInstructions.trim());
      setShowForkInput(false);
      setForkInstructions("");
    }
  }, [onForkFromHere, currentIndex, forkInstructions]);

  // Timeline event markers as percentages
  const eventMarkers = useMemo(() => {
    if (totalDuration === 0) {
      return [];
    }
    return events.map((event, idx) => ({
      position:
        ((new Date(event.timestamp).getTime() - firstTs) / totalDuration) * 100,
      type: event.type,
      index: idx,
    }));
  }, [events, firstTs, totalDuration]);

  if (events.length === 0) {
    return (
      <Card className="flex h-96 items-center justify-center bg-zinc-950 text-zinc-500">
        No session events to replay.
      </Card>
    );
  }

  return (
    <Card className="flex h-full flex-col overflow-hidden border-zinc-800 bg-zinc-950">
      {/* ── Main content: 2-panel layout ─────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: Timeline event list */}
        <div
          className="w-72 shrink-0 overflow-y-auto border-zinc-800 border-r"
          ref={eventListRef}
        >
          <div className="p-2">
            <p className="mb-2 px-2 font-medium text-xs text-zinc-400">
              Timeline ({events.length} events)
            </p>
            {events.map((event, idx) => {
              const isCurrent = idx === currentIndex;
              const isPast = idx < currentIndex;
              const config = EVENT_TYPE_CONFIG[event.type];

              return (
                <button
                  className={[
                    "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                    getTimelineItemClass(isCurrent, isPast),
                  ].join(" ")}
                  data-event-index={idx}
                  key={event.id}
                  onClick={() => {
                    setCurrentIndex(idx);
                    setIsPlaying(false);
                  }}
                  type="button"
                >
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${config.color}`}
                  />
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-zinc-300">
                      {getEventTitle(event)}
                    </span>
                    <span className="block text-[10px] text-zinc-600">
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
        </div>

        {/* Right panel: Event detail view */}
        <div className="flex flex-1 flex-col overflow-y-auto p-4">
          {currentEvent && (
            <>
              {/* Event header */}
              <div className="mb-4 flex items-center gap-2">
                <Badge
                  className={`${EVENT_TYPE_CONFIG[currentEvent.type].color} text-white`}
                >
                  {EVENT_TYPE_CONFIG[currentEvent.type].label}
                </Badge>
                <span className="font-mono text-xs text-zinc-500">
                  Step {currentIndex + 1} of {events.length}
                </span>
                <span className="font-mono text-xs text-zinc-600">
                  {new Date(currentEvent.timestamp).toLocaleTimeString()}
                </span>
              </div>

              {/* Thinking section */}
              {currentEvent.thinking && (
                <div className="mb-3">
                  <p className="mb-1 font-medium text-indigo-400 text-xs">
                    Agent Thinking
                  </p>
                  <div className="rounded-lg bg-indigo-500/5 p-3 font-mono text-xs text-zinc-300 leading-relaxed">
                    {currentEvent.thinking}
                  </div>
                </div>
              )}

              {/* Tool call section */}
              {currentEvent.toolName && (
                <div className="mb-3">
                  <p className="mb-1 font-medium text-violet-400 text-xs">
                    Tool: {currentEvent.toolName}
                  </p>
                  {currentEvent.toolInput && (
                    <pre className="mb-2 overflow-auto rounded-lg bg-zinc-900 p-3 font-mono text-[11px] text-zinc-400">
                      {JSON.stringify(currentEvent.toolInput, null, 2)}
                    </pre>
                  )}
                  {currentEvent.toolOutput && (
                    <div className="rounded-lg bg-zinc-900 p-3">
                      <p className="mb-1 text-[10px] text-zinc-600">Output:</p>
                      <pre className="overflow-auto font-mono text-[11px] text-zinc-400">
                        {currentEvent.toolOutput}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {/* Code generation section */}
              {currentEvent.codeGenerated && (
                <div className="mb-3">
                  <p className="mb-1 font-medium text-emerald-400 text-xs">
                    Generated Code
                  </p>
                  <pre className="overflow-auto rounded-lg bg-zinc-900 p-3 font-mono text-[11px] text-emerald-300/80 leading-relaxed">
                    {currentEvent.codeGenerated}
                  </pre>
                </div>
              )}

              {/* Generic data fallback */}
              {!(
                currentEvent.thinking ||
                currentEvent.toolName ||
                currentEvent.codeGenerated
              ) && (
                <div className="rounded-lg bg-zinc-900 p-3">
                  <pre className="overflow-auto font-mono text-[11px] text-zinc-400">
                    {getEventPreview(currentEvent)}
                  </pre>
                </div>
              )}

              {/* Fork from here */}
              <div className="mt-4 border-zinc-800 border-t pt-4">
                {showForkInput ? (
                  <div className="space-y-2">
                    <p className="text-xs text-zinc-400">
                      Fork from step {currentIndex + 1} with new instructions:
                    </p>
                    <textarea
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-300 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none"
                      onChange={(e) => setForkInstructions(e.target.value)}
                      placeholder="Enter different instructions for the agent..."
                      rows={3}
                      value={forkInstructions}
                    />
                    <div className="flex gap-2">
                      <Button
                        disabled={!forkInstructions.trim()}
                        onClick={handleFork}
                        size="sm"
                      >
                        <GitBranch className="mr-1 h-3 w-3" />
                        Fork Session
                      </Button>
                      <Button
                        onClick={() => setShowForkInput(false)}
                        size="sm"
                        variant="outline"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    onClick={() => setShowForkInput(true)}
                    size="sm"
                    variant="outline"
                  >
                    <GitBranch className="mr-1 h-3 w-3" />
                    Fork from here
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Playback controls ────────────────────────────────────── */}
      <div className="border-zinc-800 border-t px-4 py-3">
        {/* Timeline scrubber with event markers */}
        <div className="relative mb-3">
          {/* Event marker dots */}
          <div className="absolute top-0 right-0 left-0 h-1.5">
            {eventMarkers.map((marker) => (
              <span
                className={`absolute top-0 h-1.5 w-1 rounded-full ${EVENT_TYPE_CONFIG[marker.type].color} opacity-40`}
                key={`marker-${marker.index}`}
                style={{ left: `${marker.position}%` }}
              />
            ))}
          </div>

          {/* Progress bar */}
          <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-violet-500 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Slider + controls */}
        <div className="mb-2 flex items-center gap-3">
          <span className="w-10 font-mono text-[10px] text-zinc-500">
            {formatDuration(currentTimeMs)}
          </span>
          <input
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-zinc-800 accent-violet-500"
            max={events.length - 1}
            min={0}
            onChange={(e) => handleScrub([Number(e.target.value)])}
            step={1}
            type="range"
            value={currentIndex}
          />
          <span className="w-10 text-right font-mono text-[10px] text-zinc-500">
            {formatDuration(totalDuration)}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Button onClick={handleReset} size="sm" variant="ghost">
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
            <Button onClick={handleStepBack} size="sm" variant="ghost">
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              className="h-8 w-8 rounded-lg bg-violet-600 text-white hover:bg-violet-500"
              onClick={handlePlayPause}
              size="sm"
            >
              {isPlaying ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>
            <Button onClick={handleStepForward} size="sm" variant="ghost">
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <Button
              className="font-mono text-[10px]"
              onClick={handleSpeedCycle}
              size="sm"
              variant="ghost"
            >
              <FastForward className="mr-1 h-3 w-3" />
              {speed}x
            </Button>
          </div>

          <span className="text-[10px] text-zinc-600">
            Event {currentIndex + 1} / {events.length}
          </span>
        </div>
      </div>
    </Card>
  );
}
