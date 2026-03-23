"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSessionStore } from "../stores/session.store";

export interface ChatMessage {
  agentRole?: string;
  content: string;
  id: string;
  role: "user" | "agent" | "system";
  timestamp: string;
}

export function useAgentChat(sessionId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const eventSourceRef = useRef<EventSource | null>(null);
  const _store = useSessionStore();

  const sendMessage = useCallback(
    (content: string) => {
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMessage]);

      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

      fetch(`${apiUrl}/api/sessions/${sessionId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      }).catch(() => {
        // Network error — add system message
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "system",
            content: "Failed to send message. Please try again.",
            timestamp: new Date().toISOString(),
          },
        ]);
      });
    },
    [sessionId]
  );

  // Listen for agent chat events from the SSE stream
  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
    const url = `${apiUrl}/api/sse/sessions/${sessionId}/stream`;

    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.addEventListener("chat_message", (e) => {
      try {
        const data = JSON.parse(e.data) as {
          agentRole?: string;
          content: string;
          id?: string;
          role?: "agent" | "system";
          timestamp?: string;
        };

        setIsStreaming(false);
        setStreamingContent("");

        const message: ChatMessage = {
          id: data.id ?? crypto.randomUUID(),
          role: data.role ?? "agent",
          content: data.content,
          timestamp: data.timestamp ?? new Date().toISOString(),
          agentRole: data.agentRole,
        };

        setMessages((prev) => [...prev, message]);
      } catch {
        /* ignore parse errors */
      }
    });

    es.addEventListener("chat_token", (e) => {
      try {
        const data = JSON.parse(e.data) as { token: string };
        setIsStreaming(true);
        setStreamingContent((prev) => prev + data.token);
      } catch {
        /* ignore parse errors */
      }
    });

    es.addEventListener("chat_stream_end", () => {
      setIsStreaming(false);
      setStreamingContent("");
    });

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [sessionId]);

  return { messages, sendMessage, isStreaming, streamingContent };
}
