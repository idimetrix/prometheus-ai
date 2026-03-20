"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSocket } from "@/hooks/use-socket";

export interface ToolCallTrace {
  durationMs: number;
  name: string;
  status: "success" | "error" | "blocked";
}

export interface LLMTrace {
  completionTokens: number;
  durationMs: number;
  id: string;
  model: string;
  promptTokens: number;
  slot: string;
  status: "success" | "error";
  timestamp: string;
  toolCalls: ToolCallTrace[];
}

const STATUS_COLORS: Record<LLMTrace["status"], string> = {
  success: "bg-emerald-500",
  error: "bg-red-500",
};

const TOOL_STATUS_COLORS: Record<ToolCallTrace["status"], string> = {
  success: "bg-emerald-500/80",
  error: "bg-red-500/80",
  blocked: "bg-amber-500/80",
};

const TOOL_STATUS_TEXT: Record<ToolCallTrace["status"], string> = {
  success: "text-emerald-400",
  error: "text-red-400",
  blocked: "text-amber-400",
};

/** Rough cost estimate per 1K tokens (blended input/output). */
const COST_PER_1K_TOKENS = 0.003;

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return String(count);
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2">
      <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
        {label}
      </span>
      <span className="font-mono font-semibold text-sm text-zinc-100">
        {value}
      </span>
    </div>
  );
}

