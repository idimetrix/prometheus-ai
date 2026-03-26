"use client";

import { useCallback, useEffect, useRef } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface EditorTab {
  isModified?: boolean;
  name: string;
  path: string;
}

interface EditorTabsProps {
  activeTab?: string;
  className?: string;
  onCloseTab: (path: string) => void;
  onSelectTab: (path: string) => void;
  tabs: EditorTab[];
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function EditorTabs({
  tabs,
  activeTab,
  onSelectTab,
  onCloseTab,
  className = "",
}: EditorTabsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Ctrl+W to close current tab
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "w" && activeTab) {
        e.preventDefault();
        onCloseTab(activeTab);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTab, onCloseTab]);

  const handleMiddleClick = useCallback(
    (e: React.MouseEvent, path: string) => {
      // Middle mouse button
      if (e.button === 1) {
        e.preventDefault();
        onCloseTab(path);
      }
    },
    [onCloseTab]
  );

  const handleCloseClick = useCallback(
    (e: React.MouseEvent, path: string) => {
      e.stopPropagation();
      onCloseTab(path);
    },
    [onCloseTab]
  );

  if (tabs.length === 0) {
    return null;
  }

  return (
    <div
      className={`flex items-center overflow-x-auto border-zinc-800 border-b bg-zinc-900/30 ${className}`}
      ref={scrollRef}
    >
      {tabs.map((tab) => {
        const isActive = tab.path === activeTab;
        return (
          <button
            className={`group flex shrink-0 items-center gap-1.5 border-zinc-800 border-r px-3 py-1.5 text-xs transition-colors ${
              isActive
                ? "border-b-2 border-b-violet-500 bg-zinc-900 text-zinc-200"
                : "text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300"
            }`}
            key={tab.path}
            onAuxClick={(e) => handleMiddleClick(e, tab.path)}
            onClick={() => onSelectTab(tab.path)}
            type="button"
          >
            {/* Modified dot */}
            {tab.isModified && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-yellow-400" />
            )}

            {/* Tab name */}
            <span className="max-w-[120px] truncate">{tab.name}</span>

            {/* Close button */}
            <span
              className={`ml-1 shrink-0 rounded p-0.5 hover:bg-zinc-700 ${
                isActive
                  ? "text-zinc-400 hover:text-zinc-200"
                  : "text-zinc-600 opacity-0 group-hover:opacity-100"
              }`}
              onClick={(e) => handleCloseClick(e, tab.path)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  onCloseTab(tab.path);
                }
              }}
              role="button"
              tabIndex={-1}
            >
              <svg
                aria-hidden="true"
                className="h-3 w-3"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  d="M6 18L18 6M6 6l12 12"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </button>
        );
      })}
    </div>
  );
}
