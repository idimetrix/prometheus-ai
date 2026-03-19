"use client";

import { useMemo } from "react";
import { useSessionStore } from "@/stores/session.store";

const ROLE_COLORS: Record<string, string> = {
  architect: "bg-violet-500/20 text-violet-400",
  "backend-coder": "bg-blue-500/20 text-blue-400",
  "frontend-coder": "bg-cyan-500/20 text-cyan-400",
  "test-engineer": "bg-green-500/20 text-green-400",
  "security-auditor": "bg-red-500/20 text-red-400",
  discovery: "bg-amber-500/20 text-amber-400",
  "ci-loop": "bg-orange-500/20 text-orange-400",
};

const OP_COLORS: Record<string, string> = {
  create: "bg-green-500/20 text-green-400",
  modify: "bg-blue-500/20 text-blue-400",
  delete: "bg-red-500/20 text-red-400",
};

interface FileChange {
  id: string;
  operation: string;
  path: string;
  role?: string;
  timestamp: string;
}

export function FileTimeline() {
  const events = useSessionStore((s) => s.events);

  const fileChanges = useMemo(() => {
    const changes: FileChange[] = [];

    for (const event of events) {
      if (
        event.type === "file_change" ||
        event.type === "file_diff" ||
        event.type === "code_change"
      ) {
        let path: string | undefined;
        if (typeof event.data.path === "string") {
          path = event.data.path;
        } else if (
          typeof event.data.file === "object" &&
          event.data.file !== null &&
          "path" in (event.data.file as Record<string, unknown>)
        ) {
          path = String((event.data.file as Record<string, unknown>).path);
        }

        if (!path) {
          continue;
        }

        let operation = "create";
        if (typeof event.data.operation === "string") {
          operation = event.data.operation;
        } else if (event.type === "code_change") {
          operation = "modify";
        }

        const role =
          typeof event.data.role === "string" ? event.data.role : undefined;

        changes.push({
          id: event.id,
          timestamp: event.timestamp,
          path,
          operation,
          role,
        });
      }
    }

    return changes;
  }, [events]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-zinc-800 border-b px-3 py-2">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-xs text-zinc-400 uppercase tracking-wider">
            File Timeline
          </h3>
          <span className="text-[10px] text-zinc-600">
            {fileChanges.length} changes
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {fileChanges.length === 0 ? (
          <div className="py-4 text-center text-xs text-zinc-600">
            No file changes yet
          </div>
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute top-0 bottom-0 left-6 w-px bg-zinc-800" />

            <div className="space-y-0.5 p-2">
              {fileChanges
                .slice()
                .reverse()
                .map((change) => (
                  <div
                    className="relative flex items-start gap-3 py-1.5 pl-4"
                    key={change.id}
                  >
                    {/* Timeline dot */}
                    <div className="absolute top-3 left-[19px] z-10 h-2 w-2 rounded-full bg-zinc-600 ring-2 ring-zinc-950" />

                    <div className="ml-6 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-zinc-600">
                          {new Date(change.timestamp).toLocaleTimeString()}
                        </span>
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 font-medium text-[10px] ${
                            OP_COLORS[change.operation] ??
                            "bg-zinc-500/20 text-zinc-400"
                          }`}
                        >
                          {change.operation}
                        </span>
                        {change.role && (
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 font-medium text-[10px] ${
                              ROLE_COLORS[change.role] ??
                              "bg-zinc-500/20 text-zinc-400"
                            }`}
                          >
                            {change.role}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 font-mono text-xs text-zinc-400">
                        {change.path}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
