"use client";

import { useState } from "react";

type Viewport = "desktop" | "tablet" | "mobile";
type Theme = "light" | "dark" | "system";
type ZoomLevel = 50 | 75 | 100 | 150;

interface DesignToolbarProps {
  onBackgroundColorChange?: (color: string) => void;
  onGridToggle?: (enabled: boolean) => void;
  onRulerToggle?: (enabled: boolean) => void;
  onThemeChange?: (theme: Theme) => void;
  onViewportChange?: (viewport: Viewport) => void;
  onZoomChange?: (zoom: ZoomLevel) => void;
}

const VIEWPORT_SIZES: Record<Viewport, string> = {
  desktop: "1280px",
  tablet: "768px",
  mobile: "375px",
};

const ZOOM_LEVELS: ZoomLevel[] = [50, 75, 100, 150];

const BACKGROUND_COLORS = [
  { label: "White", value: "#ffffff" },
  { label: "Light Gray", value: "#f4f4f5" },
  { label: "Dark", value: "#18181b" },
  { label: "Black", value: "#000000" },
  { label: "Blue", value: "#eff6ff" },
  { label: "Green", value: "#f0fdf4" },
];

export function DesignToolbar({
  onBackgroundColorChange,
  onGridToggle,
  onRulerToggle,
  onThemeChange,
  onViewportChange,
  onZoomChange,
}: DesignToolbarProps) {
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [theme, setTheme] = useState<Theme>("light");
  const [zoom, setZoom] = useState<ZoomLevel>(100);
  const [gridEnabled, setGridEnabled] = useState(false);
  const [rulerEnabled, setRulerEnabled] = useState(false);
  const [showBgPicker, setShowBgPicker] = useState(false);

  function handleViewportChange(vp: Viewport) {
    setViewport(vp);
    onViewportChange?.(vp);
  }

  function handleThemeChange(t: Theme) {
    setTheme(t);
    onThemeChange?.(t);
  }

  function handleZoomChange(z: ZoomLevel) {
    setZoom(z);
    onZoomChange?.(z);
  }

  function handleGridToggle() {
    const next = !gridEnabled;
    setGridEnabled(next);
    onGridToggle?.(next);
  }

  function handleRulerToggle() {
    const next = !rulerEnabled;
    setRulerEnabled(next);
    onRulerToggle?.(next);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
      {/* Viewport selector */}
      <div className="flex items-center gap-1 rounded-lg bg-zinc-800 p-0.5">
        {(["desktop", "tablet", "mobile"] as const).map((vp) => (
          <button
            aria-label={`${vp} viewport (${VIEWPORT_SIZES[vp]})`}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
              viewport === vp
                ? "bg-zinc-700 text-zinc-200"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            key={vp}
            onClick={() => handleViewportChange(vp)}
            type="button"
          >
            {vp === "desktop" && (
              <svg
                aria-hidden="true"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                viewBox="0 0 24 24"
              >
                <path
                  d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25A2.25 2.25 0 0 1 5.25 3h13.5A2.25 2.25 0 0 1 21 5.25Z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            {vp === "tablet" && (
              <svg
                aria-hidden="true"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                viewBox="0 0 24 24"
              >
                <path
                  d="M10.5 19.5h3m-6.75 2.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-15a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 4.5v15a2.25 2.25 0 0 0 2.25 2.25Z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            {vp === "mobile" && (
              <svg
                aria-hidden="true"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                viewBox="0 0 24 24"
              >
                <path
                  d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            <span className="hidden sm:inline">{VIEWPORT_SIZES[vp]}</span>
          </button>
        ))}
      </div>

      {/* Divider */}
      <div className="h-5 w-px bg-zinc-800" />

      {/* Theme toggle */}
      <div className="flex items-center gap-1 rounded-lg bg-zinc-800 p-0.5">
        {(["light", "dark", "system"] as const).map((t) => (
          <button
            aria-label={`${t} theme`}
            className={`rounded-md px-2 py-1 text-xs transition-colors ${
              theme === t
                ? "bg-zinc-700 text-zinc-200"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            key={t}
            onClick={() => handleThemeChange(t)}
            type="button"
          >
            {t === "light" && "Light"}
            {t === "dark" && "Dark"}
            {t === "system" && "System"}
          </button>
        ))}
      </div>

      {/* Divider */}
      <div className="h-5 w-px bg-zinc-800" />

      {/* Zoom controls */}
      <div className="flex items-center gap-1 rounded-lg bg-zinc-800 p-0.5">
        {ZOOM_LEVELS.map((z) => (
          <button
            aria-label={`Zoom ${z}%`}
            className={`rounded-md px-2 py-1 text-xs transition-colors ${
              zoom === z
                ? "bg-zinc-700 text-zinc-200"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            key={z}
            onClick={() => handleZoomChange(z)}
            type="button"
          >
            {z}%
          </button>
        ))}
      </div>

      {/* Divider */}
      <div className="h-5 w-px bg-zinc-800" />

      {/* Grid toggle */}
      <button
        aria-label="Toggle grid overlay"
        aria-pressed={gridEnabled}
        className={`rounded-lg p-1.5 transition-colors ${
          gridEnabled
            ? "bg-pink-500/20 text-pink-400"
            : "text-zinc-500 hover:text-zinc-300"
        }`}
        onClick={handleGridToggle}
        type="button"
      >
        <svg
          aria-hidden="true"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* Ruler toggle */}
      <button
        aria-label="Toggle rulers"
        aria-pressed={rulerEnabled}
        className={`rounded-lg p-1.5 transition-colors ${
          rulerEnabled
            ? "bg-pink-500/20 text-pink-400"
            : "text-zinc-500 hover:text-zinc-300"
        }`}
        onClick={handleRulerToggle}
        type="button"
      >
        <svg
          aria-hidden="true"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 0 1-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-1.5A1.125 1.125 0 0 1 18 18.375M20.625 4.5H3.375m17.25 0c.621 0 1.125.504 1.125 1.125M20.625 4.5h-1.5C18.504 4.5 18 5.004 18 5.625m3.75 0v1.5c0 .621-.504 1.125-1.125 1.125M3.375 4.5c-.621 0-1.125.504-1.125 1.125M3.375 4.5h1.5C5.496 4.5 6 5.004 6 5.625m-3.75 0v1.5c0 .621.504 1.125 1.125 1.125m0 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 8.25 6 7.746 6 7.125v-1.5M4.875 8.25C5.496 8.25 6 8.754 6 9.375v1.5c0 .621-.504 1.125-1.125 1.125m0 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 12 6 11.496 6 10.875v-1.5m-1.125 3.75h1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* Background color picker */}
      <div className="relative">
        <button
          aria-label="Choose background color"
          className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:text-zinc-300"
          onClick={() => setShowBgPicker(!showBgPicker)}
          type="button"
        >
          <svg
            aria-hidden="true"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              d="M4.098 19.902a3.75 3.75 0 0 0 5.304 0l6.401-6.402M6.75 21A3.75 3.75 0 0 1 3 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 0 0 3.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008Z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {showBgPicker && (
          <div className="absolute top-full right-0 z-20 mt-1 rounded-lg border border-zinc-700 bg-zinc-800 p-2 shadow-xl">
            <div className="grid grid-cols-3 gap-1.5">
              {BACKGROUND_COLORS.map((color) => (
                <button
                  aria-label={`Background: ${color.label}`}
                  className="flex flex-col items-center gap-1 rounded p-1 transition-colors hover:bg-zinc-700"
                  key={color.value}
                  onClick={() => {
                    onBackgroundColorChange?.(color.value);
                    setShowBgPicker(false);
                  }}
                  type="button"
                >
                  <div
                    className="h-6 w-6 rounded border border-zinc-600"
                    style={{ backgroundColor: color.value }}
                  />
                  <span className="text-[9px] text-zinc-500">
                    {color.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
