"use client";

import { type FleetConflict, useFleetStore } from "@/stores/fleet.store";

interface ConflictCardProps {
  conflict: FleetConflict;
  onResolve: (taskId: string) => void;
}

function ConflictCard({ conflict, onResolve }: ConflictCardProps) {
  const isResolved = Boolean(conflict.resolution);

  return (
    <div
      className={`rounded-md border p-3 ${
        isResolved
          ? "border-green-500/20 bg-green-500/5"
          : "border-red-500/20 bg-red-500/5"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-zinc-300">
          {conflict.branch}
        </span>
        {isResolved ? (
          <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-[10px] text-green-400">
            Resolved
          </span>
        ) : (
          <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] text-red-400">
            Conflict
          </span>
        )}
      </div>

      <div className="mt-2 space-y-1">
        {conflict.files.map((file) => (
          <div className="text-[11px] text-zinc-500" key={file}>
            {file}
          </div>
        ))}
      </div>

      {/* Side-by-side diff display */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded border border-zinc-800 bg-zinc-950 p-2">
          <div className="mb-1 text-[10px] text-zinc-600 uppercase">Ours</div>
          <div className="font-mono text-[11px] text-green-400/70">
            {conflict.files.map((file) => (
              <div key={`ours-${file}`}>
                <span className="text-green-600">+</span> {file}
              </div>
            ))}
          </div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950 p-2">
          <div className="mb-1 text-[10px] text-zinc-600 uppercase">Theirs</div>
          <div className="font-mono text-[11px] text-red-400/70">
            {conflict.files.map((file) => (
              <div key={`theirs-${file}`}>
                <span className="text-red-600">~</span> {file}
              </div>
            ))}
          </div>
        </div>
      </div>

      {!isResolved && (
        <div className="mt-3 flex gap-2">
          <button
            className="rounded-md bg-violet-600/20 px-3 py-1 text-violet-400 text-xs transition-colors hover:bg-violet-600/30"
            onClick={() => onResolve(conflict.taskId)}
            type="button"
          >
            Resolve
          </button>
        </div>
      )}

      {isResolved && conflict.resolution && (
        <div className="mt-2 text-[11px] text-zinc-500">
          Resolution: {conflict.resolution}
        </div>
      )}
    </div>
  );
}

export function ConflictResolver() {
  const conflicts = useFleetStore((s) => s.conflicts);
  const resolveConflict = useFleetStore((s) => s.resolveConflict);

  const unresolvedCount = conflicts.filter((c) => !c.resolution).length;

  function handleResolve(taskId: string) {
    resolveConflict(taskId, "manual");
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-zinc-800 border-b px-3 py-2">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-xs text-zinc-400 uppercase tracking-wider">
            Merge Conflicts
          </h3>
          {unresolvedCount > 0 && (
            <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] text-red-400">
              {unresolvedCount} unresolved
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {conflicts.length === 0 ? (
          <div className="py-4 text-center text-xs text-zinc-600">
            No merge conflicts
          </div>
        ) : (
          <div className="space-y-2">
            {conflicts.map((conflict) => (
              <ConflictCard
                conflict={conflict}
                key={conflict.taskId}
                onResolve={handleResolve}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
