"use client";

import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// SkipNav — accessible skip navigation link
// ---------------------------------------------------------------------------

interface SkipNavLinkProps {
  /** The ID of the target content element */
  contentId?: string;
  /** Custom label for the skip link */
  label?: string;
}

/**
 * Renders a "Skip to main content" link that is visually hidden until focused.
 * This is a standard accessibility pattern that allows keyboard users to bypass
 * repetitive navigation and jump directly to the main content area.
 *
 * Usage:
 * ```tsx
 * <SkipNavLink contentId="main-content" />
 * <nav>...</nav>
 * <main id="main-content">...</main>
 * ```
 */
export function SkipNavLink({
  contentId = "main-content",
  label = "Skip to main content",
}: SkipNavLinkProps): ReactNode {
  return (
    <a
      className="skip-nav-link"
      href={`#${contentId}`}
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
        background: "hsl(263, 70%, 58%)",
        color: "#ffffff",
        fontWeight: 600,
        fontSize: "14px",
        textDecoration: "none",
        borderRadius: "0 0 8px 8px",
        outline: "2px solid transparent",
        outlineOffset: "2px",
        transition: "top 0.15s ease-in-out",
      }}
    >
      {label}
    </a>
  );
}

// ---------------------------------------------------------------------------
// SkipNavContent — target anchor for skip navigation
// ---------------------------------------------------------------------------

interface SkipNavContentProps {
  children: ReactNode;
  /** The ID that matches the SkipNavLink's contentId */
  id?: string;
}

/**
 * Wraps the main content area and provides the target anchor for SkipNavLink.
 * Applies tabIndex={-1} so the element can receive focus programmatically.
 *
 * Usage:
 * ```tsx
 * <SkipNavContent>
 *   <h1>Page Title</h1>
 *   <p>Content here...</p>
 * </SkipNavContent>
 * ```
 */
export function SkipNavContent({
  id = "main-content",
  children,
}: SkipNavContentProps): ReactNode {
  return (
    <main id={id} style={{ outline: "none" }} tabIndex={-1}>
      {children}
    </main>
  );
}
