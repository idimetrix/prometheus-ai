"use client";
import { create } from "zustand";

export interface Notification {
  id: string;
  type: "info" | "success" | "warning" | "error";
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
}

interface DashboardState {
  activeAgents: number;
  creditBalance: number;
  projectCount: number;
  tasksToday: number;
  activeSessions: Array<{
    id: string;
    status: string;
    projectName: string;
    mode: string;
    startedAt: string;
  }>;
  recentActivity: Array<{
    id: string;
    type: string;
    message: string;
    timestamp: string;
  }>;
  notifications: Notification[];

  setStats: (stats: Partial<DashboardState>) => void;
  addActivity: (activity: DashboardState["recentActivity"][0]) => void;
  setActiveSessions: (sessions: DashboardState["activeSessions"]) => void;
  addNotification: (notification: Omit<Notification, "read">) => void;
  markNotificationRead: (id: string) => void;
  clearNotifications: () => void;
  refresh: () => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  activeAgents: 0,
  creditBalance: 50,
  projectCount: 0,
  tasksToday: 0,
  activeSessions: [],
  recentActivity: [],
  notifications: [],

  setStats: (stats) => set(stats),

  addActivity: (activity) =>
    set((state) => ({
      recentActivity: [activity, ...state.recentActivity].slice(0, 50),
    })),

  setActiveSessions: (sessions) =>
    set({
      activeSessions: sessions,
      activeAgents: sessions.filter((s) => s.status === "active").length,
    }),

  addNotification: (notification) =>
    set((state) => ({
      notifications: [
        { ...notification, read: false },
        ...state.notifications,
      ].slice(0, 100),
    })),

  markNotificationRead: (id) =>
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n,
      ),
    })),

  clearNotifications: () => set({ notifications: [] }),

  refresh: () => {
    // Trigger a refresh -- consumers should refetch queries
  },
}));
