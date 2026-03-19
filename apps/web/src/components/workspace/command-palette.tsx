"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUIStore } from "@/stores/ui.store";

interface CommandAction {
  description?: string;
  group: string;
  handler: () => void;
  id: string;
  label: string;
  shortcut?: string;
}

export function WorkspaceCommandPalette() {
  const commandPaletteOpen = useUIStore((s) => s.commandPaletteOpen);
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const setTheme = useUIStore((s) => s.setTheme);
  const theme = useUIStore((s) => s.theme);

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const actions = useMemo<CommandAction[]>(
    () => [
      {
        id: "switch-project",
        label: "Switch Project",
        group: "Navigation",
        handler: () => {
          window.dispatchEvent(new CustomEvent("prometheus:switch-project"));
        },
      },
      {
        id: "new-session",
        label: "New Session",
        description: "Start a new agent session",
        group: "Create",
        handler: () => {
          window.dispatchEvent(new CustomEvent("prometheus:new-session"));
        },
      },
      {
        id: "toggle-theme",
        label: "Toggle Theme",
        description: `Currently: ${theme}`,
        group: "Preferences",
        shortcut: "Cmd+Shift+T",
        handler: () => {
          setTheme(theme === "dark" ? "light" : "dark");
        },
      },
      {
        id: "open-settings",
        label: "Open Settings",
        group: "Navigation",
        handler: () => {
          window.dispatchEvent(new CustomEvent("prometheus:open-settings"));
        },
      },
      {
        id: "view-shortcuts",
        label: "View Keyboard Shortcuts",
        group: "Help",
        handler: () => {
          window.dispatchEvent(new CustomEvent("prometheus:show-shortcuts"));
        },
      },
    ],
    [theme, setTheme]
  );

  const filtered = useMemo(() => {
    if (!query.trim()) {
      return actions;
    }
    const lower = query.toLowerCase();
    return actions.filter(
      (a) =>
        a.label.toLowerCase().includes(lower) ||
        a.description?.toLowerCase().includes(lower) ||
        a.group.toLowerCase().includes(lower)
    );
  }, [actions, query]);

  const grouped = useMemo(() => {
    const groups: Record<string, CommandAction[]> = {};
    for (const action of filtered) {
      if (!groups[action.group]) {
        groups[action.group] = [];
      }
      groups[action.group]?.push(action);
    }
    return groups;
  }, [filtered]);

  const flatList = useMemo(() => {
    const list: CommandAction[] = [];
    for (const group of Object.values(grouped)) {
      list.push(...group);
    }
    return list;
  }, [grouped]);

  // Keyboard shortcut to open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [commandPaletteOpen, setCommandPaletteOpen]);

  // Focus input on open
  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [commandPaletteOpen]);

  const executeAction = useCallback(
    (action: CommandAction) => {
      setCommandPaletteOpen(false);
      setQuery("");
      action.handler();
    },
    [setCommandPaletteOpen]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, flatList.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && flatList[selectedIndex]) {
      e.preventDefault();
      executeAction(flatList[selectedIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setCommandPaletteOpen(false);
      setQuery("");
    }
  };

  // Reset index on query change
  useEffect(() => {
    setSelectedIndex(0);
  }, []);

  if (!commandPaletteOpen) {
    return null;
  }

  let globalIndex = 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-close */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop overlay */}
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: backdrop overlay */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => {
          setCommandPaletteOpen(false);
          setQuery("");
        }}
      />

      <div className="relative w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl">
        {/* Search */}
        <div className="flex items-center gap-3 border-zinc-800 border-b px-4 py-3">
          <svg
            aria-hidden="true"
            className="h-5 w-5 shrink-0 text-zinc-500"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <input
            autoFocus
            className="flex-1 bg-transparent text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            ref={inputRef}
            value={query}
          />
          <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-auto p-2">
          {flatList.length === 0 ? (
            <div className="py-6 text-center text-sm text-zinc-600">
              No matching commands
            </div>
          ) : (
            Object.entries(grouped).map(([group, items]) => (
              <div className="mb-2" key={group}>
                <div className="px-2 py-1 font-medium text-[10px] text-zinc-600 uppercase tracking-wider">
                  {group}
                </div>
                {items.map((action) => {
                  const idx = globalIndex++;
                  const isSelected = idx === selectedIndex;
                  return (
                    <button
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                        isSelected
                          ? "bg-violet-500/10 text-zinc-200"
                          : "text-zinc-400 hover:bg-zinc-800/50"
                      }`}
                      key={action.id}
                      onClick={() => executeAction(action)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      type="button"
                    >
                      <div className="flex-1">
                        <div className="text-sm">{action.label}</div>
                        {action.description && (
                          <div className="text-[11px] text-zinc-600">
                            {action.description}
                          </div>
                        )}
                      </div>
                      {action.shortcut && (
                        <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
                          {action.shortcut}
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 border-zinc-800 border-t px-4 py-2 text-[10px] text-zinc-600">
          <span>
            <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5">
              &uarr;&darr;
            </kbd>{" "}
            Navigate
          </span>
          <span>
            <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5">
              &crarr;
            </kbd>{" "}
            Select
          </span>
          <span>
            <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5">
              Esc
            </kbd>{" "}
            Close
          </span>
        </div>
      </div>
    </div>
  );
}
