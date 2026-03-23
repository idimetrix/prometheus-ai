"use client";
import { create } from "zustand";

export interface Notification {
  id: string;
  message: string;
  read: boolean;
  timestamp: string;
  title: string;
  type: "info" | "success" | "warning" | "error";
}

export interface RecentProject {
  id: string;
  name: string;
  status: string;
  updatedAt: string;
}

export interface RecentSession {
  id: string;
  mode: string;
  projectName: string;
  startedAt: string;
  status: string;
}

interface DashboardState {
  activeAgents: number;
  activeSessions: Array<{
    id: string;
    status: string;
    projectName: string;
    mode: string;
    startedAt: string;
  }>;
  addActivity: (activity: DashboardState["recentActivity"][0]) => void;
  addNotification: (notification: Omit<Notification, "read">) => void;
  addRecentProject: (project: RecentProject) => void;
  addRecentSession: (session: RecentSession) => void;
  clearNotifications: () => void;
  creditBalance: number;
  markNotificationRead: (id: string) => void;
  notifications: Notification[];
  projectCount: number;
  recentActivity: Array<{
    id: string;
    type: string;
    message: string;
    timestamp: string;
  }>;
  recentProjects: RecentProject[];
  recentSessions: RecentSession[];
  refresh: () => void;
  setActiveSessions: (sessions: DashboardState["activeSessions"]) => void;
  setRecentProjects: (projects: RecentProject[]) => void;
  setRecentSessions: (sessions: RecentSession[]) => void;

  setStats: (stats: Partial<DashboardState>) => void;
  tasksToday: number;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  activeAgents: 0,
  creditBalance: 50,
  projectCount: 0,
  tasksToday: 0,
  activeSessions: [],
  recentActivity: [],
  notifications: [],
  recentProjects: [],
  recentSessions: [],

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
        n.id === id ? { ...n, read: true } : n
      ),
    })),

  clearNotifications: () => set({ notifications: [] }),

  setRecentProjects: (projects) => set({ recentProjects: projects }),

  addRecentProject: (project) =>
    set((state) => {
      const filtered = state.recentProjects.filter((p) => p.id !== project.id);
      return { recentProjects: [project, ...filtered].slice(0, 10) };
    }),

  setRecentSessions: (sessions) => set({ recentSessions: sessions }),

  addRecentSession: (session) =>
    set((state) => {
      const filtered = state.recentSessions.filter((s) => s.id !== session.id);
      return { recentSessions: [session, ...filtered].slice(0, 10) };
    }),

  refresh: () => {
    // Trigger a refresh -- consumers should refetch queries
  },
}));
