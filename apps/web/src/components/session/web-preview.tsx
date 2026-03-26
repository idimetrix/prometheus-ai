"use client";

import { ExternalLink, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ViewportPreset = "desktop" | "tablet" | "mobile";

interface ViewportDimensions {
  height: number;
  label: string;
  width: number;
}

export interface ConsoleEntry {
  id: string;
  level: "log" | "warn" | "error" | "info";
  message: string;
  timestamp: Date;
}

export interface WebPreviewProps {
  /** Called when a console message is received from the iframe */
  onConsoleMessage?: (entry: ConsoleEntry) => void;
  onNavigate?: (url: string) => void;
  sandboxUrl: string;
  viewport?: ViewportPreset;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VIEWPORT_PRESETS: Record<ViewportPreset, ViewportDimensions> = {
  desktop: { width: 1280, height: 800, label: "Desktop" },
  tablet: { width: 768, height: 1024, label: "Tablet" },
  mobile: { width: 375, height: 667, label: "Mobile" },
};

let consoleEntryId = 0;

// ---------------------------------------------------------------------------
// WebPreview
// ---------------------------------------------------------------------------

/**
 * Iframe-based preview of a sandbox web server with URL bar,
 * refresh button, viewport selector, open in new tab, and error overlay.
 */
export function WebPreview({
  sandboxUrl,
  onNavigate,
  onConsoleMessage,
  viewport: initialViewport = "desktop",
}: WebPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [currentUrl, setCurrentUrl] = useState(sandboxUrl);
  const [urlInput, setUrlInput] = useState(sandboxUrl);
  const [activeViewport, setActiveViewport] =
    useState<ViewportPreset>(initialViewport);
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const dimensions = VIEWPORT_PRESETS[activeViewport];

  // Listen for console messages from the iframe via postMessage
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (
        typeof event.data === "object" &&
        event.data !== null &&
        event.data.type === "console" &&
        typeof event.data.level === "string" &&
        typeof event.data.message === "string"
      ) {
        const level = event.data.level as ConsoleEntry["level"];
        if (
          level === "log" ||
          level === "warn" ||
          level === "error" ||
          level === "info"
        ) {
          consoleEntryId++;
          const entry: ConsoleEntry = {
            id: `console-${consoleEntryId}`,
            level,
            message: String(event.data.message),
            timestamp: new Date(),
          };
          onConsoleMessage?.(entry);
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onConsoleMessage]);

  const handleNavigate = useCallback(() => {
    setCurrentUrl(urlInput);
    setHasError(false);
    setIsLoading(true);
    onNavigate?.(urlInput);
  }, [urlInput, onNavigate]);

  const handleRefresh = useCallback(() => {
    setHasError(false);
    setIsLoading(true);
    if (iframeRef.current) {
      iframeRef.current.src = currentUrl;
    }
  }, [currentUrl]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        handleNavigate();
      }
    },
    [handleNavigate]
  );

  const handleIframeLoad = useCallback(() => {
    setIsLoading(false);
  }, []);

  const handleIframeError = useCallback(() => {
    setHasError(true);
    setIsLoading(false);
  }, []);

  const handleOpenInNewTab = useCallback(() => {
    window.open(currentUrl, "_blank", "noopener,noreferrer");
  }, [currentUrl]);

  return (
    <div className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-950">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-zinc-800 border-b px-3 py-2">
        {/* Refresh */}
        <button
          aria-label="Refresh preview"
          className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          onClick={handleRefresh}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={16} />
        </button>

        {/* URL Bar */}
        <div className="flex flex-1 items-center rounded border border-zinc-700 bg-zinc-900 px-2">
          <span className="mr-1 text-xs text-zinc-500">URL</span>
          <input
            aria-label="URL input"
            className="flex-1 bg-transparent py-1 text-sm text-zinc-200 outline-none"
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={handleKeyDown}
            type="text"
            value={urlInput}
          />
          <button
            className="ml-1 text-xs text-zinc-400 hover:text-zinc-200"
            onClick={handleNavigate}
            type="button"
          >
            Go
          </button>
        </div>

        {/* Viewport Selector */}
        <div className="flex items-center gap-1">
          {(
            Object.entries(VIEWPORT_PRESETS) as [
              ViewportPreset,
              ViewportDimensions,
            ][]
          ).map(([key, value]) => (
            <button
              aria-label={`Switch to ${value.label} viewport`}
              className={`rounded px-2 py-1 text-xs transition-colors ${
                activeViewport === key
                  ? "bg-violet-600 text-white"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`}
              key={key}
              onClick={() => setActiveViewport(key)}
              type="button"
            >
              {value.label}
            </button>
          ))}
        </div>

        {/* Open in new tab */}
        <button
          aria-label="Open preview in new tab"
          className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          onClick={handleOpenInNewTab}
          type="button"
        >
          <ExternalLink aria-hidden="true" size={16} />
        </button>
      </div>

      {/* Preview Area */}
      <div className="relative flex items-center justify-center overflow-auto bg-zinc-900 p-4">
        {/* Loading indicator */}
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-900/80">
            <div className="flex flex-col items-center gap-2">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
              <span className="text-xs text-zinc-400">
                Waiting for dev server...
              </span>
            </div>
          </div>
        )}

        {/* Error overlay */}
        {hasError && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-zinc-900/90 p-8 text-center">
            <div className="mb-2 text-red-400">
              <svg
                aria-hidden="true"
                fill="none"
                height="32"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                width="32"
                xmlns="http://www.w3.org/2000/svg"
              >
                <title>Error</title>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" x2="12" y1="8" y2="12" />
                <line x1="12" x2="12.01" y1="16" y2="16" />
              </svg>
            </div>
            <p className="mb-1 font-medium text-sm text-zinc-200">
              Dev Server Unavailable
            </p>
            <p className="mb-3 text-xs text-zinc-400">
              The preview could not be loaded. Make sure the dev server is
              running in the sandbox terminal.
            </p>
            <button
              className="rounded bg-violet-600 px-3 py-1.5 text-white text-xs hover:bg-violet-500"
              onClick={handleRefresh}
              type="button"
            >
              Retry
            </button>
          </div>
        )}

        {/* Iframe */}
        <iframe
          className="rounded border border-zinc-700 bg-white"
          height={dimensions.height}
          onError={handleIframeError}
          onLoad={handleIframeLoad}
          ref={iframeRef}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          src={currentUrl}
          title="Web preview"
          width={dimensions.width}
        />
      </div>

      {/* Status Bar */}
      <div className="flex items-center justify-between border-zinc-800 border-t px-3 py-1.5 text-xs text-zinc-500">
        <span>
          {dimensions.width} x {dimensions.height}
        </span>
        <span>{isLoading ? "Loading..." : "Ready"}</span>
      </div>
    </div>
  );
}
