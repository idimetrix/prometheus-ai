"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Definition of a keyboard shortcut for registration */
export interface KeyboardShortcutDef {
  /** Requires Alt/Option */
  alt?: boolean;
  /** Category for grouping in the reference panel */
  category: "general" | "navigation" | "editor" | "terminal" | "custom";
  /** Requires Ctrl specifically */
  ctrl?: boolean;
  /** Display-friendly description */
  description: string;
  /** If true, shortcut is currently disabled */
  disabled?: boolean;
  /** If true, fires even when an input/textarea is focused */
  global?: boolean;
  /** Handler to execute when shortcut fires */
  handler: (event: KeyboardEvent) => void;
  /** Unique identifier for the shortcut */
  id: string;
  /** The key value (e.g., 'k', 'b', 'j', 'Escape', '?') */
  key: string;
  /** Requires Meta (Cmd on Mac, Ctrl on Windows/Linux) */
  meta?: boolean;
  /** Requires Shift */
  shift?: boolean;
}

interface ShortcutRegistry {
  listeners: Set<() => void>;
  shortcuts: Map<string, KeyboardShortcutDef>;
}

/** Global singleton registry shared across all hook instances */
const registry: ShortcutRegistry = {
  shortcuts: new Map(),
  listeners: new Set(),
};

function notifyListeners(): void {
  for (const listener of registry.listeners) {
    listener();
  }
}

function isInputElement(el: Element | null): boolean {
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
 * Format a shortcut definition into a human-readable string.
 * Example: "Cmd+K" on Mac, "Ctrl+K" on Windows/Linux
 */
export function formatKeyboardShortcut(def: KeyboardShortcutDef): string {
  const isMac =
    typeof navigator !== "undefined" && navigator.platform.includes("Mac");
  const parts: string[] = [];

  if (def.meta) {
    parts.push(isMac ? "\u2318" : "Ctrl");
  }
  if (def.ctrl && !def.meta) {
    parts.push("Ctrl");
  }
  if (def.shift) {
    parts.push(isMac ? "\u21E7" : "Shift");
  }
  if (def.alt) {
    parts.push(isMac ? "\u2325" : "Alt");
  }

  if (def.key === "Escape") {
    parts.push("Esc");
  } else if (def.key === "Enter") {
    parts.push("\u21B5");
  } else if (def.key === " ") {
    parts.push("Space");
  } else {
    parts.push(def.key.toUpperCase());
  }

  return parts.join("+");
}

/** Default shortcuts always registered */
const DEFAULT_SHORTCUTS: KeyboardShortcutDef[] = [
  {
    id: "command-palette",
    description: "Open command palette",
    category: "general",
    key: "k",
    meta: true,
    handler: () => {
      window.dispatchEvent(
        new CustomEvent("prometheus:command-palette", {
          detail: { open: true },
        })
      );
    },
  },
  {
    id: "toggle-sidebar",
    description: "Toggle sidebar",
    category: "navigation",
    key: "b",
    meta: true,
    handler: () => {
      window.dispatchEvent(new CustomEvent("prometheus:toggle-sidebar"));
    },
  },
  {
    id: "toggle-terminal",
    description: "Toggle terminal panel",
    category: "terminal",
    key: "j",
    meta: true,
    handler: () => {
      window.dispatchEvent(new CustomEvent("prometheus:toggle-terminal"));
    },
  },
  {
    id: "close-modal",
    description: "Close modal / panel",
    category: "general",
    key: "Escape",
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
  {
    id: "show-shortcuts",
    description: "Show keyboard shortcuts",
    category: "general",
    key: "?",
    handler: () => {
      window.dispatchEvent(
        new CustomEvent("prometheus:show-shortcut-reference")
      );
    },
  },
];

// Register defaults on module load
for (const def of DEFAULT_SHORTCUTS) {
  registry.shortcuts.set(def.id, def);
}

/**
 * Centralized keyboard shortcut manager hook.
 *
 * Features:
 * - Register/unregister shortcuts dynamically
 * - `?` to show shortcut reference panel
 * - Escape to close modals
 * - Standard shortcuts: Cmd+K (command palette), Cmd+B (sidebar), Cmd+J (terminal)
 *
 * @param additionalShortcuts - Extra shortcuts to register for the lifetime of the component
 * @returns Registry state and control methods
 */
export function useKeyboardShortcuts(
  additionalShortcuts: KeyboardShortcutDef[] = []
): {
  shortcuts: KeyboardShortcutDef[];
  showReference: boolean;
  setShowReference: (show: boolean) => void;
  register: (def: KeyboardShortcutDef) => void;
  unregister: (id: string) => void;
} {
  const [showReference, setShowReference] = useState<boolean>(false);
  const [, forceUpdate] = useState<number>(0);

  // Register additional shortcuts on mount and unregister on unmount
  const additionalIds = useRef<string[]>([]);

  useEffect(() => {
    const ids: string[] = [];
    for (const def of additionalShortcuts) {
      registry.shortcuts.set(def.id, def);
      ids.push(def.id);
    }
    additionalIds.current = ids;
    notifyListeners();

    return () => {
      for (const id of ids) {
        // Only remove if it's not a default
        if (!DEFAULT_SHORTCUTS.some((d) => d.id === id)) {
          registry.shortcuts.delete(id);
        }
      }
      notifyListeners();
    };
  }, [additionalShortcuts]);

  // Subscribe to registry changes
  useEffect(() => {
    const listener = (): void => {
      forceUpdate((n) => n + 1);
    };
    registry.listeners.add(listener);
    return () => {
      registry.listeners.delete(listener);
    };
  }, []);

  // Listen for the show-shortcut-reference event
  useEffect(() => {
    const handler = (): void => {
      setShowReference((prev) => !prev);
    };
    window.addEventListener(
      "prometheus:show-shortcut-reference",
      handler as EventListener
    );
    return () => {
      window.removeEventListener(
        "prometheus:show-shortcut-reference",
        handler as EventListener
      );
    };
  }, []);

  // Main keydown listener
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    for (const def of registry.shortcuts.values()) {
      if (def.disabled) {
        continue;
      }

      const metaMatch = def.meta ? e.metaKey || e.ctrlKey : true;
      const ctrlMatch = def.ctrl ? e.ctrlKey : true;
      const shiftMatch = def.shift
        ? e.shiftKey
        : !e.shiftKey || def.key === "Escape" || def.key === "?";
      const altMatch = def.alt ? e.altKey : true;

      if (
        e.key === def.key &&
        metaMatch &&
        ctrlMatch &&
        shiftMatch &&
        altMatch
      ) {
        // Skip non-global shortcuts when input is focused
        if (
          !def.global &&
          isInputElement(document.activeElement) &&
          def.key !== "Escape" &&
          !(def.meta || def.ctrl)
        ) {
          continue;
        }

        e.preventDefault();
        def.handler(e);
        return;
      }
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);

  const register = useCallback((def: KeyboardShortcutDef): void => {
    registry.shortcuts.set(def.id, def);
    notifyListeners();
  }, []);

  const unregister = useCallback((id: string): void => {
    if (!DEFAULT_SHORTCUTS.some((d) => d.id === id)) {
      registry.shortcuts.delete(id);
      notifyListeners();
    }
  }, []);

  return {
    shortcuts: Array.from(registry.shortcuts.values()),
    showReference,
    setShowReference,
    register,
    unregister,
  };
}
