"use client";
import { create } from "zustand";

export interface SessionEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface PlanStep {
  id: string;
  title: string;
  status: string;
  description?: string;
}

export interface FileEntry {
  name: string;
  path: string;
  type: string;
  status?: string;
  children?: FileEntry[];
}

interface SessionState {
  activeSessionId: string | null;
  status: string | null;
  terminalLines: Array<{ content: string; timestamp?: string }>;
  planSteps: PlanStep[];
  fileTree: FileEntry[];
  events: SessionEvent[];
  isConnected: boolean;
  queuePosition: number;
  reasoning: string[];

  setActiveSession: (id: string | null) => void;
  setStatus: (status: string | null) => void;
  addTerminalLine: (line: { content: string; timestamp?: string }) => void;
  setPlanSteps: (steps: PlanStep[]) => void;
  updatePlanStep: (stepId: string, updates: Partial<PlanStep>) => void;
  setFileTree: (files: FileEntry[]) => void;
  addFileEntry: (entry: FileEntry) => void;
  addEvent: (event: SessionEvent) => void;
  setConnected: (connected: boolean) => void;
  setQueuePosition: (position: number) => void;
  addReasoning: (thought: string) => void;
  addTerminalOutput: (content: string) => void;
  updateFileTree: (files: FileEntry[]) => void;
  clearSession: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  activeSessionId: null,
  status: null,
  terminalLines: [],
  planSteps: [],
  fileTree: [],
  events: [],
  isConnected: false,
  queuePosition: 0,
  reasoning: [],

  setActiveSession: (id) => set({ activeSessionId: id }),
  setStatus: (status) => set({ status }),

  addTerminalLine: (line) =>
    set((state) => ({
      terminalLines: [...state.terminalLines, line].slice(-500),
    })),

  setPlanSteps: (steps) => set({ planSteps: steps }),

  updatePlanStep: (stepId, updates) =>
    set((state) => ({
      planSteps: state.planSteps.map((s) =>
        s.id === stepId ? { ...s, ...updates } : s,
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

  clearSession: () =>
    set({
      activeSessionId: null,
      status: null,
      terminalLines: [],
      planSteps: [],
      fileTree: [],
      events: [],
      isConnected: false,
      queuePosition: 0,
      reasoning: [],
    }),
}));
