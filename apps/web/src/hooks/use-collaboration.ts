"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSocket } from "@/hooks/use-socket";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CollaborationRole = "viewer" | "contributor" | "owner";

export interface CollaborationParticipant {
  avatar?: string;
  joinedAt: string;
  lastActivity: string;
  name: string;
  role: CollaborationRole;
  status: "active" | "idle" | "viewing";
  userId: string;
}

export interface CollaborationMessage {
  content: string;
  id: string;
  sender: "user" | "agent" | "system";
  senderName: string;
  timestamp: string;
  userId?: string;
}

interface ControlRequest {
  requestedAt: string;
  userId: string;
  userName: string;
}

interface UseCollaborationReturn {
  controlRequests: ControlRequest[];
  currentController: string | null;
  grantControl: (userId: string) => void;
  isConnected: boolean;
  join: () => void;
  leave: () => void;
  messages: CollaborationMessage[];
  myRole: CollaborationRole;
  participants: CollaborationParticipant[];
  requestControl: () => void;
  revokeControl: (userId: string) => void;
  sendMessage: (content: string) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IDLE_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCollaboration(sessionId: string): UseCollaborationReturn {
  const { isConnected, emit, on } = useSocket(
    sessionId ? `collab:${sessionId}` : undefined
  );

  const [participants, setParticipants] = useState<CollaborationParticipant[]>(
    []
  );
  const [myRole, setMyRole] = useState<CollaborationRole>("viewer");
  const [messages, setMessages] = useState<CollaborationMessage[]>([]);
  const [currentController, setCurrentController] = useState<string | null>(
    null
  );
  const [controlRequests, setControlRequests] = useState<ControlRequest[]>([]);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // -----------------------------------------------------------------------
  // Join / Leave
  // -----------------------------------------------------------------------

  const join = useCallback(() => {
    emit("collab:join", { sessionId });
  }, [emit, sessionId]);

  const leave = useCallback(() => {
    emit("collab:leave", { sessionId });
  }, [emit, sessionId]);

  // -----------------------------------------------------------------------
  // Messaging
  // -----------------------------------------------------------------------

  const sendMessage = useCallback(
    (content: string) => {
      if (!content.trim()) {
        return;
      }
      emit("collab:message", { sessionId, content: content.trim() });
    },
    [emit, sessionId]
  );

  // -----------------------------------------------------------------------
  // Control management
  // -----------------------------------------------------------------------

  const requestControl = useCallback(() => {
    emit("collab:request_control", { sessionId });
  }, [emit, sessionId]);

  const grantControl = useCallback(
    (userId: string) => {
      emit("collab:grant_control", { sessionId, userId });
    },
    [emit, sessionId]
  );

  const revokeControl = useCallback(
    (userId: string) => {
      emit("collab:revoke_control", { sessionId, userId });
    },
    [emit, sessionId]
  );

  // -----------------------------------------------------------------------
  // Idle detection and activity tracking
  // -----------------------------------------------------------------------

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
    }
    emit("collab:activity", { sessionId, status: "active" });
    idleTimerRef.current = setTimeout(() => {
      emit("collab:activity", { sessionId, status: "idle" });
    }, IDLE_TIMEOUT_MS);
  }, [emit, sessionId]);

  // -----------------------------------------------------------------------
  // Socket event listeners
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!(isConnected && sessionId)) {
      return;
    }

    const cleanups: Array<() => void> = [];

    // Participant list (received on join)
    cleanups.push(
      on("collab:participants", (...args: unknown[]) => {
        const data = args[0] as {
          participants?: CollaborationParticipant[];
          myRole?: CollaborationRole;
          controller?: string | null;
        };
        if (data.participants) {
          setParticipants(data.participants);
        }
        if (data.myRole) {
          setMyRole(data.myRole);
        }
        if (data.controller !== undefined) {
          setCurrentController(data.controller);
        }
      })
    );

    // Participant joined
    cleanups.push(
      on("collab:participant_joined", (...args: unknown[]) => {
        const participant = args[0] as CollaborationParticipant;
        if (!participant.userId) {
          return;
        }
        setParticipants((prev) => {
          if (prev.some((p) => p.userId === participant.userId)) {
            return prev;
          }
          return [...prev, participant];
        });
        setMessages((prev) => [
          ...prev,
          {
            id: `system-join-${participant.userId}-${Date.now()}`,
            sender: "system",
            senderName: "System",
            content: `${participant.name} joined the session`,
            timestamp: new Date().toISOString(),
          },
        ]);
      })
    );

    // Participant left
    cleanups.push(
      on("collab:participant_left", (...args: unknown[]) => {
        const data = args[0] as { userId: string; name?: string };
        if (!data.userId) {
          return;
        }
        setParticipants((prev) => prev.filter((p) => p.userId !== data.userId));
        setMessages((prev) => [
          ...prev,
          {
            id: `system-leave-${data.userId}-${Date.now()}`,
            sender: "system",
            senderName: "System",
            content: `${data.name ?? "A user"} left the session`,
            timestamp: new Date().toISOString(),
          },
        ]);
      })
    );

    // New message
    cleanups.push(
      on("collab:new_message", (...args: unknown[]) => {
        const msg = args[0] as CollaborationMessage;
        if (msg.id) {
          setMessages((prev) => [...prev, msg]);
        }
      })
    );

    // Control changed
    cleanups.push(
      on("collab:control_changed", (...args: unknown[]) => {
        const data = args[0] as {
          userId: string;
          role: CollaborationRole;
          name?: string;
        };
        setCurrentController(data.userId || null);
        setParticipants((prev) =>
          prev.map((p) =>
            p.userId === data.userId ? { ...p, role: data.role } : p
          )
        );
        setMessages((prev) => [
          ...prev,
          {
            id: `system-control-${data.userId}-${Date.now()}`,
            sender: "system",
            senderName: "System",
            content: `${data.name ?? "A user"} is now ${data.role}`,
            timestamp: new Date().toISOString(),
          },
        ]);
      })
    );

    // Control request
    cleanups.push(
      on("collab:control_request", (...args: unknown[]) => {
        const req = args[0] as ControlRequest;
        if (req.userId) {
          setControlRequests((prev) => {
            if (prev.some((r) => r.userId === req.userId)) {
              return prev;
            }
            return [...prev, req];
          });
        }
      })
    );

    // Control request resolved
    cleanups.push(
      on("collab:control_request_resolved", (...args: unknown[]) => {
        const data = args[0] as { userId: string };
        if (data.userId) {
          setControlRequests((prev) =>
            prev.filter((r) => r.userId !== data.userId)
          );
        }
      })
    );

    // Participant activity
    cleanups.push(
      on("collab:participant_activity", (...args: unknown[]) => {
        const data = args[0] as {
          userId: string;
          status: "active" | "idle" | "viewing";
        };
        if (data.userId) {
          setParticipants((prev) =>
            prev.map((p) =>
              p.userId === data.userId ? { ...p, status: data.status } : p
            )
          );
        }
      })
    );

    // Auto-join and set up idle detection
    join();
    resetIdleTimer();

    // Track user activity for idle detection
    const handleActivity = () => resetIdleTimer();
    if (typeof window !== "undefined") {
      window.addEventListener("mousemove", handleActivity);
      window.addEventListener("keydown", handleActivity);
    }

    return () => {
      for (const fn of cleanups) {
        fn();
      }
      leave();
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("mousemove", handleActivity);
        window.removeEventListener("keydown", handleActivity);
      }
    };
  }, [isConnected, sessionId, on, join, leave, resetIdleTimer]);

  return {
    participants,
    myRole,
    messages,
    currentController,
    controlRequests,
    isConnected,
    join,
    leave,
    sendMessage,
    requestControl,
    grantControl,
    revokeControl,
  };
}
