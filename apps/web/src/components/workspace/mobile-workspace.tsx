"use client";

import {
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
  useRef,
  useState,
} from "react";
import { useBreakpoint } from "@/hooks/use-breakpoint";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabId = "chat" | "code" | "terminal" | "preview" | "files";

interface TabConfig {
  icon: ReactNode;
  id: TabId;
  label: string;
}

interface MobileWorkspaceProps {
  chatPanel?: ReactNode;
  codePanel?: ReactNode;
  filesPanel?: ReactNode;
  onAction?: (action: string) => void;
  previewPanel?: ReactNode;
  projectDescription?: string;
  projectName?: string;
  terminalPanel?: ReactNode;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SWIPE_THRESHOLD = 50;

const TAB_ICONS: Record<TabId, ReactNode> = {
  chat: (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  code: (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        d="m17.25 6.75 4.5 4.5-4.5 4.5m-10.5 0L2.25 11.25l4.5-4.5m7.5-3-4.5 16.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  terminal: (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        d="m6.75 7.5 3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0 0 21 18V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v12a2.25 2.25 0 0 0 2.25 2.25Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  preview: (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  files: (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
};

const TABS: TabConfig[] = [
  { id: "chat", label: "Chat", icon: TAB_ICONS.chat },
  { id: "code", label: "Code", icon: TAB_ICONS.code },
  { id: "terminal", label: "Terminal", icon: TAB_ICONS.terminal },
  { id: "preview", label: "Preview", icon: TAB_ICONS.preview },
  { id: "files", label: "Files", icon: TAB_ICONS.files },
];

const FAB_ACTIONS = [
  { id: "new-task", label: "New Task" },
  { id: "new-file", label: "New File" },
  { id: "run-command", label: "Run Command" },
  { id: "ask-ai", label: "Ask AI" },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CollapsibleHeader({
  projectName,
  projectDescription,
  collapsed,
  onToggle,
}: {
  projectName: string;
  projectDescription?: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-zinc-800 border-b bg-zinc-900">
      <button
        className="flex w-full items-center justify-between px-4 py-3"
        onClick={onToggle}
        type="button"
      >
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-green-500" />
          <span className="font-semibold text-sm text-zinc-100">
            {projectName}
          </span>
        </div>
        <svg
          aria-hidden="true"
          className={`h-4 w-4 text-zinc-500 transition-transform ${
            collapsed ? "" : "rotate-180"
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            d="m19 9-7 7-7-7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {!collapsed && projectDescription && (
        <div className="px-4 pb-3">
          <p className="text-xs text-zinc-500">{projectDescription}</p>
        </div>
      )}
    </div>
  );
}

function BottomNavBar({
  activeTab,
  onTabChange,
}: {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}) {
  return (
    <nav className="safe-area-bottom flex border-zinc-800 border-t bg-zinc-900">
      {TABS.map((tab) => (
        <button
          className={`flex flex-1 flex-col items-center gap-0.5 py-2 transition-colors ${
            activeTab === tab.id
              ? "text-violet-400"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          type="button"
        >
          {tab.icon}
          <span className="text-[10px]">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}

function FloatingActionButton({
  onAction,
}: {
  onAction: (action: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="fixed right-4 bottom-20 z-50">
      {/* Action menu */}
      {isOpen && (
        <div className="mb-3 space-y-2">
          {FAB_ACTIONS.map((action) => (
            <button
              className="flex w-full items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm text-zinc-200 shadow-lg transition-colors hover:bg-zinc-700"
              key={action.id}
              onClick={() => {
                onAction(action.id);
                setIsOpen(false);
              }}
              type="button"
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      {/* FAB button */}
      <button
        className={`flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all ${
          isOpen ? "rotate-45 bg-zinc-700" : "bg-violet-600 hover:bg-violet-500"
        }`}
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <svg
          aria-hidden="true"
          className="h-6 w-6 text-white"
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
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function MobileWorkspace({
  chatPanel,
  codePanel,
  terminalPanel,
  previewPanel,
  filesPanel,
  projectName = "Project",
  projectDescription,
  onAction,
}: MobileWorkspaceProps) {
  const breakpoint = useBreakpoint();
  const [activeTab, setActiveTab] = useState<TabId>("chat");
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  // Only render on mobile/tablet
  if (breakpoint === "desktop") {
    return null;
  }

  const tabOrder = TABS.map((t) => t.id);
  const currentIndex = tabOrder.indexOf(activeTab);

  const handleTouchStart = (e: ReactTouchEvent) => {
    const touch = e.touches[0];
    if (!touch) {
      return;
    }
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchEnd = (e: ReactTouchEvent) => {
    if (!touchStartRef.current) {
      return;
    }

    const touch = e.changedTouches[0];
    if (!touch) {
      return;
    }
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;

    // Only process horizontal swipes (not vertical scrolling)
    if (
      Math.abs(deltaX) > SWIPE_THRESHOLD &&
      Math.abs(deltaX) > Math.abs(deltaY)
    ) {
      const nextTab = tabOrder[currentIndex + 1];
      const prevTab = tabOrder[currentIndex - 1];
      if (deltaX < 0 && currentIndex < tabOrder.length - 1 && nextTab) {
        // Swipe left -> next tab
        setActiveTab(nextTab);
      } else if (deltaX > 0 && currentIndex > 0 && prevTab) {
        // Swipe right -> previous tab
        setActiveTab(prevTab);
      }
    }

    touchStartRef.current = null;
  };

  const handleAction = (action: string) => {
    if (action === "new-task" || action === "ask-ai") {
      setActiveTab("chat");
    }
    onAction?.(action);
  };

  const panelContent: Record<TabId, ReactNode> = {
    chat: chatPanel ?? (
      <div className="flex h-full items-center justify-center text-sm text-zinc-600">
        Chat panel
      </div>
    ),
    code: codePanel ?? (
      <div className="flex h-full items-center justify-center text-sm text-zinc-600">
        Code editor
      </div>
    ),
    terminal: terminalPanel ?? (
      <div className="flex h-full items-center justify-center text-sm text-zinc-600">
        Terminal
      </div>
    ),
    preview: previewPanel ?? (
      <div className="flex h-full items-center justify-center text-sm text-zinc-600">
        Preview
      </div>
    ),
    files: filesPanel ?? (
      <div className="flex h-full items-center justify-center text-sm text-zinc-600">
        File explorer
      </div>
    ),
  };

  return (
    <div className="flex h-dvh flex-col bg-zinc-950">
      {/* Collapsible header */}
      {!isFullScreen && (
        <CollapsibleHeader
          collapsed={headerCollapsed}
          onToggle={() => setHeaderCollapsed(!headerCollapsed)}
          projectDescription={projectDescription}
          projectName={projectName}
        />
      )}

      {/* Full-screen toggle */}
      {(activeTab === "code" || activeTab === "terminal") && (
        <button
          className="absolute top-2 right-2 z-40 rounded bg-zinc-800/80 p-1.5 text-zinc-400 backdrop-blur-sm hover:text-zinc-200"
          onClick={() => setIsFullScreen(!isFullScreen)}
          type="button"
        >
          <svg
            aria-hidden="true"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            {isFullScreen ? (
              <path
                d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5 5.25 5.25"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : (
              <path
                d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </svg>
        </button>
      )}

      {/* Main content area with swipe */}
      <div
        className="flex-1 overflow-hidden"
        onTouchEnd={handleTouchEnd}
        onTouchStart={handleTouchStart}
      >
        {panelContent[activeTab]}
      </div>

      {/* Floating action button */}
      {!isFullScreen && <FloatingActionButton onAction={handleAction} />}

      {/* Bottom navigation */}
      {!isFullScreen && (
        <BottomNavBar activeTab={activeTab} onTabChange={setActiveTab} />
      )}
    </div>
  );
}
