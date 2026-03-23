"use client";

import {
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useBreakpoint } from "../../hooks/use-breakpoint";

/** Panel identifiers for mobile navigation */
export type MobilePanel = "chat" | "code" | "terminal" | "files" | "settings";

/** Icons rendered as simple SVG for the bottom tab bar */
const TAB_ICONS: Record<MobilePanel, ReactNode> = {
  chat: (
    <svg
      aria-hidden="true"
      fill="none"
      height="24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="24"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  code: (
    <svg
      aria-hidden="true"
      fill="none"
      height="24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="24"
    >
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  ),
  terminal: (
    <svg
      aria-hidden="true"
      fill="none"
      height="24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="24"
    >
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" x2="20" y1="19" y2="19" />
    </svg>
  ),
  files: (
    <svg
      aria-hidden="true"
      fill="none"
      height="24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="24"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  ),
  settings: (
    <svg
      aria-hidden="true"
      fill="none"
      height="24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="24"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
};

const PANEL_ORDER: MobilePanel[] = [
  "chat",
  "code",
  "terminal",
  "files",
  "settings",
];

const SWIPE_THRESHOLD = 50;

interface BottomTabBarProps {
  activePanel: MobilePanel;
  onPanelChange: (panel: MobilePanel) => void;
}

/** Bottom tab bar for mobile navigation */
function BottomTabBar({
  activePanel,
  onPanelChange,
}: BottomTabBarProps): ReactNode {
  return (
    <nav
      aria-label="Main navigation"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        height: "56px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-around",
        backgroundColor: "var(--color-bg-surface, #18181b)",
        borderTop: "1px solid var(--color-border, #27272a)",
        zIndex: 50,
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {PANEL_ORDER.map((panel) => {
        const isActive = activePanel === panel;
        return (
          <button
            aria-label={`Switch to ${panel} panel`}
            aria-selected={isActive}
            key={panel}
            onClick={() => onPanelChange(panel)}
            role="tab"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "2px",
              padding: "6px 12px",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: isActive
                ? "var(--color-text-primary, #fafafa)"
                : "var(--color-text-muted, #71717a)",
              opacity: isActive ? 1 : 0.7,
              transition: "color 150ms, opacity 150ms",
              fontSize: "10px",
              fontWeight: isActive ? 600 : 400,
              textTransform: "capitalize",
            }}
            type="button"
          >
            {TAB_ICONS[panel]}
            <span>{panel}</span>
          </button>
        );
      })}
    </nav>
  );
}

interface ResponsiveLayoutProps {
  /** Content rendered for the chat panel */
  chatPanel?: ReactNode;
  /** Additional className for the wrapper */
  className?: string;
  /** Content rendered for the code/editor panel */
  codePanel?: ReactNode;
  /** Full desktop workspace (used when breakpoint is desktop) */
  desktopWorkspace?: ReactNode;
  /** Content rendered for the files panel */
  filesPanel?: ReactNode;
  /** Content rendered for the settings panel */
  settingsPanel?: ReactNode;
  /** Sidebar content for tablet and desktop */
  sidebar?: ReactNode;
  /** Content rendered for the terminal panel */
  terminalPanel?: ReactNode;
}

/**
 * Responsive layout wrapper with breakpoint-based panel management.
 *
 * - Mobile (<768px): single-panel view with bottom tab navigation and swipe gestures
 * - Tablet (768-1024px): two-panel layout with collapsible sidebar
 * - Desktop (>1024px): full multi-panel workspace layout
 */
