"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface XtermTheme {
  background?: string;
  cursor?: string;
  foreground?: string;
  selectionBackground?: string;
}

export interface XtermTerminalProps {
  /** Font size in pixels */
  fontSize?: number;
  /** Called when the terminal session ends */
  onExit?: (code: number) => void;
  /** Called when the WebSocket connection status changes */
  onStatusChange?: (status: TerminalStatus) => void;
  /** Sandbox ID to connect to */
  sandboxId: string;
  /** Custom color theme */
  theme?: XtermTheme;
  /** WebSocket base URL for the PTY bridge */
  wsUrl?: string;
}

export type TerminalStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_THEME: XtermTheme = {
  background: "#09090b",
  foreground: "#e4e4e7",
  cursor: "#a78bfa",
  selectionBackground: "#3f3f46",
};

const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusIndicatorClass(s: TerminalStatus): string {
  if (s === "connecting") {
    return "animate-pulse bg-yellow-400";
  }
  if (s === "error") {
    return "bg-red-400";
  }
  return "bg-zinc-500";
}

function statusLabel(s: TerminalStatus): string {
  if (s === "connecting") {
    return "Connecting...";
  }
  if (s === "error") {
    return "Connection error";
  }
  return "Disconnected";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function XtermTerminal({
  sandboxId,
  wsUrl,
  fontSize = 14,
  theme = DEFAULT_THEME,
  onStatusChange,
  onExit,
}: XtermTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<TerminalStatus>("connecting");

  const updateStatus = useCallback(
    (next: TerminalStatus) => {
      setStatus(next);
      onStatusChange?.(next);
    },
    [onStatusChange]
  );

  // Build WebSocket URL
  const getWsUrl = useCallback(() => {
    const base =
      wsUrl ??
      (typeof window !== "undefined" && window.location.hostname === "localhost"
        ? "ws://localhost:4006"
        : (process.env.NEXT_PUBLIC_SANDBOX_WS_URL ?? "ws://localhost:4006"));
    return `${base}/terminal/${sandboxId}`;
  }, [wsUrl, sandboxId]);

  // Connect WebSocket
  const connectWs = useCallback(
    (terminal: import("@xterm/xterm").Terminal) => {
      const url = getWsUrl();
      const ws = new WebSocket(url);
      wsRef.current = ws;
      updateStatus("connecting");

      ws.binaryType = "arraybuffer";

      ws.addEventListener("open", () => {
        reconnectAttemptsRef.current = 0;
        updateStatus("connected");

        // Send initial resize
        if (terminal.cols && terminal.rows) {
          ws.send(
            JSON.stringify({
              type: "resize",
              cols: terminal.cols,
              rows: terminal.rows,
            })
          );
        }
      });

      ws.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          try {
            const msg = JSON.parse(event.data) as {
              type: string;
              code?: number;
            };
            if (msg.type === "exit") {
              onExit?.(msg.code ?? 0);
              return;
            }
          } catch {
            // Plain text data
          }
          terminal.write(event.data);
        } else if (event.data instanceof ArrayBuffer) {
          terminal.write(new Uint8Array(event.data));
        }
      });

      ws.addEventListener("close", () => {
        updateStatus("disconnected");
        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectTimerRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connectWs(terminal);
          }, RECONNECT_DELAY_MS);
        }
      });

      ws.addEventListener("error", () => {
        updateStatus("error");
      });

      return ws;
    },
    [getWsUrl, updateStatus, onExit]
  );

  // Initialize terminal
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let disposed = false;

    const init = async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      const { WebLinksAddon } = await import("@xterm/addon-web-links");

      if (disposed) {
        return;
      }

      const terminal = new Terminal({
        fontSize,
        fontFamily:
          "ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, monospace",
        cursorBlink: true,
        cursorStyle: "bar",
        scrollback: 10_000,
        theme: {
          background: theme.background ?? DEFAULT_THEME.background,
          foreground: theme.foreground ?? DEFAULT_THEME.foreground,
          cursor: theme.cursor ?? DEFAULT_THEME.cursor,
          selectionBackground:
            theme.selectionBackground ?? DEFAULT_THEME.selectionBackground,
        },
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(new WebLinksAddon());

      terminal.open(container);
      fitAddon.fit();

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      // Handle user input -> send to WS
      terminal.onData((data) => {
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "input", data }));
        }
      });

      // Handle resize -> send to WS
      terminal.onResize(({ cols, rows }) => {
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols, rows }));
        }
      });

      // Connect WebSocket
      connectWs(terminal);

      // Handle container resize
      const observer = new ResizeObserver(() => {
        if (!disposed && fitAddonRef.current) {
          try {
            fitAddonRef.current.fit();
          } catch {
            // Ignore fit errors during rapid resizing
          }
        }
      });
      observer.observe(container);

      // Store cleanup for observer
      (
        container as unknown as { _resizeObserver?: ResizeObserver }
      )._resizeObserver = observer;
    };

    init();

    return () => {
      disposed = true;

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      wsRef.current?.close();
      wsRef.current = null;

      const observer = (
        container as unknown as { _resizeObserver?: ResizeObserver }
      )._resizeObserver;
      observer?.disconnect();

      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [fontSize, theme, connectWs]);

  return (
    <div className="relative h-full w-full">
      {/* Status indicator */}
      {status !== "connected" && (
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5 rounded bg-zinc-800/90 px-2 py-1 text-xs">
          <span
            className={`h-2 w-2 rounded-full ${statusIndicatorClass(status)}`}
          />
          <span className="text-zinc-400">{statusLabel(status)}</span>
        </div>
      )}

      {/* Terminal container */}
      <div
        className="h-full w-full p-1"
        ref={containerRef}
        style={{
          backgroundColor: theme.background ?? DEFAULT_THEME.background,
        }}
      />
    </div>
  );
}
