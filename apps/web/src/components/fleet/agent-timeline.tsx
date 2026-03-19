"use client";

import { useCallback, useMemo, useState } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface AgentTimelineEntry {
  agentId: string;
  details?: string;
  endTime: Date;
  id: string;
  role: string;
  startTime: Date;
  taskTitle: string;
}

interface AgentTimelineProps {
  agents: AgentTimelineEntry[];
  onBarClick?: (entry: AgentTimelineEntry) => void;
  timeRange: [Date, Date];
}

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

const ROLE_COLORS: Record<
  string,
  { bg: string; border: string; fill: string }
> = {
  orchestrator: {
    fill: "#8b5cf6",
    bg: "bg-violet-500/20",
    border: "border-violet-500/30",
  },
  discovery: {
    fill: "#3b82f6",
    bg: "bg-blue-500/20",
    border: "border-blue-500/30",
  },
  architect: {
    fill: "#6366f1",
    bg: "bg-indigo-500/20",
    border: "border-indigo-500/30",
  },
  frontend: {
    fill: "#06b6d4",
    bg: "bg-cyan-500/20",
    border: "border-cyan-500/30",
  },
  backend: {
    fill: "#22c55e",
    bg: "bg-green-500/20",
    border: "border-green-500/30",
  },
  database: {
    fill: "#eab308",
    bg: "bg-yellow-500/20",
    border: "border-yellow-500/30",
  },
  devops: {
    fill: "#f97316",
    bg: "bg-orange-500/20",
    border: "border-orange-500/30",
  },
  testing: {
    fill: "#ec4899",
    bg: "bg-pink-500/20",
    border: "border-pink-500/30",
  },
  security: {
    fill: "#ef4444",
    bg: "bg-red-500/20",
    border: "border-red-500/30",
  },
  documentation: {
    fill: "#a1a1aa",
    bg: "bg-zinc-500/20",
    border: "border-zinc-500/30",
  },
};

const DEFAULT_ROLE_COLOR = {
  fill: "#8b5cf6",
  bg: "bg-violet-500/20",
  border: "border-violet-500/30",
};