function ToolTimeline({
  toolCalls,
  maxDuration,
}: {
  toolCalls: ToolCallTrace[];
  maxDuration: number;
}) {
  return (
    <div className="space-y-1.5 py-2">
      {toolCalls.map((tool) => {
        const widthPct =
          maxDuration > 0
            ? Math.max((tool.durationMs / maxDuration) * 100, 4)
            : 4;

        return (
          <div
            className="flex items-center gap-2"
            key={`${tool.name}-${tool.status}-${tool.durationMs}`}
          >
            <span
              className={`w-28 shrink-0 truncate font-mono text-[11px] ${TOOL_STATUS_TEXT[tool.status]}`}
            >
              {tool.name}
            </span>
            <div className="relative h-4 flex-1 rounded bg-zinc-800/60">
              <div
                className={`absolute inset-y-0 left-0 rounded ${TOOL_STATUS_COLORS[tool.status]}`}
                style={{ width: `${widthPct}%` }}
              />
            </div>
            <span className="w-14 shrink-0 text-right font-mono text-[10px] text-zinc-500">
              {formatDuration(tool.durationMs)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function TraceRow({
  trace,
  isSelected,
  onSelect,
}: {
  trace: LLMTrace;
  isSelected: boolean;
  onSelect: (id: string) => void;
}) {
  const totalTokens = trace.promptTokens + trace.completionTokens;
  const maxToolDuration = Math.max(
    ...trace.toolCalls.map((t) => t.durationMs),
    0
  );

  return (
    <div
      className={`border-zinc-800/50 border-b transition-colors ${
        isSelected ? "bg-zinc-800/40" : "hover:bg-zinc-800/20"
      }`}
    >
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => onSelect(trace.id)}
        type="button"
      >
        <span
          className={`inline-block h-2 w-2 shrink-0 rounded-full ${STATUS_COLORS[trace.status]}`}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-200">
          {trace.model}
        </span>
        <span className="rounded bg-violet-500/15 px-1.5 py-0.5 font-medium text-[10px] text-violet-400">
          {trace.slot}
        </span>
        <span className="rounded bg-blue-500/15 px-1.5 py-0.5 font-mono text-[10px] text-blue-400">
          {formatTokens(totalTokens)} tok
        </span>
        <span className="rounded bg-zinc-700/50 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
          {formatDuration(trace.durationMs)}
        </span>
        <span className="text-[10px] text-zinc-600">
          {new Date(trace.timestamp).toLocaleTimeString()}
        </span>
      </button>

      {isSelected && (
        <div className="border-zinc-800/30 border-t px-3 pb-3">
          <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
            <div className="text-zinc-500">
              Prompt tokens:{" "}
              <span className="text-zinc-300">
                {trace.promptTokens.toLocaleString()}
              </span>
            </div>
            <div className="text-zinc-500">
              Completion tokens:{" "}
              <span className="text-zinc-300">
                {trace.completionTokens.toLocaleString()}
              </span>
            </div>
          </div>

          {trace.toolCalls.length > 0 && (
            <div className="mt-2">
              <div className="mb-1 text-[10px] text-zinc-500 uppercase tracking-wider">
                Tool Calls ({trace.toolCalls.length})
              </div>
              <ToolTimeline
                maxDuration={maxToolDuration}
                toolCalls={trace.toolCalls}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DevToolsPanel({ sessionId }: { sessionId: string }) {
  const [traces, setTraces] = useState<LLMTrace[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const { on } = useSocket(`session:${sessionId}`);

  useEffect(() => {
    const cleanup = on("session_event", (...args: unknown[]) => {
      const payload = args[0] as
        | {
            type?: string;
            data?: LLMTrace;
          }
        | undefined;

      if (payload?.type === "llm_trace" && payload.data) {
        setTraces((prev) => [payload.data as LLMTrace, ...prev]);
      }
    });

    return cleanup;
  }, [on]);

  const handleSelect = useCallback((id: string) => {
    setSelectedTrace((prev) => (prev === id ? null : id));
  }, []);

  const handleFilterChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setFilter(e.target.value);
    },
    []
  );

  const filteredTraces = useMemo(() => {
    if (!filter) {
      return traces;
    }
    const lower = filter.toLowerCase();
    return traces.filter(
      (t) =>
        t.model.toLowerCase().includes(lower) ||
        t.slot.toLowerCase().includes(lower) ||
        t.toolCalls.some((tc) => tc.name.toLowerCase().includes(lower))
    );
  }, [traces, filter]);

  const stats = useMemo(() => {
    const totalPrompt = traces.reduce((sum, t) => sum + t.promptTokens, 0);
    const totalCompletion = traces.reduce(
      (sum, t) => sum + t.completionTokens,
      0
    );
    const totalTokens = totalPrompt + totalCompletion;
    const totalCost = (totalTokens / 1000) * COST_PER_1K_TOKENS;
    const avgLatency =
      traces.length > 0
        ? traces.reduce((sum, t) => sum + t.durationMs, 0) / traces.length
        : 0;
    const toolCallCount = traces.reduce(
      (sum, t) => sum + t.toolCalls.length,
      0
    );

    return { totalTokens, totalCost, avgLatency, toolCallCount };
  }, [traces]);

  return (
    <div className="flex h-full flex-col bg-zinc-900 text-zinc-100">
      {/* Header */}
      <div className="border-zinc-800 border-b px-3 py-2">
        <h3 className="font-medium text-xs text-zinc-400 uppercase tracking-wider">
          AI DevTools
        </h3>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-2 border-zinc-800 border-b p-2">
        <StatCard label="Tokens" value={formatTokens(stats.totalTokens)} />
        <StatCard label="Cost" value={`$${stats.totalCost.toFixed(4)}`} />
        <StatCard
          label="Avg Latency"
          value={formatDuration(Math.round(stats.avgLatency))}
        />
        <StatCard label="Tool Calls" value={String(stats.toolCallCount)} />
      </div>

      {/* Filter Bar */}
      <div className="border-zinc-800 border-b px-3 py-2">
        <input
          className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
          onChange={handleFilterChange}
          placeholder="Filter by model, slot, or tool name..."
          type="text"
          value={filter}
        />
      </div>

      {/* Trace List */}
      <div className="flex-1 overflow-y-auto">
        {filteredTraces.length === 0 ? (
          <div className="py-8 text-center text-xs text-zinc-600">
            {traces.length === 0
              ? "No LLM traces yet. Waiting for activity..."
              : "No traces match the current filter."}
          </div>
        ) : (
          filteredTraces.map((trace) => (
            <TraceRow
              isSelected={selectedTrace === trace.id}
              key={trace.id}
              onSelect={handleSelect}
              trace={trace}
            />
          ))
        )}
      </div>
    </div>
  );
}
