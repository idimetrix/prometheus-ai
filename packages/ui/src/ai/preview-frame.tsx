"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type DevicePreset = "desktop" | "tablet" | "mobile" | "responsive";

interface DeviceConfig {
  height: number;
  label: string;
  width: number;
}

const DEVICE_PRESETS: Record<
  Exclude<DevicePreset, "responsive">,
  DeviceConfig
> = {
  desktop: { width: 1280, height: 800, label: "Desktop" },
  tablet: { width: 768, height: 1024, label: "Tablet" },
  mobile: { width: 375, height: 667, label: "Mobile" },
};

interface PreviewFrameProps {
  /** Device preset or responsive mode */
  device?: DevicePreset;
  /** Callback on iframe error */
  onError?: (error: string) => void;
  /** Callback when the iframe loads */
  onLoad?: () => void;
  /** Whether to show the device selector toolbar */
  showToolbar?: boolean;
  /** The URL to load in the preview iframe */
  url: string;
}

export function PreviewFrame({
  url,
  device: initialDevice = "responsive",
  showToolbar = true,
  onLoad,
  onError,
}: PreviewFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [device, setDevice] = useState<DevicePreset>(initialDevice);
  const [isLoading, setIsLoading] = useState(true);
  const [currentUrl, setCurrentUrl] = useState(url);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCurrentUrl(url);
    setIsLoading(true);
    setError(null);
  }, [url]);

  const handleLoad = useCallback(() => {
    setIsLoading(false);
    onLoad?.();
  }, [onLoad]);

  const handleError = useCallback(() => {
    setIsLoading(false);
    const msg = "Failed to load preview";
    setError(msg);
    onError?.(msg);
  }, [onError]);

  const refresh = useCallback(() => {
    if (iframeRef.current) {
      setIsLoading(true);
      setError(null);
      iframeRef.current.src = currentUrl;
    }
  }, [currentUrl]);

  const deviceConfig = device === "responsive" ? null : DEVICE_PRESETS[device];

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
      {/* Toolbar */}
      {showToolbar && (
        <div className="flex items-center gap-2 border-zinc-800 border-b bg-zinc-900 px-3 py-1.5">
          {/* URL bar */}
          <div className="flex min-w-0 flex-1 items-center gap-1 rounded bg-zinc-800 px-2 py-1">
            <span className="text-[10px] text-zinc-500">
              {(() => {
                if (isLoading) {
                  return "...";
                }
                if (error) {
                  return "!";
                }
                return "\u2713";
              })()}
            </span>
            <span className="truncate text-xs text-zinc-400">{currentUrl}</span>
          </div>

          {/* Refresh */}
          <button
            className="rounded p-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            onClick={refresh}
            title="Refresh"
            type="button"
          >
            \u21BB
          </button>

          {/* Device selector */}
          <div className="flex gap-0.5 rounded bg-zinc-800 p-0.5">
            {(
              ["responsive", "desktop", "tablet", "mobile"] as DevicePreset[]
            ).map((d) => (
              <button
                className={`rounded px-2 py-0.5 text-[10px] capitalize ${
                  device === d
                    ? "bg-violet-600 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
                key={d}
                onClick={() => setDevice(d)}
                type="button"
              >
                {d === "responsive" ? "Auto" : d}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Preview area */}
      <div className="relative flex flex-1 items-center justify-center overflow-auto bg-zinc-950 p-2">
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950/80">
            <div className="text-sm text-zinc-400">Loading preview...</div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-zinc-950/80">
            <div className="mb-2 text-red-400 text-sm">{error}</div>
            <button
              className="rounded bg-zinc-800 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
              onClick={refresh}
              type="button"
            >
              Retry
            </button>
          </div>
        )}

        <iframe
          className="rounded border border-zinc-800 bg-white"
          onError={handleError}
          onLoad={handleLoad}
          ref={iframeRef}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          src={currentUrl}
          style={{
            width: deviceConfig ? `${deviceConfig.width}px` : "100%",
            height: deviceConfig ? `${deviceConfig.height}px` : "100%",
            maxWidth: "100%",
            maxHeight: "100%",
          }}
          title="Preview"
        />
      </div>

      {/* Status bar */}
      {deviceConfig && (
        <div className="border-zinc-800 border-t bg-zinc-900 px-3 py-1 text-center text-[10px] text-zinc-500">
          {deviceConfig.label}: {deviceConfig.width} x {deviceConfig.height}
        </div>
      )}
    </div>
  );
}
