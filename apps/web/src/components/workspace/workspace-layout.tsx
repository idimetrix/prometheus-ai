"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useUIStore } from "@/stores/ui.store";

interface WorkspaceLayoutProps {
  agentPanel?: ReactNode;
  center: ReactNode;
  fileTree?: ReactNode;
  terminal?: ReactNode;
}

interface ResizeHandleProps {
  direction: "col" | "row";
  gridArea: string;
  onMouseDown: (e: React.MouseEvent) => void;
}

function ResizeHandle({ direction, gridArea, onMouseDown }: ResizeHandleProps) {
  const isRow = direction === "row";
  return (
    <button
      aria-label={`Resize ${gridArea.replace("-resize", "")} panel`}
      className={`${isRow ? "h-1" : "w-1"} flex cursor-${isRow ? "row" : "col"}-resize items-center justify-center border-0 bg-transparent p-0 hover:bg-violet-500/30`}
      onMouseDown={onMouseDown}
      style={{ gridArea }}
      type="button"
    />
  );
}

const MIN_FILE_TREE = 260;
const MIN_AGENT_PANEL = 360;
const MIN_TERMINAL = 240;

export function WorkspaceLayout({
  fileTree,
  center,
  agentPanel,
  terminal,
}: WorkspaceLayoutProps) {
  const panelSizes = useUIStore((s) => s.panelSizes);
  const setPanelSize = useUIStore((s) => s.setPanelSize);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  const [terminalCollapsed, setTerminalCollapsed] = useState(false);
  const [agentPanelCollapsed, setAgentPanelCollapsed] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<{
    panel: "fileTree" | "agentPanel" | "terminal";
    startPos: number;
    startSize: number;
  } | null>(null);

  const toggleTerminal = useCallback(() => {
    setTerminalCollapsed((prev) => !prev);
  }, []);

  const toggleAgentPanel = useCallback(() => {
    setAgentPanelCollapsed((prev) => !prev);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;

      if (isMod && e.key === "b") {
        e.preventDefault();
        toggleSidebar();
      } else if (isMod && e.key === "j") {
        e.preventDefault();
        toggleTerminal();
      } else if (isMod && e.shiftKey && (e.key === "A" || e.key === "a")) {
        e.preventDefault();
        toggleAgentPanel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar, toggleTerminal, toggleAgentPanel]);

  // Resize handling
  const handleMouseDown = useCallback(
    (panel: "fileTree" | "agentPanel" | "terminal", e: React.MouseEvent) => {
      e.preventDefault();
      const isHorizontal = panel === "terminal";
      const startPos = isHorizontal ? e.clientY : e.clientX;
      let startSize = panelSizes.terminal;
      if (panel === "fileTree") {
        startSize = panelSizes.fileTree;
      } else if (panel === "agentPanel") {
        startSize = panelSizes.codePanel ?? MIN_AGENT_PANEL;
      }

      draggingRef.current = { panel, startPos, startSize };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!draggingRef.current) {
          return;
        }
        const {
          panel: dragPanel,
          startPos: dragStart,
          startSize: dragSize,
        } = draggingRef.current;

        if (dragPanel === "fileTree") {
          const delta = moveEvent.clientX - dragStart;
          const newSize = Math.max(MIN_FILE_TREE, dragSize + delta);
          setPanelSize("fileTree", newSize);
        } else if (dragPanel === "agentPanel") {
          const delta = dragStart - moveEvent.clientX;
          const newSize = Math.max(MIN_AGENT_PANEL, dragSize + delta);
          setPanelSize("codePanel", newSize);
        } else if (dragPanel === "terminal") {
          const delta = dragStart - moveEvent.clientY;
          const newSize = Math.max(MIN_TERMINAL, dragSize + delta);
          setPanelSize("terminal", newSize);
        }
      };

      const handleMouseUp = () => {
        draggingRef.current = null;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = isHorizontal ? "row-resize" : "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [panelSizes, setPanelSize]
  );

  const fileTreeWidth = sidebarCollapsed ? 0 : panelSizes.fileTree;
  const agentPanelWidth = agentPanelCollapsed
    ? 0
    : (panelSizes.codePanel ?? MIN_AGENT_PANEL);
  const terminalHeight = terminalCollapsed ? 0 : panelSizes.terminal;

  const gridTemplate = `${fileTreeWidth > 0 ? `${fileTreeWidth}px auto` : "0px auto"} 1fr ${agentPanelWidth > 0 ? `auto ${agentPanelWidth}px` : "auto 0px"}`;
  const gridTemplateRows =
    terminalHeight > 0 ? `1fr auto ${terminalHeight}px` : "1fr auto 0px";

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-zinc-950"
      ref={containerRef}
      style={{
        display: "grid",
        gridTemplateColumns: gridTemplate,
        gridTemplateRows,
        gridTemplateAreas: `
          "filetree filetree-resize center agentpanel-resize agentpanel"
          "terminal-resize terminal-resize terminal-resize terminal-resize terminal-resize"
          "terminal terminal terminal terminal terminal"
        `,
      }}
    >
      {/* File Tree */}
      {!sidebarCollapsed && fileTree && (
        <div
          className="overflow-hidden border-zinc-800 border-r"
          style={{ gridArea: "filetree" }}
        >
          {fileTree}
        </div>
      )}

      {/* File Tree Resize Handle */}
      {!sidebarCollapsed && (
        <ResizeHandle
          direction="col"
          gridArea="filetree-resize"
          onMouseDown={(e) => handleMouseDown("fileTree", e)}
        />
      )}

      {/* Center Content */}
      <div className="min-w-0 overflow-hidden" style={{ gridArea: "center" }}>
        {center}
      </div>

      {/* Agent Panel Resize Handle */}
      {!agentPanelCollapsed && (
        <ResizeHandle
          direction="col"
          gridArea="agentpanel-resize"
          onMouseDown={(e) => handleMouseDown("agentPanel", e)}
        />
      )}

      {/* Agent Activity Panel */}
      {!agentPanelCollapsed && agentPanel && (
        <div
          className="overflow-hidden border-zinc-800 border-l"
          style={{ gridArea: "agentpanel" }}
        >
          {agentPanel}
        </div>
      )}

      {/* Terminal Resize Handle */}
      {!terminalCollapsed && (
        <ResizeHandle
          direction="row"
          gridArea="terminal-resize"
          onMouseDown={(e) => handleMouseDown("terminal", e)}
        />
      )}

      {/* Terminal */}
      {!terminalCollapsed && terminal && (
        <div
          className="overflow-hidden border-zinc-800 border-t"
          style={{ gridArea: "terminal" }}
        >
          {terminal}
        </div>
      )}

      {/* Panel Toggle Bar */}
      <div className="pointer-events-none fixed right-4 bottom-4 z-10 flex gap-2">
        <button
          className="pointer-events-auto rounded-md border border-zinc-700 bg-zinc-800/80 px-2 py-1 text-xs text-zinc-400 backdrop-blur-sm hover:text-white"
          onClick={toggleSidebar}
          title="Toggle sidebar (Cmd+B)"
          type="button"
        >
          {sidebarCollapsed ? "Show Files" : "Hide Files"}
        </button>
        <button
          className="pointer-events-auto rounded-md border border-zinc-700 bg-zinc-800/80 px-2 py-1 text-xs text-zinc-400 backdrop-blur-sm hover:text-white"
          onClick={toggleTerminal}
          title="Toggle terminal (Cmd+J)"
          type="button"
        >
          {terminalCollapsed ? "Show Terminal" : "Hide Terminal"}
        </button>
        <button
          className="pointer-events-auto rounded-md border border-zinc-700 bg-zinc-800/80 px-2 py-1 text-xs text-zinc-400 backdrop-blur-sm hover:text-white"
          onClick={toggleAgentPanel}
          title="Toggle agent panel (Cmd+Shift+A)"
          type="button"
        >
          {agentPanelCollapsed ? "Show Agents" : "Hide Agents"}
        </button>
      </div>
    </div>
  );
}
