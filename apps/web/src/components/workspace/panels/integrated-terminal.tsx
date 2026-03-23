"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TerminalTab {
  id: string;
  label: string;
  workerId?: string;
}

interface IntegratedTerminalProps {
  /** Sandbox ID to connect terminal to */
  sandboxId: string;
  /** Session ID for streaming output */
  sessionId: string;
  /** Optional specific worker to show output for */
  workerId?: string;
}

// ---------------------------------------------------------------------------
// Dynamic import for XTerminal
// ---------------------------------------------------------------------------

const XTerminal = dynamic(
  () =>
    import("./terminal-panel").then((mod) => {
      // The XTerminalInner is wrapped via forwardRef in terminal-panel
      // We use the TerminalPanel's XTerminal via re-export
      return { default: mod.TerminalPanel };
    }),
  { ssr: false, loading: () => <div className="h-full bg-zinc-950" /> }
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function IntegratedTerminal({
  sessionId: _sessionId,
  sandboxId: _sandboxId,
  workerId,
}: IntegratedTerminalProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>([
    { id: "main", label: "Main" },
  ]);
  const [activeTabId, setActiveTabId] = useState("main");

  // Add worker-specific tab if workerId is provided
  useEffect(() => {
    if (workerId) {
      const tabId = `worker-${workerId}`;
      setTabs((prev) => {
        if (prev.some((t) => t.id === tabId)) {
          return prev;
        }
        return [
          ...prev,
          {
            id: tabId,
            label: `Worker ${workerId.slice(0, 6)}`,
            workerId,
          },
        ];
      });
      setActiveTabId(tabId);
    }
  }, [workerId]);

  const handleAddTab = useCallback(() => {
    const newId = `tab-${Date.now()}`;
    setTabs((prev) => [...prev, { id: newId, label: `Shell ${prev.length}` }]);
    setActiveTabId(newId);
  }, []);

  const handleCloseTab = useCallback(
    (tabId: string) => {
      if (tabs.length <= 1) {
        return;
      }
      setTabs((prev) => prev.filter((t) => t.id !== tabId));
      if (activeTabId === tabId) {
        setActiveTabId(tabs[0]?.id ?? "main");
      }
    },
    [tabs, activeTabId]
  );

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Tab bar */}
      <div className="flex items-center border-zinc-800 border-b">
        <div className="flex flex-1 overflow-x-auto">
          {tabs.map((tab) => (
            <div
              className={`group flex items-center gap-1 border-zinc-800 border-r px-3 py-1.5 ${
                activeTabId === tab.id
                  ? "border-violet-500 border-b-2 text-violet-400"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
              key={tab.id}
            >
              <button
                className="text-xs"
                onClick={() => setActiveTabId(tab.id)}
                type="button"
              >
                {tab.label}
              </button>
              {tabs.length > 1 && (
                <button
                  className="ml-1 hidden rounded p-0.5 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400 group-hover:block"
                  onClick={() => handleCloseTab(tab.id)}
                  type="button"
                >
                  <svg
                    aria-hidden="true"
                    className="h-2.5 w-2.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M6 18 18 6M6 6l12 12"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          className="px-2 py-1.5 text-zinc-600 hover:text-zinc-400"
          onClick={handleAddTab}
          title="New terminal tab"
          type="button"
        >
          <svg
            aria-hidden="true"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              d="M12 4.5v15m7.5-7.5h-15"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {/* Terminal content - uses existing TerminalPanel */}
      <div className="flex-1 overflow-hidden">
        <XTerminal />
      </div>
    </div>
  );
}
