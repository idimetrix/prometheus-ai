"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUIStore } from "@/stores/ui.store";

const WHITESPACE_RE = /\s+/;

interface CommandAction {
  description?: string;
  group: string;
  handler: () => void;
  id: string;
  keywords?: string[];
  label: string;
  shortcut?: string;
}

/**
 * Natural-language phrase mappings. Each entry maps a set of common phrases
 * (and their variations) to a command action ID. When the user types a
 * natural-language query like "run tests" or "deploy my app", the matcher
 * boosts the corresponding command so it appears first in the results.
 */
const NL_PHRASE_MAP: Array<{ actionId: string; phrases: string[] }> = [
  {
    actionId: "run-tests",
    phrases: [
      "run tests",
      "run the tests",
      "execute tests",
      "test my code",
      "start tests",
      "run test suite",
    ],
  },
  {
    actionId: "open-file",
    phrases: [
      "open file",
      "open a file",
      "edit file",
      "go to file",
      "find file",
      "open document",
    ],
  },
  {
    actionId: "search",
    phrases: [
      "search for",
      "search",
      "find",
      "look for",
      "grep",
      "search codebase",
      "search code",
    ],
  },
  {
    actionId: "deploy",
    phrases: [
      "deploy",
      "deploy app",
      "deploy my app",
      "push to production",
      "ship it",
      "release",
      "deploy to staging",
      "deploy to prod",
    ],
  },
  {
    actionId: "new-session",
    phrases: [
      "new session",
      "start session",
      "create session",
      "begin session",
      "start a new session",
      "new agent session",
    ],
  },
  {
    actionId: "switch-project",
    phrases: [
      "switch project",
      "change project",
      "go to project",
      "open project",
      "select project",
    ],
  },
  {
    actionId: "toggle-theme",
    phrases: [
      "toggle theme",
      "switch theme",
      "dark mode",
      "light mode",
      "change theme",
      "toggle dark mode",
    ],
  },
  {
    actionId: "open-settings",
    phrases: [
      "open settings",
      "settings",
      "preferences",
      "configure",
      "configuration",
      "go to settings",
    ],
  },
  {
    actionId: "view-shortcuts",
    phrases: [
      "keyboard shortcuts",
      "shortcuts",
      "keybindings",
      "hotkeys",
      "show shortcuts",
      "view shortcuts",
    ],
  },
];

/**
 * Score an action against a natural-language query. Returns a relevance
 * score between 0 and 1, where 1 is a perfect phrase match. The scoring
 * considers exact phrase matches, partial matches, and keyword overlap.
 */
function phraseMatchScore(lower: string, action: CommandAction): number | null {
  const mapping = NL_PHRASE_MAP.find((m) => m.actionId === action.id);
  if (!mapping) {
    return null;
  }
  for (const phrase of mapping.phrases) {
    if (lower === phrase || lower.includes(phrase)) {
      return 1;
    }
    if (phrase.includes(lower)) {
      return 0.8;
    }
  }
  return null;
}

function keywordMatchScore(
  lower: string,
  action: CommandAction
): number | null {
  if (!action.keywords) {
    return null;
  }
  for (const kw of action.keywords) {
    if (lower.includes(kw.toLowerCase())) {
      return 0.6;
    }
  }
  return null;
}

function tokenOverlapScore(lower: string, action: CommandAction): number {
  const queryTokens = lower.split(WHITESPACE_RE);
  const labelTokens = action.label.toLowerCase().split(WHITESPACE_RE);
  const descTokens = (action.description ?? "")
    .toLowerCase()
    .split(WHITESPACE_RE);
  const allTargetTokens = new Set([...labelTokens, ...descTokens]);
  const matchCount = queryTokens.filter((t) => allTargetTokens.has(t)).length;
  if (matchCount > 0) {
    return (matchCount / queryTokens.length) * 0.4;
  }
  return 0;
}

function nlMatchScore(query: string, action: CommandAction): number {
  const lower = query.toLowerCase().trim();
  if (!lower) {
    return 0;
  }

  const phrase = phraseMatchScore(lower, action);
  if (phrase !== null) {
    return phrase;
  }

  const keyword = keywordMatchScore(lower, action);
  if (keyword !== null) {
    return keyword;
  }

  if (action.label.toLowerCase().includes(lower)) {
    return 0.5;
  }
  if (action.description?.toLowerCase().includes(lower)) {
    return 0.3;
  }

  return tokenOverlapScore(lower, action);
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
        keywords: ["change", "go to", "select", "project"],
        handler: () => {
          window.dispatchEvent(new CustomEvent("prometheus:switch-project"));
        },
      },
      {
        id: "new-session",
        label: "New Session",
        description: "Start a new agent session",
        group: "Create",
        keywords: ["begin", "create", "start", "session"],
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
        keywords: ["dark mode", "light mode", "theme"],
        handler: () => {
          setTheme(theme === "dark" ? "light" : "dark");
        },
      },
      {
        id: "open-settings",
        label: "Open Settings",
        group: "Navigation",
        keywords: ["preferences", "configure", "configuration"],
        handler: () => {
          window.dispatchEvent(new CustomEvent("prometheus:open-settings"));
        },
      },
      {
        id: "view-shortcuts",
        label: "View Keyboard Shortcuts",
        group: "Help",
        keywords: ["hotkeys", "keybindings", "shortcuts"],
        handler: () => {
          window.dispatchEvent(new CustomEvent("prometheus:show-shortcuts"));
        },
      },
      {
        id: "run-tests",
        label: "Run Tests",
        description: "Execute the project test suite",
        group: "Actions",
        keywords: ["test", "execute", "suite"],
        handler: () => {
          window.dispatchEvent(new CustomEvent("prometheus:run-tests"));
        },
      },
      {
        id: "open-file",
        label: "Open File",
        description: "Open a file by name",
        group: "Navigation",
        keywords: ["edit", "go to", "find file"],
        shortcut: "Cmd+P",
        handler: () => {
          window.dispatchEvent(new CustomEvent("prometheus:open-file"));
        },
      },
      {
        id: "search",
        label: "Search Codebase",
        description: "Search for text across files",
        group: "Navigation",
        keywords: ["grep", "find", "look for"],
        shortcut: "Cmd+Shift+F",
        handler: () => {
          window.dispatchEvent(new CustomEvent("prometheus:search"));
        },
      },
      {
        id: "deploy",
        label: "Deploy",
        description: "Deploy the project to a target environment",
        group: "Actions",
        keywords: ["ship", "release", "push", "production", "staging"],
        handler: () => {
          window.dispatchEvent(new CustomEvent("prometheus:deploy"));
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

    // Score each action using NL matching + substring matching
    const scored = actions
      .map((action) => {
        const nl = nlMatchScore(query, action);
        // Also check basic substring matching on label/description/group
        const substringMatch =
          action.label.toLowerCase().includes(lower) ||
          action.description?.toLowerCase().includes(lower) ||
          action.group.toLowerCase().includes(lower) ||
          action.keywords?.some((kw) => kw.toLowerCase().includes(lower));
        const score = Math.max(nl, substringMatch ? 0.2 : 0);
        return { action, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.map((entry) => entry.action);
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
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => {
          setCommandPaletteOpen(false);
          setQuery("");
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setCommandPaletteOpen(false);
            setQuery("");
          }
        }}
        role="presentation"
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
