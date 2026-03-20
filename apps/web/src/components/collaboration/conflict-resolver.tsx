"use client";

import { useCallback, useState } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface ConflictItem {
  content: string;
  id: string;
  timestamp: number;
  userId: string;
  userName: string;
}

type ConflictResolution = "merge" | "override_mine" | "override_theirs";

interface ConflictResolverProps {
  className?: string;
  conflicts: ConflictItem[];
  localItem?: ConflictItem;
  onResolve: (resolution: ConflictResolution, conflictIds: string[]) => void;
}

/* -------------------------------------------------------------------------- */
/*  Conflict Entry                                                             */
/* -------------------------------------------------------------------------- */

function ConflictEntry({
  item,
  isLocal,
  selected,
  onSelect,
}: {
  isLocal: boolean;
  item: ConflictItem;
  onSelect: (id: string) => void;
  selected: boolean;
}) {
  return (
    <button
      className={`w-full rounded border p-3 text-left ${
        selected
          ? "border-blue-500 bg-blue-950/20"
          : "border-zinc-700 bg-zinc-900/40 hover:border-zinc-600"
      }`}
      onClick={() => onSelect(item.id)}
      type="button"
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-zinc-400">
          {item.userName}
          {isLocal && <span className="ml-1 text-zinc-600">(you)</span>}
        </span>
        <span className="text-[10px] text-zinc-600">
          {new Date(item.timestamp).toLocaleTimeString()}
        </span>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-zinc-300">
        {item.content}
      </pre>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function ConflictResolver({
  conflicts,
  localItem,
  onResolve,
  className = "",
}: ConflictResolverProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const handleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleMerge = useCallback(() => {
    onResolve("merge", [...selectedIds]);
  }, [onResolve, selectedIds]);

  const handleOverrideMine = useCallback(() => {
    onResolve(
      "override_mine",
      conflicts.map((c) => c.id)
    );
  }, [onResolve, conflicts]);

  const handleOverrideTheirs = useCallback(() => {
    onResolve(
      "override_theirs",
      conflicts.map((c) => c.id)
    );
  }, [onResolve, conflicts]);

  return (
    <div
      className={`rounded-lg border border-amber-900/40 bg-zinc-900/80 p-4 ${className}`}
    >
      {/* Header */}
      <div className="mb-3 flex items-center gap-2">
        <div className="h-2 w-2 rounded-full bg-amber-500" />
        <h3 className="font-semibold text-sm text-zinc-200">
          Conflict Detected
        </h3>
        <span className="text-xs text-zinc-500">
          {conflicts.length} conflicting change
          {conflicts.length > 1 ? "s" : ""}
        </span>
      </div>

      {/* Queue display */}
      <div className="mb-3 flex flex-col gap-2">
        {/* Local version */}
        {localItem && (
          <div>
            <span className="mb-1 block text-[10px] text-zinc-500 uppercase">
              Your version
            </span>
            <ConflictEntry
              isLocal
              item={localItem}
              onSelect={handleSelect}
              selected={selectedIds.has(localItem.id)}
            />
          </div>
        )}

        {/* Remote versions */}
        <div>
          <span className="mb-1 block text-[10px] text-zinc-500 uppercase">
            Incoming changes
          </span>
          <div className="flex flex-col gap-1">
            {conflicts.map((conflict) => (
              <ConflictEntry
                isLocal={false}
                item={conflict}
                key={conflict.id}
                onSelect={handleSelect}
                selected={selectedIds.has(conflict.id)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Resolution actions */}
      <div className="flex gap-2">
        <button
          className="flex-1 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 disabled:opacity-40"
          disabled={selectedIds.size === 0}
          onClick={handleMerge}
          type="button"
        >
          Merge Selected
        </button>
        <button
          className="rounded bg-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-600"
          onClick={handleOverrideMine}
          type="button"
        >
          Keep Mine
        </button>
        <button
          className="rounded bg-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-600"
          onClick={handleOverrideTheirs}
          type="button"
        >
          Keep Theirs
        </button>
      </div>
    </div>
  );
}

export type { ConflictItem, ConflictResolution, ConflictResolverProps };
