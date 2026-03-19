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

export type SessionMode = "task" | "plan" | "ask" | "watch" | "fleet";

export type AgentStatus =
  | "idle"
  | "working"
  | "waiting"
  | "terminated"
  | "error";

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

export interface CreditEntry {
  credits: number;
  timestamp: number;
}

interface SessionState {
  activeFilePath: string | null;
  activeSessionId: string | null;
  addCreditEntry: (credits: number) => void;
  addEvent: (event: SessionEvent) => void;
  addFileEntry: (entry: FileEntry) => void;
  addReasoning: (thought: string) => void;
  addTerminalLine: (line: { content: string; timestamp?: string }) => void;
  addTerminalOutput: (content: string) => void;
  agents: ActiveAgent[];
  clearSession: () => void;
  closeFile: (path: string) => void;
  creditHistory: CreditEntry[];
  events: SessionEvent[];
  fileTree: FileEntry[];
  isConnected: boolean;
  mode: SessionMode;
  openFile: (path: string) => void;
  openFiles: string[];
  planSteps: PlanStep[];
  queuePosition: number;
  reasoning: string[];
  removeAgent: (agentId: string) => void;
  setActiveFile: (path: string) => void;

  setActiveSession: (id: string | null) => void;
  setAgents: (agents: ActiveAgent[]) => void;
  setConnected: (connected: boolean) => void;
  setFileTree: (files: FileEntry[]) => void;
  setMode: (mode: SessionMode) => void;
  setPlanSteps: (steps: PlanStep[]) => void;
  setQueuePosition: (position: number) => void;
  setStatus: (status: string | null) => void;
  status: string | null;
  terminalLines: Array<{ content: string; timestamp?: string }>;
  updateAgent: (agentId: string, updates: Partial<ActiveAgent>) => void;
  updateFileTree: (files: FileEntry[]) => void;
  updatePlanStep: (stepId: string, updates: Partial<PlanStep>) => void;
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
  queuePosition: 0,
  reasoning: [],
  agents: [],
  openFiles: [],
  activeFilePath: null,
  creditHistory: [],

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

  clearSession: () =>
    set({
      activeSessionId: null,
      status: null,
      mode: "task",
      terminalLines: [],
      planSteps: [],
      fileTree: [],
      events: [],
      isConnected: false,
      queuePosition: 0,
      reasoning: [],
      agents: [],
      openFiles: [],
      activeFilePath: null,
      creditHistory: [],
    }),
}));
