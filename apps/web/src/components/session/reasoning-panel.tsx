"use client";

import { useCallback, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReasoningBlock {
  content: string;
  id: string;
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
};

/** Simple code block detection and highlight */
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
          key={`code-${idx.toString()}`}
        >
          {code}
        </pre>
      );
    }
    return (
      <span className="whitespace-pre-wrap" key={`text-${idx.toString()}`}>
        {part}
      </span>
    );
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ReasoningEntry({ block }: { block: ReasoningBlock }) {
  const [open, setOpen] = useState(false);
  const phaseColor =
    PHASE_COLORS[block.phase] ?? "bg-zinc-700/50 text-zinc-400";

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
        <svg
          aria-hidden="true"
          className={`h-3 w-3 shrink-0 text-zinc-500 transition-transform ${open ? "rotate-90" : ""}`}
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
        <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">
          {block.content.slice(0, 80)}
          {block.content.length > 80 ? "..." : ""}
        </span>
        <span className="shrink-0 text-[10px] text-zinc-600">
          {new Date(block.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </span>
      </button>
      {open && (
        <div className="bg-zinc-900/30 px-3 pb-3 pl-8 text-xs text-zinc-400 leading-relaxed">
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

  const toggleExpanded = useCallback(() => {
    setExpanded((p) => !p);
  }, []);

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/50">
      {/* Header */}
      <button
        className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-800/30"
        onClick={toggleExpanded}
        type="button"
      >
        <svg
          aria-hidden="true"
          className={`h-3.5 w-3.5 text-indigo-400 transition-transform ${expanded ? "rotate-90" : ""}`}
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
      </button>

      {/* Content */}
      {expanded && (
        <div className="max-h-96 overflow-auto border-zinc-800 border-t">
          {reasoning.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-zinc-600">
              No reasoning blocks yet
            </div>
          ) : (
            reasoning.map((block) => (
              <ReasoningEntry block={block} key={block.id} />
            ))
          )}
        </div>
      )}
    </div>
  );
}
