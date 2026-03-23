"use client";

import { useCallback } from "react";
import { useRealtime } from "@/providers/realtime-provider";
import { useOptimisticStore } from "@/stores/optimistic.store";
import { useSessionStore } from "@/stores/session.store";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OptimisticMessage {
  content: string;
  id: string;
  isPending: boolean;
  status: "sending" | "confirmed" | "failed";
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Hook for sending messages with optimistic UI updates.
 *
 * Messages appear immediately in the session event feed with a "sending..."
 * indicator. Once the server acknowledges the message (via the realtime
 * provider), the pending state is cleared. On rejection the optimistic event
 * is rolled back from the store.
 */
export function useOptimisticMessage() {
  const { subscribe, unsubscribe } = useRealtime();
  const sessionStore = useSessionStore();
  const optimisticStore = useOptimisticStore();

  const pendingMessages = optimisticStore.getPending("message_send");

  /**
   * Send a message optimistically.
   *
   * @param content - The message text to send.
   * @param sendFn  - An async function that actually transmits the message to
   *                  the server (e.g. via tRPC mutation). It receives the
   *                  generated `messageId` so the server can echo it back for
   *                  confirmation.
   */
  const sendMessage = useCallback(
    async (content: string, sendFn: (messageId: string) => Promise<void>) => {
      const messageId = crypto.randomUUID();
      const timestamp = new Date().toISOString();

      // 1. Optimistically add the message to the session event store
      const optimisticEvent = {
        id: messageId,
        type: "user_message",
        data: {
          content,
          optimistic: true,
          status: "sending",
        },
        timestamp,
      };
      sessionStore.addEvent(optimisticEvent);

      // 2. Register in the optimistic store so we can track / rollback
      const rollback = () => {
        // On rollback, add a "failed" event so the UI can show the error
        sessionStore.addEvent({
          id: crypto.randomUUID(),
          type: "user_message_failed",
          data: {
            originalId: messageId,
            content,
            status: "failed",
          },
          timestamp: new Date().toISOString(),
        });
      };

      optimisticStore.addOptimistic(
        messageId,
        "message_send",
        { content },
        rollback
      );

      // 3. Listen for server confirmation
      const onConfirm = (data: Record<string, unknown>) => {
        if (data.messageId === messageId || data.id === messageId) {
          optimisticStore.confirm(messageId);
          unsubscribe("message_confirmed", onConfirm);
          unsubscribe("message_rejected", onReject);
        }
      };

      const onReject = (data: Record<string, unknown>) => {
        if (data.messageId === messageId || data.id === messageId) {
          optimisticStore.reject(messageId);
          unsubscribe("message_confirmed", onConfirm);
          unsubscribe("message_rejected", onReject);
        }
      };

      subscribe("message_confirmed", onConfirm);
      subscribe("message_rejected", onReject);

      // 4. Actually send
      try {
        await sendFn(messageId);
      } catch {
        // Network failure — reject immediately
        optimisticStore.reject(messageId);
        unsubscribe("message_confirmed", onConfirm);
        unsubscribe("message_rejected", onReject);
      }
    },
    [sessionStore, optimisticStore, subscribe, unsubscribe]
  );

  /**
   * Check whether a specific message ID is still pending.
   */
  const isPending = useCallback(
    (messageId: string) => optimisticStore.pendingUpdates.has(messageId),
    [optimisticStore]
  );

  return {
    sendMessage,
    isPending,
    pendingMessages,
  };
}
