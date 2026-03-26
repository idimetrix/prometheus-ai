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

  // Dev auth bypass — read from meta tag to avoid Turbopack compile-time inlining
  const devBypassMeta = document.querySelector<HTMLMetaElement>(
    'meta[name="dev-auth-bypass"]'
  );
  if (devBypassMeta?.content === "true") {
    return "dev_token_usr_seed_dev001__org_seed_dev001";
  }

  return null;
}

export function useSessionStream(sessionId: string | null) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const store = useSessionStore();
  const storeRef = useRef(store);
  storeRef.current = store;

  const connect = useCallback(() => {
    if (!sessionId) {
      return;
    }

    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    // Derive API URL at runtime — use meta tag for production, localhost for dev
    const apiMeta =
      typeof document === "undefined"
        ? null
        : document.querySelector<HTMLMetaElement>('meta[name="api-url"]');
    const apiUrl =
      apiMeta?.content ||
      (typeof window !== "undefined" &&
      (window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1")
        ? `http://${window.location.hostname}:4000`
        : `${window.location.protocol}//${window.location.hostname}:4000`);

    // Build URL with auth token — EventSource doesn't support custom headers,
    // so we pass the token as a query parameter.
    const token = getAuthTokenSync();
    const params = token ? `?token=${encodeURIComponent(token)}` : "";
    const url = `${apiUrl}/api/sse/sessions/${sessionId}/stream${params}`;

    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      storeRef.current.setConnected(true);
      storeRef.current.setActiveSession(sessionId);
      reconnectAttempts.current = 0;
    };

    // Terminal / agent output
    es.addEventListener("agent_output", (e) => {
      try {
        const data = JSON.parse(e.data);
        storeRef.current.addTerminalLine({
          content: data.content,
          timestamp: data.timestamp,
        });
        storeRef.current.addEvent({
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
        storeRef.current.addTerminalLine({
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
          storeRef.current.setPlanSteps(data.steps);
        }
      } catch {
        /* ignore */
      }
    });

    es.addEventListener("plan_step_update", (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.stepId) {
          storeRef.current.updatePlanStep(data.stepId, {
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
          storeRef.current.setFileTree(data.files);
        } else if (data.file) {
          storeRef.current.addFileEntry(data.file);
        }
      } catch {
        /* ignore */
      }
    });

    // Code diffs
    es.addEventListener("file_diff", (e) => {
      try {
        const data = JSON.parse(e.data);
        storeRef.current.addEvent({
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
        storeRef.current.addEvent({
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
        storeRef.current.addEvent({
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
        storeRef.current.setQueuePosition(data.position);
      } catch {
        /* ignore */
      }
    });

    // Task status
    es.addEventListener("task_status", (e) => {
      try {
        const data = JSON.parse(e.data);
        storeRef.current.setStatus(data.status);
        storeRef.current.addEvent({
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
        storeRef.current.addReasoning(data.content ?? data.thought ?? "");
        storeRef.current.addTerminalLine({
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
        storeRef.current.setStatus(data.status ?? "completed");
      } catch {
        storeRef.current.setStatus("completed");
      }
    });

    // Error handling with auto-reconnect
    es.onerror = () => {
      storeRef.current.setConnected(false);
      es.close();
      eventSourceRef.current = null;

      if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts.current += 1;
        const delay =
          RECONNECT_DELAY_MS * Math.min(reconnectAttempts.current, 5);
        reconnectTimer.current = setTimeout(connect, delay);
      }
    };
  }, [sessionId]);

  const disconnect = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    storeRef.current.setConnected(false);
  }, []);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  const isConnected = useSessionStore((s) => s.isConnected);
  return { isConnected };
}
