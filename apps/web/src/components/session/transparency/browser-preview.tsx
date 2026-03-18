"use client";

import Image from "next/image";
import { useCallback, useState } from "react";
import { useSessionStore } from "@/stores/session.store";

interface BrowserPreviewProps {
  sessionId: string;
}

export function BrowserPreview({ sessionId: _sessionId }: BrowserPreviewProps) {
  const { events } = useSessionStore();
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);

  const screenshots = events
    .filter((e) => e.type === "browser_screenshot")
    .map((e) => ({
      id: e.id,
      url: String(e.data.url ?? ""),
      screenshotUrl: String(e.data.screenshotUrl ?? ""),
      timestamp: e.timestamp,
    }));

  const selected =
    selectedIdx === null ? screenshots.at(-1) : screenshots[selectedIdx];

  const handleZoomIn = useCallback(
    () => setZoom((z) => Math.min(z + 0.25, 3)),
    []
  );
  const handleZoomOut = useCallback(
    () => setZoom((z) => Math.max(z - 0.25, 0.25)),
    []
  );
  const handleZoomReset = useCallback(() => setZoom(1), []);

  if (screenshots.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        No browser screenshots yet
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-zinc-800 border-b px-3 py-2">
        <h3 className="font-medium text-sm text-zinc-300">Browser Preview</h3>
        <div className="flex items-center gap-2">
          <button
            className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
            onClick={handleZoomOut}
            type="button"
          >
            −
          </button>
          <span className="text-xs text-zinc-500">
            {Math.round(zoom * 100)}%
          </span>
          <button
            className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
            onClick={handleZoomIn}
            type="button"
          >
            +
          </button>
          <button
            className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
            onClick={handleZoomReset}
            type="button"
          >
            Reset
          </button>
        </div>
      </div>

      {selected && (
        <div className="flex-1 overflow-auto p-2">
          <div className="mb-2 truncate text-xs text-zinc-500">
            {selected.url}
          </div>
          <div
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: "top left",
            }}
          >
            <Image
              alt={`Screenshot of ${selected.url}`}
              className="rounded border border-zinc-700"
              height={600}
              src={selected.screenshotUrl}
              unoptimized
              width={800}
            />
          </div>
        </div>
      )}

      {screenshots.length > 1 && (
        <div className="flex gap-1 overflow-x-auto border-zinc-800 border-t p-2">
          {screenshots.map((s, i) => (
            <button
              className={`shrink-0 rounded border p-1 ${
                selectedIdx === i ||
                (selectedIdx === null && i === screenshots.length - 1)
                  ? "border-indigo-500 bg-indigo-500/10"
                  : "border-zinc-700 hover:border-zinc-600"
              }`}
              key={s.id}
              onClick={() => setSelectedIdx(i)}
              type="button"
            >
              <Image
                alt=""
                className="h-12 w-20 rounded object-cover"
                height={48}
                src={s.screenshotUrl}
                unoptimized
                width={80}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
