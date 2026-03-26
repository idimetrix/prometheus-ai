"use client";

import { useMemo, useState } from "react";
import {
  formatKeyboardShortcut,
  type KeyboardShortcutDef,
} from "@/hooks/use-keyboard-shortcuts";

const CATEGORY_LABELS: Record<string, string> = {
  general: "General",
  navigation: "Navigation",
  editor: "Editor",
  terminal: "Terminal",
  custom: "AI",
};

const CATEGORY_ORDER = [
  "general",
  "navigation",
  "editor",
  "terminal",
  "custom",
];

interface ShortcutReferenceProps {
  /** Close the reference panel */
  onClose: () => void;
  /** Whether the reference panel is open */
  open: boolean;
  /** All registered shortcuts */
  shortcuts: KeyboardShortcutDef[];
}

export function ShortcutReference({
  open,
  onClose,
  shortcuts,
}: ShortcutReferenceProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) {
      return shortcuts;
    }
    const lower = searchQuery.toLowerCase();
    return shortcuts.filter(
      (s) =>
        s.description.toLowerCase().includes(lower) ||
        s.id.toLowerCase().includes(lower) ||
        s.category.toLowerCase().includes(lower) ||
        formatKeyboardShortcut(s).toLowerCase().includes(lower)
    );
  }, [shortcuts, searchQuery]);

  const grouped = useMemo(() => {
    const groups: Record<string, KeyboardShortcutDef[]> = {};
    for (const shortcut of filtered) {
      const cat = shortcut.category;
      if (!groups[cat]) {
        groups[cat] = [];
      }
      groups[cat]?.push(shortcut);
    }
    return groups;
  }, [filtered]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onClose();
          }
        }}
        role="presentation"
      />

      <div className="relative w-full max-w-2xl rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-zinc-800 border-b px-4 py-3">
          <h2 className="flex-1 font-medium text-sm text-zinc-200">
            Keyboard Shortcuts
          </h2>
          <button
            className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            onClick={onClose}
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
              <title>Close</title>
              <path
                d="M6 18 18 6M6 6l12 12"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="border-zinc-800 border-b px-4 py-2">
          <input
            autoFocus
            className="w-full bg-transparent text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search shortcuts..."
            value={searchQuery}
          />
        </div>

        {/* Shortcut table */}
        <div className="max-h-[60vh] overflow-auto p-4">
          {CATEGORY_ORDER.map((cat) => {
            const items = grouped[cat];
            if (!items || items.length === 0) {
              return null;
            }
            return (
              <div className="mb-4" key={cat}>
                <h3 className="mb-2 font-medium text-[11px] text-zinc-500 uppercase tracking-wider">
                  {CATEGORY_LABELS[cat] ?? cat}
                </h3>
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-[11px] text-zinc-600">
                      <th className="pr-4 pb-1 font-medium">Action</th>
                      <th className="pr-4 pb-1 font-medium">Shortcut</th>
                      <th className="pb-1 font-medium">Category</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((shortcut) => (
                      <tr
                        className="group border-zinc-800/50 border-t"
                        key={shortcut.id}
                      >
                        <td className="py-1.5 pr-4 text-[12px] text-zinc-300">
                          {shortcut.description}
                        </td>
                        <td className="py-1.5 pr-4">
                          <ShortcutKeys shortcut={shortcut} />
                        </td>
                        <td className="py-1.5 text-[11px] text-zinc-600">
                          {CATEGORY_LABELS[shortcut.category] ??
                            shortcut.category}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}

          {filtered.length === 0 && (
            <div className="py-6 text-center text-sm text-zinc-600">
              No matching shortcuts
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-zinc-800 border-t px-4 py-2 text-center text-[10px] text-zinc-600">
          Press{" "}
          <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5">
            ?
          </kbd>{" "}
          or use the command palette to open this reference
        </div>
      </div>
    </div>
  );
}

function ShortcutKeys({ shortcut }: { shortcut: KeyboardShortcutDef }) {
  const formatted = formatKeyboardShortcut(shortcut);
  const parts = formatted.split("+");
  return (
    <span className="inline-flex items-center gap-0.5">
      {parts.map((part, i) => (
        <span key={`shortcut-part-${part}`}>
          {i > 0 && <span className="mx-0.5 text-zinc-700">+</span>}
          <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-zinc-700 bg-zinc-800 px-1 text-[10px] text-zinc-400">
            {part}
          </kbd>
        </span>
      ))}
    </span>
  );
}