const ROW_HEIGHT = 36;
const LABEL_WIDTH = 140;
const MIN_BAR_WIDTH = 4;

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function getRoleColor(role: string) {
  return ROLE_COLORS[role] ?? DEFAULT_ROLE_COLOR;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/* -------------------------------------------------------------------------- */
/*  Time Axis                                                                  */
/* -------------------------------------------------------------------------- */

function TimeAxis({
  timeRange,
  width,
  tickCount,
}: {
  tickCount: number;
  timeRange: [Date, Date];
  width: number;
}) {
  const [start, end] = timeRange;
  const totalMs = end.getTime() - start.getTime();

  const ticks = useMemo(() => {
    const result: Array<{ label: string; x: number }> = [];
    for (let i = 0; i <= tickCount; i++) {
      const fraction = i / tickCount;
      const time = new Date(start.getTime() + totalMs * fraction);
      result.push({
        x: fraction * width,
        label: formatTime(time),
      });
    }
    return result;
  }, [start, totalMs, tickCount, width]);

  return (
    <div className="relative" style={{ height: 24, width }}>
      {ticks.map((tick) => (
        <div
          className="absolute top-0 -translate-x-1/2"
          key={tick.label}
          style={{ left: tick.x }}
        >
          <div className="mx-auto h-2 w-px bg-zinc-700" />
          <span className="font-mono text-[9px] text-zinc-600">
            {tick.label}
          </span>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tooltip                                                                    */
/* -------------------------------------------------------------------------- */

function BarTooltip({
  entry,
  x,
  y,
}: {
  entry: AgentTimelineEntry;
  x: number;
  y: number;
}) {
  const duration = entry.endTime.getTime() - entry.startTime.getTime();

  return (
    <div
      className="pointer-events-none absolute z-50 rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 shadow-xl"
      style={{ left: x, top: y - 80 }}
    >
      <div className="font-medium text-xs text-zinc-200">{entry.taskTitle}</div>
      <div className="mt-1 space-y-0.5 text-[10px] text-zinc-500">
        <div>
          Agent: <span className="text-zinc-300">{entry.role}</span>
        </div>
        <div>
          Duration:{" "}
          <span className="text-zinc-300">{formatDuration(duration)}</span>
        </div>
        <div>
          {formatTime(entry.startTime)} - {formatTime(entry.endTime)}
        </div>
        {entry.details && (
          <div className="mt-1 max-w-[200px] text-zinc-400">
            {entry.details}
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  AgentTimeline (Gantt-style)                                                */
/* -------------------------------------------------------------------------- */

export function AgentTimeline({
  agents,
  timeRange,
  onBarClick,
}: AgentTimelineProps) {
  const [hoveredEntry, setHoveredEntry] = useState<{
    entry: AgentTimelineEntry;
    x: number;
    y: number;
  } | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);

  const chartWidth = 600 * zoomLevel;
  const [rangeStart, rangeEnd] = timeRange;
  const totalMs = rangeEnd.getTime() - rangeStart.getTime();

  // Group entries by agent (unique agentId)
  const agentGroups = useMemo(() => {
    const grouped = new Map<
      string,
      { entries: AgentTimelineEntry[]; role: string }
    >();
    for (const entry of agents) {
      const existing = grouped.get(entry.agentId);
      if (existing) {
        existing.entries.push(entry);
      } else {
        grouped.set(entry.agentId, {
          role: entry.role,
          entries: [entry],
        });
      }
    }
    return Array.from(grouped.entries()).map(([agentId, data]) => ({
      agentId,
      ...data,
    }));
  }, [agents]);

  const totalHeight = agentGroups.length * ROW_HEIGHT;

  const getBarPosition = useCallback(
    (entry: AgentTimelineEntry) => {
      const startOffset = Math.max(
        0,
        entry.startTime.getTime() - rangeStart.getTime()
      );
      const endOffset = Math.min(
        totalMs,
        entry.endTime.getTime() - rangeStart.getTime()
      );
      const left = (startOffset / totalMs) * chartWidth;
      const width = Math.max(
        MIN_BAR_WIDTH,
        ((endOffset - startOffset) / totalMs) * chartWidth
      );
      return { left, width };
    },
    [rangeStart, totalMs, chartWidth]
  );

  const handleZoomIn = useCallback(() => {
    setZoomLevel((prev) => Math.min(prev * 1.5, 5));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoomLevel((prev) => Math.max(prev / 1.5, 0.5));
  }, []);

  const handleZoomReset = useCallback(() => {
    setZoomLevel(1);
  }, []);

  const tickCount = Math.max(4, Math.min(12, Math.floor(chartWidth / 80)));

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-sm text-zinc-200">Agent Timeline</h4>
        <div className="flex items-center gap-1">
          <button
            className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            onClick={handleZoomOut}
            type="button"
          >
            -
          </button>
          <button
            className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            onClick={handleZoomReset}
            type="button"
          >
            Reset
          </button>
          <button
            className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            onClick={handleZoomIn}
            type="button"
          >
            +
          </button>
        </div>
      </div>

      {/* Chart */}
      {agentGroups.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-sm text-zinc-600">
          No agent activity to display
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div
            className="relative flex"
            style={{ minWidth: chartWidth + LABEL_WIDTH }}
          >
            {/* Agent labels */}
            <div
              className="sticky left-0 z-10 shrink-0 bg-zinc-950"
              style={{ width: LABEL_WIDTH }}
            >
              <div style={{ height: 24 }} />
              {agentGroups.map((group) => {
                const roleColor = getRoleColor(group.role);
                return (
                  <div
                    className="flex items-center gap-2 border-zinc-800/50 border-b px-2"
                    key={group.agentId}
                    style={{ height: ROW_HEIGHT }}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: roleColor.fill }}
                    />
                    <span className="truncate text-xs text-zinc-300">
                      {group.role}
                    </span>
                    <span className="font-mono text-[9px] text-zinc-600">
                      {group.agentId.slice(0, 6)}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Timeline area */}
            <div className="relative flex-1">
              {/* Time axis */}
              <TimeAxis
                tickCount={tickCount}
                timeRange={timeRange}
                width={chartWidth}
              />

              {/* Grid + bars */}
              <div
                className="relative"
                style={{ height: totalHeight, width: chartWidth }}
              >
                {/* Horizontal grid lines */}
                {agentGroups.map((group, i) => (
                  <div
                    className="absolute right-0 left-0 border-zinc-800/30 border-b"
                    key={`grid-${group.agentId}`}
                    style={{ top: (i + 1) * ROW_HEIGHT }}
                  />
                ))}

                {/* Bars */}
                {agentGroups.map((group, rowIndex) =>
                  group.entries.map((entry) => {
                    const { left, width } = getBarPosition(entry);
                    const roleColor = getRoleColor(entry.role);
                    const top = rowIndex * ROW_HEIGHT + 6;

                    return (
                      <button
                        className="absolute rounded-md border transition-all hover:brightness-125"
                        key={entry.id}
                        onClick={() => onBarClick?.(entry)}
                        onMouseEnter={(e) => {
                          const _rect = e.currentTarget.getBoundingClientRect();
                          setHoveredEntry({
                            entry,
                            x: left,
                            y: top,
                          });
                        }}
                        onMouseLeave={() => setHoveredEntry(null)}
                        style={{
                          left,
                          top,
                          width,
                          height: ROW_HEIGHT - 12,
                          backgroundColor: `${roleColor.fill}30`,
                          borderColor: `${roleColor.fill}50`,
                        }}
                        type="button"
                      >
                        {width > 60 && (
                          <span
                            className="truncate px-1.5 text-[9px]"
                            style={{ color: roleColor.fill }}
                          >
                            {entry.taskTitle}
                          </span>
                        )}
                      </button>
                    );
                  })
                )}

                {/* Tooltip */}
                {hoveredEntry && (
                  <BarTooltip
                    entry={hoveredEntry.entry}
                    x={hoveredEntry.x}
                    y={hoveredEntry.y}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 border-zinc-800 border-t pt-3">
        {Object.entries(ROLE_COLORS).map(([role, color]) => (
          <div className="flex items-center gap-1.5" key={role}>
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: color.fill }}
            />
            <span className="text-[10px] text-zinc-500">{role}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
