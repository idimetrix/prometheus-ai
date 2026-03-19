"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DevicePreset = "desktop" | "tablet" | "mobile";

interface DeviceConfig {
  height: number | "100%";
  label: string;
  width: number | "100%";
}

const DEVICE_PRESETS: Record<DevicePreset, DeviceConfig> = {
  desktop: { label: "Desktop", width: "100%", height: "100%" },
  tablet: { label: "Tablet", width: 768, height: 1024 },
  mobile: { label: "Mobile", width: 375, height: 812 },
};

const DEFAULT_URL = "http://localhost:3001";

// ---------------------------------------------------------------------------
// BrowserPreviewPanel
// ---------------------------------------------------------------------------

/**
 * An iframe-based browser preview panel for the workspace.
 *
 * Provides:
 *  - URL bar with navigation (back, forward, refresh)
 *  - Device size presets (desktop, tablet, mobile)
 *  - Loading indicator
 *  - Error state handling
 *  - Console message capture from the iframe
 */
export function BrowserPreviewPanel() {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [inputUrl, setInputUrl] = useState(DEFAULT_URL);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<DevicePreset>("desktop");
  const [consoleMessages, setConsoleMessages] = useState<
    Array<{ type: string; message: string; timestamp: number }>
  >([]);
  const [showConsole, setShowConsole] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const historyStack = useRef<string[]>([DEFAULT_URL]);
  const historyIndex = useRef(0);

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------

  const navigate = useCallback((targetUrl: string) => {
    try {
      // Normalize the URL
      let normalizedUrl = targetUrl.trim();
      if (
        !(
          normalizedUrl.startsWith("http://") ||
          normalizedUrl.startsWith("https://")
        )
      ) {
        normalizedUrl = `http://${normalizedUrl}`;
      }

      // Validate URL
      new URL(normalizedUrl);

      setUrl(normalizedUrl);
      setInputUrl(normalizedUrl);
      setError(null);
      setIsLoading(true);

      // Update history
      const stack = historyStack.current;
      const idx = historyIndex.current;

      // Trim forward history if navigating from a back state
      if (idx < stack.length - 1) {
        historyStack.current = stack.slice(0, idx + 1);
      }

      historyStack.current.push(normalizedUrl);
      historyIndex.current = historyStack.current.length - 1;
    } catch {
      setError(`Invalid URL: ${targetUrl}`);
    }
  }, []);

  const goBack = useCallback(() => {
    if (historyIndex.current > 0) {
      historyIndex.current--;
      const prevUrl = historyStack.current[historyIndex.current];
      if (prevUrl) {
        setUrl(prevUrl);
        setInputUrl(prevUrl);
        setIsLoading(true);
      }
    }
  }, []);

  const goForward = useCallback(() => {
    if (historyIndex.current < historyStack.current.length - 1) {
      historyIndex.current++;
      const nextUrl = historyStack.current[historyIndex.current];
      if (nextUrl) {
        setUrl(nextUrl);
        setInputUrl(nextUrl);
        setIsLoading(true);
      }
    }
  }, []);

  const refresh = useCallback(() => {
    setIsLoading(true);
    setError(null);
    if (iframeRef.current) {
      iframeRef.current.src = url;
    }
  }, [url]);

  const handleUrlSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      navigate(inputUrl);
    },
    [inputUrl, navigate]
  );

  // -------------------------------------------------------------------------
  // Iframe event handlers
  // -------------------------------------------------------------------------

  const handleIframeLoad = useCallback(() => {
    setIsLoading(false);
    setError(null);
  }, []);

  const handleIframeError = useCallback(() => {
    setIsLoading(false);
    setError("Failed to load page. The server may not be running.");
  }, []);

  // Listen for messages from the iframe (console capture)
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "console") {
        setConsoleMessages((prev) => [
          ...prev.slice(-99), // Keep last 100 messages
          {
            type: event.data.level ?? "log",
            message: String(event.data.message ?? ""),
            timestamp: Date.now(),
          },
        ]);
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // -------------------------------------------------------------------------
  // Device preset dimensions
  // -------------------------------------------------------------------------

  const deviceConfig = DEVICE_PRESETS[device];
  const iframeStyle: React.CSSProperties = {
    width: deviceConfig.width === "100%" ? "100%" : `${deviceConfig.width}px`,
    height:
      deviceConfig.height === "100%" ? "100%" : `${deviceConfig.height}px`,
    maxWidth: "100%",
    maxHeight: "100%",
    border: "none",
    backgroundColor: "#ffffff",
  };

  const canGoBack = historyIndex.current > 0;
  const canGoForward = historyIndex.current < historyStack.current.length - 1;

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Navigation bar */}
      <div className="flex items-center gap-1.5 border-zinc-800 border-b px-2 py-1.5">
        {/* Back / Forward / Refresh */}
        <button
          className={`rounded p-1 text-xs ${
            canGoBack
              ? "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              : "cursor-not-allowed text-zinc-700"
          }`}
          disabled={!canGoBack}
          onClick={goBack}
          title="Go back"
          type="button"
        >
          <ArrowLeftIcon />
        </button>
        <button
          className={`rounded p-1 text-xs ${
            canGoForward
              ? "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              : "cursor-not-allowed text-zinc-700"
          }`}
          disabled={!canGoForward}
          onClick={goForward}
          title="Go forward"
          type="button"
        >
          <ArrowRightIcon />
        </button>
        <button
          className="rounded p-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          onClick={refresh}
          title="Refresh"
          type="button"
        >
          <RefreshIcon />
        </button>

        {/* URL input */}
        <form className="flex flex-1" onSubmit={handleUrlSubmit}>
          <input
            className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 font-mono text-xs text-zinc-300 outline-none transition-colors focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30"
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder="Enter URL..."
            spellCheck={false}
            type="text"
            value={inputUrl}
          />
        </form>

        {/* Device presets */}
        <div className="flex items-center gap-0.5 rounded border border-zinc-800 p-0.5">
          {(Object.keys(DEVICE_PRESETS) as DevicePreset[]).map((preset) => (
            <button
              className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
                device === preset
                  ? "bg-violet-500/20 text-violet-400"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
              key={preset}
              onClick={() => setDevice(preset)}
              title={DEVICE_PRESETS[preset].label}
              type="button"
            >
              {DEVICE_PRESETS[preset].label}
            </button>
          ))}
        </div>

        {/* Console toggle */}
        <button
          className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
            showConsole
              ? "bg-violet-500/20 text-violet-400"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
          onClick={() => setShowConsole((v) => !v)}
          title="Toggle console"
          type="button"
        >
          Console
          {consoleMessages.length > 0 && (
            <span className="ml-1 rounded-full bg-zinc-700 px-1.5 text-[9px] text-zinc-400">
              {consoleMessages.length}
            </span>
          )}
        </button>
      </div>

      {/* Loading bar */}
      {isLoading && (
        <div className="h-0.5 w-full overflow-hidden bg-zinc-800">
          <div className="h-full w-1/3 animate-pulse bg-violet-500" />
        </div>
      )}

      {/* Content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Iframe container */}
        <div
          className={`flex flex-1 items-start justify-center overflow-auto ${
            device === "desktop" ? "" : "bg-zinc-900 p-4"
          }`}
        >
          {error ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3">
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
              <button
                className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
                onClick={refresh}
                type="button"
              >
                Retry
              </button>
            </div>
          ) : (
            // biome-ignore lint/a11y/noNoninteractiveElementInteractions: onLoad/onError are lifecycle events, not user interactions
            <iframe
              className={`${device === "desktop" ? "" : "rounded-lg border border-zinc-700 shadow-xl"}`}
              onError={handleIframeError}
              onLoad={handleIframeLoad}
              ref={iframeRef}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
              src={url}
              style={iframeStyle}
              title="Browser Preview"
            />
          )}
        </div>

        {/* Console panel */}
        {showConsole && (
          <div className="h-40 shrink-0 border-zinc-800 border-t">
            <div className="flex items-center justify-between border-zinc-800 border-b px-3 py-1">
              <span className="font-medium text-[10px] text-zinc-500 uppercase">
                Console
              </span>
              <button
                className="text-[10px] text-zinc-600 hover:text-zinc-400"
                onClick={() => setConsoleMessages([])}
                type="button"
              >
                Clear
              </button>
            </div>
            <div className="h-[calc(100%-24px)] overflow-y-auto">
              {consoleMessages.length === 0 ? (
                <div className="px-3 py-3 text-center text-[11px] text-zinc-700">
                  No console messages
                </div>
              ) : (
                consoleMessages.map((msg) => (
                  <div
                    className={`flex gap-2 px-3 py-0.5 font-mono text-[11px] leading-5 ${getConsoleMessageStyle(msg.type)}`}
                    key={`${msg.timestamp}-${msg.message.slice(0, 20)}`}
                  >
                    <span className="shrink-0 select-none text-zinc-700">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="min-w-0 break-all">{msg.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

function getConsoleMessageStyle(type: string): string {
  if (type === "error") {
    return "bg-red-500/5 text-red-400";
  }
  if (type === "warn") {
    return "bg-yellow-500/5 text-yellow-400";
  }
  return "text-zinc-400";
}

// ---------------------------------------------------------------------------
// Inline SVG icons (kept minimal to avoid external dependencies)
// ---------------------------------------------------------------------------

function ArrowLeftIcon() {
  return (
    <svg
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="14"
    >
      <title>Go back</title>
      <path d="M19 12H5" />
      <path d="M12 19l-7-7 7-7" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="14"
    >
      <title>Go forward</title>
      <path d="M5 12h14" />
      <path d="M12 5l7 7-7 7" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="14"
    >
      <title>Refresh</title>
      <path d="M23 4v6h-6" />
      <path d="M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}
