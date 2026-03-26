"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface StreamToken {
  content: string;
  timestamp: number;
}

export interface ToolCallEvent {
  args?: Record<string, unknown>;
  id: string;
  name: string;
  result?: unknown;
  status: "pending" | "running" | "completed" | "failed";
}

interface UseAgentStreamOptions {
  apiUrl?: string;
  autoConnect?: boolean;
  sessionId: string;
}

export function useAgentStream(options: UseAgentStreamOptions) {
  const { sessionId, apiUrl = "/api/sse", autoConnect = true } = options;
  const [tokens, setTokens] = useState<StreamToken[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCallEvent[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retriesRef = useRef(0);
  const maxRetries = 10;

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      return;
    }

    const url = `${apiUrl}/api/sse/sessions/${encodeURIComponent(sessionId)}/stream`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      setIsStreaming(true);
      retriesRef.current = 0;
    };

    es.addEventListener("token", (e) => {
      try {
        const data = JSON.parse(e.data) as { content: string };
        setTokens((prev) => [
          ...prev,
          { content: data.content, timestamp: Date.now() },
        ]);
      } catch {
        /* ignore parse errors */
      }
    });

    es.addEventListener("tool_call", (e) => {
      try {
        const data = JSON.parse(e.data) as ToolCallEvent;
        setToolCalls((prev) => {
          const idx = prev.findIndex((tc) => tc.id === data.id);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = data;
            return updated;
          }
          return [...prev, data];
        });
      } catch {
        /* ignore parse errors */
      }
    });

    es.addEventListener("done", () => {
      setIsStreaming(false);
      es.close();
      eventSourceRef.current = null;
    });

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
      setIsStreaming(false);
      if (retriesRef.current < maxRetries) {
        retriesRef.current++;
        const delay = Math.min(1000 * 2 ** retriesRef.current, 30_000);
        reconnectTimerRef.current = setTimeout(connect, delay);
      }
    };
  }, [sessionId, apiUrl]);

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setIsStreaming(false);
  }, []);

  useEffect(() => {
    if (autoConnect) {
      connect();
    }
    return disconnect;
  }, [autoConnect, connect, disconnect]);

  const send = useCallback(
    async (message: string) => {
      await fetch(`${apiUrl}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message }),
      });
    },
    [sessionId, apiUrl]
  );

  return { tokens, toolCalls, isStreaming, send, connect, disconnect };
}