export function ResponsiveLayout({
  chatPanel,
  codePanel,
  terminalPanel,
  filesPanel,
  settingsPanel,
  sidebar,
  desktopWorkspace,
  className,
}: ResponsiveLayoutProps): ReactNode {
  const breakpoint = useBreakpoint();
  const [activePanel, setActivePanel] = useState<MobilePanel>("chat");
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);

  // Touch swipe tracking
  const touchStartX = useRef<number>(0);
  const touchStartY = useRef<number>(0);

  const handleTouchStart = useCallback((e: ReactTouchEvent<HTMLDivElement>) => {
    const touch = e.touches[0];
    if (touch) {
      touchStartX.current = touch.clientX;
      touchStartY.current = touch.clientY;
    }
  }, []);

  const handleTouchEnd = useCallback(
    (e: ReactTouchEvent<HTMLDivElement>) => {
      const touch = e.changedTouches[0];
      if (!touch) {
        return;
      }

      const deltaX = touch.clientX - touchStartX.current;
      const deltaY = touch.clientY - touchStartY.current;

      // Only handle horizontal swipes (more horizontal than vertical)
      if (
        Math.abs(deltaX) < SWIPE_THRESHOLD ||
        Math.abs(deltaX) < Math.abs(deltaY)
      ) {
        return;
      }

      const currentIndex = PANEL_ORDER.indexOf(activePanel);
      if (deltaX < 0 && currentIndex < PANEL_ORDER.length - 1) {
        // Swipe left: go to next panel
        const nextPanel = PANEL_ORDER[currentIndex + 1];
        if (nextPanel) {
          setActivePanel(nextPanel);
        }
      } else if (deltaX > 0 && currentIndex > 0) {
        // Swipe right: go to previous panel
        const prevPanel = PANEL_ORDER[currentIndex - 1];
        if (prevPanel) {
          setActivePanel(prevPanel);
        }
      }
    },
    [activePanel]
  );

  // Listen for sidebar toggle events
  useEffect(() => {
    const handler = (): void => {
      setSidebarOpen((prev) => !prev);
    };
    window.addEventListener(
      "prometheus:toggle-sidebar",
      handler as EventListener
    );
    return () => {
      window.removeEventListener(
        "prometheus:toggle-sidebar",
        handler as EventListener
      );
    };
  }, []);

  const panelMap: Record<MobilePanel, ReactNode> = {
    chat: chatPanel ?? null,
    code: codePanel ?? null,
    terminal: terminalPanel ?? null,
    files: filesPanel ?? null,
    settings: settingsPanel ?? null,
  };

  // ---- Desktop: render the full workspace ----
  if (breakpoint === "desktop") {
    return (
      <div
        className={className}
        style={{
          display: "flex",
          height: "100vh",
          width: "100%",
          overflow: "hidden",
        }}
      >
        {desktopWorkspace ?? (
          <>
            {sidebar && (
              <aside
                style={{
                  width: sidebarOpen ? "260px" : "0px",
                  overflow: "hidden",
                  transition: "width 200ms ease",
                  borderRight: sidebarOpen
                    ? "1px solid var(--color-border, #27272a)"
                    : "none",
                  flexShrink: 0,
                }}
              >
                {sidebar}
              </aside>
            )}
            <main style={{ flex: 1, display: "flex", overflow: "hidden" }}>
              <div style={{ flex: 1, overflow: "auto" }}>{chatPanel}</div>
              <div
                style={{
                  flex: 1,
                  overflow: "auto",
                  borderLeft: "1px solid var(--color-border, #27272a)",
                }}
              >
                {codePanel}
              </div>
              <div
                style={{
                  width: "320px",
                  overflow: "auto",
                  borderLeft: "1px solid var(--color-border, #27272a)",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div style={{ flex: 1 }}>{terminalPanel}</div>
                <div
                  style={{
                    borderTop: "1px solid var(--color-border, #27272a)",
                    flex: 1,
                  }}
                >
                  {filesPanel}
                </div>
              </div>
            </main>
          </>
        )}
      </div>
    );
  }

  // ---- Tablet: two-panel with collapsible sidebar ----
  if (breakpoint === "tablet") {
    return (
      <div
        className={className}
        style={{
          display: "flex",
          height: "100vh",
          width: "100%",
          overflow: "hidden",
        }}
      >
        {sidebar && sidebarOpen && (
          <aside
            style={{
              width: "240px",
              flexShrink: 0,
              borderRight: "1px solid var(--color-border, #27272a)",
              overflow: "auto",
            }}
          >
            {sidebar}
          </aside>
        )}
        <main
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div style={{ flex: 1, overflow: "auto" }}>
            {panelMap[activePanel]}
          </div>
          <BottomTabBar
            activePanel={activePanel}
            onPanelChange={setActivePanel}
          />
        </main>
      </div>
    );
  }

  // ---- Mobile: single-panel with bottom tabs and swipe ----
  return (
    <div
      className={className}
      onTouchEnd={handleTouchEnd}
      onTouchStart={handleTouchStart}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100%",
        overflow: "hidden",
      }}
    >
      <main
        aria-label={`${activePanel} panel`}
        role="tabpanel"
        style={{
          flex: 1,
          overflow: "auto",
          paddingBottom: "56px", // Space for bottom tab bar
        }}
      >
        {panelMap[activePanel]}
      </main>
      <BottomTabBar activePanel={activePanel} onPanelChange={setActivePanel} />
    </div>
  );
}
