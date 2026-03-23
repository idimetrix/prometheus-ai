"use client";

import { type ReactNode, useState } from "react";

interface PanelLayoutProps {
  main: ReactNode;
  rightPanel?: ReactNode;
  rightPanelWidth?: number;
  sidebar: ReactNode;
  sidebarWidth?: number;
}

export function PanelLayout({
  sidebar,
  main,
  rightPanel,
  sidebarWidth = 280,
  rightPanelWidth = 360,
}: PanelLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(!rightPanel);

  return (
    <div className="flex h-full">
      {/* Left Sidebar */}
      <div
        className="shrink-0 border-zinc-800 border-r transition-all"
        style={{ width: sidebarCollapsed ? 48 : sidebarWidth }}
      >
        <button
          className="flex w-full items-center justify-center border-zinc-800 border-b py-2 text-xs text-zinc-400 hover:text-white"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          type="button"
        >
          {sidebarCollapsed ? ">" : "<"}
        </button>
        {!sidebarCollapsed && <div className="overflow-y-auto">{sidebar}</div>}
      </div>

      {/* Main Canvas */}
      <div className="min-w-0 flex-1 overflow-hidden">{main}</div>

      {/* Right Panel */}
      {rightPanel && (
        <div
          className="shrink-0 border-zinc-800 border-l transition-all"
          style={{ width: rightCollapsed ? 48 : rightPanelWidth }}
        >
          <button
            className="flex w-full items-center justify-center border-zinc-800 border-b py-2 text-xs text-zinc-400 hover:text-white"
            onClick={() => setRightCollapsed(!rightCollapsed)}
            type="button"
          >
            {rightCollapsed ? "<" : ">"}
          </button>
          {!rightCollapsed && (
            <div className="h-full overflow-y-auto">{rightPanel}</div>
          )}
        </div>
      )}
    </div>
  );
}
