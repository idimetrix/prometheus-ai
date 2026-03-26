"use client";

import { Plus, X } from "lucide-react";
import { useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TerminalTab {
  id: string;
  label: string;
}

export interface TerminalTabsProps {
  /** Currently active tab ID */
  activeTabId: string;
  /** Called when the active tab changes */
  onActiveTabChange: (tabId: string) => void;
  /** Called when the close button is clicked */
  onCloseTab: (tabId: string) => void;
  /** Called when the new tab button is clicked */
  onNewTab: () => void;
  /** List of terminal tabs */
  tabs: TerminalTab[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TerminalTabs({
  tabs,
  activeTabId,
  onActiveTabChange,
  onCloseTab,
  onNewTab,
}: TerminalTabsProps) {
  const handleClose = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      e.stopPropagation();
      onCloseTab(tabId);
    },
    [onCloseTab]
  );

  return (
    <div className="flex items-center gap-0.5 overflow-x-auto border-zinc-800 border-b bg-zinc-950 px-1">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <button
            className={`group flex items-center gap-1.5 whitespace-nowrap rounded-t px-3 py-1.5 text-xs transition-colors ${
              isActive
                ? "bg-zinc-900 text-zinc-100"
                : "text-zinc-500 hover:bg-zinc-900/50 hover:text-zinc-300"
            }`}
            key={tab.id}
            onClick={() => onActiveTabChange(tab.id)}
            type="button"
          >
            <span className="font-mono">{tab.label}</span>
            {tabs.length > 1 && (
              <button
                aria-label={`Close ${tab.label}`}
                className={`rounded p-0.5 transition-colors ${
                  isActive
                    ? "text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200"
                    : "text-zinc-600 opacity-0 hover:bg-zinc-700 hover:text-zinc-200 group-hover:opacity-100"
                }`}
                onClick={(e) => handleClose(e, tab.id)}
                type="button"
              >
                <X aria-hidden="true" size={12} />
              </button>
            )}
          </button>
        );
      })}

      {/* New tab button */}
      <button
        aria-label="New terminal tab"
        className="ml-1 rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
        onClick={onNewTab}
        type="button"
      >
        <Plus aria-hidden="true" size={14} />
      </button>
    </div>
  );
}
