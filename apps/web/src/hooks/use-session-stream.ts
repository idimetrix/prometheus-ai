"use client";
import { useCallback, useEffect, useRef } from "react";
import { useSessionStore } from "../stores/session.store";

const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 10;

/**
 * Synchronously get an auth token for SSE connections.
 * EventSource doesn't support async setup, so we read from Clerk's
 * window global or fall back to the dev bypass token.
 */
function getAuthTokenSync(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  // Try Clerk session token from window global
  try {
    const clerkSession = (
      window as unknown as {
        Clerk?: { session?: { lastToken?: { getRawString?: () => string } } };
      }
    ).Clerk?.session;
    const raw = clerkSession?.lastToken?.getRawString?.();
    if (raw) {
      return raw;
    }
  } catch {
    // Clerk not ready
  }

  // Dev auth bypass
  if (process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === "true") {
    return "dev_token_usr_seed_dev001__org_seed_dev001";
  }

  return null;
}

export function useSessionStream(sessionId: string | null) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const store = useSessionStore();

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

    // Build URL with auth token — EventSource doesn't support custom headers,
    // so we pass the token as a query parameter.
    const token = getAuthTokenSync();
    const params = token ? `?token=${encodeURIComponent(token)}` : "";
    const url = `${apiUrl}/api/sse/sessions/${sessionId}/stream${params}`;

    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      store.setConnected(true);
      store.setActiveSession(sessionId);
      reconnectAttempts.current = 0;
    };

    // Terminal / agent output
    es.addEventListener("agent_output", (e) => {
      try {
        const data = JSON.parse(e.data);
        store.addTerminalLine({
          content: data.content,
          timestamp: data.timestamp,
        });
        store.addEvent({
          id: crypto.randomUUID(),
          type: "agent_output",
          data,
          timestamp: data.timestamp ?? new Date().toISOString(),
        });
      } catch {
        /* ignore parse errors */
      }
    });

    es.addEventListener("terminal_output", (e) => {
      try {
        const data = JSON.parse(e.data);
        store.addTerminalLine({
          content: data.content,
          timestamp: data.timestamp,
        });
      } catch {
        /* ignore */
      }
    });

    // Plan updates
    es.addEventListener("plan_update", (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.steps) {
          store.setPlanSteps(data.steps);
        }
      } catch {
        /* ignore */
      }
    });

    es.addEventListener("plan_step_update", (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.stepId) {
          store.updatePlanStep(data.stepId, {
            status: data.status,
            title: data.title,
            description: data.description,
          });
        }
      } catch {
        /* ignore */
      }
    });

    // File changes
    es.addEventListener("file_change", (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.files) {
          store.setFileTree(data.files);
        } else if (data.file) {
          store.addFileEntry(data.file);
        }
      } catch {
        /* ignore */
      }
    });

    // Code diffs
    es.addEventListener("file_diff", (e) => {
      try {
        const data = JSON.parse(e.data);
        store.addEvent({
          id: crypto.randomUUID(),
          type: "file_diff",
          data,
          timestamp: new Date().toISOString(),
        });
      } catch {
        /* ignore */
      }
    });

    es.addEventListener("code_change", (e) => {
      try {
        const data = JSON.parse(e.data);
        store.addEvent({
          id: crypto.randomUUID(),
          type: "code_change",
          data,
          timestamp: new Date().toISOString(),
        });
      } catch {
        /* ignore */
      }
    });

    // Agent status
    es.addEventListener("agent_status", (e) => {
      try {
        const data = JSON.parse(e.data);
        store.addEvent({
          id: crypto.randomUUID(),
          type: "agent_status",
          data,
          timestamp: new Date().toISOString(),
        });
      } catch {
        /* ignore */
      }
    });

    // Queue position
    es.addEventListener("queue_position", (e) => {
      try {
        const data = JSON.parse(e.data);
        store.setQueuePosition(data.position);
      } catch {
        /* ignore */
      }
    });

    // Task status
    es.addEventListener("task_status", (e) => {
      try {
        const data = JSON.parse(e.data);
        store.setStatus(data.status);
        store.addEvent({
          id: crypto.randomUUID(),
          type: "task_status",
          data,
          timestamp: new Date().toISOString(),
        });
      } catch {
        /* ignore */
      }
    });

    // Reasoning/thinking
    es.addEventListener("reasoning", (e) => {
      try {
        const data = JSON.parse(e.data);
        store.addReasoning(data.content ?? data.thought ?? "");
        store.addTerminalLine({
          content: `[THINK] ${data.content ?? data.thought ?? ""}`,
          timestamp: new Date().toISOString(),
        });
      } catch {
        /* ignore */
      }
    });

    // Session complete
    es.addEventListener("session_complete", (e) => {
      try {
        const data = JSON.parse(e.data);
        store.setStatus(data.status ?? "completed");
      } catch {
        store.setStatus("completed");
      }
    });

    // Error handling with auto-reconnect
    es.onerror = () => {
      store.setConnected(false);
      es.close();
      eventSourceRef.current = null;

      if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts.current += 1;
        const delay =
          RECONNECT_DELAY_MS * Math.min(reconnectAttempts.current, 5);
        reconnectTimer.current = setTimeout(connect, delay);
      }
    };
  }, [sessionId, store]);

  const disconnect = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    store.setConnected(false);
  }, [store]);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return { isConnected: store.isConnected };
}
