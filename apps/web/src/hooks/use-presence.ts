"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSocket } from "@/hooks/use-socket";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PresenceStatus = "online" | "idle" | "away";

export interface PresenceUser {
  avatar?: string;
  lastSeen: Date;
  name: string;
  status: PresenceStatus;
  userId: string;
  viewing?: string;
}

interface PresenceData {
  avatar?: string;
  name?: string;
  status?: PresenceStatus;
  viewing?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const PRESENCE_BROADCAST_INTERVAL_MS = 30_000; // 30 seconds

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Track who is online in a given room (org, project, session, etc.) and
 * broadcast our own presence.
 *
 * ```tsx
 * const { users, updatePresence } = usePresence("org:abc123");
 * updatePresence({ viewing: "/sessions/xyz" });
 * ```
 */
export function usePresence(roomId: string) {
  const { isConnected, emit, on } = useSocket(
    roomId ? `presence:${roomId}` : undefined
  );
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const broadcastTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const localPresenceRef = useRef<PresenceData>({});

  // -----------------------------------------------------------------------
  // Broadcast our own presence
  // -----------------------------------------------------------------------

  const broadcastPresence = useCallback(
    (data?: Partial<PresenceData>) => {
      if (data) {
        localPresenceRef.current = { ...localPresenceRef.current, ...data };
      }
      emit("presence:update", {
        room: roomId,
        ...localPresenceRef.current,
      });
    },
    [emit, roomId]
  );

  const updatePresence = useCallback(
    (data: Partial<PresenceData>) => {
      localPresenceRef.current = { ...localPresenceRef.current, ...data };
      broadcastPresence(data);

      // Reset idle timer on activity
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
      }
      idleTimerRef.current = setTimeout(() => {
        broadcastPresence({ status: "idle" });
      }, IDLE_TIMEOUT_MS);
    },
    [broadcastPresence]
  );

  // -----------------------------------------------------------------------
  // Listen for presence events
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!(isConnected && roomId)) {
      return;
    }

    // Handle full presence list (received on join)
    const offList = on("presence:list", (...args: unknown[]) => {
      const data = args[0] as { users?: PresenceUser[] };
      if (data.users) {
        setUsers(
          data.users.map((u) => ({
            ...u,
            lastSeen: new Date(u.lastSeen),
          }))
        );
      }
    });

    // Handle individual user presence updates
    const offUpdate = on("presence:user_update", (...args: unknown[]) => {
      const userData = args[0] as PresenceUser;
      if (!userData.userId) {
        return;
      }
      setUsers((prev) => {
        const idx = prev.findIndex((u) => u.userId === userData.userId);
        const updated: PresenceUser = {
          ...userData,
          lastSeen: new Date(userData.lastSeen),
        };
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = updated;
          return next;
        }
        return [...prev, updated];
      });
    });

    // Handle user leaving
    const offLeave = on("presence:user_leave", (...args: unknown[]) => {
      const data = args[0] as { userId?: string };
      if (data.userId) {
        setUsers((prev) => prev.filter((u) => u.userId !== data.userId));
      }
    });

    // Broadcast initial presence and request member list
    broadcastPresence({ status: "online" });

    // Periodic re-broadcast so others know we're still alive
    broadcastTimerRef.current = setInterval(() => {
      broadcastPresence();
    }, PRESENCE_BROADCAST_INTERVAL_MS);

    // Start idle detection
    idleTimerRef.current = setTimeout(() => {
      broadcastPresence({ status: "idle" });
    }, IDLE_TIMEOUT_MS);

    return () => {
      offList();
      offUpdate();
      offLeave();

      if (broadcastTimerRef.current) {
        clearInterval(broadcastTimerRef.current);
        broadcastTimerRef.current = null;
      }
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }

      // Announce departure
      emit("presence:leave", { room: roomId });
    };
  }, [isConnected, roomId, on, emit, broadcastPresence]);

  // -----------------------------------------------------------------------
  // Track navigation changes and broadcast them
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleVisibilityChange = () => {
      if (document.hidden) {
        broadcastPresence({ status: "away" });
      } else {
        broadcastPresence({ status: "online" });
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [broadcastPresence]);

  return {
    users,
    updatePresence,
  };
}
