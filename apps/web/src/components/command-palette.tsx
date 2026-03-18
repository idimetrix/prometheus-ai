"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import type { JSX } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface PaletteAction {
  category: "navigate" | "create" | "search" | "action";
  description?: string;
  handler: () => void;
  icon?:
    | "navigate"
    | "create"
    | "search"
    | "settings"
    | "project"
    | "session"
    | "help";
  id: string;
  label: string;
  shortcut?: string;
}

const ICONS: Record<string, JSX.Element> = {
  navigate: (
    <svg
      aria-hidden="true"
      className="h-4 w-4 text-zinc-500"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  create: (
    <svg
      aria-hidden="true"
      className="h-4 w-4 text-green-500"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        d="M12 4.5v15m7.5-7.5h-15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  search: (
    <svg
      aria-hidden="true"
      className="h-4 w-4 text-blue-500"
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
  ),
  settings: (
    <svg
      aria-hidden="true"
      className="h-4 w-4 text-zinc-500"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  project: (
    <svg
      aria-hidden="true"
      className="h-4 w-4 text-violet-500"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  session: (
    <svg
      aria-hidden="true"
      className="h-4 w-4 text-amber-500"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  help: (
    <svg
      aria-hidden="true"
      className="h-4 w-4 text-zinc-500"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
};

const CATEGORY_ORDER = ["navigate", "create", "search", "action"] as const;
const CATEGORY_LABELS: Record<string, string> = {
  navigate: "Navigation",
  create: "Create",
  search: "Search",
  action: "Actions",
};

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Define available actions
  const actions = useMemo<PaletteAction[]>(
    () => [
      {
        id: "nav-dashboard",
        label: "Go to Dashboard",
        category: "navigate",
        icon: "navigate",
        handler: () => router.push("/dashboard"),
      },
      {
        id: "nav-projects",
        label: "Go to Projects",
        category: "navigate",
        icon: "project",
        handler: () => router.push("/dashboard/projects"),
      },
      {
        id: "nav-sessions",
        label: "Go to Sessions",
        category: "navigate",
        icon: "session",
        handler: () => router.push("/dashboard/sessions" as Route),
      },
      {
        id: "nav-settings",
        label: "Go to Settings",
        category: "navigate",
        icon: "settings",
        handler: () => router.push("/dashboard/settings"),
      },
      {
        id: "create-project",
        label: "New Project",
        description: "Create a new project",
        category: "create",
        icon: "create",
        handler: () => router.push("/dashboard/projects/new"),
      },
      {
        id: "create-task",
        label: "New Task",
        description: "Submit a new task",
        category: "create",
        icon: "create",
        handler: () => router.push("/new"),
      },
      {
        id: "search-code",
        label: "Search Code",
        description: "Search across project files",
        category: "search",
        icon: "search",
        handler: () => {
          window.dispatchEvent(new CustomEvent("prometheus:open-code-search"));
        },
      },
      {
        id: "action-shortcuts",
        label: "Keyboard Shortcuts",
        description: "View all keyboard shortcuts",
        category: "action",
        icon: "help",
        handler: () => {
          window.dispatchEvent(new CustomEvent("prometheus:show-shortcuts"));
        },
      },
    ],
    [router]
  );

  // Filter actions by query
  const filteredActions = useMemo(() => {
    if (!query.trim()) {
      return actions;
    }
    const lower = query.toLowerCase();
    return actions.filter(
      (a) =>
        a.label.toLowerCase().includes(lower) ||
        a.description?.toLowerCase().includes(lower) ||
        a.category.toLowerCase().includes(lower)
    );
  }, [actions, query]);

  // Group by category
  const groupedActions = useMemo(() => {
    const groups: Record<string, PaletteAction[]> = {};
    for (const action of filteredActions) {
      if (!groups[action.category]) {
        groups[action.category] = [];
      }
      groups[action.category]?.push(action);
    }
    return groups;
  }, [filteredActions]);

  // Flat list for keyboard nav
  const flatList = useMemo(() => {
    const list: PaletteAction[] = [];
    for (const cat of CATEGORY_ORDER) {
      if (groupedActions[cat]) {
        list.push(...groupedActions[cat]);
      }
    }
    return list;
  }, [groupedActions]);

  // Listen for open/close events
  useEffect(() => {
    const handlePalette = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.open === false) {
        setIsOpen(false);
      } else {
        setIsOpen(true);
        setQuery(detail?.filter ?? "");
        setSelectedIndex(0);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    };

    const handleClose = () => setIsOpen(false);

    window.addEventListener("prometheus:command-palette", handlePalette);
    window.addEventListener("prometheus:close-modal", handleClose);
    return () => {
      window.removeEventListener("prometheus:command-palette", handlePalette);
      window.removeEventListener("prometheus:close-modal", handleClose);
    };
  }, []);

  const executeAction = useCallback((action: PaletteAction) => {
    setIsOpen(false);
    setQuery("");
    action.handler();
  }, []);

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
      setIsOpen(false);
      setQuery("");
    }
  };

  // Reset index when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, []);

  if (!isOpen) {
    return null;
  }

  let globalIndex = 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-close */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop overlay */}
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: backdrop overlay */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => {
          setIsOpen(false);
          setQuery("");
        }}
      />

      {/* Palette */}
      <div className="relative w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl">
        {/* Search input */}
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
            placeholder="Type a command or search..."
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
            CATEGORY_ORDER.map((cat) => {
              const items = groupedActions[cat];
              if (!items || items.length === 0) {
                return null;
              }

              return (
                <div className="mb-2" key={cat}>
                  <div className="px-2 py-1 font-medium text-[10px] text-zinc-600 uppercase tracking-wider">
                    {CATEGORY_LABELS[cat]}
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
                        {action.icon && ICONS[action.icon]}
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
              );
            })
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
