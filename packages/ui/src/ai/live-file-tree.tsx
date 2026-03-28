"use client";

import { cn } from "../lib/utils";

type FileChangeStatus = "created" | "modified" | "deleted";

interface LiveFileEntry {
  path: string;
  status: FileChangeStatus;
  timestamp: number;
}

interface LiveFileTreeProps {
  className?: string;
  files: LiveFileEntry[];
}

const STATUS_CONFIG: Record<
  FileChangeStatus,
  { color: string; icon: string; label: string }
> = {
  created: { color: "text-green-500", icon: "+", label: "Created" },
  modified: { color: "text-yellow-500", icon: "~", label: "Modified" },
  deleted: { color: "text-red-500", icon: "-", label: "Deleted" },
};

export function LiveFileTree({ files, className }: LiveFileTreeProps) {
  const sortedFiles = [...files].sort((a, b) => b.timestamp - a.timestamp);

  return (
    <div className={cn("space-y-0.5 font-mono text-sm", className)}>
      {sortedFiles.length === 0 && (
        <div className="py-2 text-center text-muted-foreground text-xs">
          No file changes yet
        </div>
      )}
      {sortedFiles.map((file) => {
        const config = STATUS_CONFIG[file.status];
        const isRecent = Date.now() - file.timestamp < 3000;

        return (
          <div
            className={cn(
              "flex items-center gap-2 rounded px-2 py-0.5 transition-colors",
              isRecent && "bg-muted/50"
            )}
            key={`${file.path}-${file.timestamp}`}
          >
            <span
              className={cn("w-3 shrink-0 text-center font-bold", config.color)}
              title={config.label}
            >
              {config.icon}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                file.status === "deleted"
                  ? "text-muted-foreground line-through"
                  : "text-foreground"
              )}
            >
              {file.path}
            </span>
            <span className="shrink-0 text-muted-foreground text-xs">
              {formatTimestamp(file.timestamp)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function formatTimestamp(ts: number): string {
  const seconds = Math.round((Date.now() - ts) / 1000);
  if (seconds < 5) {
    return "just now";
  }
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  return `${Math.floor(minutes / 60)}h ago`;
}
