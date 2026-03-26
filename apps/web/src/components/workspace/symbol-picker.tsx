"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const _WHITESPACE_RE = /\s+/;

type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "variable"
  | "export";

interface SymbolEntry {
  /** Column offset within the line (1-based) */
  column: number;
  /** Containing file path relative to the workspace root */
  filePath: string;
  /** Kind of symbol */
  kind: SymbolKind;
  /** Line number in the file (1-based) */
  line: number;
  /** Symbol name */
  name: string;
}

/** Group label ordering */
const GROUP_ORDER: SymbolKind[] = [
  "function",
  "class",
  "interface",
  "type",
  "variable",
  "export",
];

const GROUP_LABELS: Record<SymbolKind, string> = {
  function: "Functions",
  class: "Classes",
  interface: "Interfaces",
  type: "Types",
  variable: "Variables",
  export: "Exports",
};

/** SVG path data for each symbol kind icon */
function SymbolIcon({ kind }: { kind: SymbolKind }) {
  const colors: Record<SymbolKind, string> = {
    function: "text-purple-400",
    class: "text-amber-400",
    interface: "text-blue-400",
    type: "text-teal-400",
    variable: "text-orange-400",
    export: "text-green-400",
  };

  const labels: Record<SymbolKind, string> = {
    function: "f",
    class: "C",
    interface: "I",
    type: "T",
    variable: "v",
    export: "E",
  };

  return (
    <span
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded font-bold text-[11px] ${colors[kind]} bg-zinc-800`}
    >
      {labels[kind]}
    </span>
  );
}

/** Simple fuzzy match: every character in the pattern appears in order in the target */
function fuzzyMatch(pattern: string, target: string): boolean {
  const lowerPattern = pattern.toLowerCase();
  const lowerTarget = target.toLowerCase();
  let pi = 0;
  for (let ti = 0; ti < lowerTarget.length && pi < lowerPattern.length; ti++) {
    if (lowerTarget[ti] === lowerPattern[pi]) {
      pi++;
    }
  }
  return pi === lowerPattern.length;
}

/** Score a fuzzy match — higher is better */
function fuzzyScore(pattern: string, target: string): number {
  const lowerPattern = pattern.toLowerCase();
  const lowerTarget = target.toLowerCase();

  // Exact prefix match gets highest score
  if (lowerTarget.startsWith(lowerPattern)) {
    return 100;
  }

  // Exact substring match
  if (lowerTarget.includes(lowerPattern)) {
    return 80;
  }

  // Fuzzy character match — score by consecutive sequences
  let score = 0;
  let pi = 0;
  let consecutive = 0;
  for (let ti = 0; ti < lowerTarget.length && pi < lowerPattern.length; ti++) {
    if (lowerTarget[ti] === lowerPattern[pi]) {
      consecutive++;
      score += consecutive * 10;
      pi++;
    } else {
      consecutive = 0;
    }
  }
  return pi === lowerPattern.length ? score : 0;
}

interface SymbolPickerProps {
  /** "file" for file symbols (Cmd+Shift+O), "workspace" for workspace-wide (Cmd+T) */
  mode: "file" | "workspace";
  /** Called to close the picker */
  onClose: () => void;
  /** Called when the user selects a symbol */
  onNavigate: (filePath: string, line: number, column: number) => void;
  /** Whether the picker is open */
  open: boolean;
  /** Symbols to display — fetched from the code-intelligence backend */
  symbols: SymbolEntry[];
}

export function SymbolPicker({
  mode,
  onNavigate,
  onClose,
  symbols,
  open,
}: SymbolPickerProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Filter and sort symbols by fuzzy match
  const filtered = useMemo(() => {
    if (!query.trim()) {
      return symbols;
    }
    return symbols
      .map((sym) => ({ sym, score: fuzzyScore(query, sym.name) }))
      .filter((entry) => entry.score > 0 || fuzzyMatch(query, entry.sym.name))
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.sym);
  }, [symbols, query]);

  // Group by kind
  const grouped = useMemo(() => {
    const groups: Partial<Record<SymbolKind, SymbolEntry[]>> = {};
    for (const sym of filtered) {
      if (!groups[sym.kind]) {
        groups[sym.kind] = [];
      }
      groups[sym.kind]?.push(sym);
    }
    return groups;
  }, [filtered]);

  // Flat list for keyboard navigation
  const flatList = useMemo(() => {
    const list: SymbolEntry[] = [];
    for (const kind of GROUP_ORDER) {
      const items = grouped[kind];
      if (items) {
        list.push(...items);
      }
    }
    return list;
  }, [grouped]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(
      `[data-index="${selectedIndex}"]`
    );
    if (el) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const executeNavigate = useCallback(
    (sym: SymbolEntry) => {
      onClose();
      onNavigate(sym.filePath, sym.line, sym.column);
    },
    [onClose, onNavigate]
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
      executeNavigate(flatList[selectedIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  // Reset index on query change
  useEffect(() => {
    setSelectedIndex(0);
  }, []);

  if (!open) {
    return null;
  }

  let globalIndex = 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
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

      <div className="relative w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl">
        {/* Search header */}
        <div className="flex items-center gap-3 border-zinc-800 border-b px-4 py-3">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-violet-500/20 font-bold text-[10px] text-violet-400">
            @
          </span>
          <input
            autoFocus
            className="flex-1 bg-transparent text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              mode === "file"
                ? "Go to symbol in file..."
                : "Go to symbol in workspace..."
            }
            ref={inputRef}
            value={query}
          />
          <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
            ESC
          </kbd>
        </div>

        {/* Symbol list */}
        <div className="max-h-80 overflow-auto p-2" ref={listRef}>
          {flatList.length === 0 ? (
            <div className="py-6 text-center text-sm text-zinc-600">
              No matching symbols
            </div>
          ) : (
            GROUP_ORDER.map((kind) => {
              const items = grouped[kind];
              if (!items || items.length === 0) {
                return null;
              }
              return (
                <div className="mb-2" key={kind}>
                  <div className="px-2 py-1 font-medium text-[10px] text-zinc-600 uppercase tracking-wider">
                    {GROUP_LABELS[kind]}
                  </div>
                  {items.map((sym) => {
                    const idx = globalIndex++;
                    const isSelected = idx === selectedIndex;
                    return (
                      <button
                        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                          isSelected
                            ? "bg-violet-500/10 text-zinc-200"
                            : "text-zinc-400 hover:bg-zinc-800/50"
                        }`}
                        data-index={idx}
                        key={`${sym.filePath}:${sym.name}:${sym.line}`}
                        onClick={() => executeNavigate(sym)}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        type="button"
                      >
                        <SymbolIcon kind={sym.kind} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm">{sym.name}</div>
                        </div>
                        <div className="shrink-0 text-[11px] text-zinc-600">
                          {sym.filePath}:{sym.line}
                        </div>
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
            Go to symbol
          </span>
          <span>
            <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5">
              Esc
            </kbd>{" "}
            Close
          </span>
          <span className="ml-auto text-zinc-700">
            {mode === "file" ? "File Symbols" : "Workspace Symbols"}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Hook to manage symbol picker state and keyboard shortcuts */
export function useSymbolPicker() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"file" | "workspace">("file");

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+Shift+O — file symbols
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "o") {
        e.preventDefault();
        setMode("file");
        setOpen(true);
      }
      // Cmd+T — workspace symbols
      if ((e.metaKey || e.ctrlKey) && e.key === "t") {
        e.preventDefault();
        setMode("workspace");
        setOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return {
    open,
    mode,
    close: () => setOpen(false),
    openFile: () => {
      setMode("file");
      setOpen(true);
    },
    openWorkspace: () => {
      setMode("workspace");
      setOpen(true);
    },
  };
}
