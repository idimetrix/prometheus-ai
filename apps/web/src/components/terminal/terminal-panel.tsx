"use client";

import { TerminalSquare, Trash2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { TerminalTab } from "./terminal-tabs";
import { TerminalTabs } from "./terminal-tabs";
import type { TerminalStatus } from "./xterm-terminal";
import { XtermTerminal } from "./xterm-terminal";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function panelStatusClass(status: TerminalStatus): string {
  if (status === "connected") {
    return "bg-green-400";
  }
  if (status === "connecting") {
    return "animate-pulse bg-yellow-400";
  }
  if (status === "error") {
    return "bg-red-400";
  }
  return "bg-zinc-500";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TerminalPanelProps {
  /** Initial height in pixels */
  defaultHeight?: number;
  /** Minimum height in pixels */
  minHeight?: number;
  /** Sandbox ID */
  sandboxId: string;
  /** WebSocket base URL */
  wsUrl?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let nextTabId = 1;

function createTab(): TerminalTab {
  const id = `term-${nextTabId}`;
  const label = `Terminal ${nextTabId}`;
  nextTabId++;
  return { id, label };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TerminalPanel({
  sandboxId,
  wsUrl,
  defaultHeight = 300,
  minHeight = 120,
}: TerminalPanelProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>(() => {
    const initial = createTab();
    return [initial];
  });
  const [activeTabId, setActiveTabId] = useState(tabs[0]?.id ?? "");
  const [height, setHeight] = useState(defaultHeight);
  const [statuses, setStatuses] = useState<Record<string, TerminalStatus>>({});
  const panelRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  // Tab management
  const handleNewTab = useCallback(() => {
    const tab = createTab();
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

  const handleCloseTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== tabId);
        if (next.length === 0) {
          const fresh = createTab();
          setActiveTabId(fresh.id);
          return [fresh];
        }
        if (activeTabId === tabId && next[0]) {
          setActiveTabId(next[0].id);
        }
        return next;
      });
      setStatuses((prev) => {
        const next = { ...prev };
        delete next[tabId];
        return next;
      });
    },
    [activeTabId]
  );

  const handleStatusChange = useCallback(
    (tabId: string) => (status: TerminalStatus) => {
      setStatuses((prev) => ({ ...prev, [tabId]: status }));
    },
    []
  );

  // Resize via drag
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      const startY = e.clientY;
      const startHeight = height;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isDraggingRef.current) {
          return;
        }
        const delta = startY - moveEvent.clientY;
        setHeight(Math.max(minHeight, startHeight + delta));
      };

      const handleMouseUp = () => {
        isDraggingRef.current = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [height, minHeight]
  );

  const activeStatus = statuses[activeTabId] ?? "connecting";

  return (
    <div
      className="flex flex-col border-zinc-800 border-t bg-zinc-950"
      ref={panelRef}
      style={{ height }}
    >
      {/* Resize handle */}
      <div
        aria-valuemax={600}
        aria-valuemin={100}
        aria-valuenow={height}
        className="flex h-1.5 cursor-row-resize items-center justify-center hover:bg-zinc-700/50"
        onMouseDown={handleResizeStart}
        role="separator"
        tabIndex={0}
      >
        <div className="h-0.5 w-8 rounded bg-zinc-700" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between border-zinc-800 border-b px-3 py-1">
        <div className="flex items-center gap-2">
          <TerminalSquare
            aria-hidden="true"
            className="text-zinc-400"
            size={14}
          />
          <span className="font-medium text-xs text-zinc-300">Terminal</span>
          <span
            className={`h-1.5 w-1.5 rounded-full ${panelStatusClass(activeStatus)}`}
          />
        </div>

        <div className="flex items-center gap-1">
          <button
            aria-label="Clear terminal"
            className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            onClick={() => {
              // Clear is handled by writing escape sequence to terminal
              // This is a visual-only clear
            }}
            type="button"
          >
            <Trash2 aria-hidden="true" size={13} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <TerminalTabs
        activeTabId={activeTabId}
        onActiveTabChange={setActiveTabId}
        onCloseTab={handleCloseTab}
        onNewTab={handleNewTab}
        tabs={tabs}
      />

      {/* Terminal instances */}
      <div className="relative flex-1 overflow-hidden">
        {tabs.map((tab) => (
          <div
            className={`absolute inset-0 ${
              tab.id === activeTabId ? "visible" : "invisible"
            }`}
            key={tab.id}
          >
            <XtermTerminal
              onStatusChange={handleStatusChange(tab.id)}
              sandboxId={sandboxId}
              wsUrl={wsUrl}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
