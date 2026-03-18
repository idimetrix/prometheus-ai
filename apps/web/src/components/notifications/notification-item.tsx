"use client";

import type { Notification } from "@/stores/notification.store";

interface NotificationItemProps {
  notification: Notification;
  onMarkRead?: (id: string) => void;
  onRemove?: (id: string) => void;
}

const TYPE_CONFIG: Record<
  Notification["type"],
  { icon: React.ReactNode; color: string }
> = {
  info: {
    color: "text-blue-400",
    icon: (
      <svg
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        viewBox="0 0 24 24"
      >
        <path
          d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  success: {
    color: "text-green-400",
    icon: (
      <svg
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        viewBox="0 0 24 24"
      >
        <path
          d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  warning: {
    color: "text-yellow-400",
    icon: (
      <svg
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        viewBox="0 0 24 24"
      >
        <path
          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  error: {
    color: "text-red-400",
    icon: (
      <svg
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        viewBox="0 0 24 24"
      >
        <path
          d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
};

function timeAgo(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffSeconds = Math.floor((now - then) / 1000);

  if (diffSeconds < 60) {
    return "just now";
  }
  if (diffSeconds < 3600) {
    return `${Math.floor(diffSeconds / 60)}m ago`;
  }
  if (diffSeconds < 86_400) {
    return `${Math.floor(diffSeconds / 3600)}h ago`;
  }
  return `${Math.floor(diffSeconds / 86_400)}d ago`;
}

export function NotificationItem({
  notification,
  onMarkRead,
  onRemove,
}: NotificationItemProps) {
  const config = TYPE_CONFIG[notification.type];

  return (
    <div
      className={`flex gap-2.5 rounded-lg px-3 py-2.5 transition-colors ${
        notification.read ? "opacity-60" : "bg-zinc-800/30 hover:bg-zinc-800/50"
      }`}
      onClick={() => !notification.read && onMarkRead?.(notification.id)}
    >
      <div className={`mt-0.5 shrink-0 ${config.color}`}>{config.icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className="font-medium text-xs text-zinc-200">
            {notification.title}
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="text-[10px] text-zinc-600">
              {timeAgo(notification.timestamp)}
            </span>
            {!notification.read && (
              <div className="h-1.5 w-1.5 rounded-full bg-violet-500" />
            )}
          </div>
        </div>
        <div className="mt-0.5 text-[11px] text-zinc-400 leading-relaxed">
          {notification.message}
        </div>
      </div>
      {onRemove && (
        <button
          className="shrink-0 self-start text-zinc-600 hover:text-zinc-400"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(notification.id);
          }}
        >
          <svg
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
        </button>
      )}
    </div>
  );
}
