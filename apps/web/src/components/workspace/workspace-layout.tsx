"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { LAYOUT_PRESETS, type LayoutPreset } from "./layout-presets";
import { LayoutSwitcher } from "./layout-switcher";

interface WorkspaceLayoutProps {
  agentPanel?: ReactNode;
  center: ReactNode;
  fileTree?: ReactNode;
  terminal?: ReactNode;
}

function ResizeHandle({ direction }: { direction: "horizontal" | "vertical" }) {
  const isVertical = direction === "vertical";
  return (
    <Separator
      className={`group relative flex items-center justify-center ${
        isVertical ? "h-1 cursor-row-resize" : "w-1 cursor-col-resize"
      }`}
    >
      <div
        className={`rounded-full bg-zinc-700 transition-all group-hover:bg-violet-500 group-data-[resize-handle-active]:bg-violet-500 ${
          isVertical
            ? "h-0.5 w-8 group-hover:h-1 group-data-[resize-handle-active]:h-1"
            : "h-8 w-0.5 group-hover:w-1 group-data-[resize-handle-active]:w-1"
        }`}
      />
    </Separator>
  );
}

interface PanelHeaderProps {
  collapsed: boolean;
  onToggle: () => void;
  title: string;
}

function PanelHeader({ title, collapsed, onToggle }: PanelHeaderProps) {
  return (
    <div className="flex items-center justify-between border-zinc-800 border-b bg-zinc-900/80 px-3 py-1.5">
      <span className="font-medium text-xs text-zinc-400 uppercase tracking-wider">
        {title}
      </span>
      <button
        className="rounded p-0.5 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
        onClick={onToggle}
        title={collapsed ? `Show ${title}` : `Hide ${title}`}
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
          {collapsed ? (
            <path
              d="M12 4.5v15m7.5-7.5h-15"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : (
            <path
              d="M19.5 12h-15"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>
      </button>
    </div>
  );
}

export function WorkspaceLayout({
  fileTree,
  center,
  agentPanel,
  terminal,
}: WorkspaceLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [terminalCollapsed, setTerminalCollapsed] = useState(false);
  const [agentPanelCollapsed, setAgentPanelCollapsed] = useState(false);
  const [_activePreset, setActivePreset] = useState<LayoutPreset>(
    LAYOUT_PRESETS[0] as LayoutPreset
  );
  const [isSmallScreen, setIsSmallScreen] = useState(false);
  const [mobileActiveTab, setMobileActiveTab] = useState<
    "editor" | "files" | "agent" | "terminal"
  >("editor");

  useEffect(() => {
    const checkSize = () => {
      const small = window.innerWidth < 768;
      setIsSmallScreen(small);
      if (small) {
        setAgentPanelCollapsed(true);
        setTerminalCollapsed(true);
      }
    };
    checkSize();
    window.addEventListener("resize", checkSize);
    return () => window.removeEventListener("resize", checkSize);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key === "b") {
        e.preventDefault();
        setSidebarCollapsed((prev) => !prev);
      } else if (isMod && e.key === "j") {
        e.preventDefault();
        setTerminalCollapsed((prev) => !prev);
      } else if (isMod && e.shiftKey && (e.key === "A" || e.key === "a")) {
        e.preventDefault();
        setAgentPanelCollapsed((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleLayoutChange = useCallback((preset: LayoutPreset) => {
    setActivePreset(preset);
  }, []);

  if (isSmallScreen) {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden bg-zinc-950">
        <div className="flex-1 overflow-hidden">
          {mobileActiveTab === "files" && fileTree && (
            <div className="h-full overflow-auto">{fileTree}</div>
          )}
          {mobileActiveTab === "editor" && (
            <div className="h-full overflow-hidden">{center}</div>
          )}
          {mobileActiveTab === "agent" && agentPanel && (
            <div className="h-full overflow-auto">{agentPanel}</div>
          )}
          {mobileActiveTab === "terminal" && terminal && (
            <div className="h-full overflow-auto">{terminal}</div>
          )}
        </div>
        <div className="flex border-zinc-700 border-t bg-zinc-900">
          {(
            [
              { key: "files", label: "Files" },
              { key: "editor", label: "Editor" },
              { key: "agent", label: "Agent" },
              { key: "terminal", label: "Terminal" },
            ] as const
          ).map((tab) => (
            <button
              className={[
                "flex-1 py-3 text-center text-xs transition-colors",
                mobileActiveTab === tab.key
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-500",
              ].join(" ")}
              key={tab.key}
              onClick={() => setMobileActiveTab(tab.key)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-zinc-950">
      {/* Layout switcher bar */}
      <div className="flex items-center justify-end border-zinc-800 border-b px-2 py-1">
        <LayoutSwitcher onLayoutChange={handleLayoutChange} />
      </div>

      {/* Main resizable layout */}
      <Group className="flex-1" id="workspace-main" orientation="vertical">
        {/* Top: horizontal panels */}
        <Panel
          defaultSize={terminalCollapsed ? 100 : 70}
          id="top-area"
          minSize={30}
        >
          <Group id="workspace-horizontal" orientation="horizontal">
            {/* File Tree / Left panel */}
            {!sidebarCollapsed && fileTree && (
              <>
                <Panel collapsible defaultSize={20} id="file-tree" minSize={10}>
                  <div className="flex h-full flex-col overflow-hidden border-zinc-800 border-r">
                    <PanelHeader
                      collapsed={sidebarCollapsed}
                      onToggle={() => setSidebarCollapsed(true)}
                      title="Files"
                    />
                    <div className="flex-1 overflow-hidden">{fileTree}</div>
                  </div>
                </Panel>
                <ResizeHandle direction="horizontal" />
              </>
            )}

            {/* Center panel */}
            <Panel defaultSize={50} id="center" minSize={25}>
              <div className="flex h-full min-w-0 flex-col overflow-hidden">
                <PanelHeader
                  collapsed={false}
                  onToggle={() => setSidebarCollapsed((p) => !p)}
                  title="Editor"
                />
                <div className="flex-1 overflow-hidden">{center}</div>
              </div>
            </Panel>

            {/* Agent / Right panel */}
            {!agentPanelCollapsed && agentPanel && (
              <>
                <ResizeHandle direction="horizontal" />
                <Panel
                  collapsible
                  defaultSize={30}
                  id="agent-panel"
                  minSize={15}
                >
                  <div className="flex h-full flex-col overflow-hidden border-zinc-800 border-l">
                    <PanelHeader
                      collapsed={agentPanelCollapsed}
                      onToggle={() => setAgentPanelCollapsed(true)}
                      title="Agent"
                    />
                    <div className="flex-1 overflow-hidden">{agentPanel}</div>
                  </div>
                </Panel>
              </>
            )}
          </Group>
        </Panel>

        {/* Terminal / Bottom panel */}
        {!terminalCollapsed && terminal && (
          <>
            <ResizeHandle direction="vertical" />
            <Panel collapsible defaultSize={30} id="terminal" minSize={10}>
              <div className="flex h-full flex-col overflow-hidden border-zinc-800 border-t">
                <PanelHeader
                  collapsed={terminalCollapsed}
                  onToggle={() => setTerminalCollapsed(true)}
                  title="Terminal"
                />
                <div className="flex-1 overflow-hidden">{terminal}</div>
              </div>
            </Panel>
          </>
        )}
      </Group>

      {/* Panel Toggle Bar */}
      <div className="pointer-events-none fixed right-4 bottom-4 z-10 flex gap-2">
        <button
          className="pointer-events-auto rounded-md border border-zinc-700 bg-zinc-800/80 px-2 py-1 text-xs text-zinc-400 backdrop-blur-sm hover:text-white"
          onClick={() => setSidebarCollapsed((p) => !p)}
          title="Toggle sidebar (Cmd+B)"
          type="button"
        >
          {sidebarCollapsed ? "Show Files" : "Hide Files"}
        </button>
        <button
          className="pointer-events-auto rounded-md border border-zinc-700 bg-zinc-800/80 px-2 py-1 text-xs text-zinc-400 backdrop-blur-sm hover:text-white"
          onClick={() => setTerminalCollapsed((p) => !p)}
          title="Toggle terminal (Cmd+J)"
          type="button"
        >
          {terminalCollapsed ? "Show Terminal" : "Hide Terminal"}
        </button>
        <button
          className="pointer-events-auto rounded-md border border-zinc-700 bg-zinc-800/80 px-2 py-1 text-xs text-zinc-400 backdrop-blur-sm hover:text-white"
          onClick={() => setAgentPanelCollapsed((p) => !p)}
          title="Toggle agent panel (Cmd+Shift+A)"
          type="button"
        >
          {agentPanelCollapsed ? "Show Agents" : "Hide Agents"}
        </button>
      </div>
    </div>
  );
}
