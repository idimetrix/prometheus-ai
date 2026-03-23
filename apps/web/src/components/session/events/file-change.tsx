"use client";

import type { SessionEvent } from "@/stores/session.store";

interface FileChangeProps {
  event: SessionEvent;
}

const CHANGE_TYPE_CONFIG: Record<
  string,
  { bg: string; text: string; label: string }
> = {
  created: { bg: "bg-green-500/10", text: "text-green-400", label: "Created" },
  modified: {
    bg: "bg-yellow-500/10",
    text: "text-yellow-400",
    label: "Modified",
  },
  deleted: { bg: "bg-red-500/10", text: "text-red-400", label: "Deleted" },
  read: { bg: "bg-blue-500/10", text: "text-blue-400", label: "Read" },
  renamed: {
    bg: "bg-violet-500/10",
    text: "text-violet-400",
    label: "Renamed",
  },
};

export function FileChange({ event }: FileChangeProps) {
  const filePath =
    (event.data.filePath as string) ?? (event.data.path as string) ?? "";
  const changeType =
    (event.data.changeType as string) ??
    (event.data.status as string) ??
    "modified";
  const config = (CHANGE_TYPE_CONFIG[changeType] ??
    CHANGE_TYPE_CONFIG.modified) as NonNullable<
    (typeof CHANGE_TYPE_CONFIG)[string]
  >;

  const fileName = filePath.split("/").pop() ?? filePath;
  const dirPath = filePath.split("/").slice(0, -1).join("/");

  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
      <svg
        aria-hidden="true"
        className="h-4 w-4 shrink-0 text-zinc-500"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        viewBox="0 0 24 24"
      >
        <path
          d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-xs text-zinc-200">
            {fileName}
          </span>
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 font-medium text-[10px] ${config.bg} ${config.text}`}
          >
            {config.label}
          </span>
        </div>
        {dirPath && (
          <div className="truncate font-mono text-[10px] text-zinc-600">
            {dirPath}
          </div>
        )}
      </div>
      {event.timestamp && (
        <span className="shrink-0 text-[10px] text-zinc-600">
          {new Date(event.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      )}
    </div>
  );
}
