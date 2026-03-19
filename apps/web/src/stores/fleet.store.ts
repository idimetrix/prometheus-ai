"use client";

import { create } from "zustand";

export interface FleetAgent {
  filesChanged: string[];
  id: string;
  progress: number;
  role: string;
  status: "idle" | "working" | "completed" | "failed";
  taskId: string;
}

export interface FleetConflict {
  branch: string;
  files: string[];
  resolution?: string;
  taskId: string;
}

export interface FleetStats {
  active: number;
  completed: number;
  failed: number;
  total: number;
}

interface FleetState {
  addAgent: (agent: FleetAgent) => void;
  addConflict: (conflict: FleetConflict) => void;
  agents: Map<string, FleetAgent>;
  clearFleet: () => void;
  conflicts: FleetConflict[];
  removeAgent: (agentId: string) => void;
  resolveConflict: (taskId: string, resolution: string) => void;
  stats: FleetStats;
  updateAgent: (agentId: string, updates: Partial<FleetAgent>) => void;
}

function computeStats(agents: Map<string, FleetAgent>): FleetStats {
  let active = 0;
  let completed = 0;
  let failed = 0;

  for (const agent of agents.values()) {
    if (agent.status === "working") {
      active++;
    } else if (agent.status === "completed") {
      completed++;
    } else if (agent.status === "failed") {
      failed++;
    }
  }

  return { total: agents.size, active, completed, failed };
}

export const useFleetStore = create<FleetState>((set) => ({
  agents: new Map(),
  conflicts: [],
  stats: { total: 0, active: 0, completed: 0, failed: 0 },

  addAgent: (agent) =>
    set((state) => {
      const updated = new Map(state.agents);
      updated.set(agent.id, agent);
      return { agents: updated, stats: computeStats(updated) };
    }),

  updateAgent: (agentId, updates) =>
    set((state) => {
      const existing = state.agents.get(agentId);
      if (!existing) {
        return state;
      }
      const updated = new Map(state.agents);
      updated.set(agentId, { ...existing, ...updates });
      return { agents: updated, stats: computeStats(updated) };
    }),

  removeAgent: (agentId) =>
    set((state) => {
      const updated = new Map(state.agents);
      updated.delete(agentId);
      return { agents: updated, stats: computeStats(updated) };
    }),

  addConflict: (conflict) =>
    set((state) => ({
      conflicts: [...state.conflicts, conflict],
    })),

  resolveConflict: (taskId, resolution) =>
    set((state) => ({
      conflicts: state.conflicts.map((c) =>
        c.taskId === taskId ? { ...c, resolution } : c
      ),
    })),

  clearFleet: () =>
    set({
      agents: new Map(),
      conflicts: [],
      stats: { total: 0, active: 0, completed: 0, failed: 0 },
    }),
}));
