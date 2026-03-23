"use client";

import type { SessionEvent } from "@/stores/session.store";

interface TaskStatusProps {
  event: SessionEvent;
}

const STATUS_CONFIG: Record<
  string,
  { bg: string; text: string; icon: string }
> = {
  queued: { bg: "bg-zinc-500/10", text: "text-zinc-400", icon: "clock" },
  running: { bg: "bg-blue-500/10", text: "text-blue-400", icon: "play" },
  active: { bg: "bg-green-500/10", text: "text-green-400", icon: "play" },
  paused: { bg: "bg-yellow-500/10", text: "text-yellow-400", icon: "pause" },
  completed: { bg: "bg-green-500/10", text: "text-green-400", icon: "check" },
  failed: { bg: "bg-red-500/10", text: "text-red-400", icon: "x" },
  cancelled: { bg: "bg-zinc-500/10", text: "text-zinc-500", icon: "stop" },
};

function StatusIcon({ icon }: { icon: string }) {
  switch (icon) {
    case "check":
      return (
        <svg
          aria-hidden="true"
          className="h-3 w-3"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            d="m4.5 12.75 6 6 9-13.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "x":
      return (
        <svg
          aria-hidden="true"
          className="h-3 w-3"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            d="M6 18 18 6M6 6l12 12"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "play":
      return (
        <svg
          aria-hidden="true"
          className="h-3 w-3"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "pause":
      return (
        <svg
          aria-hidden="true"
          className="h-3 w-3"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            d="M15.75 5.25v13.5m-7.5-13.5v13.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "stop":
      return (
        <svg
          aria-hidden="true"
          className="h-3 w-3"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            d="M5.25 7.5A2.25 2.25 0 0 1 7.5 5.25h9a2.25 2.25 0 0 1 2.25 2.25v9a2.25 2.25 0 0 1-2.25 2.25h-9a2.25 2.25 0 0 1-2.25-2.25v-9Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    default: // clock
      return (
        <svg
          aria-hidden="true"
          className="h-3 w-3"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
  }
}

export function TaskStatus({ event }: TaskStatusProps) {
  const status = (event.data.status as string) ?? "queued";
  const message = (event.data.message as string) ?? "";
  const config = (STATUS_CONFIG[status] ?? STATUS_CONFIG.queued) as NonNullable<
    (typeof STATUS_CONFIG)[string]
  >;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
      <div
        className={`flex h-6 w-6 items-center justify-center rounded-full ${config.bg} ${config.text}`}
      >
        <StatusIcon icon={config.icon} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-xs text-zinc-200">Task Status</span>
          <span
            className={`rounded-full px-2 py-0.5 font-medium text-[10px] ${config.bg} ${config.text}`}
          >
            {status}
          </span>
        </div>
        {message && (
          <div className="mt-0.5 text-[10px] text-zinc-500">{message}</div>
        )}
      </div>
      {event.timestamp && (
        <span className="shrink-0 text-[10px] text-zinc-600">
          {new Date(event.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </span>
      )}
    </div>
  );
}
