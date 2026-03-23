"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface TerminalLine {
  id: string;
  stream?: "stdout" | "stderr";
  text: string;
  timestamp?: number;
}

interface TerminalOutputProps {
  autoScroll?: boolean;
  className?: string;
  lines: TerminalLine[];
  maxHeight?: string;
  onClear?: () => void;
  showTimestamps?: boolean;
  title?: string;
  wrapLines?: boolean;
}

/* -------------------------------------------------------------------------- */
/*  ANSI color code handling                                                   */
/* -------------------------------------------------------------------------- */

interface AnsiSpan {
  className: string;
  text: string;
}

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

function parseAnsi(text: string): AnsiSpan[] {
  const spans: AnsiSpan[] = [];
  const regex = /\x1b\[(\d+)m/g;
  let lastIndex = 0;
  let currentColor = "";
  let match: RegExpExecArray | null = regex.exec(text);

  while (match !== null) {
    if (match.index > lastIndex) {
      spans.push({
        className: currentColor,
        text: text.slice(lastIndex, match.index),
      });
    }
    const code = match[1] ?? "";
    if (code === "0") {
      currentColor = "";
    } else {
      currentColor = ANSI_COLOR_MAP[code] ?? "";
    }
    lastIndex = match.index + match[0].length;
    match = regex.exec(text);
  }

  if (lastIndex < text.length) {
    spans.push({
      className: currentColor,
      text: text.slice(lastIndex),
    });
  }

  return spans.length > 0 ? spans : [{ className: "", text }];
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function TerminalOutput({
  lines,
  title = "Terminal",
  maxHeight = "20rem",
  autoScroll: initialAutoScroll = true,
  showTimestamps = false,
  wrapLines = false,
  className = "",
  onClear,
}: TerminalOutputProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(initialAutoScroll);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current && autoScroll) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [autoScroll]);

  useEffect(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) {
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40);
  }, []);

  return (
    <div
      className={`overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950 ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-zinc-800 border-b px-3 py-1.5">
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <div className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
            <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" />
            <div className="h-2.5 w-2.5 rounded-full bg-green-500/70" />
          </div>
          <span className="text-xs text-zinc-500">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          {onClear && (
            <button
              className="text-[10px] text-zinc-600 hover:text-zinc-400"
              onClick={onClear}
              type="button"
            >
              Clear
            </button>
          )}
          <span className="text-[10px] text-zinc-600">
            {lines.length} lines
          </span>
        </div>
      </div>

      {/* Output area */}
      <div
        className="overflow-auto p-2 font-mono text-xs"
        onScroll={handleScroll}
        ref={scrollRef}
        style={{ maxHeight }}
      >
        {lines.map((line) => (
          <div
            className={`leading-5 ${
              line.stream === "stderr" ? "text-red-400" : "text-zinc-300"
            } ${wrapLines ? "whitespace-pre-wrap break-all" : "whitespace-pre"}`}
            key={line.id}
          >
            {showTimestamps && line.timestamp && (
              <span className="mr-2 text-zinc-600">
                {new Date(line.timestamp).toLocaleTimeString()}
              </span>
            )}
            {parseAnsi(line.text).map((span) => (
              <span
                className={span.className}
                key={`${line.id}-${span.text.slice(0, 20)}-${span.className ?? ""}`}
              >
                {span.text}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export type { TerminalLine, TerminalOutputProps };
