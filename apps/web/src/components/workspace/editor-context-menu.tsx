"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContextMenuAction =
  | "explain"
  | "refactor"
  | "fix"
  | "generate-tests"
  | "optimize"
  | "add-comments"
  | "cut"
  | "copy"
  | "paste"
  | "select-all";

interface MenuItemDef {
  action: ContextMenuAction;
  icon: string;
  kbd?: string;
  label: string;
  requiresSelection?: boolean;
}

interface EditorContextMenuProps {
  /** Callback when an AI action is triggered */
  onAiAction: (action: ContextMenuAction, selection: string) => void;
  /** Close the context menu */
  onClose: () => void;
  /** Callback for standard editor actions */
  onEditorAction?: (action: "cut" | "copy" | "paste" | "select-all") => void;
  /** The position where the menu was triggered */
  position: { x: number; y: number } | null;
  /** Current selected text in the editor */
  selectedText: string;
}

// ---------------------------------------------------------------------------
// Menu configuration
// ---------------------------------------------------------------------------

const AI_ACTIONS: MenuItemDef[] = [
  {
    action: "explain",
    label: "Explain Selection",
    icon: "\u{1F4AC}",
    requiresSelection: true,
  },
  {
    action: "refactor",
    label: "Refactor Selection",
    icon: "\u{1F527}",
    requiresSelection: true,
  },
  {
    action: "fix",
    label: "Fix This",
    icon: "\u{1F41B}",
    requiresSelection: true,
  },
  {
    action: "generate-tests",
    label: "Generate Tests",
    icon: "\u{1F9EA}",
    requiresSelection: true,
  },
  {
    action: "optimize",
    label: "Optimize",
    icon: "\u{26A1}",
    requiresSelection: true,
  },
  {
    action: "add-comments",
    label: "Add Comments",
    icon: "\u{1F4DD}",
    requiresSelection: true,
  },
];

const EDITOR_ACTIONS: MenuItemDef[] = [
  { action: "cut", label: "Cut", icon: "", kbd: "Ctrl+X" },
  { action: "copy", label: "Copy", icon: "", kbd: "Ctrl+C" },
  { action: "paste", label: "Paste", icon: "", kbd: "Ctrl+V" },
  { action: "select-all", label: "Select All", icon: "", kbd: "Ctrl+A" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EditorContextMenu({
  selectedText,
  onAiAction,
  onEditorAction,
  position,
  onClose,
}: EditorContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedPosition, setAdjustedPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // Close on outside click
  useEffect(() => {
    if (!position) {
      return;
    }

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [position, onClose]);

  // Adjust position to keep menu within viewport
  useEffect(() => {
    if (!(position && menuRef.current)) {
      setAdjustedPosition(position);
      return;
    }

    const rect = menuRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let x = position.x;
    let y = position.y;

    if (x + rect.width > viewportWidth) {
      x = viewportWidth - rect.width - 8;
    }
    if (y + rect.height > viewportHeight) {
      y = viewportHeight - rect.height - 8;
    }

    setAdjustedPosition({ x: Math.max(0, x), y: Math.max(0, y) });
  }, [position]);

  const handleAiAction = useCallback(
    (action: ContextMenuAction) => {
      onAiAction(action, selectedText);
      onClose();
    },
    [onAiAction, selectedText, onClose]
  );

  const handleEditorAction = useCallback(
    (action: "cut" | "copy" | "paste" | "select-all") => {
      onEditorAction?.(action);
      onClose();
    },
    [onEditorAction, onClose]
  );

  if (!position) {
    return null;
  }

  const hasSelection = selectedText.trim().length > 0;
  const displayPosition = adjustedPosition ?? position;

  return (
    <div
      className="fixed z-50 min-w-[200px] rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
      ref={menuRef}
      role="menu"
      style={{
        left: `${displayPosition.x}px`,
        top: `${displayPosition.y}px`,
      }}
    >
      {/* AI Actions */}
      {AI_ACTIONS.map((item) => {
        const disabled = item.requiresSelection && !hasSelection;
        return (
          <button
            aria-disabled={disabled}
            className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition-colors ${
              disabled
                ? "cursor-not-allowed text-zinc-600"
                : "text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
            }`}
            disabled={disabled}
            key={item.action}
            onClick={() => handleAiAction(item.action)}
            role="menuitem"
            type="button"
          >
            <span className="w-4 text-center text-xs">{item.icon}</span>
            <span className="flex-1">{item.label}</span>
          </button>
        );
      })}

      {/* Separator */}
      <div className="my-1 h-px bg-zinc-700" />

      {/* Standard editor actions */}
      {EDITOR_ACTIONS.map((item) => (
        <button
          className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          key={item.action}
          onClick={() =>
            handleEditorAction(
              item.action as "cut" | "copy" | "paste" | "select-all"
            )
          }
          role="menuitem"
          type="button"
        >
          <span className="w-4" />
          <span className="flex-1">{item.label}</span>
          {item.kbd && (
            <span className="text-[10px] text-zinc-600">{item.kbd}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hook for integrating with CodeMirror
// ---------------------------------------------------------------------------

interface UseEditorContextMenuOptions {
  onAiAction: (action: ContextMenuAction, selection: string) => void;
}

export function useEditorContextMenu({
  onAiAction,
}: UseEditorContextMenuOptions) {
  const [menuState, setMenuState] = useState<{
    position: { x: number; y: number } | null;
    selectedText: string;
  }>({
    position: null,
    selectedText: "",
  });

  const openMenu = useCallback((e: MouseEvent, selectedText: string) => {
    e.preventDefault();
    setMenuState({
      position: { x: e.clientX, y: e.clientY },
      selectedText,
    });
  }, []);

  const closeMenu = useCallback(() => {
    setMenuState({ position: null, selectedText: "" });
  }, []);

  return {
    menuProps: {
      position: menuState.position,
      selectedText: menuState.selectedText,
      onAiAction,
      onClose: closeMenu,
    },
    openMenu,
    closeMenu,
    isOpen: menuState.position !== null,
  };
}
