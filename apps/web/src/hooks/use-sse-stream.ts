"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useNotificationStore } from "@/stores/notification.store";
import { useSessionStore } from "@/stores/session.store";

const RECONNECT_BASE_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 15;
const HEARTBEAT_TIMEOUT_MS = 15_000;
const EVENT_BUFFER_FLUSH_MS = 50;

type EventHandler = (data: Record<string, unknown>) => void;

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
  const [isConnected, setIsConnected] = useState(false);

  const store = useSessionStore();
  const notifications = useNotificationStore();

  const resetHeartbeat = useCallback(() => {
    if (heartbeatTimer.current) {
      clearTimeout(heartbeatTimer.current);
    }
    heartbeatTimer.current = setTimeout(() => {
      // No heartbeat received in 15s - reconnect
      console.warn("[SSE] Heartbeat timeout, reconnecting...");
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      setIsConnected(false);
      store.setConnected(false);
      scheduleReconnect();
    }, HEARTBEAT_TIMEOUT_MS);
  }, [store, scheduleReconnect]);

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

  function processEvent(type: string, data: Record<string, unknown>) {
    switch (type) {
      case "agent_output":
        store.addTerminalLine({
          content: data.content as string,
          timestamp: (data.timestamp as string) ?? new Date().toISOString(),
        });
        store.addEvent({
          id: crypto.randomUUID(),
          type: "agent_output",
          data,
          timestamp: (data.timestamp as string) ?? new Date().toISOString(),
        });
        break;

      case "terminal_output":
        store.addTerminalLine({
          content: data.content as string,
          timestamp: (data.timestamp as string) ?? new Date().toISOString(),
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
        store.addEvent({
          id: crypto.randomUUID(),
          type,
          data,
          timestamp: new Date().toISOString(),
        });
        break;

      case "queue_position":
        store.setQueuePosition(data.position as number);
        break;

      case "task_status":
        store.setStatus(data.status as string);
        store.addEvent({
          id: crypto.randomUUID(),
          type: "task_status",
          data,
          timestamp: new Date().toISOString(),
        });
        break;

      case "reasoning":
        store.addReasoning(
          (data.content as string) ?? (data.thought as string) ?? ""
        );
        store.addTerminalLine({
          content: `[THINK] ${(data.content as string) ?? (data.thought as string) ?? ""}`,
          timestamp: new Date().toISOString(),
        });
        break;

      case "checkpoint":
        store.addEvent({
          id: crypto.randomUUID(),
          type: "checkpoint",
          data,
          timestamp: new Date().toISOString(),
        });
        break;

      case "credit_update":
        store.addEvent({
          id: crypto.randomUUID(),
          type: "credit_update",
          data,
          timestamp: new Date().toISOString(),
        });
        break;

      case "error":
        store.addEvent({
          id: crypto.randomUUID(),
          type: "error",
          data,
          timestamp: new Date().toISOString(),
        });
        notifications.addNotification({
          id: crypto.randomUUID(),
          type: "error",
          title: "Session Error",
          message: (data.message as string) ?? "An error occurred",
          timestamp: new Date().toISOString(),
        });
        break;

      case "session_complete":
        store.setStatus((data.status as string) ?? "completed");
        notifications.addNotification({
          id: crypto.randomUUID(),
          type: "success",
          title: "Session Complete",
          message: (data.message as string) ?? "Session has finished",
          timestamp: new Date().toISOString(),
        });
        break;

      default:
        // Forward unknown events to the event log
        store.addEvent({
          id: crypto.randomUUID(),
          type,
          data,
          timestamp: new Date().toISOString(),
        });
        break;
    }
  }

  const scheduleReconnect = useCallback(() => {
    if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
      return;
    }
    reconnectAttempts.current++;
    const delay =
      RECONNECT_BASE_DELAY_MS *
      Math.min(2 ** (reconnectAttempts.current - 1), 16);
    reconnectTimer.current = setTimeout(() => {
      connect();
    }, delay);
  }, [connect]);

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
    const url = `${apiUrl}/api/sse/sessions/${sessionId}/stream`;

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
      scheduleReconnect();
    };
  }, [sessionId, store, resetHeartbeat, queueEvent, scheduleReconnect]);

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
