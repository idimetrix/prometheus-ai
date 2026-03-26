"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface ComponentPreviewProps {
  code: string;
  sandboxBaseUrl?: string;
  theme?: "light" | "dark";
  viewport?: "desktop" | "tablet" | "mobile";
}

const VIEWPORT_WIDTHS: Record<string, number> = {
  desktop: 1280,
  tablet: 768,
  mobile: 375,
};

type PreviewState = "loading" | "ready" | "error";

export function ComponentPreview({
  code,
  sandboxBaseUrl = "/api/preview",
  theme = "light",
  viewport = "desktop",
}: ComponentPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [previewState, setPreviewState] = useState<PreviewState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [iframeHeight, setIframeHeight] = useState(400);

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
        { type: "render-component", code, theme },
        "*"
      );
    }
  }, [code, theme]);

  const width = VIEWPORT_WIDTHS[viewport] ?? VIEWPORT_WIDTHS.desktop;

  return (
    <div className="relative overflow-hidden rounded-lg border border-zinc-700">
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

      {/* Error boundary display */}
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

      {/* Preview iframe */}
      <div
        className="mx-auto transition-all duration-300"
        style={{ width: `${width}px`, maxWidth: "100%" }}
      >
        <iframe
          className={`w-full border-0 ${theme === "dark" ? "bg-zinc-950" : "bg-white"}`}
          ref={iframeRef}
          sandbox="allow-scripts allow-same-origin"
          src={sandboxBaseUrl}
          style={{ height: `${iframeHeight}px` }}
          title="Component preview"
        />
      </div>
    </div>
  );
}
