"use client";

import { useCallback, useEffect, useRef } from "react";
import { useSocketContext } from "@/providers/socket-provider";

/**
 * Hook for joining/leaving Socket.io rooms and listening to events.
 */
export function useSocket(room?: string): {
  socket: ReturnType<typeof useSocketContext>["socket"];
  status: ReturnType<typeof useSocketContext>["status"];
  joinRoom: (roomName: string) => void;
  leaveRoom: (roomName: string) => void;
  emit: (event: string, data: unknown) => void;
  on: (event: string, handler: (...args: unknown[]) => void) => () => void;
  isConnected: boolean;
} {
  const { socket, status } = useSocketContext();
  const joinedRooms = useRef<Set<string>>(new Set());

  const joinRoom = useCallback(
    (roomName: string) => {
      if (socket?.connected && !joinedRooms.current.has(roomName)) {
        socket.emit("join", { room: roomName });
        joinedRooms.current.add(roomName);
      }
    },
    [socket]
  );

  const leaveRoom = useCallback(
    (roomName: string) => {
      if (socket?.connected && joinedRooms.current.has(roomName)) {
        socket.emit("leave", { room: roomName });
        joinedRooms.current.delete(roomName);
      }
    },
    [socket]
  );

  const emit = useCallback(
    (event: string, data?: unknown) => {
      socket?.emit(event, data);
    },
    [socket]
  );

  const on = useCallback(
    (event: string, handler: (...args: unknown[]) => void) => {
      socket?.on(event, handler);
      return () => {
        socket?.off(event, handler);
      };
    },
    [socket]
  );

  // Auto join/leave the specified room
  useEffect(() => {
    if (!room) {
      return;
    }

    if (socket?.connected) {
      joinRoom(room);
    }

    // Also join when we reconnect
    const handleConnect = () => {
      if (room) {
        joinRoom(room);
      }
    };
    socket?.on("connect", handleConnect);

    return () => {
      socket?.off("connect", handleConnect);
      if (room) {
        leaveRoom(room);
      }
    };
  }, [room, socket, joinRoom, leaveRoom]);

  return {
    socket,
    status,
    isConnected: status === "connected",
    joinRoom,
    leaveRoom,
    emit,
    on,
  };
}
