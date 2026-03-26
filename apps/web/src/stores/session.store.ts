"use client";
import { create } from "zustand";

export interface SessionEvent {
  data: Record<string, unknown>;
  id: string;
  timestamp: string;
  type: string;
}

export interface PlanStep {
  description?: string;
  id: string;
  status: string;
  title: string;
}

export interface FileEntry {
  children?: FileEntry[];
  name: string;
  path: string;
  status?: string;
  type: string;
}

export type SessionMode =
  | "task"
  | "plan"
  | "ask"
  | "watch"
  | "fleet"
  | "design";

export type AgentStatus =
  | "idle"
  | "working"
  | "waiting"
  | "terminated"
  | "error";

export type TaskPhase =
  | "discovery"
  | "planning"
  | "coding"
  | "testing"
  | "review"
  | "deploy"
  | "complete";

export interface PhaseInfo {
  completedAt?: string;
  message?: string;
  phase: TaskPhase;
  progress: number;
  startedAt?: string;
  status: "pending" | "active" | "completed" | "skipped";
}

export interface TaskProgress {
  agentRole?: string;
  confidenceScore: number;
  creditsConsumed: number;
  currentPhase: TaskPhase;
  estimatedTimeRemaining: number | null;
  message: string;
  overallProgress: number;
  phases: PhaseInfo[];
  startedAt: string | null;
  taskId: string;
}

export interface ActiveAgent {
  currentTask?: string;
  id: string;
  role: string;
  startedAt?: string;
  status: AgentStatus;
  stepsCompleted: number;
  tokensIn: number;
  tokensOut: number;
}

export interface PendingCheckpoint {
  checkpointId: string;
  createdAt: string;
  data: Record<string, unknown>;
  description: string;
  timeoutMs: number;
  title: string;
  type: string;
}

export interface CreditEntry {
  credits: number;
  timestamp: number;
}

export type ConnectionState = "disconnected" | "reconnecting" | "connected";

/** Key used to persist the active session ID in localStorage */
const SESSION_STORAGE_KEY = "prometheus:activeSessionId";
const SESSION_TIMESTAMP_KEY = "prometheus:lastEventTimestamp";

interface SessionState {
  activeFilePath: string | null;
  activeSessionId: string | null;
  addCreditEntry: (credits: number) => void;
  addEvent: (event: SessionEvent) => void;
  addFileEntry: (entry: FileEntry) => void;
  addPendingCheckpoint: (checkpoint: PendingCheckpoint) => void;
  addReasoning: (thought: string) => void;
  addTerminalLine: (line: { content: string; timestamp?: string }) => void;
  addTerminalOutput: (content: string) => void;
  agents: ActiveAgent[];
  clearPersistedSession: () => void;
  clearSession: () => void;
  closeFile: (path: string) => void;
  confidenceScore: number;
  connectionState: ConnectionState;
  creditHistory: CreditEntry[];
  events: SessionEvent[];
  fileTree: FileEntry[];
  getPersistedSessionId: () => string | null;
  getPersistedTimestamp: () => string | null;
  isConnected: boolean;
  mode: SessionMode;
  openFile: (path: string) => void;
  openFiles: string[];
  pendingCheckpoints: PendingCheckpoint[];
  persistSession: (sessionId: string, lastEventTimestamp?: string) => void;
  planSteps: PlanStep[];
  queuePosition: number;
  reasoning: string[];
  reconnectReplayCount: number;
  removeAgent: (agentId: string) => void;
  removePendingCheckpoint: (checkpointId: string) => void;
  setActiveFile: (path: string) => void;

  setActiveSession: (id: string | null) => void;
  setAgents: (agents: ActiveAgent[]) => void;
  setConfidenceScore: (score: number) => void;
  setConnected: (connected: boolean) => void;
  setConnectionState: (state: ConnectionState) => void;
  setFileTree: (files: FileEntry[]) => void;
  setMode: (mode: SessionMode) => void;
  setPlanSteps: (steps: PlanStep[]) => void;
  setQueuePosition: (position: number) => void;
  setReconnectReplayCount: (count: number) => void;
  setStatus: (status: string | null) => void;
  setTaskProgress: (progress: TaskProgress) => void;
  status: string | null;
  taskProgress: TaskProgress | null;
  terminalLines: Array<{ content: string; timestamp?: string }>;
  updateAgent: (agentId: string, updates: Partial<ActiveAgent>) => void;
  updateFileTree: (files: FileEntry[]) => void;
  updatePlanStep: (stepId: string, updates: Partial<PlanStep>) => void;
  updateTaskPhase: (
    phase: TaskPhase,
    status: PhaseInfo["status"],
    message?: string
  ) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  activeSessionId: null,
  status: null,
  mode: "task",
  terminalLines: [],
  planSteps: [],
  fileTree: [],
  events: [],
  isConnected: false,
  connectionState: "disconnected" as ConnectionState,
  reconnectReplayCount: 0,
  queuePosition: 0,
  reasoning: [],
  agents: [],
  openFiles: [],
  activeFilePath: null,
  creditHistory: [],
  taskProgress: null,
  confidenceScore: 0,
  pendingCheckpoints: [],

  addPendingCheckpoint: (checkpoint) =>
    set((state) => {
      // Avoid duplicates
      if (
        state.pendingCheckpoints.some(
          (c) => c.checkpointId === checkpoint.checkpointId
        )
      ) {
        return state;
      }
      return { pendingCheckpoints: [...state.pendingCheckpoints, checkpoint] };
    }),

