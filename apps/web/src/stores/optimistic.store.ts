"use client";
import { create } from "zustand";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OptimisticUpdateType =
  | "message_send"
  | "file_save"
  | "task_create"
  | "plan_approve";

export type OptimisticStatus = "pending" | "confirmed" | "rejected";

export interface OptimisticUpdate<T = unknown> {
  createdAt: number;
  data: T;
  id: string;
  rollback: () => void;
  status: OptimisticStatus;
  type: OptimisticUpdateType;
}

interface OptimisticState {
  /** Register an optimistic update with a rollback function. */
  addOptimistic: <T = unknown>(
    id: string,
    type: OptimisticUpdateType,
    data: T,
    rollback: () => void
  ) => void;

  /** Server confirmed the operation — remove from pending. */
  confirm: (id: string) => void;

  /** Get all pending updates of a given type. */
  getPending: (type: OptimisticUpdateType) => OptimisticUpdate[];

  /** The map of all pending optimistic updates keyed by operation ID. */
  pendingUpdates: Map<string, OptimisticUpdate>;

  /** Server rejected the operation — execute rollback and remove. */
  reject: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useOptimisticStore = create<OptimisticState>((set, get) => ({
  pendingUpdates: new Map(),

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
}));
