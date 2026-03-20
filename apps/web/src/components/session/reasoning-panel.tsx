"use client";

import { useCallback, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReasoningBlock {
  confidenceScore?: number;
  content: string;
  durationMs?: number;
  id: string;
  isToolCall?: boolean;
  phase: string;
  timestamp: string;
}

interface ReasoningPanelProps {
  isExpanded?: boolean;
  reasoning: ReasoningBlock[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PHASE_COLORS: Record<string, string> = {
  planning: "bg-indigo-500/20 text-indigo-300",
  analysis: "bg-blue-500/20 text-blue-300",
  implementation: "bg-green-500/20 text-green-300",
  review: "bg-amber-500/20 text-amber-300",
  testing: "bg-cyan-500/20 text-cyan-300",
  debugging: "bg-red-500/20 text-red-300",
  decision: "bg-violet-500/20 text-violet-300",
  tool_call: "bg-orange-500/20 text-orange-300",
};

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function getConfidenceBadgeClass(percentage: number): string {
  if (percentage >= 75) {
    return "text-green-400 bg-green-500/10";
  }
  if (percentage >= 50) {
    return "text-yellow-400 bg-yellow-500/10";
  }
  return "text-red-400 bg-red-500/10";
}

function renderContent(content: string) {
  const parts = content.split(/(```[\s\S]*?```)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("```") && part.endsWith("```")) {
      const inner = part.slice(3, -3);
      const newlineIdx = inner.indexOf("\n");
      const code = newlineIdx >= 0 ? inner.slice(newlineIdx + 1) : inner;
      return (
        <pre
          className="my-1.5 overflow-auto rounded bg-zinc-950 p-2 font-mono text-[10px] text-zinc-300"
          key={`code-${String(idx)}`}
        >
          {code}
        </pre>
      );
    }
    return (
      <span className="whitespace-pre-wrap" key={`text-${String(idx)}`}>
        {part}
      </span>
    );
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ConfidenceBadge({ score }: { score: number }) {
  const percentage = Math.round(score * 100);
  const cls = getConfidenceBadgeClass(percentage);
  return (
    <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${cls}`}>
      {percentage}%
    </span>
  );
}

function ToolCallBadge() {
  return (
    <span className="flex items-center gap-0.5 rounded bg-orange-500/10 px-1.5 py-0.5 text-[9px] text-orange-300">
      Tool Call
    </span>
  );
}

function ReasoningEntry({
  block,
  stepNumber,
}: {
  block: ReasoningBlock;
  stepNumber: number;
}) {
  const [open, setOpen] = useState(false);
  const phaseColor =
    PHASE_COLORS[block.phase] ?? "bg-zinc-700/50 text-zinc-400";
  const chevronCls = open
    ? "h-3 w-3 shrink-0 text-zinc-500 transition-transform rotate-90"
    : "h-3 w-3 shrink-0 text-zinc-500 transition-transform";

  const toggleOpen = useCallback(() => {
    setOpen((p) => !p);
  }, []);

  return (
    <div className="border-zinc-800 border-b last:border-b-0">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-800/30"
        onClick={toggleOpen}
        type="button"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-800 font-mono text-[9px] text-zinc-500">
          {stepNumber}
        </span>
        <svg
          aria-hidden="true"
          className={chevronCls}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path d="m9 5 7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className={`rounded-full px-2 py-0.5 text-[10px] ${phaseColor}`}>
          {block.phase}
        </span>
        {block.isToolCall && <ToolCallBadge />}
        <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">
          {block.content.slice(0, 80)}
          {block.content.length > 80 ? "..." : ""}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {block.confidenceScore !== undefined && (
            <ConfidenceBadge score={block.confidenceScore} />
          )}
          {block.durationMs !== undefined && (
            <span className="font-mono text-[9px] text-zinc-600">
              {formatDuration(block.durationMs)}
            </span>
          )}
          <span className="text-[10px] text-zinc-600">
            {new Date(block.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
        </div>
      </button>
      {open && (
        <div className="bg-zinc-900/30 px-3 pb-3 pl-12 text-xs text-zinc-400 leading-relaxed">
          <div className="mb-2 flex flex-wrap items-center gap-3 text-[10px] text-zinc-600">
            <span>Step #{stepNumber}</span>
            {block.durationMs !== undefined && (
              <span>Duration: {formatDuration(block.durationMs)}</span>
            )}
            {block.confidenceScore !== undefined && (
              <span>
                Confidence: {Math.round(block.confidenceScore * 100)}%
              </span>
            )}
            {block.isToolCall && (
              <span className="text-orange-400">Tool Decision</span>
            )}
          </div>
          {renderContent(block.content)}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ReasoningPanel({
  reasoning,
  isExpanded: initialExpanded = false,
}: ReasoningPanelProps) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const [filterPhase, setFilterPhase] = useState<string>("");

  const toggleExpanded = useCallback(() => {
    setExpanded((p) => !p);
  }, []);

  const availablePhases = useMemo(() => {
    const phases = new Set(reasoning.map((b) => b.phase));
    return [...phases].sort();
  }, [reasoning]);

  const filteredReasoning = useMemo(() => {
    if (!filterPhase) {
      return reasoning;
    }
    return reasoning.filter((b) => b.phase === filterPhase);
  }, [reasoning, filterPhase]);

  const totalDuration = useMemo(() => {
    return reasoning.reduce((sum, b) => sum + (b.durationMs ?? 0), 0);
  }, [reasoning]);

  const avgConfidence = useMemo(() => {
    const withScore = reasoning.filter((b) => b.confidenceScore !== undefined);
    if (withScore.length === 0) {
      return undefined;
    }
    return (
      withScore.reduce((sum, b) => sum + (b.confidenceScore ?? 0), 0) /
      withScore.length
    );
  }, [reasoning]);

  const expandedChevronCls = expanded
    ? "h-3.5 w-3.5 text-indigo-400 transition-transform rotate-90"
    : "h-3.5 w-3.5 text-indigo-400 transition-transform";

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/50">
      <button
        className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-800/30"
        onClick={toggleExpanded}
        type="button"
      >
        <svg
          aria-hidden="true"
          className={expandedChevronCls}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path d="m9 5 7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <svg
          aria-hidden="true"
          className="h-3.5 w-3.5 text-indigo-400"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="font-medium text-xs text-zinc-300">
          Agent Reasoning
        </span>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
          {reasoning.length}
        </span>
        {reasoning.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            {totalDuration > 0 && (
              <span className="font-mono text-[9px] text-zinc-600">
                {formatDuration(totalDuration)}
              </span>
            )}
            {avgConfidence !== undefined && (
              <ConfidenceBadge score={avgConfidence} />
            )}
          </div>
        )}
      </button>

      {expanded && (
        <div className="border-zinc-800 border-t">
          {availablePhases.length > 1 && (
            <div className="flex items-center gap-2 border-zinc-800 border-b px-3 py-1.5">
              <span className="text-[10px] text-zinc-600">Filter:</span>
              <button
                className={
                  filterPhase
                    ? "rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-300"
                    : "rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] text-violet-400"
                }
                onClick={() => setFilterPhase("")}
                type="button"
              >
                All
              </button>
              {availablePhases.map((phase) => (
                <button
                  className={
                    filterPhase === phase
                      ? "rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] text-violet-400"
                      : "rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-300"
                  }
                  key={phase}
                  onClick={() => setFilterPhase(phase)}
                  type="button"
                >
                  {phase}
                </button>
              ))}
            </div>
          )}

          <div className="max-h-96 overflow-auto">
            {filteredReasoning.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-zinc-600">
                {reasoning.length === 0
                  ? "No reasoning blocks yet"
                  : "No matching reasoning blocks"}
              </div>
            ) : (
              filteredReasoning.map((block, idx) => (
                <ReasoningEntry
                  block={block}
                  key={block.id}
                  stepNumber={idx + 1}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
