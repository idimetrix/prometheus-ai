"use client";

import { useCallback, useEffect, useState } from "react";
import {
  LAYOUT_PRESETS,
  type LayoutPreset,
  loadLayoutFromStorage,
  saveLayoutToStorage,
} from "./layout-presets";

interface LayoutSwitcherProps {
  onLayoutChange: (preset: LayoutPreset) => void;
}

export function LayoutSwitcher({ onLayoutChange }: LayoutSwitcherProps) {
  const [activePresetId, setActivePresetId] = useState("development");
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const saved = loadLayoutFromStorage();
    if (saved) {
      const preset = LAYOUT_PRESETS.find((p) => p.id === saved);
      if (preset) {
        setActivePresetId(saved);
        onLayoutChange(preset);
      }
    }
  }, [onLayoutChange]);

  const handleSelect = useCallback(
    (preset: LayoutPreset) => {
      setActivePresetId(preset.id);
      saveLayoutToStorage(preset.id);
      onLayoutChange(preset);
      setIsOpen(false);
    },
    [onLayoutChange]
  );

  const activePreset = LAYOUT_PRESETS.find((p) => p.id === activePresetId);

  return (
    <div className="relative">
      <button
        className="flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-800/80 px-3 py-1.5 text-xs text-zinc-300 backdrop-blur-sm transition-colors hover:border-zinc-600 hover:text-white"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <svg
          aria-hidden="true"
          className="h-3.5 w-3.5"
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
        <span>{activePreset?.name ?? "Layout"}</span>
        <svg
          aria-hidden="true"
          className={`h-3 w-3 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            d="m19.5 8.25-7.5 7.5-7.5-7.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setIsOpen(false);
              }
            }}
            role="presentation"
          />
          <div className="absolute right-0 z-50 mt-1 w-64 rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-xl">
            {LAYOUT_PRESETS.map((preset) => (
              <button
                className={`flex w-full flex-col rounded-md px-3 py-2 text-left transition-colors ${
                  activePresetId === preset.id
                    ? "bg-violet-500/10 text-violet-300"
                    : "text-zinc-300 hover:bg-zinc-800"
                }`}
                key={preset.id}
                onClick={() => handleSelect(preset)}
                type="button"
              >
                <span className="font-medium text-sm">{preset.name}</span>
                <span className="mt-0.5 text-[10px] text-zinc-500">
                  {preset.description}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
