"use client";

import { useNotificationStore } from "@/stores/notification.store";
import { NotificationItem } from "./notification-item";

interface NotificationDropdownProps {
  onClose?: () => void;
}

export function NotificationDropdown({
  onClose: _onClose,
}: NotificationDropdownProps) {
  const { notifications, markRead, markAllRead, removeNotification, clearAll } =
    useNotificationStore();

  const hasUnread = notifications.some((n) => !n.read);

  return (
    <div className="w-80 rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-zinc-800 border-b px-4 py-3">
        <span className="font-medium text-sm text-zinc-200">Notifications</span>
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
        </div>
      </div>

      {/* Notification list */}
      <div className="max-h-96 overflow-auto">
        {notifications.length === 0 ? (
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
            <span className="text-xs">No notifications</span>
          </div>
        ) : (
          <div className="space-y-0.5 p-1.5">
            {notifications.map((notification) => (
              <NotificationItem
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
  );
}
