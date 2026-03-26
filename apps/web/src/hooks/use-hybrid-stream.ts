"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSessionStore } from "@/stores/session.store";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StreamEvent {
  data: Record<string, unknown>;
  sequence: number;
  timestamp: string;
  type: string;
}

type TransportType = "websocket" | "sse" | "none";

interface HybridStreamReturn {
  events: StreamEvent[];
  isConnected: boolean;
  reconnect: () => void;
  sendMessage: (event: string, data: unknown) => void;
  transport: TransportType;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RECONNECT_ATTEMPTS = 12;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;
const WS_CLOSE_NORMAL = 1000;
const TRANSPORT_PREF_KEY = "prometheus:preferred-transport";

function _getPreferredTransport(): "ws" | "sse" | null {
  try {
    const val = globalThis.sessionStorage?.getItem(TRANSPORT_PREF_KEY);
    return val === "ws" || val === "sse" ? val : null;
  } catch {
    return null;
  }
}

function savePreferredTransport(transport: "ws" | "sse"): void {
  try {
    globalThis.sessionStorage?.setItem(TRANSPORT_PREF_KEY, transport);
  } catch {
    // sessionStorage unavailable (SSR)
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Hybrid streaming hook that tries WebSocket first for bidirectional
 * communication, then falls back to SSE for agent output events.
 * Uses ref-based callbacks to avoid circular dependency issues.
 */
export function useHybridStream(sessionId: string): HybridStreamReturn {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [transport, setTransport] = useState<TransportType>("none");

  const wsRef = useRef<WebSocket | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSequence = useRef(0);
  const store = useSessionStore();

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  const wsUrlBase = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4001";

  // Use refs to break circular callback dependencies
  const connectRef = useRef<() => void>(() => {
    /* initialized below */
  });
  const scheduleReconnectRef = useRef<() => void>(() => {
    /* initialized below */
  });

  const addEvent = useCallback((event: StreamEvent) => {
    if (event.sequence > lastSequence.current) {
      lastSequence.current = event.sequence;
    }
    setEvents((prev) => [...prev.slice(-500), event]);
  }, []);

  const handleMessage = useCallback(
    (type: string, data: Record<string, unknown>, seq: number) => {
      const event: StreamEvent = {
        type,
        data,
        sequence: seq,
        timestamp: (data.timestamp as string) ?? new Date().toISOString(),
      };
      addEvent(event);
      store.addEvent({
        id: crypto.randomUUID(),
        type,
        data,
        timestamp: event.timestamp,
      });
    },
    [addEvent, store]
  );

  const disconnect = useCallback((): void => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close(WS_CLOSE_NORMAL);
      wsRef.current = null;
    }
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setIsConnected(false);
    store.setConnected(false);
    setTransport("none");
  }, [store]);

  const connectWebSocket = useCallback((): boolean => {
    try {
      const url = `${wsUrlBase}/sessions/${sessionId}/stream`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setTransport("websocket");
        savePreferredTransport("ws");
        store.setConnected(true);
        reconnectAttempts.current = 0;

        if (lastSequence.current > 0) {
          ws.send(
            JSON.stringify({
              type: "replay",
              after: lastSequence.current,
            })
          );
        }
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string) as {
            data?: Record<string, unknown>;
            sequence?: number;
            type?: string;
          };
          if (msg.type && msg.data) {
            handleMessage(msg.type, msg.data, msg.sequence ?? 0);
          }
        } catch {
          /* ignore parse errors */
        }
      };

      ws.onclose = (e) => {
        wsRef.current = null;
        if (e.code !== WS_CLOSE_NORMAL) {
          setIsConnected(false);
          store.setConnected(false);
          setTransport("none");
          scheduleReconnectRef.current();
        }
      };

      ws.onerror = () => {
        ws.close();
      };

      return true;
    } catch {
      return false;
    }
  }, [sessionId, wsUrlBase, store, handleMessage]);

  const connectSSE = useCallback((): void => {
    const seqParam =
      lastSequence.current > 0 ? `?lastEventId=${lastSequence.current}` : "";
    const url = `${apiUrl}/api/sse/sessions/${sessionId}/stream${seqParam}`;

    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      setIsConnected(true);
      setTransport("sse");
      savePreferredTransport("sse");
      store.setConnected(true);
      reconnectAttempts.current = 0;
    };

    const eventTypes = [
      "agent_output",
      "terminal_output",
      "plan_update",
      "plan_step_update",
      "file_change",
      "file_diff",
      "code_change",
      "task_status",
      "reasoning",
      "session_complete",
      "error",
      "credit_update",
      "checkpoint",
      // Canonical agent streaming events (GAP-P0-08)
      "agent:thinking",
      "agent:terminal",
      "agent:file-change",
      "agent:progress",
      "task:complete",
      "task:created",
      "session:checkpoint",
      "session:error",
    ];

    for (const eventType of eventTypes) {
      es.addEventListener(eventType, (e) => {
        try {
          const data = JSON.parse(e.data) as Record<string, unknown>;
          const seq = (data.sequence as number) ?? 0;
          handleMessage(eventType, data, seq);
        } catch {
          /* ignore */
        }
      });
    }

    es.onerror = () => {
      es.close();
      esRef.current = null;
      setIsConnected(false);
      store.setConnected(false);
      setTransport("none");
      scheduleReconnectRef.current();
    };
  }, [sessionId, apiUrl, store, handleMessage]);

  const connect = useCallback((): void => {
    if (!sessionId) {
      return;
    }
    disconnect();
    const wsOk = connectWebSocket();
    if (!wsOk) {
      connectSSE();
    }
  }, [sessionId, disconnect, connectWebSocket, connectSSE]);

  const scheduleReconnect = useCallback((): void => {
    if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
      return;
    }
    reconnectAttempts.current++;
    const exponential = Math.min(
      BASE_DELAY_MS * 2 ** (reconnectAttempts.current - 1),
      MAX_DELAY_MS
    );
    // Add jitter to prevent thundering herd on server restart
    const delay = exponential * (0.5 + Math.random());
    reconnectTimer.current = setTimeout(() => {
      connectRef.current();
    }, delay);
  }, []);

  // Keep refs in sync with latest callbacks
  connectRef.current = connect;
  scheduleReconnectRef.current = scheduleReconnect;

  const sendMessage = useCallback((event: string, data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: event, data }));
    }
  }, []);

  const reconnect = useCallback(() => {
    reconnectAttempts.current = 0;
    connectRef.current();
  }, []);

  useEffect(() => {
    connectRef.current();
    return () => disconnect();
  }, [disconnect]);

  return {
    events,
    isConnected,
    sendMessage,
    reconnect,
    transport,
  };
}
