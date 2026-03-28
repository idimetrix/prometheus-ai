"use client";

import { Badge, Button, Card, CardContent } from "@prometheus/ui";
import { ChevronLeft, ChevronRight, Filter, Pause, Play } from "lucide-react";
import { use, useCallback, useMemo, useState } from "react";
import type { ReplayEvent } from "@/components/session/replay/replay-engine";
import { ReplayViewer } from "@/components/session/replay/replay-viewer";
import { trpc } from "@/lib/trpc";

const PLAYBACK_SPEEDS = [0.5, 1, 2, 4] as const;
type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

const EVENT_TYPE_FILTERS = [
  "file_change",
  "tool_call",
  "agent_reasoning",
  "terminal_output",
] as const;
type EventTypeFilter = (typeof EVENT_TYPE_FILTERS)[number];

export default function SessionReplayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: sessionId } = use(params);

  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeFilters, setActiveFilters] = useState<Set<EventTypeFilter>>(
    new Set(EVENT_TYPE_FILTERS)
  );

  const timelineQuery = trpc.replay.getTimeline.useQuery(
    { sessionId, limit: 5000 },
    { enabled: !!sessionId, retry: 2 }
  );

  const events: ReplayEvent[] = useMemo(() => {
    if (!timelineQuery.data?.events) {
      return [];
    }
    return timelineQuery.data.events.map(
      (e: {
        id: string;
        type: string;
        data: unknown;
        agentRole: string | null;
        timestamp: string;
      }) => ({
        id: e.id,
        type: e.type as ReplayEvent["type"],
        data: (e.data ?? {}) as Record<string, unknown>,
        agentRole: e.agentRole ?? null,
        timestamp: e.timestamp,
      })
    );
  }, [timelineQuery.data]);

  const filteredEvents = useMemo(() => {
    return events.filter((e) => activeFilters.has(e.type as EventTypeFilter));
  }, [events, activeFilters]);

  const toggleFilter = useCallback((filter: EventTypeFilter) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(filter)) {
        next.delete(filter);
      } else {
        next.add(filter);
      }
      return next;
    });
  }, []);

  const handleStepForward = useCallback(() => {
    setCurrentIndex((prev) => Math.min(filteredEvents.length - 1, prev + 1));
  }, [filteredEvents.length]);

  const handleStepBack = useCallback(() => {
    setCurrentIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const handlePlayPause = useCallback(() => {
    setIsPlaying((prev) => !prev);
  }, []);

  if (timelineQuery.isLoading) {
    return (
      <div className="flex h-[calc(100vh-theme(spacing.14)-theme(spacing.12))] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
          <span className="text-sm text-zinc-500">
            Loading session events...
          </span>
        </div>
      </div>
    );
  }

  if (timelineQuery.isError) {
    return (
      <div className="flex h-[calc(100vh-theme(spacing.14)-theme(spacing.12))] items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 text-sm">Failed to load session events</p>
          <p className="mt-1 text-xs text-zinc-500">
            {timelineQuery.error.message}
          </p>
          <button
            className="mt-3 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700"
            onClick={() => timelineQuery.refetch()}
            type="button"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-theme(spacing.14)-theme(spacing.12))] flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-foreground text-xl">Session Replay</h1>
          <p className="text-muted-foreground text-xs">
            Step through session events with full playback controls.
          </p>
        </div>
        <Badge variant="outline">{sessionId.slice(0, 12)}</Badge>
      </div>

      {/* Playback controls */}
      <Card>
        <CardContent className="flex items-center gap-3 p-3">
          <Button onClick={handleStepBack} size="sm" variant="outline">
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <Button onClick={handlePlayPause} size="sm" variant="default">
            {isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </Button>

          <Button onClick={handleStepForward} size="sm" variant="outline">
            <ChevronRight className="h-4 w-4" />
          </Button>

          {/* Speed selector */}
          <div className="flex items-center gap-1.5 border-zinc-800 border-l pl-3">
            <span className="text-muted-foreground text-xs">Speed:</span>
            {PLAYBACK_SPEEDS.map((s) => (
              <Button
                key={s}
                onClick={() => setSpeed(s)}
                size="sm"
                variant={speed === s ? "default" : "ghost"}
              >
                {s}x
              </Button>
            ))}
          </div>

          {/* Event position */}
          <span className="ml-auto font-mono text-muted-foreground text-xs">
            {filteredEvents.length > 0 ? currentIndex + 1 : 0} /{" "}
            {filteredEvents.length} events
          </span>
        </CardContent>
      </Card>

      {/* Event type filters */}
      <div className="flex items-center gap-2">
        <Filter className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-muted-foreground text-xs">Filter:</span>
        {EVENT_TYPE_FILTERS.map((filter) => (
          <Button
            key={filter}
            onClick={() => toggleFilter(filter)}
            size="sm"
            variant={activeFilters.has(filter) ? "secondary" : "ghost"}
          >
            {filter.replace(/_/g, " ")}
          </Button>
        ))}
      </div>

      {/* Timeline scrubber showing event density */}
      {filteredEvents.length > 0 && (
        <Card>
          <CardContent className="p-2">
            <div className="flex h-6 items-end gap-px">
              {Array.from({
                length: Math.min(80, filteredEvents.length),
              }).map((_, i) => {
                const bucketSize = Math.max(
                  1,
                  Math.floor(filteredEvents.length / 80)
                );
                const bucketStart = i * bucketSize;
                const isActive =
                  currentIndex >= bucketStart &&
                  currentIndex < bucketStart + bucketSize;
                return (
                  <button
                    className={`flex-1 rounded-sm transition-colors ${
                      isActive
                        ? "bg-violet-500"
                        : "bg-zinc-700 hover:bg-zinc-600"
                    }`}
                    key={`density-${bucketStart}`}
                    onClick={() => setCurrentIndex(bucketStart)}
                    style={{ height: "100%" }}
                    type="button"
                  />
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Replay viewer */}
      <div className="min-h-0 flex-1">
        <ReplayViewer events={filteredEvents} sessionId={sessionId} />
      </div>
    </div>
  );
}