  removePendingCheckpoint: (checkpointId) =>
    set((state) => ({
      pendingCheckpoints: state.pendingCheckpoints.filter(
        (c) => c.checkpointId !== checkpointId
      ),
    })),

  setConnectionState: (state) => set({ connectionState: state }),
  setReconnectReplayCount: (count) => set({ reconnectReplayCount: count }),

  persistSession: (sessionId, lastEventTimestamp) => {
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
        if (lastEventTimestamp) {
          localStorage.setItem(SESSION_TIMESTAMP_KEY, lastEventTimestamp);
        }
      }
    } catch {
      // localStorage unavailable (e.g. incognito quota exceeded)
    }
  },

  getPersistedSessionId: () => {
    try {
      if (typeof window !== "undefined") {
        return localStorage.getItem(SESSION_STORAGE_KEY);
      }
    } catch {
      // localStorage unavailable
    }
    return null;
  },

  getPersistedTimestamp: () => {
    try {
      if (typeof window !== "undefined") {
        return localStorage.getItem(SESSION_TIMESTAMP_KEY);
      }
    } catch {
      // localStorage unavailable
    }
    return null;
  },

  clearPersistedSession: () => {
    try {
      if (typeof window !== "undefined") {
        localStorage.removeItem(SESSION_STORAGE_KEY);
        localStorage.removeItem(SESSION_TIMESTAMP_KEY);
      }
    } catch {
      // localStorage unavailable
    }
  },

  setActiveSession: (id) => set({ activeSessionId: id }),
  setStatus: (status) => set({ status }),
  setMode: (mode) => set({ mode }),

  addTerminalLine: (line) =>
    set((state) => ({
      terminalLines: [...state.terminalLines, line].slice(-500),
    })),

  setPlanSteps: (steps) => set({ planSteps: steps }),

  updatePlanStep: (stepId, updates) =>
    set((state) => ({
      planSteps: state.planSteps.map((s) =>
        s.id === stepId ? { ...s, ...updates } : s
      ),
    })),

  setFileTree: (files) => set({ fileTree: files }),

  addFileEntry: (entry) =>
    set((state) => {
      const existing = state.fileTree.findIndex((f) => f.path === entry.path);
      if (existing >= 0) {
        const updated = [...state.fileTree];
        updated[existing] = entry;
        return { fileTree: updated };
      }
      return { fileTree: [...state.fileTree, entry] };
    }),

  addEvent: (event) =>
    set((state) => ({
      events: [...state.events, event].slice(-200),
    })),

  setConnected: (connected) => set({ isConnected: connected }),
  setQueuePosition: (position) => set({ queuePosition: position }),

  addReasoning: (thought) =>
    set((state) => ({
      reasoning: [...state.reasoning, thought].slice(-50),
    })),

  addTerminalOutput: (content) =>
    set((state) => ({
      terminalLines: [
        ...state.terminalLines,
        { content, timestamp: new Date().toISOString() },
      ].slice(-500),
    })),

  updateFileTree: (files) => set({ fileTree: files }),

  openFile: (path) =>
    set((state) => ({
      openFiles: state.openFiles.includes(path)
        ? state.openFiles
        : [...state.openFiles, path],
      activeFilePath: path,
    })),

  closeFile: (path) =>
    set((state) => {
      const updated = state.openFiles.filter((f) => f !== path);
      const newActive =
        state.activeFilePath === path
          ? (updated.at(-1) ?? null)
          : state.activeFilePath;
      return { openFiles: updated, activeFilePath: newActive };
    }),

  setActiveFile: (path) => set({ activeFilePath: path }),

  addCreditEntry: (credits) =>
    set((state) => ({
      creditHistory: [
        ...state.creditHistory,
        { credits, timestamp: Date.now() },
      ].slice(-100),
    })),

  setAgents: (agents) => set({ agents }),

  updateAgent: (agentId, updates) =>
    set((state) => ({
      agents: state.agents.map((a) =>
        a.id === agentId ? { ...a, ...updates } : a
      ),
    })),

  removeAgent: (agentId) =>
    set((state) => ({
      agents: state.agents.filter((a) => a.id !== agentId),
    })),

  setConfidenceScore: (score) => set({ confidenceScore: score }),

  setTaskProgress: (progress) => set({ taskProgress: progress }),

  updateTaskPhase: (phase, status, message) =>
    set((state) => {
      if (!state.taskProgress) {
        return state;
      }
      const phases = state.taskProgress.phases.map((p) => {
        if (p.phase === phase) {
          return {
            ...p,
            status,
            message: message ?? p.message,
            ...(status === "active"
              ? { startedAt: new Date().toISOString() }
              : {}),
            ...(status === "completed"
              ? { completedAt: new Date().toISOString() }
              : {}),
          };
        }
        return p;
      });
      return {
        taskProgress: {
          ...state.taskProgress,
          currentPhase: phase,
          phases,
        },
      };
    }),

  clearSession: () => {
    try {
      if (typeof window !== "undefined") {
        localStorage.removeItem(SESSION_STORAGE_KEY);
        localStorage.removeItem(SESSION_TIMESTAMP_KEY);
      }
    } catch {
      // localStorage unavailable
    }
    set({
      activeSessionId: null,
      status: null,
      mode: "task",
      terminalLines: [],
      planSteps: [],
      fileTree: [],
      events: [],
      isConnected: false,
      connectionState: "disconnected" as ConnectionState,
      reconnectReplayCount: 0,
      queuePosition: 0,
      reasoning: [],
      agents: [],
      openFiles: [],
      activeFilePath: null,
      creditHistory: [],
      taskProgress: null,
      confidenceScore: 0,
      pendingCheckpoints: [],
    });
  },
}));
