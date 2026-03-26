"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Socket } from "socket.io-client";
import { logger } from "@/lib/logger";
import { connectSocket, disconnectSocket } from "@/lib/socket";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RealtimeTransport = "websocket" | "sse" | "none";

type EventHandler = (data: Record<string, unknown>) => void;

interface BufferedEvent {
  data: Record<string, unknown>;
  sequence: number;
  type: string;
}

interface RealtimeContextValue {
  isConnected: boolean;
  subscribe: (eventType: string, handler: EventHandler) => void;
  transport: RealtimeTransport;
  unsubscribe: (eventType: string, handler: EventHandler) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL_MS = 15_000;
const HEARTBEAT_TIMEOUT_MS = 30_000;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 20;
// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const RealtimeContext = createContext<RealtimeContextValue>({
  isConnected: false,
  transport: "none",
  subscribe: () => {
    /* noop default */
  },
  unsubscribe: () => {
    /* noop default */
  },
});

/**
 * Hook that provides access to the unified real-time transport.
 *
 * ```ts
 * const { subscribe, unsubscribe, isConnected, transport } = useRealtime();
 * ```
 */
export function useRealtime(): RealtimeContextValue {
  return useContext(RealtimeContext);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const [transport, setTransport] = useState<RealtimeTransport>("none");

  // Refs that survive renders
  const socketRef = useRef<Socket | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const listenersRef = useRef<Map<string, Set<EventHandler>>>(new Map());
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatPingTimerRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );
  const heartbeatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const lastSequenceRef = useRef(0);
  const seenSequencesRef = useRef<Set<number>>(new Set());
  const offlineBufferRef = useRef<BufferedEvent[]>([]);
  const connectedRef = useRef(false);

  // Stable refs for reconnect helpers
  const connectRef = useRef<() => void>(() => {
    /* initialized below */
  });
  const scheduleReconnectRef = useRef<() => void>(() => {
    /* initialized below */
  });

  // -----------------------------------------------------------------------
  // Dispatch event to subscribers
  // -----------------------------------------------------------------------

  const dispatch = useCallback(
    (type: string, data: Record<string, unknown>) => {
      const handlers = listenersRef.current.get(type);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(data);
          } catch {
            // Individual handler errors must not break the loop
          }
        }
      }

      // Also dispatch to wildcard listeners
      const wildcardHandlers = listenersRef.current.get("*");
      if (wildcardHandlers) {
        for (const handler of wildcardHandlers) {
          try {
            handler({ ...data, _eventType: type });
          } catch {
            // ignore
          }
        }
      }
    },
    []
  );

  // -----------------------------------------------------------------------
  // Deduplication & sequencing
  // -----------------------------------------------------------------------

  const processEvent = useCallback(
    (type: string, data: Record<string, unknown>) => {
      const seq = data.sequence as number | undefined;

      // Deduplicate by sequence number
      if (seq !== undefined) {
        if (seenSequencesRef.current.has(seq)) {
          return;
        }
        seenSequencesRef.current.add(seq);
        lastSequenceRef.current = Math.max(lastSequenceRef.current, seq);

        // Keep the set bounded
        if (seenSequencesRef.current.size > 2000) {
          const sorted = Array.from(seenSequencesRef.current).sort(
            (a, b) => a - b
          );
          seenSequencesRef.current = new Set(sorted.slice(-1000));
        }
      }

      dispatch(type, data);
    },
    [dispatch]
  );

  // -----------------------------------------------------------------------
  // Replay offline buffer
  // -----------------------------------------------------------------------

  const replayBuffer = useCallback(() => {
    const buffered = offlineBufferRef.current.splice(0);
    for (const event of buffered) {
      processEvent(event.type, event.data);
    }
  }, [processEvent]);

  // -----------------------------------------------------------------------
  // Heartbeat management
  // -----------------------------------------------------------------------

  const clearHeartbeat = useCallback(() => {
    if (heartbeatPingTimerRef.current) {
      clearInterval(heartbeatPingTimerRef.current);
      heartbeatPingTimerRef.current = null;
    }
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current);
      heartbeatTimeoutRef.current = null;
    }
  }, []);

  const resetHeartbeatTimeout = useCallback(() => {
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current);
    }
    heartbeatTimeoutRef.current = setTimeout(() => {
      logger.warn("[Realtime] Heartbeat timeout - reconnecting");
      // Force disconnect current transport, trigger reconnect
      if (socketRef.current?.connected) {
        socketRef.current.disconnect();
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      connectedRef.current = false;
      setIsConnected(false);
      scheduleReconnectRef.current();
    }, HEARTBEAT_TIMEOUT_MS);
  }, []);

  const startHeartbeat = useCallback(
    (socket: Socket) => {
      clearHeartbeat();

      // Send a ping every 15s
      heartbeatPingTimerRef.current = setInterval(() => {
        if (socket.connected) {
          socket.emit("ping");
        }
      }, HEARTBEAT_INTERVAL_MS);

      // Listen for pong
      socket.on("pong", () => {
        resetHeartbeatTimeout();
      });

      // Also treat any incoming event as a sign of life
      socket.onAny(() => {
        resetHeartbeatTimeout();
      });

      resetHeartbeatTimeout();
    },
    [clearHeartbeat, resetHeartbeatTimeout]
  );

  // -----------------------------------------------------------------------
  // WebSocket transport (preferred)
  // -----------------------------------------------------------------------

  const connectWebSocket = useCallback(() => {
    try {
      const socket = connectSocket({
        onStatusChange: (status) => {
          if (status === "connected") {
            connectedRef.current = true;
            setIsConnected(true);
            setTransport("websocket");
            reconnectAttemptsRef.current = 0;
            startHeartbeat(socket);

            // Request missed events since our last sequence
            if (lastSequenceRef.current > 0) {
              socket.emit("replay", {
                lastSequence: lastSequenceRef.current,
              });
            }

            replayBuffer();
          } else if (status === "disconnected" || status === "error") {
            connectedRef.current = false;
            setIsConnected(false);
            clearHeartbeat();
          }
        },
        onError: (err) => {
          logger.error("[Realtime] WebSocket error:", err.message);
        },
      });

      socketRef.current = socket;

      // Listen for all events and route them
      socket.onAny((eventType: string, data: Record<string, unknown>) => {
        if (eventType === "pong") {
          return;
        }
        processEvent(eventType, data ?? {});
      });

      return true;
    } catch {
      return false;
    }
  }, [startHeartbeat, clearHeartbeat, replayBuffer, processEvent]);

  // -----------------------------------------------------------------------
  // SSE transport (fallback)
  // -----------------------------------------------------------------------

  const connectSSE = useCallback(() => {
    try {
      const apiMeta =
        typeof document === "undefined"
          ? null
          : document.querySelector<HTMLMetaElement>('meta[name="api-url"]');
      const apiUrl = apiMeta?.content || "http://localhost:4000";
      const lastSeq = lastSequenceRef.current;
      const url =
        lastSeq > 0
          ? `${apiUrl}/api/sse/stream?lastSequence=${lastSeq}`
          : `${apiUrl}/api/sse/stream`;

      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        connectedRef.current = true;
        setIsConnected(true);
        setTransport("sse");
        reconnectAttemptsRef.current = 0;
        replayBuffer();
      };

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as Record<string, unknown>;
          const type = (data.type as string) ?? "message";
          processEvent(type, data);
        } catch {
          // ignore parse errors
        }
      };

      // Named event types
      const knownEvents = [
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
        "heartbeat",
        "presence",
      ];

      for (const eventType of knownEvents) {
        es.addEventListener(eventType, (e) => {
          try {
            const data = JSON.parse((e as MessageEvent).data) as Record<
              string,
              unknown
            >;
            if (eventType === "heartbeat") {
              // heartbeat is just for liveness
              return;
            }
            processEvent(eventType, data);
          } catch {
            // ignore
          }
        });
      }

      es.onerror = () => {
        connectedRef.current = false;
        setIsConnected(false);
        es.close();
        eventSourceRef.current = null;
        scheduleReconnectRef.current();
      };

      return true;
    } catch {
      return false;
    }
  }, [replayBuffer, processEvent]);

  // -----------------------------------------------------------------------
  // Transport selection & reconnection
  // -----------------------------------------------------------------------

  const connect = useCallback(() => {
    // Prefer WebSocket, fall back to SSE
    const wsOk = connectWebSocket();
    if (!wsOk) {
      connectSSE();
    }
  }, [connectWebSocket, connectSSE]);

  const scheduleReconnect = useCallback(() => {
    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      logger.warn("[Realtime] Max reconnect attempts reached");
      return;
    }

    reconnectAttemptsRef.current++;
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** (reconnectAttemptsRef.current - 1),
      RECONNECT_MAX_DELAY_MS
    );
    // Add jitter (0-25%)
    const jitteredDelay = delay + Math.random() * delay * 0.25;

    reconnectTimerRef.current = setTimeout(() => {
      connectRef.current();
    }, jitteredDelay);
  }, []);

  // Keep refs current
  connectRef.current = connect;
  scheduleReconnectRef.current = scheduleReconnect;

  // -----------------------------------------------------------------------
  // Subscribe / Unsubscribe
  // -----------------------------------------------------------------------

  const subscribe = useCallback((eventType: string, handler: EventHandler) => {
    let handlers = listenersRef.current.get(eventType);
    if (!handlers) {
      handlers = new Set();
      listenersRef.current.set(eventType, handlers);
    }
    handlers.add(handler);
  }, []);

  const unsubscribe = useCallback(
    (eventType: string, handler: EventHandler) => {
      const handlers = listenersRef.current.get(eventType);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          listenersRef.current.delete(eventType);
        }
      }
    },
    []
  );

  // -----------------------------------------------------------------------
  // Queue events while offline
  // -----------------------------------------------------------------------

  // Expose a way for child hooks to queue events during disconnection
  // This is used internally by the provider when events arrive while reconnecting
  useEffect(() => {
    // On mount, connect
    connect();

    return () => {
      // Cleanup on unmount
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      clearHeartbeat();

      if (socketRef.current) {
        disconnectSocket();
        socketRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      connectedRef.current = false;
      setIsConnected(false);
      setTransport("none");
    };
  }, [connect, clearHeartbeat]);

  return (
    <RealtimeContext.Provider
      value={{ isConnected, transport, subscribe, unsubscribe }}
    >
      {children}
    </RealtimeContext.Provider>
  );
}
