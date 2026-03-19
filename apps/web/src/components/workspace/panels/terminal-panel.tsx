"use client";

import dynamic from "next/dynamic";
import {
  type ForwardedRef,
  forwardRef,
  type RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useSessionStore } from "@/stores/session.store";

type TerminalTab = "output" | "shell" | "logs";

const TERMINAL_TABS: Array<{ id: TerminalTab; label: string }> = [
  { id: "output", label: "Agent Output" },
  { id: "shell", label: "Shell" },
  { id: "logs", label: "Logs" },
];

// Strip ANSI escape codes for safe rendering in fallback views
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

// -- XTerminal handle for imperative access --

export interface XTerminalHandle {
  clear: () => void;
  write: (data: string) => void;
}

interface XTerminalProps {
  className?: string;
  onData?: (data: string) => void;
}

/**
 * XTerminal renders an xterm.js terminal instance inside the browser.
 * It must only be rendered on the client (use next/dynamic with ssr: false).
 */
const XTerminalInner = forwardRef(function XTerminalInner(
  { className, onData }: XTerminalProps,
  ref: ForwardedRef<XTerminalHandle>
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchAddonRef = useRef<
    import("@xterm/addon-search").SearchAddon | null
  >(null);

  useImperativeHandle(ref, () => ({
    write(data: string) {
      terminalRef.current?.write(data);
    },
    clear() {
      terminalRef.current?.clear();
    },
  }));

  useEffect(() => {
    let disposed = false;

    async function init() {
      if (!containerRef.current) {
        return;
      }

      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      const { SearchAddon } = await import("@xterm/addon-search");
      const { WebLinksAddon } = await import("@xterm/addon-web-links");

      // Dynamic CSS import for xterm styles
      await import("@xterm/xterm/css/xterm.css");

      if (disposed) {
        return;
      }

      const fitAddon = new FitAddon();
      const searchAddon = new SearchAddon();
      const webLinksAddon = new WebLinksAddon();

      const terminal = new Terminal({
        allowProposedApi: true,
        cursorBlink: true,
        cursorStyle: "bar",
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        fontSize: 13,
        lineHeight: 1.5,
        scrollback: 5000,
        theme: {
          background: "#09090b",
          foreground: "#fafafa",
          cursor: "#8b5cf6",
          selectionBackground: "rgba(139,92,246,0.3)",
          black: "#18181b",
          red: "#f87171",
          green: "#4ade80",
          yellow: "#facc15",
          blue: "#60a5fa",
          magenta: "#c084fc",
          cyan: "#22d3ee",
          white: "#fafafa",
          brightBlack: "#52525b",
          brightRed: "#fca5a5",
          brightGreen: "#86efac",
          brightYellow: "#fde68a",
          brightBlue: "#93c5fd",
          brightMagenta: "#d8b4fe",
          brightCyan: "#67e8f9",
          brightWhite: "#ffffff",
        },
      });

      terminal.loadAddon(fitAddon);
      terminal.loadAddon(searchAddon);
      terminal.loadAddon(webLinksAddon);

      terminal.open(containerRef.current);
      fitAddon.fit();

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      searchAddonRef.current = searchAddon;

      if (onData) {
        terminal.onData(onData);
      }
    }

    init();

    return () => {
      disposed = true;
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
    };
  }, [onData]);

  // Resize observer for fit addon
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const observer = new ResizeObserver(() => {
      try {
        fitAddonRef.current?.fit();
      } catch {
        // Terminal may not be ready yet
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Keyboard shortcut for search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
      if (e.key === "Escape" && searchOpen) {
        setSearchOpen(false);
        setSearchQuery("");
      }
    }

    const container = containerRef.current;
    container?.addEventListener("keydown", handleKeyDown);
    return () => container?.removeEventListener("keydown", handleKeyDown);
  }, [searchOpen]);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (query) {
      searchAddonRef.current?.findNext(query);
    }
  }, []);

  const handleSearchNext = useCallback(() => {
    if (searchQuery) {
      searchAddonRef.current?.findNext(searchQuery);
    }
  }, [searchQuery]);

  const handleSearchPrev = useCallback(() => {
    if (searchQuery) {
      searchAddonRef.current?.findPrevious(searchQuery);
    }
  }, [searchQuery]);

  return (
    <div className={`relative flex h-full flex-col ${className ?? ""}`}>
      {searchOpen && (
        <div className="absolute top-0 right-0 z-10 flex items-center gap-1 rounded-bl-md border-zinc-700 border-b border-l bg-zinc-900 px-2 py-1">
          <input
            autoFocus
            className="w-48 rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-200 outline-none focus:border-violet-500"
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search..."
            type="text"
            value={searchQuery}
          />
          <button
            className="rounded px-1 py-0.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
            onClick={handleSearchPrev}
            title="Previous match"
            type="button"
          >
            Up
          </button>
          <button
            className="rounded px-1 py-0.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
            onClick={handleSearchNext}
            title="Next match"
            type="button"
          >
            Dn
          </button>
          <button
            className="rounded px-1 py-0.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
            onClick={() => {
              setSearchOpen(false);
              setSearchQuery("");
            }}
            title="Close search"
            type="button"
          >
            X
          </button>
        </div>
      )}
      <div className="flex-1" ref={containerRef} />
    </div>
  );
});

/**
 * Dynamically imported XTerminal (no SSR) to avoid Node.js incompatibilities
 * with xterm.js which requires browser APIs.
 */
const XTerminal = dynamic(() => Promise.resolve(XTerminalInner), {
  ssr: false,
});

// -- Main TerminalPanel export --

export function TerminalPanel() {
  const [activeTab, setActiveTab] = useState<TerminalTab>("output");
  const terminalLines = useSessionStore((s) => s.terminalLines);
  const events = useSessionStore((s) => s.events);
  const xtermRef = useRef<XTerminalHandle>(null);
  const writtenCountRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Write new terminal lines to xterm as they arrive
  useEffect(() => {
    if (activeTab !== "shell" || !xtermRef.current) {
      return;
    }

    const newLines = terminalLines.slice(writtenCountRef.current);
    for (const line of newLines) {
      xtermRef.current.write(`${line.content}\r\n`);
    }
    writtenCountRef.current = terminalLines.length;
  }, [terminalLines, activeTab]);

  // Auto-scroll for output/logs tabs
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

  const handleTerminalData = useCallback((_data: string) => {
    // Future: send input data to backend shell session
  }, []);

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
        {activeTab !== "shell" && (
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
        )}
      </div>

      {/* Terminal Content */}
      {activeTab === "shell" ? (
        <div className="flex-1">
          <XTerminal
            onData={handleTerminalData}
            ref={xtermRef as RefObject<XTerminalHandle>}
          />
        </div>
      ) : (
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
                <div
                  className="flex gap-2 px-3 py-px font-mono text-xs leading-5"
                  key={`line-${line.timestamp ?? ""}-${line.content.slice(0, 40)}`}
                >
                  {line.timestamp && (
                    <span className="shrink-0 select-none text-zinc-700">
                      {new Date(line.timestamp).toLocaleTimeString()}
                    </span>
                  )}
                  <span className="min-w-0 whitespace-pre-wrap break-all text-zinc-300">
                    {stripAnsi(line.content)}
                  </span>
                </div>
              ))
            ))}
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
      )}
    </div>
  );
}
