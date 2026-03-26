"use client";

import { useCallback, useEffect, useRef } from "react";
import type { Socket } from "socket.io-client";
import { logger } from "@/lib/logger";
import { getNamespaceSocket } from "@/lib/socket";
import { useSessionStore } from "@/stores/session.store";

/**
 * Hook that connects to the Socket.io /sessions namespace, joins the
 * session room, and listens for all agent streaming events.
 *
 * Updates the session Zustand store with incoming events so UI
 * components reactively render agent output, terminal lines,
 * plan progress, file changes, etc.
 */
export function useSessionSocket(sessionId: string | null) {
  const socketRef = useRef<Socket | null>(null);
  const store = useSessionStore();
  const storeRef = useRef(store);
  storeRef.current = store;

  const connect = useCallback(() => {
    if (!sessionId) {
      return;
    }

    // Get or create a socket for the /sessions namespace
    const socket = getNamespaceSocket("/sessions");
    socketRef.current = socket;

    // Join the session room once connected
    const onConnect = () => {
      socket.emit("join_session", { sessionId });
      storeRef.current.setConnected(true);
      storeRef.current.setActiveSession(sessionId);
      logger.info(`[WS] Connected to session ${sessionId}`);
    };

    if (socket.connected) {
      onConnect();
    } else {
      socket.on("connect", onConnect);
    }

    // Acknowledge join
    socket.on("session_joined", () => {
      logger.debug(`[WS] Joined session room ${sessionId}`);
    });

    // ---- Agent streaming events (canonical) ----

    // agent:thinking — LLM token streaming (partial text)
    socket.on(
      "agent:thinking",
      (data: {
        content?: string;
        agentRole?: string;
        streaming?: boolean;
        sequence?: number;
        timestamp?: string;
      }) => {
        if (data.content) {
          storeRef.current.addTerminalLine({
            content: data.content,
            timestamp: data.timestamp,
          });
          storeRef.current.addEvent({
            id: crypto.randomUUID(),
            type: "agent:thinking",
            data: data as Record<string, unknown>,
            timestamp: data.timestamp ?? new Date().toISOString(),
          });
        }
      }
    );

    // agent:terminal — Terminal command output
    socket.on(
      "agent:terminal",
      (data: {
        command?: string;
        output?: string;
        success?: boolean;
        timestamp?: string;
      }) => {
        const content = data.output
          ? `$ ${data.command ?? ""}\n${data.output}`
          : `$ ${data.command ?? ""}`;
        storeRef.current.addTerminalLine({
          content,
          timestamp: data.timestamp,
        });
        storeRef.current.addEvent({
          id: crypto.randomUUID(),
          type: "agent:terminal",
          data: data as Record<string, unknown>,
          timestamp: data.timestamp ?? new Date().toISOString(),
        });
      }
    );

    // agent:file-change — File write with diff
    socket.on(
      "agent:file-change",
      (data: {
        filePath?: string;
        tool?: string;
        diff?: string;
        agentRole?: string;
        timestamp?: string;
      }) => {
        if (data.filePath) {
          storeRef.current.addFileEntry({
            path: data.filePath,
            name: data.filePath.split("/").pop() ?? data.filePath,
            type: "file",
            status: "modified",
          });
        }
        storeRef.current.addEvent({
          id: crypto.randomUUID(),
          type: "agent:file-change",
          data: data as Record<string, unknown>,
          timestamp: data.timestamp ?? new Date().toISOString(),
        });
      }
    );

    // agent:progress — Task progress (step N of M)
    socket.on(
      "agent:progress",
      (data: {
        step?: number;
        totalSteps?: number;
        status?: string;
        agentRole?: string;
        confidence?: number;
        timestamp?: string;
      }) => {
        if (data.status) {
          storeRef.current.setStatus(data.status);
        }
        storeRef.current.addEvent({
          id: crypto.randomUUID(),
          type: "agent:progress",
          data: data as Record<string, unknown>,
          timestamp: data.timestamp ?? new Date().toISOString(),
        });
      }
    );

    // task:complete — Task completion with summary
    socket.on(
      "task:complete",
      (data: {
        success?: boolean;
        output?: string;
        filesChanged?: string[];
        status?: string;
        timestamp?: string;
      }) => {
        storeRef.current.setStatus(data.status ?? "completed");
        storeRef.current.addEvent({
          id: crypto.randomUUID(),
          type: "task:complete",
          data: data as Record<string, unknown>,
          timestamp: data.timestamp ?? new Date().toISOString(),
        });
      }
    );

    // task:created — New task enqueued
    socket.on(
      "task:created",
      (data: { taskId?: string; status?: string; timestamp?: string }) => {
        storeRef.current.addEvent({
          id: crypto.randomUUID(),
          type: "task:created",
          data: data as Record<string, unknown>,
          timestamp: data.timestamp ?? new Date().toISOString(),
        });
      }
    );

    // session:checkpoint — Checkpoint saved
    socket.on(
      "session:checkpoint",
      (data: {
        checkpointType?: string;
        reason?: string;
        affectedFiles?: string[];
        timestamp?: string;
      }) => {
        storeRef.current.addEvent({
          id: crypto.randomUUID(),
          type: "session:checkpoint",
          data: data as Record<string, unknown>,
          timestamp: data.timestamp ?? new Date().toISOString(),
        });
      }
    );

    // session:error — Error event
    socket.on(
      "session:error",
      (data: {
        error?: string;
        recoverable?: boolean;
        agentRole?: string;
        timestamp?: string;
      }) => {
        storeRef.current.addEvent({
          id: crypto.randomUUID(),
          type: "session:error",
          data: data as Record<string, unknown>,
          timestamp: data.timestamp ?? new Date().toISOString(),
        });
      }
    );

    // ---- Legacy / backward-compat events ----

    socket.on(
      "agent_output",
      (data: { content?: string; timestamp?: string }) => {
        if (data.content) {
          storeRef.current.addTerminalLine({
            content: data.content,
            timestamp: data.timestamp,
          });
          storeRef.current.addEvent({
            id: crypto.randomUUID(),
            type: "agent_output",
            data: data as Record<string, unknown>,
            timestamp: data.timestamp ?? new Date().toISOString(),
          });
        }
      }
    );

    socket.on(
      "terminal_output",
      (data: { content?: string; output?: string; timestamp?: string }) => {
        storeRef.current.addTerminalLine({
          content: data.content ?? data.output ?? "",
          timestamp: data.timestamp,
        });
      }
    );

    socket.on(
      "plan_update",
      (data: { steps?: import("@/stores/session.store").PlanStep[] }) => {
        if (data.steps) {
          storeRef.current.setPlanSteps(data.steps);
        }
      }
    );

    socket.on(
      "plan_step_update",
      (data: {
        stepId?: string;
        status?: string;
        title?: string;
        description?: string;
      }) => {
        if (data.stepId) {
          storeRef.current.updatePlanStep(data.stepId, {
            status: data.status,
            title: data.title,
            description: data.description,
          });
        }
      }
    );

    socket.on(
      "file_change",
      (data: {
        files?: import("@/stores/session.store").FileEntry[];
        file?: import("@/stores/session.store").FileEntry;
      }) => {
        if (data.files) {
          storeRef.current.setFileTree(data.files);
        } else if (data.file) {
          storeRef.current.addFileEntry(data.file);
        }
      }
    );

    socket.on("file_diff", (data: Record<string, unknown>) => {
      storeRef.current.addEvent({
        id: crypto.randomUUID(),
        type: "file_diff",
        data,
        timestamp: new Date().toISOString(),
      });
    });

    socket.on("agent_status", (data: Record<string, unknown>) => {
      storeRef.current.addEvent({
        id: crypto.randomUUID(),
        type: "agent_status",
        data,
        timestamp: new Date().toISOString(),
      });
    });

    socket.on("queue_position", (data: { position?: number }) => {
      if (data.position !== undefined) {
        storeRef.current.setQueuePosition(data.position);
      }
    });

    socket.on(
      "task_status",
      (data: { status?: string; [key: string]: unknown }) => {
        if (data.status) {
          storeRef.current.setStatus(data.status);
        }
        storeRef.current.addEvent({
          id: crypto.randomUUID(),
          type: "task_status",
          data: data as Record<string, unknown>,
          timestamp: new Date().toISOString(),
        });
      }
    );

    socket.on("reasoning", (data: { content?: string; thought?: string }) => {
      storeRef.current.addReasoning(data.content ?? data.thought ?? "");
      storeRef.current.addTerminalLine({
        content: `[THINK] ${data.content ?? data.thought ?? ""}`,
        timestamp: new Date().toISOString(),
      });
    });

    socket.on("session_complete", (data: { status?: string }) => {
      storeRef.current.setStatus(data.status ?? "completed");
    });

    socket.on("credit_update", (data: { creditsConsumed?: number }) => {
      if (data.creditsConsumed !== undefined) {
        storeRef.current.addCreditEntry(data.creditsConsumed);
      }
    });

    socket.on("disconnect", () => {
      storeRef.current.setConnected(false);
      logger.debug(`[WS] Disconnected from session ${sessionId}`);
    });
  }, [sessionId]);

  const disconnect = useCallback(() => {
    const socket = socketRef.current;
    if (socket && sessionId) {
      socket.emit("leave_session", { sessionId });
      socket.removeAllListeners();
    }
    socketRef.current = null;
    storeRef.current.setConnected(false);
  }, [sessionId]);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  const isConnected = useSessionStore((s) => s.isConnected);
  return { isConnected };
}
