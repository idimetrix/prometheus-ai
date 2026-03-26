"use client";

import { useEffect, useRef, useState } from "react";
import type {
  Notification,
  NotificationType,
} from "@/stores/notification.store";
import { useNotificationStore } from "@/stores/notification.store";

/* -------------------------------------------------------------------------- */
/*  Notification category types (domain-specific)                              */
/* -------------------------------------------------------------------------- */

export type NotificationCategory =
  | "task_completed"
  | "task_failed"
  | "pr_created"
  | "pr_merged"
  | "mention"
  | "review_requested"
  | "deployment_complete"
  | "credit_warning";

interface NotificationCategoryConfig {
  bg: string;
  color: string;
  icon: React.ReactNode;
  label: string;
  mapToType: NotificationType;
}

const CATEGORY_CONFIG: Record<
  NotificationCategory,
  NotificationCategoryConfig
> = {
  task_completed: {
    label: "Task Completed",
    color: "text-green-400",
    bg: "bg-green-500/10",
    mapToType: "success",
    icon: (
      <svg
        aria-hidden="true"
        className="h-4 w-4"
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
  task_failed: {
    label: "Task Failed",
    color: "text-red-400",
    bg: "bg-red-500/10",
    mapToType: "error",
    icon: (
      <svg
        aria-hidden="true"
        className="h-4 w-4"
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
  pr_created: {
    label: "PR Created",
    color: "text-violet-400",
    bg: "bg-violet-500/10",
    mapToType: "info",
    icon: (
      <svg
        aria-hidden="true"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        viewBox="0 0 24 24"
      >
        <path
          d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  pr_merged: {
    label: "PR Merged",
    color: "text-purple-400",
    bg: "bg-purple-500/10",
    mapToType: "success",
    icon: (
      <svg
        aria-hidden="true"
        className="h-4 w-4"
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
  mention: {
    label: "Mention",
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    mapToType: "info",
    icon: (
      <svg
        aria-hidden="true"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        viewBox="0 0 24 24"
      >
        <path
          d="M16.5 12a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Zm0 0c0 1.657 1.007 3 2.25 3S21 13.657 21 12a9 9 0 1 0-2.636 6.364M16.5 12V8.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  review_requested: {
    label: "Review Requested",
    color: "text-yellow-400",
    bg: "bg-yellow-500/10",
    mapToType: "warning",
    icon: (
      <svg
        aria-hidden="true"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        viewBox="0 0 24 24"
      >
        <path
          d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  deployment_complete: {
    label: "Deployment Complete",
    color: "text-green-400",
    bg: "bg-green-500/10",
    mapToType: "success",
    icon: (
      <svg
        aria-hidden="true"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        viewBox="0 0 24 24"
      >
        <path
          d="M15.59 14.37a6 6 0 0 1-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 0 0 6.16-12.12A14.98 14.98 0 0 0 9.631 8.41m5.96 5.96a14.926 14.926 0 0 1-5.841 2.58m-.119-8.54a6 6 0 0 0-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 0 0-2.58 5.841m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 0 1-2.448-2.448 14.9 14.9 0 0 1 .06-.312m-2.24 2.39a4.493 4.493 0 0 0-1.757 4.306 4.493 4.493 0 0 0 4.306-1.758M16.5 9a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  credit_warning: {
    label: "Credit Warning",
    color: "text-orange-400",
    bg: "bg-orange-500/10",
    mapToType: "warning",
    icon: (
      <svg
        aria-hidden="true"
        className="h-4 w-4"
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
};

/* -------------------------------------------------------------------------- */
/*  Time formatting                                                            */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/*  Notification item (enhanced)                                               */
/* -------------------------------------------------------------------------- */

function NotificationCenterItem({
  notification,
  onMarkRead,
  onRemove,
}: {
  notification: Notification;
  onMarkRead: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const typeConfig = getCategoryFromNotification(notification);

  function handleClick() {
    if (!notification.read) {
      onMarkRead(notification.id);
    }
    // Navigate to relevant page if actionUrl is present
    if (notification.actionUrl && typeof window !== "undefined") {
      window.location.href = notification.actionUrl;
    }
  }

  return (
    <button
      className={`flex w-full gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
        notification.read
          ? "opacity-60 hover:opacity-80"
          : "bg-zinc-800/30 hover:bg-zinc-800/50"
      }`}
      onClick={handleClick}
      type="button"
    >
      {/* Icon */}
      <div
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${typeConfig.bg} ${typeConfig.color}`}
      >
        {typeConfig.icon}
      </div>

      {/* Content */}
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

      {/* Remove button */}
      <button
        className="shrink-0 self-start text-zinc-600 hover:text-zinc-400"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(notification.id);
        }}
        type="button"
      >
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
      </button>
    </button>
  );
}

/** Map a Notification to its category config for rendering */
function getCategoryFromNotification(
  notification: Notification
): NotificationCategoryConfig {
  // Try to match title to a known category
  const titleLower = notification.title.toLowerCase();
  for (const [_key, config] of Object.entries(CATEGORY_CONFIG)) {
    if (titleLower.includes(config.label.toLowerCase())) {
      return config;
    }
  }

  // Fallback based on notification type
  const fallbackMap: Record<NotificationType, NotificationCategoryConfig> = {
    success: CATEGORY_CONFIG.task_completed,
    error: CATEGORY_CONFIG.task_failed,
    warning: CATEGORY_CONFIG.credit_warning,
    info: CATEGORY_CONFIG.mention,
  };

  return fallbackMap[notification.type] ?? CATEGORY_CONFIG.mention;
}

/* -------------------------------------------------------------------------- */
/*  Filter tabs                                                                */
/* -------------------------------------------------------------------------- */

type FilterTab = "all" | "unread" | NotificationType;

const FILTER_TABS: { label: string; value: FilterTab }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "success", label: "Success" },
  { value: "error", label: "Errors" },
  { value: "warning", label: "Warnings" },
  { value: "info", label: "Info" },
];

/* -------------------------------------------------------------------------- */
/*  Main component                                                             */
/* -------------------------------------------------------------------------- */

export interface NotificationCenterProps {
  /** Callback to navigate to notification preferences */
  onOpenSettings?: () => void;
  /** WebSocket URL for real-time notification updates */
  wsUrl?: string;
}

export function NotificationCenter({
  wsUrl,
  onOpenSettings,
}: NotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<FilterTab>("all");
  const ref = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const {
    notifications,
    unreadCount,
    markRead,
    markAllRead,
    removeNotification,
    clearAll,
    addNotification,
  } = useNotificationStore();

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // WebSocket connection for real-time updates
  useEffect(() => {
    if (!wsUrl) {
      return;
    }

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.addEventListener("message", (event) => {
        try {
          const data = JSON.parse(event.data as string) as {
            type: string;
            payload: Omit<Notification, "read">;
          };
          if (data.type === "notification" && data.payload) {
            addNotification(data.payload);
          }
        } catch {
          // Ignore malformed messages
        }
      });

      ws.addEventListener("close", () => {
        wsRef.current = null;
      });
    } catch {
      // WebSocket not available
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [wsUrl, addNotification]);

  // Filter notifications
  const filteredNotifications = notifications.filter((n) => {
    if (filter === "all") {
      return true;
    }
    if (filter === "unread") {
      return !n.read;
    }
    return n.type === filter;
  });

  const hasUnread = unreadCount > 0;

  return (
    <div className="relative" ref={ref}>
      {/* Bell icon button */}
      <button
        className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
        onClick={() => setOpen(!open)}
        type="button"
      >
        <svg
          aria-hidden="true"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        {/* Unread count badge */}
        {hasUnread && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 font-bold text-[9px] text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute top-full right-0 z-50 mt-2 w-96 rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-zinc-800 border-b px-4 py-3">
            <span className="font-medium text-sm text-zinc-200">
              Notifications
            </span>
            <div className="flex items-center gap-2">
              {hasUnread && (
                <button
                  className="text-[10px] text-violet-400 hover:text-violet-300"
                  onClick={markAllRead}
                  type="button"
                >
                  Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  className="text-[10px] text-zinc-500 hover:text-zinc-400"
                  onClick={clearAll}
                  type="button"
                >
                  Clear
                </button>
              )}
              {onOpenSettings && (
                <button
                  className="text-[10px] text-zinc-500 hover:text-zinc-400"
                  onClick={onOpenSettings}
                  type="button"
                >
                  Settings
                </button>
              )}
            </div>
          </div>

          {/* Filter tabs */}
          <div className="flex items-center gap-0.5 overflow-x-auto border-zinc-800 border-b px-3 py-1.5">
            {FILTER_TABS.map((tab) => (
              <button
                className={`whitespace-nowrap rounded-md px-2 py-1 text-[10px] transition-colors ${
                  filter === tab.value
                    ? "bg-zinc-800 font-medium text-zinc-200"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
                key={tab.value}
                onClick={() => setFilter(tab.value)}
                type="button"
              >
                {tab.label}
                {tab.value === "unread" && hasUnread && (
                  <span className="ml-1 text-violet-400">({unreadCount})</span>
                )}
              </button>
            ))}
          </div>

          {/* Notification list */}
          <div className="max-h-96 overflow-auto">
            {filteredNotifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-zinc-600">
                <svg
                  aria-hidden="true"
                  className="mb-2 h-8 w-8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1}
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="text-xs">
                  {filter === "all"
                    ? "No notifications"
                    : `No ${filter === "unread" ? "unread" : filter} notifications`}
                </span>
              </div>
            ) : (
              <div className="space-y-0.5 p-1.5">
                {filteredNotifications.map((notification) => (
                  <NotificationCenterItem
                    key={notification.id}
                    notification={notification}
                    onMarkRead={markRead}
                    onRemove={removeNotification}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
