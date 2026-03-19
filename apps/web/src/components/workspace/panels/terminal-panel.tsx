"use client";

import { useEffect, useRef, useState } from "react";
import { useSessionStore } from "@/stores/session.store";

type TerminalTab = "output" | "shell" | "logs";

const TERMINAL_TABS: Array<{ id: TerminalTab; label: string }> = [
  { id: "output", label: "Agent Output" },
  { id: "shell", label: "Shell" },
  { id: "logs", label: "Logs" },
];

// Strip ANSI escape codes for safe rendering
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences require control characters
const ANSI_REGEX = /\x1b\[[0-9;]*[A-Za-z]|\x1b\].*?\x07|\x1b\[.*?[@-~]/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, "");
}

const LOG_LEVEL_COLORS: Record<string, string> = {
  error: "text-red-400",
  warning: "text-yellow-400",
  log: "text-zinc-400",
};

function LogLevelBadge({ type }: { type: string }) {
  const colorClass = LOG_LEVEL_COLORS[type] ?? "text-zinc-400";
  return <span className={colorClass}>[{type.toUpperCase()}]</span>;
}

interface TerminalLineProps {
  content: string;
  timestamp?: string;
}

function TerminalLine({ content, timestamp }: TerminalLineProps) {
  const cleanContent = stripAnsi(content);
  return (
    <div className="flex gap-2 px-3 py-px font-mono text-xs leading-5">
      {timestamp && (
        <span className="shrink-0 select-none text-zinc-700">
          {new Date(timestamp).toLocaleTimeString()}
        </span>
      )}
      <span className="min-w-0 whitespace-pre-wrap break-all text-zinc-300">
        {cleanContent}
      </span>
    </div>
  );
}

export function TerminalPanel() {
  const [activeTab, setActiveTab] = useState<TerminalTab>("output");
  const terminalLines = useSessionStore((s) => s.terminalLines);
  const events = useSessionStore((s) => s.events);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) {
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(isAtBottom);
  };

  // Filter events for logs tab
  const logEntries = events.filter(
    (e) => e.type === "log" || e.type === "error" || e.type === "warning"
  );

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Tab Bar */}
      <div className="flex items-center border-zinc-800 border-b">
        <div className="flex">
          {TERMINAL_TABS.map((tab) => (
            <button
              className={`px-3 py-1.5 text-xs transition-colors ${
                activeTab === tab.id
                  ? "border-violet-500 border-b-2 text-violet-400"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 px-2">
          <button
            className="text-[10px] text-zinc-600 hover:text-zinc-400"
            onClick={() => {
              if (scrollRef.current) {
                scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
              }
              setAutoScroll(true);
            }}
            title="Scroll to bottom"
            type="button"
          >
            {autoScroll ? "Auto-scroll ON" : "Auto-scroll OFF"}
          </button>
        </div>
      </div>

      {/* Terminal Content */}
      <div
        className="flex-1 overflow-y-auto py-1"
        onScroll={handleScroll}
        ref={scrollRef}
      >
        {activeTab === "output" &&
          (terminalLines.length === 0 ? (
            <div className="px-3 py-4 text-center font-mono text-xs text-zinc-700">
              Waiting for output...
            </div>
          ) : (
            terminalLines.map((line) => (
              <TerminalLine
                content={line.content}
                key={`line-${line.timestamp ?? ""}-${line.content.slice(0, 40)}`}
                timestamp={line.timestamp}
              />
            ))
          ))}
        {activeTab === "shell" && (
          <div className="px-3 py-4 text-center font-mono text-xs text-zinc-700">
            Shell session not available
          </div>
        )}
        {activeTab === "logs" &&
          (logEntries.length === 0 ? (
            <div className="px-3 py-4 text-center font-mono text-xs text-zinc-700">
              No log entries
            </div>
          ) : (
            logEntries.map((entry) => (
              <div
                className="flex gap-2 px-3 py-px font-mono text-xs leading-5"
                key={entry.id}
              >
                <span className="shrink-0 select-none text-zinc-700">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
                <LogLevelBadge type={entry.type} />
                <span className="min-w-0 whitespace-pre-wrap break-all text-zinc-300">
                  {typeof entry.data.message === "string"
                    ? stripAnsi(entry.data.message)
                    : JSON.stringify(entry.data)}
                </span>
              </div>
            ))
          ))}
      </div>
    </div>
  );
}
