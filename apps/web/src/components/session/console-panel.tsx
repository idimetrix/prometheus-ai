"use client";

import {
  AlertTriangle,
  Info,
  MessageSquare,
  Trash2,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ConsoleEntry } from "./web-preview";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LogLevel = ConsoleEntry["level"];

export interface ConsolePanelProps {
  /** Console entries to display */
  entries: ConsoleEntry[];
  /** Called when the clear button is clicked */
  onClear: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LEVEL_CONFIG: Record<
  LogLevel,
  { className: string; icon: typeof Info; label: string }
> = {
  log: { icon: MessageSquare, className: "text-zinc-400", label: "log" },
  info: { icon: Info, className: "text-blue-400", label: "info" },
  warn: { icon: AlertTriangle, className: "text-yellow-400", label: "warn" },
  error: { icon: XCircle, className: "text-red-400", label: "error" },
};

const ALL_LEVELS: LogLevel[] = ["log", "info", "warn", "error"];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Console panel that displays log/warn/error messages captured from
 * the preview iframe via postMessage. Supports filtering by log level,
 * auto-scrolling, and clearing.
 */
export function ConsolePanel({ entries, onClear }: ConsolePanelProps) {
  const [activeFilters, setActiveFilters] = useState<Set<LogLevel>>(
    new Set(ALL_LEVELS)
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [autoScroll]);

  // Detect manual scroll to disable auto-scroll
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
    setAutoScroll(isAtBottom);
  }, []);

  const toggleFilter = useCallback((level: LogLevel) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  }, []);

  const filteredEntries = entries.filter((e) => activeFilters.has(e.level));

  const formatTime = (date: Date): string => {
    const h = date.getHours().toString().padStart(2, "0");
    const m = date.getMinutes().toString().padStart(2, "0");
    const s = date.getSeconds().toString().padStart(2, "0");
    const ms = date.getMilliseconds().toString().padStart(3, "0");
    return `${h}:${m}:${s}.${ms}`;
  };

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-zinc-800 border-b px-3 py-1.5">
        <div className="flex items-center gap-1">
          <span className="mr-2 font-medium text-xs text-zinc-300">
            Console
          </span>

          {/* Level filters */}
          {ALL_LEVELS.map((level) => {
            const config = LEVEL_CONFIG[level];
            const count = entries.filter((e) => e.level === level).length;
            const isActive = activeFilters.has(level);

            return (
              <button
                aria-label={`${isActive ? "Hide" : "Show"} ${config.label} messages`}
                className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors ${
                  isActive
                    ? `${config.className} bg-zinc-800`
                    : "text-zinc-600 hover:text-zinc-400"
                }`}
                key={level}
                onClick={() => toggleFilter(level)}
                type="button"
              >
                <config.icon aria-hidden="true" size={11} />
                <span>{count}</span>
              </button>
            );
          })}
        </div>

        <button
          aria-label="Clear console"
          className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          onClick={onClear}
          type="button"
        >
          <Trash2 aria-hidden="true" size={13} />
        </button>
      </div>

      {/* Log entries */}
      <div
        className="flex-1 overflow-y-auto font-mono text-xs"
        onScroll={handleScroll}
        ref={scrollRef}
      >
        {filteredEntries.length === 0 ? (
          <div className="flex h-full items-center justify-center text-zinc-600">
            {entries.length === 0
              ? "No console output yet"
              : "All messages filtered out"}
          </div>
        ) : (
          filteredEntries.map((entry) => {
            const config = LEVEL_CONFIG[entry.level];
            const Icon = config.icon;

            return (
              <div
                className={`flex items-start gap-2 border-zinc-800/50 border-b px-3 py-1 ${(() => {
                  if (entry.level === "error") {
                    return "bg-red-950/20";
                  }
                  if (entry.level === "warn") {
                    return "bg-yellow-950/20";
                  }
                  return "";
                })()}`}
                key={entry.id}
              >
                <Icon
                  aria-hidden="true"
                  className={`mt-0.5 shrink-0 ${config.className}`}
                  size={12}
                />
                <span className="shrink-0 text-zinc-600">
                  {formatTime(entry.timestamp)}
                </span>
                <span
                  className={`flex-1 whitespace-pre-wrap break-all ${config.className}`}
                >
                  {entry.message}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
