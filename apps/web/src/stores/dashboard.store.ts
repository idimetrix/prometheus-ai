"use client";
import { create } from "zustand";

interface DashboardState {
  activeAgents: number;
  creditBalance: number;
  projectCount: number;
  tasksToday: number;
  recentActivity: Array<{
    id: string;
    type: string;
    message: string;
    timestamp: string;
  }>;

  setStats: (stats: Partial<DashboardState>) => void;
  addActivity: (activity: DashboardState["recentActivity"][0]) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  activeAgents: 0,
  creditBalance: 50,
  projectCount: 0,
  tasksToday: 0,
  recentActivity: [],

  setStats: (stats) => set(stats),
  addActivity: (activity) =>
    set((state) => ({
      recentActivity: [activity, ...state.recentActivity].slice(0, 50),
    })),
}));
