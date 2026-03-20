"use client";

import { useCallback, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ViewportPreset = "desktop" | "tablet" | "mobile";

interface ViewportDimensions {
  height: number;
  label: string;
  width: number;
}

export interface WebPreviewProps {
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

// ---------------------------------------------------------------------------
// WebPreview
// ---------------------------------------------------------------------------

/**
 * Iframe-based preview of a sandbox web server with URL bar,
 * refresh button, viewport selector, and error overlay.
 */
export function WebPreview({
  sandboxUrl,
  onNavigate,
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
          <svg
            aria-hidden="true"
            fill="none"
            height="16"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            width="16"
            xmlns="http://www.w3.org/2000/svg"
          >
            <title>Refresh</title>
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
            <path d="M16 16h5v5" />
          </svg>
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
      </div>

      {/* Preview Area */}
      <div className="relative flex items-center justify-center overflow-auto bg-zinc-900 p-4">
        {/* Loading indicator */}
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-900/80">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
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
              Build Error
            </p>
            <p className="mb-3 text-xs text-zinc-400">
              The preview could not be loaded. Check the sandbox for build
              errors.
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
        {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: iframe needs load/error handlers for preview state management */}
        <iframe
          className="rounded border border-zinc-700 bg-white"
          height={dimensions.height}
          onError={handleIframeError}
          onLoad={handleIframeLoad}
          ref={iframeRef}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          src={currentUrl}
          title="Web Preview"
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
