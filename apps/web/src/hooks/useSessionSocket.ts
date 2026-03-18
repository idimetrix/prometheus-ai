"use client";
import { useEffect, useRef, useCallback } from "react";
import { useSessionStore } from "../stores/session.store";

export function useSessionSocket(sessionId: string | null) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const store = useSessionStore();

  const connect = useCallback(() => {
    if (!sessionId) return;

    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
    const url = `${apiUrl}/api/sse/sessions/${sessionId}/stream`;

    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      store.setConnected(true);
    };

    es.addEventListener("agent_output", (e) => {
      const data = JSON.parse(e.data);
      store.addTerminalLine({ content: data.content, timestamp: data.timestamp });
    });

    es.addEventListener("terminal_output", (e) => {
      const data = JSON.parse(e.data);
      store.addTerminalLine({ content: data.content, timestamp: data.timestamp });
    });

    es.addEventListener("plan_update", (e) => {
      const data = JSON.parse(e.data);
      store.setPlanSteps(data.steps);
    });

    es.addEventListener("file_change", (e) => {
      const data = JSON.parse(e.data);
      store.setFileTree(data.files);
    });

    es.addEventListener("queue_position", (e) => {
      const data = JSON.parse(e.data);
      store.setQueuePosition(data.position);
    });

    es.addEventListener("task_status", (e) => {
      const data = JSON.parse(e.data);
      // Handle task status updates
    });

    es.onerror = () => {
      store.setConnected(false);
      // Auto-reconnect is handled by EventSource
    };
  }, [sessionId, store]);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      store.setConnected(false);
    }
  }, [store]);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return { isConnected: store.isConnected };
}
