"use client";

import { create } from "zustand";

// ---------------------------------------------------------------------------
// Agent & conflict types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// MCTS decision tree visualization types
// ---------------------------------------------------------------------------

export interface DecisionNode {
  children: DecisionNode[];
  depth: number;
  id: string;
  label: string;
  parentId: string | null;
  score: number;
  selected: boolean;
  visits: number;
}

export interface DecisionTree {
  currentNodeId: string | null;
  nodes: DecisionNode[];
  rootId: string | null;
  totalSimulations: number;
}

// ---------------------------------------------------------------------------
// Credit / cost tracking types
// ---------------------------------------------------------------------------

export interface CreditBurnRate {
  currentBalance: number;
  estimatedDepletion: Date | null;
  history: Array<{ amount: number; timestamp: Date }>;
  ratePerMinute: number;
  totalSpent: number;
}

// ---------------------------------------------------------------------------
// Agent timeline types
// ---------------------------------------------------------------------------

export interface TimelineEntry {
  agentId: string;
  details?: string;
  duration?: number;
  event: "started" | "tool_call" | "output" | "error" | "completed" | "paused";
  id: string;
  timestamp: Date;
}

export interface AgentTimeline {
  agentId: string;
  entries: TimelineEntry[];
  role: string;
}

// ---------------------------------------------------------------------------
// Store state
// ---------------------------------------------------------------------------

interface FleetState {
  addAgent: (agent: FleetAgent) => void;
  addConflict: (conflict: FleetConflict) => void;
  addTimelineEntry: (agentId: string, entry: TimelineEntry) => void;
  agents: Map<string, FleetAgent>;
  agentTimelines: Map<string, AgentTimeline>;
  clearFleet: () => void;
  conflicts: FleetConflict[];
  creditBurnRate: CreditBurnRate;
  decisionTree: DecisionTree;
  recordCreditUsage: (amount: number) => void;
  removeAgent: (agentId: string) => void;
  resolveConflict: (taskId: string, resolution: string) => void;
  setCreditBalance: (balance: number) => void;
  stats: FleetStats;
  updateAgent: (agentId: string, updates: Partial<FleetAgent>) => void;
  updateDecisionTree: (update: Partial<DecisionTree>) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const MAX_BURN_HISTORY = 100;
const BURN_RATE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function computeBurnRate(history: CreditBurnRate["history"]): number {
  if (history.length < 2) {
    return 0;
  }

  const now = Date.now();
  const windowStart = now - BURN_RATE_WINDOW_MS;
  const recent = history.filter((h) => h.timestamp.getTime() >= windowStart);

  if (recent.length < 2) {
    return 0;
  }

  const totalAmount = recent.reduce((sum, h) => sum + h.amount, 0);
  const firstTimestamp = recent[0]?.timestamp.getTime() ?? now;
  const elapsed = (now - firstTimestamp) / 60_000; // minutes

  return elapsed > 0 ? totalAmount / elapsed : 0;
}

function estimateDepletion(
  balance: number,
  ratePerMinute: number
): Date | null {
  if (ratePerMinute <= 0 || balance <= 0) {
    return null;
  }
  const minutesRemaining = balance / ratePerMinute;
  return new Date(Date.now() + minutesRemaining * 60_000);
}

// ---------------------------------------------------------------------------
// Initial state values
// ---------------------------------------------------------------------------

const initialDecisionTree: DecisionTree = {
  currentNodeId: null,
  nodes: [],
  rootId: null,
  totalSimulations: 0,
};

const initialCreditBurnRate: CreditBurnRate = {
  currentBalance: 0,
  estimatedDepletion: null,
  history: [],
  ratePerMinute: 0,
  totalSpent: 0,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useFleetStore = create<FleetState>((set) => ({
  agents: new Map(),
  agentTimelines: new Map(),
  conflicts: [],
  creditBurnRate: initialCreditBurnRate,
  decisionTree: initialDecisionTree,
  stats: { total: 0, active: 0, completed: 0, failed: 0 },

  // -- Agent management -----------------------------------------------------

  addAgent: (agent) =>
    set((state) => {
      const updated = new Map(state.agents);
      updated.set(agent.id, agent);

      // Initialize timeline for new agent
      const timelines = new Map(state.agentTimelines);
      if (!timelines.has(agent.id)) {
        timelines.set(agent.id, {
          agentId: agent.id,
          role: agent.role,
          entries: [],
        });
      }

      return {
        agents: updated,
        agentTimelines: timelines,
        stats: computeStats(updated),
      };
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

  // -- Conflict management --------------------------------------------------

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

  // -- Decision tree (MCTS visualization) -----------------------------------

  updateDecisionTree: (update) =>
    set((state) => ({
      decisionTree: { ...state.decisionTree, ...update },
    })),

  // -- Credit burn rate tracking --------------------------------------------

  recordCreditUsage: (amount) =>
    set((state) => {
      const entry = { amount, timestamp: new Date() };
      const history = [...state.creditBurnRate.history, entry].slice(
        -MAX_BURN_HISTORY
      );
      const totalSpent = state.creditBurnRate.totalSpent + amount;
      const currentBalance = state.creditBurnRate.currentBalance - amount;
      const ratePerMinute = computeBurnRate(history);
      const estimatedDepletionDate = estimateDepletion(
        currentBalance,
        ratePerMinute
      );

      return {
        creditBurnRate: {
          currentBalance: Math.max(0, currentBalance),
          estimatedDepletion: estimatedDepletionDate,
          history,
          ratePerMinute,
          totalSpent,
        },
      };
    }),

  setCreditBalance: (balance) =>
    set((state) => ({
      creditBurnRate: {
        ...state.creditBurnRate,
        currentBalance: balance,
        estimatedDepletion: estimateDepletion(
          balance,
          state.creditBurnRate.ratePerMinute
        ),
      },
    })),

  // -- Agent timelines (chronological activity) -----------------------------

  addTimelineEntry: (agentId, entry) =>
    set((state) => {
      const timelines = new Map(state.agentTimelines);
      const existing = timelines.get(agentId);
      if (existing) {
        timelines.set(agentId, {
          ...existing,
          entries: [...existing.entries, entry].slice(-500),
        });
      } else {
        const agent = state.agents.get(agentId);
        timelines.set(agentId, {
          agentId,
          role: agent?.role ?? "unknown",
          entries: [entry],
        });
      }
      return { agentTimelines: timelines };
    }),

  // -- Reset ----------------------------------------------------------------

  clearFleet: () =>
    set({
      agents: new Map(),
      agentTimelines: new Map(),
      conflicts: [],
      creditBurnRate: initialCreditBurnRate,
      decisionTree: initialDecisionTree,
      stats: { total: 0, active: 0, completed: 0, failed: 0 },
    }),
}));
