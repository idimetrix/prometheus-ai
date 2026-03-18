"use client";
import { create } from "zustand";

interface SessionState {
  activeSessionId: string | null;
  terminalLines: Array<{ content: string; timestamp?: string }>;
  planSteps: Array<{ id: string; title: string; status: string; description?: string }>;
  fileTree: Array<{ name: string; path: string; type: string; status?: string; children?: unknown[] }>;
  isConnected: boolean;
  queuePosition: number;

  setActiveSession: (id: string | null) => void;
  addTerminalLine: (line: { content: string; timestamp?: string }) => void;
  setPlanSteps: (steps: SessionState["planSteps"]) => void;
  setFileTree: (files: SessionState["fileTree"]) => void;
  setConnected: (connected: boolean) => void;
  setQueuePosition: (position: number) => void;
  clearSession: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  activeSessionId: null,
  terminalLines: [],
  planSteps: [],
  fileTree: [],
  isConnected: false,
  queuePosition: 0,

  setActiveSession: (id) => set({ activeSessionId: id }),
  addTerminalLine: (line) =>
    set((state) => ({ terminalLines: [...state.terminalLines, line] })),
  setPlanSteps: (steps) => set({ planSteps: steps }),
  setFileTree: (files) => set({ fileTree: files }),
  setConnected: (connected) => set({ isConnected: connected }),
  setQueuePosition: (position) => set({ queuePosition: position }),
  clearSession: () =>
    set({
      activeSessionId: null,
      terminalLines: [],
      planSteps: [],
      fileTree: [],
      isConnected: false,
      queuePosition: 0,
    }),
}));
