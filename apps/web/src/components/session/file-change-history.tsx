"use client";

import { Badge, Card, ScrollArea } from "@prometheus/ui";
import { FileEdit, FileMinus, FilePlus } from "lucide-react";
import { useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FileOperation = "create" | "modify" | "delete";

interface FileChange {
  additions: number;
  deletions: number;
  filePath: string;
  id: string;
  operation: FileOperation;
  stepNumber: number;
  timestamp: string;
}

interface FileChangeHistoryProps {
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPERATION_CONFIG: Record<
  FileOperation,
  { color: string; icon: typeof FilePlus; label: string }
> = {
  create: {
    label: "Created",
    color: "bg-green-500/20 text-green-400",
    icon: FilePlus,
  },
  modify: {
    label: "Modified",
    color: "bg-yellow-500/20 text-yellow-400",
    icon: FileEdit,
  },
  delete: {
    label: "Deleted",
    color: "bg-red-500/20 text-red-400",
    icon: FileMinus,
  },
};

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_CHANGES: FileChange[] = [
  {
    id: "fc_001",
    stepNumber: 1,
    filePath: "src/components/Button.tsx",
    operation: "create",
    additions: 42,
    deletions: 0,
    timestamp: "2026-03-26T10:01:00Z",
  },
  {
    id: "fc_002",
    stepNumber: 2,
    filePath: "src/styles/globals.css",
    operation: "modify",
    additions: 12,
    deletions: 3,
    timestamp: "2026-03-26T10:01:45Z",
  },
  {
    id: "fc_003",
    stepNumber: 3,
    filePath: "src/utils/helpers.ts",
    operation: "modify",
    additions: 8,
    deletions: 15,
    timestamp: "2026-03-26T10:02:30Z",
  },
  {
    id: "fc_004",
    stepNumber: 3,
    filePath: "src/utils/deprecated.ts",
    operation: "delete",
    additions: 0,
    deletions: 67,
    timestamp: "2026-03-26T10:02:31Z",
  },
  {
    id: "fc_005",
    stepNumber: 4,
    filePath: "src/components/Button.test.tsx",
    operation: "create",
    additions: 58,
    deletions: 0,
    timestamp: "2026-03-26T10:03:15Z",
  },
  {
    id: "fc_006",
    stepNumber: 5,
    filePath: "src/components/index.ts",
    operation: "modify",
    additions: 1,
    deletions: 0,
    timestamp: "2026-03-26T10:03:45Z",
  },
  {
    id: "fc_007",
    stepNumber: 6,
    filePath: "package.json",
    operation: "modify",
    additions: 2,
    deletions: 1,
    timestamp: "2026-03-26T10:04:00Z",
  },
  {
    id: "fc_008",
    stepNumber: 7,
    filePath: "src/components/Card.tsx",
    operation: "create",
    additions: 35,
    deletions: 0,
    timestamp: "2026-03-26T10:05:00Z",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getFileName(path: string): string {
  return path.split("/").pop() ?? path;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FileChangeHistory({ sessionId }: FileChangeHistoryProps) {
  const [filterOp, setFilterOp] = useState<FileOperation | "all">("all");

  const filteredChanges = useMemo(() => {
    if (filterOp === "all") {
      return MOCK_CHANGES;
    }
    return MOCK_CHANGES.filter((c) => c.operation === filterOp);
  }, [filterOp]);

  const stepGroups = useMemo(() => {
    const groups = new Map<number, FileChange[]>();
    for (const change of filteredChanges) {
      const existing = groups.get(change.stepNumber);
      if (existing) {
        existing.push(change);
      } else {
        groups.set(change.stepNumber, [change]);
      }
    }
    return groups;
  }, [filteredChanges]);

  const totalStats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const change of MOCK_CHANGES) {
      additions += change.additions;
      deletions += change.deletions;
    }
    return { additions, deletions, files: MOCK_CHANGES.length };
  }, []);

  const filterOptions: Array<{ label: string; value: FileOperation | "all" }> =
    [
      { value: "all", label: "All" },
      { value: "create", label: "Created" },
      { value: "modify", label: "Modified" },
      { value: "delete", label: "Deleted" },
    ];

  return (
    <Card className="flex flex-col border-zinc-800 bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between border-zinc-800 border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <h3 className="font-medium text-sm text-zinc-200">File Changes</h3>
          <span
            className="text-xs text-zinc-500"
            title={`Session: ${sessionId}`}
          >
            {totalStats.files} files
          </span>
          <span className="font-mono text-green-400 text-xs">
            +{totalStats.additions}
          </span>
          <span className="font-mono text-red-400 text-xs">
            -{totalStats.deletions}
          </span>
        </div>

        {/* Filter buttons */}
        <div className="flex items-center gap-1">
          {filterOptions.map((opt) => (
            <button
              className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                filterOp === opt.value
                  ? "bg-violet-500/20 font-medium text-violet-400"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
              key={opt.value}
              onClick={() => setFilterOp(opt.value)}
              type="button"
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          {filteredChanges.length === 0 ? (
            <div className="py-8 text-center text-sm text-zinc-600">
              No file changes match the current filter
            </div>
          ) : (
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute top-0 bottom-0 left-4 w-px bg-zinc-800" />

              {[...stepGroups.entries()].map(([step, changes]) => (
                <div className="relative mb-4 last:mb-0" key={step}>
                  {/* Step marker */}
                  <div className="relative mb-2 flex items-center gap-3">
                    <div className="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 font-mono text-xs text-zinc-300">
                      {step}
                    </div>
                    <span className="text-xs text-zinc-500">Step {step}</span>
                  </div>

                  {/* Changes in this step */}
                  <div className="ml-12 space-y-1.5">
                    {changes.map((change) => {
                      const opConfig = OPERATION_CONFIG[change.operation];
                      const Icon = opConfig.icon;

                      return (
                        <div
                          className="flex items-center gap-2 rounded-md border border-zinc-800/50 bg-zinc-900/50 px-3 py-2 transition-colors hover:border-zinc-700"
                          key={change.id}
                        >
                          <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-500" />

                          <span
                            className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-300"
                            title={change.filePath}
                          >
                            {getFileName(change.filePath)}
                          </span>

                          <Badge className={opConfig.color} variant="secondary">
                            {opConfig.label}
                          </Badge>

                          {change.additions > 0 && (
                            <span className="font-mono text-[10px] text-green-500">
                              +{change.additions}
                            </span>
                          )}
                          {change.deletions > 0 && (
                            <span className="font-mono text-[10px] text-red-500">
                              -{change.deletions}
                            </span>
                          )}

                          <span className="shrink-0 text-[10px] text-zinc-600">
                            {formatTime(change.timestamp)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </Card>
  );
}
