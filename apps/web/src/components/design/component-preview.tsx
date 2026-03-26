"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Viewport = "desktop" | "tablet" | "mobile";
type ZoomLevel = 50 | 75 | 100 | 125 | 150;
type PreviewState = "loading" | "ready" | "error";

interface ComponentPreviewProps {
  code: string;
  sandboxBaseUrl?: string;
  theme?: "light" | "dark";
  viewport?: Viewport;
}

const VIEWPORT_WIDTHS: Record<Viewport, number> = {
  desktop: 1280,
  tablet: 768,
  mobile: 375,
};

const VIEWPORT_LABELS: Record<Viewport, string> = {
  desktop: "Desktop",
  tablet: "Tablet",
  mobile: "Mobile",
};

const ZOOM_LEVELS: ZoomLevel[] = [50, 75, 100, 125, 150];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ComponentPreview({
  code,
  sandboxBaseUrl = "/api/preview",
  theme: initialTheme = "light",
  viewport: initialViewport = "desktop",
}: ComponentPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [previewState, setPreviewState] = useState<PreviewState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [iframeHeight, setIframeHeight] = useState(400);
  const [currentViewport, setCurrentViewport] =
    useState<Viewport>(initialViewport);
  const [currentTheme, setCurrentTheme] = useState<"light" | "dark">(
    initialTheme
  );
  const [zoom, setZoom] = useState<ZoomLevel>(100);
  const [showGrid, setShowGrid] = useState(false);

  // Listen for messages from the preview iframe
  const handleMessage = useCallback((event: MessageEvent) => {
    if (event.data?.type === "preview-ready") {
      setPreviewState("ready");
    } else if (event.data?.type === "preview-error") {
      setPreviewState("error");
      setErrorMessage(String(event.data.message ?? "Component render error"));
    } else if (event.data?.type === "preview-height") {
      const height = Number(event.data.height);
      if (height > 0) {
        setIframeHeight(Math.min(height + 32, 800));
      }
    }
  }, []);

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  // Send code to iframe when it changes
  useEffect(() => {
    if (iframeRef.current?.contentWindow && code) {
      setPreviewState("loading");
      setErrorMessage(null);
      iframeRef.current.contentWindow.postMessage(
        { type: "render-component", code, theme: currentTheme },
        "*"
      );
    }
  }, [code, currentTheme]);

  const width = VIEWPORT_WIDTHS[currentViewport];
  const scaleFactor = zoom / 100;

  return (
    <div className="flex flex-col rounded-lg border border-zinc-700">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-zinc-700 border-b px-3 py-2">
        {/* Viewport switcher */}
        <div className="flex items-center gap-1 rounded-md border border-zinc-700 p-0.5">
          {(Object.keys(VIEWPORT_WIDTHS) as Viewport[]).map((vp) => (
            <button
              aria-label={`Switch to ${VIEWPORT_LABELS[vp]} viewport`}
              className={`rounded px-2.5 py-1 text-xs transition-colors ${
                currentViewport === vp
                  ? "bg-pink-500 text-white"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
              key={vp}
              onClick={() => setCurrentViewport(vp)}
              type="button"
            >
              {VIEWPORT_LABELS[vp]}
            </button>
          ))}
        </div>

        <span className="text-xs text-zinc-600">
          {VIEWPORT_WIDTHS[currentViewport]}px
        </span>

        {/* Separator */}
        <div className="mx-1 h-4 w-px bg-zinc-700" />

        {/* Zoom controls */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-zinc-500">Zoom:</span>
          <select
            aria-label="Zoom level"
            className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300 outline-none focus:border-pink-500"
            onChange={(e) => setZoom(Number(e.target.value) as ZoomLevel)}
            value={zoom}
          >
            {ZOOM_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}%
              </option>
            ))}
          </select>
        </div>

        {/* Separator */}
        <div className="mx-1 h-4 w-px bg-zinc-700" />

        {/* Grid overlay toggle */}
        <button
          aria-label="Toggle grid overlay"
          aria-pressed={showGrid}
          className={`rounded px-2 py-1 text-xs transition-colors ${
            showGrid
              ? "bg-zinc-700 text-pink-400"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
          onClick={() => setShowGrid((prev) => !prev)}
          type="button"
        >
          Grid
        </button>

        {/* Theme toggle */}
        <button
          aria-label={`Switch to ${currentTheme === "light" ? "dark" : "light"} theme`}
          className="ml-auto rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 transition-colors hover:text-zinc-200"
          onClick={() =>
            setCurrentTheme((prev) => (prev === "light" ? "dark" : "light"))
          }
          type="button"
        >
          {currentTheme === "light" ? "Light" : "Dark"}
        </button>
      </div>

      {/* Preview area */}
      <div className="relative overflow-auto">
        {/* Loading spinner */}
        {previewState === "loading" && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-900/80">
            <div className="flex flex-col items-center gap-2">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-pink-500 border-t-transparent" />
              <span className="text-xs text-zinc-400">
                Compiling component...
              </span>
            </div>
          </div>
        )}

        {/* Error display */}
        {previewState === "error" && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-900/90 p-4">
            <div className="max-w-md rounded-lg border border-red-500/30 bg-red-500/10 p-4">
              <div className="flex items-center gap-2">
                <svg
                  aria-hidden="true"
                  className="h-5 w-5 shrink-0 text-red-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="font-medium text-red-400 text-sm">
                  Render Error
                </span>
              </div>
              <pre className="mt-2 overflow-auto text-red-300/80 text-xs">
                {errorMessage}
              </pre>
            </div>
          </div>
        )}

        {/* Grid overlay */}
        {showGrid && (
          <div
            className="pointer-events-none absolute inset-0 z-20"
            style={{
              backgroundImage: `
                linear-gradient(to right, rgba(236, 72, 153, 0.08) 1px, transparent 1px),
                linear-gradient(to bottom, rgba(236, 72, 153, 0.08) 1px, transparent 1px)
              `,
              backgroundSize: "8px 8px",
            }}
          />
        )}

        {/* Preview iframe with zoom and viewport */}
        <div
          className="mx-auto transition-all duration-300 ease-in-out"
          style={{
            width: `${width}px`,
            maxWidth: "100%",
            transform: `scale(${scaleFactor})`,
            transformOrigin: "top center",
          }}
        >
          <iframe
            className={`w-full border-0 transition-colors duration-300 ${
              currentTheme === "dark" ? "bg-zinc-950" : "bg-white"
            }`}
            ref={iframeRef}
            sandbox="allow-scripts allow-same-origin"
            src={sandboxBaseUrl}
            style={{ height: `${iframeHeight}px` }}
            title="Component preview"
          />
        </div>
      </div>
    </div>
  );
}
