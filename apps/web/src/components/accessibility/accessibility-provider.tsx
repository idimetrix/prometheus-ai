"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

// ─── Accessibility Context ───────────────────────────────────────────

interface AccessibilityContextValue {
  /** Announce a message to screen readers via aria-live region */
  announce: (message: string, priority?: "polite" | "assertive") => void;
  /** Whether high contrast mode is active (fixes zinc-on-zinc issues) */
  highContrast: boolean;
  /** Whether the user prefers reduced motion */
  prefersReducedMotion: boolean;
  /** Toggle high contrast mode */
  setHighContrast: (enabled: boolean) => void;
}

const AccessibilityContext = createContext<AccessibilityContextValue>({
  prefersReducedMotion: false,
  highContrast: false,
  setHighContrast: () => {
    // noop
  },
  announce: () => {
    // noop
  },
});

// ─── Hooks ────────────────────────────────────────────────────────────

/**
 * Detect whether the user prefers reduced motion.
 * SSR-safe: defaults to false.
 */
function usePrefersReducedMotion(): boolean {
  const [prefersReduced, setPrefersReduced] = useState<boolean>(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReduced(query.matches);

    const handler = (e: MediaQueryListEvent): void => {
      setPrefersReduced(e.matches);
    };
    query.addEventListener("change", handler);
    return () => {
      query.removeEventListener("change", handler);
    };
  }, []);

  return prefersReduced;
}

/**
 * Trap focus within a container element. When active, Tab and Shift+Tab
 * cycle through focusable elements inside the container.
 *
 * @param active - Whether the focus trap is currently active
 * @returns A ref to attach to the container element
 */
export function useFocusTrap<T extends HTMLElement>(
  active: boolean
): React.RefObject<T | null> {
  const containerRef = useRef<T | null>(null);

  useEffect(() => {
    if (!(active && containerRef.current)) {
      return;
    }

    const container = containerRef.current;

    const getFocusableElements = (): HTMLElement[] => {
      const selector = [
        "a[href]",
        "button:not([disabled])",
        "input:not([disabled])",
        "textarea:not([disabled])",
        "select:not([disabled])",
        "[tabindex]:not([tabindex='-1'])",
      ].join(", ");
      return Array.from(container.querySelectorAll<HTMLElement>(selector));
    };

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== "Tab") {
        return;
      }

      const focusable = getFocusableElements();
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0] as HTMLElement;
      const last = focusable.at(-1) as HTMLElement;

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", handleKeyDown);

    // Focus the first focusable element when trap activates
    const focusable = getFocusableElements();
    if (focusable[0]) {
      focusable[0].focus();
    }

    return () => {
      container.removeEventListener("keydown", handleKeyDown);
    };
  }, [active]);

  return containerRef;
}

/**
 * Saves the currently focused element on mount and restores focus to it
 * when the component unmounts. Useful for modals and dialogs.
 */
export function useReturnFocus(): void {
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;

    return () => {
      if (
        previousFocus.current &&
        typeof previousFocus.current.focus === "function"
      ) {
        previousFocus.current.focus();
      }
    };
  }, []);
}

// ─── Components ───────────────────────────────────────────────────────

interface AriaLiveRegionProps {
  /** Message to announce. Changing this triggers a screen reader announcement. */
  message: string;
  /** Priority level. 'assertive' interrupts the current speech. */
  priority?: "polite" | "assertive";
}

/**
 * Aria-live region component for announcing streaming messages and
 * terminal output to screen readers.
 */
export function AriaLiveRegion({
  message,
  priority = "polite",
}: AriaLiveRegionProps): ReactNode {
  return (
    <div
      aria-atomic="true"
      aria-live={priority}
      role="status"
      style={{
        position: "absolute",
        width: "1px",
        height: "1px",
        padding: 0,
        margin: "-1px",
        overflow: "hidden",
        clip: "rect(0, 0, 0, 0)",
        whiteSpace: "nowrap",
        border: 0,
      }}
    >
      {message}
    </div>
  );
}

interface SkipToContentLinkProps {
  targetId: string;
}

/** Skip-to-content link that becomes visible on focus */
function SkipToContentLink({ targetId }: SkipToContentLinkProps): ReactNode {
  return (
    <a
      href={`#${targetId}`}
      onBlur={(e) => {
        e.currentTarget.style.top = "-100%";
      }}
      onFocus={(e) => {
        e.currentTarget.style.top = "0";
      }}
      style={{
        position: "absolute",
        top: "-100%",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 10_000,
        padding: "8px 16px",
        background: "var(--color-accent, #a78bfa)",
        color: "var(--color-accent-foreground, #09090b)",
        fontWeight: 600,
        fontSize: "14px",
        textDecoration: "none",
        borderRadius: "0 0 8px 8px",
        outline: "none",
      }}
    >
      Skip to main content
    </a>
  );
}

interface AccessibilityProviderProps {
  children: ReactNode;
  /** ID of the main content element for skip-to-content link */
  mainContentId?: string;
}

/**
 * Accessibility provider that wraps the application with:
 * - CSS custom properties to fix zinc-on-zinc contrast issues (via data attribute)
 * - aria-live region for streaming announcements
 * - Skip-to-content link at the top of the page
 * - prefers-reduced-motion support
 * - Focus management utilities via context
 */
export function AccessibilityProvider({
  children,
  mainContentId = "main-content",
}: AccessibilityProviderProps): ReactNode {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [highContrast, setHighContrast] = useState<boolean>(false);
  const [politeMessage, setPoliteMessage] = useState<string>("");
  const [assertiveMessage, setAssertiveMessage] = useState<string>("");

  // Apply high contrast data attribute to document root
  useEffect(() => {
    document.documentElement.setAttribute(
      "data-high-contrast",
      String(highContrast)
    );
    return () => {
      document.documentElement.removeAttribute("data-high-contrast");
    };
  }, [highContrast]);

  // Apply reduced motion data attribute
  useEffect(() => {
    document.documentElement.setAttribute(
      "data-reduced-motion",
      String(prefersReducedMotion)
    );
    return () => {
      document.documentElement.removeAttribute("data-reduced-motion");
    };
  }, [prefersReducedMotion]);

  const announce = useCallback(
    (message: string, priority: "polite" | "assertive" = "polite"): void => {
      if (priority === "assertive") {
        setAssertiveMessage("");
        // Force re-render by clearing first, then setting in next tick
        requestAnimationFrame(() => {
          setAssertiveMessage(message);
        });
      } else {
        setPoliteMessage("");
        requestAnimationFrame(() => {
          setPoliteMessage(message);
        });
      }
    },
    []
  );

  const contextValue: AccessibilityContextValue = {
    prefersReducedMotion,
    highContrast,
    setHighContrast,
    announce,
  };

  return (
    <AccessibilityContext.Provider value={contextValue}>
      {/* Skip-to-content link */}
      <SkipToContentLink targetId={mainContentId} />

      {/* Aria-live regions for dynamic announcements */}
      <AriaLiveRegion message={politeMessage} priority="polite" />
      <AriaLiveRegion message={assertiveMessage} priority="assertive" />

      {children}
    </AccessibilityContext.Provider>
  );
}

/**
 * Hook to access accessibility context values and utilities.
 */
export function useAccessibility(): AccessibilityContextValue {
  return useContext(AccessibilityContext);
}
