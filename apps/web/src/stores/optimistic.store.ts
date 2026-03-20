"use client";
import { create } from "zustand";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OptimisticUpdateType =
  | "message_send"
  | "file_save"
  | "task_create"
  | "plan_approve"
  | "approval_response"
  | "tool_retry";

export type OptimisticStatus = "pending" | "confirmed" | "rejected";

export interface OptimisticUpdate<T = unknown> {
  createdAt: number;
  data: T;
  id: string;
  rollback: () => void;
  status: OptimisticStatus;
  type: OptimisticUpdateType;
}

/** Optimistic message for instant display in chat. */
export interface OptimisticMessage {
  content: string;
  id: string;
  status: "pending" | "confirmed" | "rejected";
  timestamp: string;
}

interface OptimisticState {
  /** Add an optimistic message for instant chat display. */
  addMessage: (id: string, content: string) => void;
  /** Register an optimistic update with a rollback function. */
  addOptimistic: <T = unknown>(
    id: string,
    type: OptimisticUpdateType,
    data: T,
    rollback: () => void
  ) => void;

  /** Server confirmed the operation — remove from pending. */
  confirm: (id: string) => void;

  /** Mark an optimistic message as confirmed. */
  confirmMessage: (id: string) => void;

  /** Get all pending updates of a given type. */
  getPending: (type: OptimisticUpdateType) => OptimisticUpdate[];

  /** Check if a given id is still pending. */
  isPending: (id: string) => boolean;

  /** Optimistic messages awaiting server confirmation. */
  messages: OptimisticMessage[];

  /** The map of all pending optimistic updates keyed by operation ID. */
  pendingUpdates: Map<string, OptimisticUpdate>;

  /** Server rejected the operation — execute rollback and remove. */
  reject: (id: string) => void;

  /** Mark an optimistic message as rejected. */
  rejectMessage: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useOptimisticStore = create<OptimisticState>((set, get) => ({
  pendingUpdates: new Map(),
  messages: [],

  addOptimistic: (id, type, data, rollback) =>
    set((state) => {
      const next = new Map(state.pendingUpdates);
      next.set(id, {
        id,
        type,
        data,
        rollback,
        status: "pending",
        createdAt: Date.now(),
      });
      return { pendingUpdates: next };
    }),

  confirm: (id) =>
    set((state) => {
      const next = new Map(state.pendingUpdates);
      next.delete(id);
      return { pendingUpdates: next };
    }),

  reject: (id) => {
    const update = get().pendingUpdates.get(id);
    if (update) {
      try {
        update.rollback();
      } catch {
        // Rollback should not throw, but guard anyway
      }
    }
    set((state) => {
      const next = new Map(state.pendingUpdates);
      next.delete(id);
      return { pendingUpdates: next };
    });
  },

  getPending: (type) => {
    const all = get().pendingUpdates;
    const results: OptimisticUpdate[] = [];
    for (const update of all.values()) {
      if (update.type === type) {
        results.push(update);
      }
    }
    return results;
  },

  isPending: (id) => get().pendingUpdates.has(id),

  addMessage: (id, content) =>
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id,
          content,
          status: "pending" as const,
          timestamp: new Date().toISOString(),
        },
      ],
    })),

  confirmMessage: (id) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, status: "confirmed" as const } : m
      ),
    })),

  rejectMessage: (id) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, status: "rejected" as const } : m
      ),
    })),
}));
