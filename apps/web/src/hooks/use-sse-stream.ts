"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { logger } from "@/lib/logger";
import { useNotificationStore } from "@/stores/notification.store";
import { useSessionStore } from "@/stores/session.store";

const RECONNECT_BASE_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 15;
const HEARTBEAT_TIMEOUT_MS = 15_000;
const EVENT_BUFFER_FLUSH_MS = 50;

interface BufferedEvent {
  data: Record<string, unknown>;
  type: string;
}

export function useSSEStream(sessionId: string | null) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventBuffer = useRef<BufferedEvent[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEventId = useRef<string>("0");
  const seenSequences = useRef<Set<number>>(new Set());
  const [isConnected, setIsConnected] = useState(false);

  const store = useSessionStore();
  const notifications = useNotificationStore();
  const connectRef = useRef<() => void>(() => {
    /* initialized below */
  });
  const scheduleReconnectRef = useRef<() => void>(() => {
    /* initialized below */
  });

  const deduplicateEvent = useCallback(function deduplicateEvent(
    data: Record<string, unknown>
  ): boolean {
    const seq = data.sequence as number | undefined;
    if (seq === undefined) {
      return false;
    }
    if (seenSequences.current.has(seq)) {
      return true;
    }
    seenSequences.current.add(seq);
    if (seenSequences.current.size > 2000) {
      const arr = Array.from(seenSequences.current).sort((a, b) => a - b);
      seenSequences.current = new Set(arr.slice(-1000));
    }
    return false;
  }, []);

  const dispatchEvent = useCallback(
    function dispatchEvent(type: string, data: Record<string, unknown>) {
      const ts = (data.timestamp as string) ?? new Date().toISOString();
      const nowTs = new Date().toISOString();

      const addSimpleEvent = (eventType: string) => {
        store.addEvent({
          id: crypto.randomUUID(),
          type: eventType,
          data,
          timestamp: nowTs,
        });
      };

      switch (type) {
        case "agent_output":
          store.addTerminalLine({
            content: data.content as string,
            timestamp: ts,
          });
          store.addEvent({
            id: crypto.randomUUID(),
            type: "agent_output",
            data,
            timestamp: ts,
          });
          break;
        case "terminal_output":
          store.addTerminalLine({
            content: data.content as string,
            timestamp: ts,
          });
          break;
        case "plan_update":
          if (data.steps) {
            store.setPlanSteps(
              data.steps as import("@/stores/session.store").PlanStep[]
            );
          }
          break;
        case "plan_step_update":
          if (data.stepId) {
            store.updatePlanStep(data.stepId as string, {
              status: data.status as string,
              title: data.title as string,
              description: data.description as string,
            });
          }
          break;
        case "file_change":
          if (data.files) {
            store.setFileTree(
              data.files as import("@/stores/session.store").FileEntry[]
            );
          } else if (data.file) {
            store.addFileEntry(
              data.file as import("@/stores/session.store").FileEntry
            );
          }
          break;
        case "file_diff":
        case "code_change":
          addSimpleEvent(type);
          break;
        case "queue_position":
          store.setQueuePosition(data.position as number);
          break;
        case "task_status":
          store.setStatus(data.status as string);
          addSimpleEvent("task_status");
          break;
        case "reasoning":
          store.addReasoning(
            (data.content as string) ?? (data.thought as string) ?? ""
          );
          store.addTerminalLine({
            content: `[THINK] ${(data.content as string) ?? (data.thought as string) ?? ""}`,
            timestamp: nowTs,
          });
          break;
        case "agent_status":
        case "checkpoint":
        case "credit_update":
          addSimpleEvent(type);
          break;
        case "error":
          addSimpleEvent("error");
          notifications.addNotification({
            id: crypto.randomUUID(),
            type: "error",
            title: "Session Error",
            message: (data.message as string) ?? "An error occurred",
            timestamp: nowTs,
          });
          break;
        case "session_complete":
          store.setStatus((data.status as string) ?? "completed");
          notifications.addNotification({
            id: crypto.randomUUID(),
            type: "success",
            title: "Session Complete",
            message: (data.message as string) ?? "Session has finished",
            timestamp: nowTs,
          });
          break;
        default:
          addSimpleEvent(type);
          break;
      }
    },
    [store, notifications]
  );

  const processEvent = useCallback(
    function processEvent(type: string, data: Record<string, unknown>) {
      if (deduplicateEvent(data)) {
        return;
      }
      if (data.id) {
        lastEventId.current = data.id as string;
      }
      dispatchEvent(type, data);
    },
    [deduplicateEvent, dispatchEvent]
  );

  const flushBuffer = useCallback(() => {
    const events = eventBuffer.current.splice(0);
    if (events.length === 0) {
      return;
    }

    for (const event of events) {
      processEvent(event.type, event.data);
    }
  }, [processEvent]);

  const queueEvent = useCallback(
    (type: string, data: Record<string, unknown>) => {
      eventBuffer.current.push({ type, data });
      if (!flushTimer.current) {
        flushTimer.current = setTimeout(() => {
          flushTimer.current = null;
          flushBuffer();
        }, EVENT_BUFFER_FLUSH_MS);
      }
    },
    [flushBuffer]
  );

  const resetHeartbeat = useCallback(() => {
    if (heartbeatTimer.current) {
      clearTimeout(heartbeatTimer.current);
    }
    heartbeatTimer.current = setTimeout(() => {
      // No heartbeat received in 15s - reconnect
      logger.warn("[SSE] Heartbeat timeout, reconnecting...");
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      setIsConnected(false);
      store.setConnected(false);
      scheduleReconnectRef.current();
    }, HEARTBEAT_TIMEOUT_MS);
  }, [store]);

  const scheduleReconnect = useCallback(() => {
    if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
      return;
    }
    reconnectAttempts.current++;
    const delay =
      RECONNECT_BASE_DELAY_MS *
      Math.min(2 ** (reconnectAttempts.current - 1), 16);
    reconnectTimer.current = setTimeout(() => {
      connectRef.current();
    }, delay);
  }, []);

  const connect = useCallback(() => {
    if (!sessionId) {
      return;
    }

    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
    // Include lastEventId for gap-fill on reconnection
    const lastId = lastEventId.current;
    const url =
      lastId === "0"
        ? `${apiUrl}/api/sse/sessions/${sessionId}/stream`
        : `${apiUrl}/api/sse/sessions/${sessionId}/stream?lastEventId=${lastId}`;

    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      setIsConnected(true);
      store.setConnected(true);
      store.setActiveSession(sessionId);
      reconnectAttempts.current = 0;
      resetHeartbeat();
    };

    // Heartbeat handling
    es.addEventListener("heartbeat", () => {
      resetHeartbeat();
    });

    // All known event types
    const eventTypes = [
      "agent_output",
      "agent_status",
      "terminal_output",
      "plan_update",
      "plan_step_update",
      "file_change",
      "file_diff",
      "code_change",
      "queue_position",
      "task_status",
      "reasoning",
      "checkpoint",
      "credit_update",
      "error",
      "session_complete",
    ];

    for (const eventType of eventTypes) {
      es.addEventListener(eventType, (e) => {
        resetHeartbeat();
        try {
          const data = JSON.parse(e.data);
          queueEvent(eventType, data);
        } catch {
          /* ignore parse errors */
        }
      });
    }

    // Generic message handler for unlisted event types
    es.onmessage = (e) => {
      resetHeartbeat();
      try {
        const data = JSON.parse(e.data);
        if (data.type) {
          queueEvent(data.type, data);
        }
      } catch {
        /* ignore */
      }
    };

    es.onerror = () => {
      setIsConnected(false);
      store.setConnected(false);
      es.close();
      eventSourceRef.current = null;

      if (heartbeatTimer.current) {
        clearTimeout(heartbeatTimer.current);
      }
      scheduleReconnectRef.current();
    };
  }, [sessionId, store, resetHeartbeat, queueEvent]);

  // Keep refs in sync with latest callbacks
  connectRef.current = connect;
  scheduleReconnectRef.current = scheduleReconnect;

  const disconnect = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (heartbeatTimer.current) {
      clearTimeout(heartbeatTimer.current);
      heartbeatTimer.current = null;
    }
    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsConnected(false);
    store.setConnected(false);
  }, [store]);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return { isConnected };
}
