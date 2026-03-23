"use client";
import { create } from "zustand";

export type NotificationType = "info" | "success" | "warning" | "error";

export interface Notification {
  actionUrl?: string;
  dismissible?: boolean;
  id: string;
  message: string;
  read: boolean;
  sessionId?: string;
  timestamp: string;
  title: string;
  type: NotificationType;
}

interface NotificationState {
  addNotification: (notification: Omit<Notification, "read">) => void;
  clearAll: () => void;
  dismiss: (id: string) => void;
  getUnread: () => Notification[];
  markAllRead: () => void;
  markRead: (id: string) => void;
  notifications: Notification[];
  removeNotification: (id: string) => void;
  unreadCount: number;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,

  addNotification: (notification) =>
    set((state) => {
      const newNotification: Notification = {
        ...notification,
        read: false,
        dismissible: notification.dismissible ?? true,
      };
      const notifications = [newNotification, ...state.notifications].slice(
        0,
        200
      );
      return {
        notifications,
        unreadCount: notifications.filter((n) => !n.read).length,
      };
    }),

  markRead: (id) =>
    set((state) => {
      const notifications = state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      );
      return {
        notifications,
        unreadCount: notifications.filter((n) => !n.read).length,
      };
    }),

  markAllRead: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    })),

  removeNotification: (id) =>
    set((state) => {
      const notifications = state.notifications.filter((n) => n.id !== id);
      return {
        notifications,
        unreadCount: notifications.filter((n) => !n.read).length,
      };
    }),

  dismiss: (id) =>
    set((state) => {
      const notifications = state.notifications.filter((n) => n.id !== id);
      return {
        notifications,
        unreadCount: notifications.filter((n) => !n.read).length,
      };
    }),

  clearAll: () => set({ notifications: [], unreadCount: 0 }),

  getUnread: () => get().notifications.filter((n) => !n.read),
}));
