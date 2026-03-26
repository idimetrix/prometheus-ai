"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { logger } from "@/lib/logger";
import { getNamespaceSocket } from "@/lib/socket";
import { useSessionStore } from "@/stores/session.store";

/** Maximum age (in ms) for a persisted session to be considered reconnectable */
const MAX_SESSION_AGE_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Hook that manages session reconnection after browser close/refresh.
 *
 * On mount, checks localStorage for a previously active session ID.
 * If found, attempts to reconnect to the socket server and replays
 * missed events. Exposes state for UI feedback (banner).
 *
 * @returns Reconnection state and controls
 */
export function useSessionReconnect() {
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [replayCount, setReplayCount] = useState(0);
  const [hasReconnected, setHasReconnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const store = useSessionStore();
  const storeRef = useRef(store);
  storeRef.current = store;

  const attemptReconnect = useCallback(() => {
    const persistedId = storeRef.current.getPersistedSessionId();
    const persistedTimestamp = storeRef.current.getPersistedTimestamp();

    if (!persistedId) {
      return;
    }

    // Check if the persisted session is too old
    if (persistedTimestamp) {
      const age = Date.now() - new Date(persistedTimestamp).getTime();
      if (age > MAX_SESSION_AGE_MS) {
        logger.info(
          `[Reconnect] Persisted session ${persistedId} expired (${Math.round(age / 1000)}s old)`
        );
        storeRef.current.clearPersistedSession();
        return;
      }
    }

    // Already connected to this session
    if (
      storeRef.current.activeSessionId === persistedId &&
      storeRef.current.isConnected
    ) {
      return;
    }

    logger.info(
      `[Reconnect] Attempting to reconnect to session ${persistedId}`
    );
    setIsReconnecting(true);
    setError(null);
    storeRef.current.setConnectionState("reconnecting");

    try {
      const socket = getNamespaceSocket("/sessions");
      socketRef.current = socket;

      const onConnect = () => {
        const joinPayload: {
          sessionId: string;
          lastEventTimestamp?: string;
        } = { sessionId: persistedId };

        if (persistedTimestamp) {
          joinPayload.lastEventTimestamp = persistedTimestamp;
        }

        socket.emit("join_session", joinPayload);
        logger.info(
          `[Reconnect] Sent join_session for ${persistedId}${
            persistedTimestamp
              ? ` with lastEventTimestamp=${persistedTimestamp}`
              : ""
          }`
        );
      };

      // Handle session_joined acknowledgment
      const onSessionJoined = () => {
        storeRef.current.setActiveSession(persistedId);
        storeRef.current.setConnected(true);
        storeRef.current.setConnectionState("connected");
        setHasReconnected(true);
        setIsReconnecting(false);

        logger.info(`[Reconnect] Successfully reconnected to ${persistedId}`);

        // Auto-dismiss after 3 seconds
        dismissTimerRef.current = setTimeout(() => {
          setHasReconnected(false);
          setReplayCount(0);
        }, 3000);
      };

      // Count replayed events
      let replayed = 0;
      const onSessionEvent = (data: { replayed?: boolean }) => {
        if (data.replayed) {
          replayed++;
          setReplayCount(replayed);
          storeRef.current.setReconnectReplayCount(replayed);
        }
      };

      const onConnectError = (err: Error) => {
        logger.error(`[Reconnect] Connection failed: ${err.message}`);
        setError("Failed to reconnect to session");
        setIsReconnecting(false);
        storeRef.current.setConnectionState("disconnected");

        // Clean up listeners
        socket.off("connect", onConnect);
        socket.off("session_joined", onSessionJoined);
        socket.off("session_event", onSessionEvent);
        socket.off("connect_error", onConnectError);
      };

      socket.on("session_joined", onSessionJoined);
      socket.on("session_event", onSessionEvent);
      socket.on("connect_error", onConnectError);

      if (socket.connected) {
        onConnect();
      } else {
        socket.on("connect", onConnect);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[Reconnect] Error: ${msg}`);
      setError("Failed to reconnect");
      setIsReconnecting(false);
      storeRef.current.setConnectionState("disconnected");
    }
  }, []);

  const dismiss = useCallback(() => {
    setHasReconnected(false);
    setReplayCount(0);
    setError(null);
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);

  // Attempt reconnect on mount
  useEffect(() => {
    attemptReconnect();

    return () => {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
      }
    };
  }, [attemptReconnect]);

  return {
    isReconnecting,
    hasReconnected,
    replayCount,
    error,
    dismiss,
    attemptReconnect,
  };
}
