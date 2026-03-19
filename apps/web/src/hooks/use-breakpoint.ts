"use client";

import { useCallback, useEffect, useState } from "react";

/** Supported breakpoint categories */
export type Breakpoint = "mobile" | "tablet" | "desktop";

/** Pixel thresholds for each breakpoint transition */
const BREAKPOINTS = {
  mobile: 768,
  tablet: 1024,
} as const;

/**
 * Determine the current breakpoint from the window width.
 * Falls back to 'desktop' when matchMedia is not available (SSR).
 */
function resolveBreakpoint(): Breakpoint {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return "desktop";
  }

  const width = window.innerWidth;

  if (width < BREAKPOINTS.mobile) {
    return "mobile";
  }
  if (width < BREAKPOINTS.tablet) {
    return "tablet";
  }
  return "desktop";
}

/**
 * Hook that returns the current responsive breakpoint:
 * - 'mobile' for viewports < 768px
 * - 'tablet' for viewports 768px-1024px
 * - 'desktop' for viewports > 1024px
 *
 * Uses the matchMedia API with proper cleanup. SSR-safe (defaults to 'desktop').
 */
export function useBreakpoint(): Breakpoint {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>("desktop");

  const update = useCallback(() => {
    setBreakpoint(resolveBreakpoint());
  }, []);

  useEffect(() => {
    // Set initial value on mount
    update();

    const mobileQuery = window.matchMedia(
      `(max-width: ${BREAKPOINTS.mobile - 1}px)`
    );
    const tabletQuery = window.matchMedia(
      `(min-width: ${BREAKPOINTS.mobile}px) and (max-width: ${BREAKPOINTS.tablet - 1}px)`
    );
    const desktopQuery = window.matchMedia(
      `(min-width: ${BREAKPOINTS.tablet}px)`
    );

    const handler = (): void => {
      update();
    };

    mobileQuery.addEventListener("change", handler);
    tabletQuery.addEventListener("change", handler);
    desktopQuery.addEventListener("change", handler);

    return () => {
      mobileQuery.removeEventListener("change", handler);
      tabletQuery.removeEventListener("change", handler);
      desktopQuery.removeEventListener("change", handler);
    };
  }, [update]);

  return breakpoint;
}

/**
 * Returns true when the current breakpoint is at or below the given threshold.
 */
export function useIsMobile(): boolean {
  return useBreakpoint() === "mobile";
}

/**
 * Returns true when the current breakpoint is tablet or mobile.
 */
export function useIsTabletOrBelow(): boolean {
  const bp = useBreakpoint();
  return bp === "mobile" || bp === "tablet";
}
