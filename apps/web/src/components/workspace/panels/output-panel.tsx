"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type OutputSource = "build" | "tests" | "lint" | "deploy" | "agent";

const OUTPUT_SOURCES: Array<{ id: OutputSource; label: string }> = [
  { id: "build", label: "Build" },
  { id: "tests", label: "Tests" },
  { id: "lint", label: "Lint" },
  { id: "deploy", label: "Deploy" },
  { id: "agent", label: "Agent" },
];

export interface OutputEntry {
  /** Unique entry id */
  id: string;
  /** The output message (may contain ANSI codes) */
  message: string;
  /** Which source this entry belongs to */
  source: OutputSource;
  /** ISO timestamp */
  timestamp: string;
}

/**
 * Strip ANSI escape sequences and return plain text.
 * Used for copy operations.
 */
const ANSI_REGEX = /\x1b\[[0-9;]*[A-Za-z]|\x1b\].*?\x07|\x1b\[.*?[@-~]/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, "");
}

/**
 * Convert ANSI color codes to Tailwind classes for rendering.
 * Handles basic foreground colors (30-37, 90-97).
 */
const ANSI_COLOR_MAP: Record<string, string> = {
  "30": "text-zinc-900",
  "31": "text-red-400",
  "32": "text-green-400",
  "33": "text-yellow-400",
  "34": "text-blue-400",
  "35": "text-purple-400",
  "36": "text-cyan-400",
  "37": "text-zinc-300",
  "90": "text-zinc-500",
  "91": "text-red-300",
  "92": "text-green-300",
  "93": "text-yellow-300",
  "94": "text-blue-300",
  "95": "text-purple-300",
  "96": "text-cyan-300",
  "97": "text-white",
};

const ANSI_ESCAPE_RE = /(\x1b\[[0-9;]*m)/;
const ANSI_CODE_RE = /^\x1b\[([0-9;]*)m$/;

interface AnsiSpan {
  className: string;
  text: string;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ANSI parsing requires nested conditionals
function parseAnsi(raw: string): AnsiSpan[] {
  const spans: AnsiSpan[] = [];
  const parts = raw.split(ANSI_ESCAPE_RE);
  let currentClass = "text-zinc-400";

  for (const part of parts) {
    const match = ANSI_CODE_RE.exec(part);
    if (match) {
      const codes = (match[1] ?? "").split(";");
      for (const code of codes) {
        if (code === "0" || code === "") {
          currentClass = "text-zinc-400";
        } else if (ANSI_COLOR_MAP[code]) {
          currentClass = ANSI_COLOR_MAP[code];
        }
      }
    } else if (part) {
      // Strip any remaining escape sequences
      const clean = stripAnsi(part);
      if (clean) {
        spans.push({ text: clean, className: currentClass });
      }
    }
  }

  return spans;
}

function AnsiLine({ text }: { text: string }) {
  const spans = useMemo(() => parseAnsi(text), [text]);
  return (
    <span>
      {spans.map((span, _i) => (
        <span
          className={span.className}
          key={`${span.className}-${span.text.slice(0, 16)}`}
        >
          {span.text}
        </span>
      ))}
    </span>
  );
}

interface OutputPanelProps {
  /** All output entries across all sources */
  entries: OutputEntry[];
  /** Called to clear entries for a specific source */
  onClear: (source: OutputSource) => void;
}

export function OutputPanel({ entries, onClear }: OutputPanelProps) {
  const [selectedSource, setSelectedSource] = useState<OutputSource>("build");
  const [filterText, setFilterText] = useState("");
  const [pinToBottom, setPinToBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const sourceEntries = useMemo(() => {
    let result = entries.filter((e) => e.source === selectedSource);
    if (filterText.trim()) {
      const lower = filterText.toLowerCase();
      result = result.filter((e) =>
        stripAnsi(e.message).toLowerCase().includes(lower)
      );
    }
    return result;
  }, [entries, selectedSource, filterText]);

  // Auto-scroll to bottom when pinned
  useEffect(() => {
    if (pinToBottom && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [pinToBottom]);

  // Detect manual scroll to un-pin
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) {
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 24;
    if (pinToBottom && !isAtBottom) {
      setPinToBottom(false);
    } else if (!pinToBottom && isAtBottom) {
      setPinToBottom(true);
    }
  }, [pinToBottom]);

  const handleCopyAll = useCallback(() => {
    const text = sourceEntries
      .map(
        (e) =>
          `[${new Date(e.timestamp).toLocaleTimeString()}] ${stripAnsi(e.message)}`
      )
      .join("\n");
    navigator.clipboard.writeText(text).catch(() => {
      // Clipboard write failed silently
    });
  }, [sourceEntries]);

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-zinc-800 border-b px-3 py-2">
        {/* Source selector */}
        <select
          aria-label="Output source"
          className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300 outline-none"
          onChange={(e) => setSelectedSource(e.target.value as OutputSource)}
          value={selectedSource}
        >
          {OUTPUT_SOURCES.map((src) => (
            <option key={src.id} value={src.id}>
              {src.label}
            </option>
          ))}
        </select>

        {/* Filter */}
        <input
          className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 outline-none placeholder:text-zinc-600 focus:border-zinc-700"
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="Filter output..."
          value={filterText}
        />

        {/* Pin to bottom toggle */}
        <button
          className={`rounded px-2 py-1 text-[11px] transition-colors ${
            pinToBottom
              ? "bg-violet-500/20 text-violet-400"
              : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-400"
          }`}
          onClick={() => setPinToBottom(!pinToBottom)}
          title={pinToBottom ? "Auto-scroll enabled" : "Auto-scroll disabled"}
          type="button"
        >
          {pinToBottom ? "Pinned" : "Unpinned"}
        </button>

        {/* Copy all */}
        <button
          className="rounded px-2 py-1 text-[11px] text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          onClick={handleCopyAll}
          title="Copy all output"
          type="button"
        >
          Copy
        </button>

        {/* Clear */}
        <button
          className="rounded px-2 py-1 text-[11px] text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          onClick={() => onClear(selectedSource)}
          title="Clear output"
          type="button"
        >
          Clear
        </button>
      </div>

      {/* Output log */}
      <div
        className="flex-1 overflow-auto font-mono text-[12px] leading-5"
        onScroll={handleScroll}
        ref={scrollRef}
      >
        {sourceEntries.length === 0 ? (
          <div className="py-8 text-center text-sm text-zinc-600">
            No output for {selectedSource}
          </div>
        ) : (
          sourceEntries.map((entry) => (
            <div
              className="flex gap-2 px-3 py-0.5 hover:bg-zinc-900/50"
              key={entry.id}
            >
              <span className="shrink-0 text-zinc-700">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">
                <AnsiLine text={entry.message} />
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export type { OutputSource };
