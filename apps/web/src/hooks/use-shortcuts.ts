"use client";

import { useCallback, useEffect, useRef } from "react";

export interface ShortcutAction {
  alt?: boolean;
  ctrl?: boolean;
  description: string;
  /** If true, shortcut works even when an input/textarea is focused */
  global?: boolean;
  handler: (e: KeyboardEvent) => void;
  key: string;
  meta?: boolean;
  shift?: boolean;
}

const DEFAULT_SHORTCUTS: ShortcutAction[] = [
  {
    key: "k",
    meta: true,
    description: "Open command palette",
    handler: () => {
      window.dispatchEvent(
        new CustomEvent("prometheus:command-palette", {
          detail: { open: true },
        })
      );
    },
  },
  {
    key: "Enter",
    meta: true,
    description: "Submit task",
    handler: () => {
      window.dispatchEvent(new CustomEvent("prometheus:submit-task"));
    },
  },
  {
    key: "p",
    meta: true,
    shift: true,
    description: "Switch project",
    handler: () => {
      window.dispatchEvent(
        new CustomEvent("prometheus:command-palette", {
          detail: { open: true, filter: "project" },
        })
      );
    },
  },
  {
    key: "Escape",
    description: "Close modal / palette",
    global: true,
    handler: () => {
      window.dispatchEvent(new CustomEvent("prometheus:close-modal"));
      window.dispatchEvent(
        new CustomEvent("prometheus:command-palette", {
          detail: { open: false },
        })
      );
    },
  },
];

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) {
    return false;
  }
  const tag = el.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    (el as HTMLElement).isContentEditable
  );
}

/**
 * Register keyboard shortcuts. Pass additional shortcuts to merge with defaults.
 * Returns the full list of registered shortcuts for display in help/command palette.
 */
export function useShortcuts(additionalShortcuts: ShortcutAction[] = []) {
  const allShortcuts = useRef<ShortcutAction[]>([
    ...DEFAULT_SHORTCUTS,
    ...additionalShortcuts,
  ]);

  useEffect(() => {
    allShortcuts.current = [...DEFAULT_SHORTCUTS, ...additionalShortcuts];
  }, [additionalShortcuts]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    for (const shortcut of allShortcuts.current) {
      const metaMatch = shortcut.meta ? e.metaKey || e.ctrlKey : true;
      const ctrlMatch = shortcut.ctrl ? e.ctrlKey : true;
      const _shiftMatch = shortcut.shift
        ? e.shiftKey
        : !(shortcut.shift || e.shiftKey) || !!shortcut.shift;
      const altMatch = shortcut.alt ? e.altKey : true;

      if (
        e.key === shortcut.key &&
        metaMatch &&
        ctrlMatch &&
        altMatch &&
        (shortcut.shift ? e.shiftKey : !e.shiftKey || shortcut.key === "Escape")
      ) {
        // Skip if input is focused and shortcut is not global
        if (!shortcut.global && isInputFocused() && shortcut.key !== "Escape") {
          // Allow meta+key combos even in inputs
          if (!(shortcut.meta || shortcut.ctrl)) {
            continue;
          }
        }

        e.preventDefault();
        shortcut.handler(e);
        return;
      }
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return { shortcuts: allShortcuts.current };
}

/**
 * Format a shortcut for display. Returns something like "Cmd+K" or "Ctrl+Shift+P".
 */
export function formatShortcut(shortcut: ShortcutAction): string {
  const isMac =
    typeof navigator !== "undefined" && navigator.platform.includes("Mac");
  const parts: string[] = [];

  if (shortcut.meta) {
    parts.push(isMac ? "\u2318" : "Ctrl");
  }
  if (shortcut.ctrl && !shortcut.meta) {
    parts.push("Ctrl");
  }
  if (shortcut.shift) {
    parts.push(isMac ? "\u21E7" : "Shift");
  }
  if (shortcut.alt) {
    parts.push(isMac ? "\u2325" : "Alt");
  }

  const keyLabel =
    shortcut.key === "Escape"
      ? "Esc"
      : shortcut.key === "Enter"
        ? "\u21B5"
        : shortcut.key.toUpperCase();
  parts.push(keyLabel);

  return parts.join("+");
}
