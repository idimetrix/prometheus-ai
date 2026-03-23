"use client";

import { useMemo, useState } from "react";

export interface MemoryEntry {
  content: string;
  id: string;
  metadata?: Record<string, unknown>;
  timestamp?: string;
}

type MemoryLayer =
  | "semantic"
  | "episodic"
  | "procedural"
  | "working"
  | "conventions";

const TABS: Array<{ id: MemoryLayer; label: string }> = [
  { id: "semantic", label: "Semantic" },
  { id: "episodic", label: "Episodic" },
  { id: "procedural", label: "Procedural" },
  { id: "working", label: "Working" },
  { id: "conventions", label: "Conventions" },
];

const TAB_COLORS: Record<MemoryLayer, string> = {
  semantic: "border-violet-500 text-violet-400",
  episodic: "border-blue-500 text-blue-400",
  procedural: "border-green-500 text-green-400",
  working: "border-amber-500 text-amber-400",
  conventions: "border-cyan-500 text-cyan-400",
};

interface MemoryExplorerProps {
  entries: Record<MemoryLayer, MemoryEntry[]>;
}

export function MemoryExplorer({ entries }: MemoryExplorerProps) {
  const [activeTab, setActiveTab] = useState<MemoryLayer>("semantic");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredEntries = useMemo(() => {
    const layerEntries = entries[activeTab] ?? [];
    if (!searchQuery.trim()) {
      return layerEntries;
    }
    const query = searchQuery.toLowerCase();
    return layerEntries.filter((entry) =>
      entry.content.toLowerCase().includes(query)
    );
  }, [entries, activeTab, searchQuery]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-zinc-800 border-b px-3 py-2">
        <h3 className="font-medium text-xs text-zinc-400 uppercase tracking-wider">
          Memory Explorer
        </h3>
      </div>

      {/* Tabs */}
      <div className="flex border-zinc-800 border-b">
        {TABS.map((tab) => (
          <button
            className={`flex-1 px-2 py-1.5 text-[11px] transition-colors ${
              activeTab === tab.id
                ? `border-b-2 ${TAB_COLORS[tab.id]}`
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="border-zinc-800 border-b px-3 py-2">
        <input
          className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 placeholder-zinc-600 outline-none focus:border-violet-500/50"
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search memories..."
          type="text"
          value={searchQuery}
        />
      </div>

      {/* Entry list */}
      <div className="flex-1 overflow-y-auto p-2">
        {filteredEntries.length === 0 ? (
          <div className="py-4 text-center text-xs text-zinc-600">
            {searchQuery ? "No matching memories" : "No memories in this layer"}
          </div>
        ) : (
          <div className="space-y-1">
            {filteredEntries.map((entry) => (
              <div
                className="rounded-md border border-zinc-800 bg-zinc-900/50 p-2"
                key={entry.id}
              >
                {entry.timestamp && (
                  <span className="text-[10px] text-zinc-600">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                )}
                <div className="mt-0.5 text-xs text-zinc-300">
                  {entry.content}
                </div>
                {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {Object.entries(entry.metadata).map(([key, value]) => (
                      <span
                        className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500"
                        key={key}
                      >
                        {key}: {String(value)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-zinc-800 border-t px-3 py-1.5 text-[10px] text-zinc-600">
        {filteredEntries.length} entries
        {searchQuery && ` (filtered from ${(entries[activeTab] ?? []).length})`}
      </div>
    </div>
  );
}
