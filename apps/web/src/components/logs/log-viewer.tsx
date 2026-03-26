"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface LogEntry {
  id: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  timestamp: string;
}

interface LogViewerProps {
  /** Initial log entries to display. */
  entries?: LogEntry[];
  /** Maximum number of entries to retain in memory. */
  maxEntries?: number;
  /** If provided, the viewer will subscribe to this event source URL for streaming. */
  streamUrl?: string;
  /** Title displayed at the top of the viewer. */
  title?: string;
}

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

const LEVEL_COLORS: Record<string, string> = {
  debug: "text-zinc-500",
  info: "text-cyan-400",
  warn: "text-yellow-400",
  error: "text-red-400",
};

const LEVEL_BG: Record<string, string> = {
  debug: "",
  info: "",
  warn: "bg-yellow-500/5",
  error: "bg-red-500/5",
};

type LogLevel = "debug" | "info" | "warn" | "error";

const ALL_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

/* -------------------------------------------------------------------------- */
/*  ANSI color support (basic)                                                 */
/* -------------------------------------------------------------------------- */

const ANSI_MAP: Record<string, string> = {
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

const ANSI_ESCAPE_RE = /\x1b\[(\d+)m/;

function AnsiLine({ text }: { text: string }) {
  // Split on ANSI escape codes
  const parts = text.split(ANSI_ESCAPE_RE);
  if (parts.length <= 1) {
    return <span>{text}</span>;
  }

  const elements: Array<{ className: string; key: string; text: string }> = [];
  let currentClass = "";

  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      // Text part
      if (parts[i]) {
        elements.push({
          key: `p-${String(i)}`,
          className: currentClass,
          text: parts[i] ?? "",
        });
      }
    } else {
      // ANSI code
      const code = parts[i] ?? "";
      if (code === "0") {
        currentClass = "";
      } else {
        currentClass = ANSI_MAP[code] ?? "";
      }
    }
  }

  return (
    <span>
      {elements.map((el) => (
        <span className={el.className} key={el.key}>
          {el.text}
        </span>
      ))}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  LogViewer                                                                   */
/* -------------------------------------------------------------------------- */

export function LogViewer({
  entries: initialEntries = [],
  streamUrl,
  title = "Logs",
  maxEntries = 5000,
}: LogViewerProps) {
  const [entries, setEntries] = useState<LogEntry[]>(initialEntries);
  const [filter, setFilter] = useState<Set<LogLevel>>(new Set(ALL_LEVELS));
  const [search, setSearch] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [paused, setPaused] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Auto scroll to bottom
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [autoScroll]);

  // Stream logs from EventSource
  useEffect(() => {
    if (!streamUrl || paused) {
      return;
    }

    const es = new EventSource(streamUrl);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as
          | LogEntry
          | { type: string; data: LogEntry };
        const entry =
          "type" in data && data.type === "log"
            ? data.data
            : (data as LogEntry);
        setEntries((prev) => {
          const next = [...prev, entry];
          return next.length > maxEntries ? next.slice(-maxEntries) : next;
        });
      } catch {
        // Ignore malformed events
      }
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [streamUrl, paused, maxEntries]);

  // Filtered + searched entries
  const visibleEntries = entries.filter((e) => {
    if (!filter.has(e.level)) {
      return false;
    }
    if (search && !e.message.toLowerCase().includes(search.toLowerCase())) {
      return false;
    }
    return true;
  });

  const toggleLevel = useCallback((level: LogLevel) => {
    setFilter((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  }, []);

  const handleCopy = useCallback(() => {
    const text = visibleEntries
      .map(
        (e) =>
          `${new Date(e.timestamp).toISOString()} [${e.level.toUpperCase()}] ${e.message}`
      )
      .join("\n");
    navigator.clipboard.writeText(text).catch(() => {
      // Silently ignore clipboard write failures (e.g. permissions)
    });
  }, [visibleEntries]);

  const handleClear = useCallback(() => {
    setEntries([]);
  }, []);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) {
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(atBottom);
  }, []);

  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-800 bg-zinc-950">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-zinc-800 border-b px-3 py-2">
        <span className="font-medium text-sm text-zinc-300">{title}</span>

        {/* Level filters */}
        <div className="ml-4 flex gap-1">
          {ALL_LEVELS.map((level) => (
            <button
              className={`rounded px-2 py-0.5 text-xs transition-colors ${
                filter.has(level)
                  ? `${LEVEL_COLORS[level]} bg-zinc-800 font-medium`
                  : "text-zinc-600"
              }`}
              key={level}
              onClick={() => toggleLevel(level)}
              type="button"
            >
              {level.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="ml-auto flex items-center gap-2">
          <label className="sr-only" htmlFor="log-search">
            Search logs
          </label>
          <input
            className="w-48 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
            id="log-search"
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search logs..."
            value={search}
          />

          {/* Controls */}
          <button
            className={`rounded px-2 py-1 text-xs ${
              paused
                ? "bg-yellow-500/10 text-yellow-400"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            onClick={() => setPaused(!paused)}
            title={paused ? "Resume" : "Pause"}
            type="button"
          >
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            className="rounded px-2 py-1 text-xs text-zinc-500 hover:text-zinc-300"
            onClick={handleCopy}
            title="Copy logs"
            type="button"
          >
            Copy
          </button>
          <button
            className="rounded px-2 py-1 text-xs text-zinc-500 hover:text-red-400"
            onClick={handleClear}
            title="Clear logs"
            type="button"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Entries count */}
      <div className="border-zinc-800 border-b px-3 py-1">
        <span className="text-[10px] text-zinc-600">
          {visibleEntries.length} / {entries.length} entries
          {!autoScroll && " (scroll paused)"}
        </span>
      </div>

      {/* Log content */}
      <div
        className="flex-1 overflow-auto font-mono text-xs"
        onScroll={handleScroll}
        ref={scrollRef}
      >
        {visibleEntries.length === 0 ? (
          <div className="p-8 text-center text-zinc-600">
            {entries.length === 0
              ? "No log entries yet"
              : "No entries match the current filters"}
          </div>
        ) : (
          visibleEntries.map((entry) => (
            <div
              className={`flex gap-2 px-3 py-0.5 hover:bg-zinc-900/50 ${
                LEVEL_BG[entry.level] ?? ""
              }`}
              key={entry.id}
            >
              <span className="shrink-0 select-none text-zinc-600">
                {new Date(entry.timestamp).toISOString().slice(11, 23)}
              </span>
              <span
                className={`w-12 shrink-0 text-right font-medium ${
                  LEVEL_COLORS[entry.level] ?? "text-zinc-400"
                }`}
              >
                {entry.level.toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-all text-zinc-300">
                <AnsiLine text={entry.message} />
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
