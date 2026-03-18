"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Socket } from "socket.io-client";
import {
  type ConnectionStatus,
  connectSocket,
  disconnectSocket,
} from "@/lib/socket";

interface SocketContextValue {
  socket: Socket | null;
  status: ConnectionStatus;
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  status: "disconnected",
});

export function useSocketContext() {
  return useContext(SocketContext);
}

export function SocketProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = connectSocket({
      onStatusChange: setStatus,
      onError: (err) => {
        console.error("[SocketProvider] connection error:", err.message);
      },
    });
    socketRef.current = socket;

    return () => {
      disconnectSocket();
      socketRef.current = null;
      setStatus("disconnected");
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, status }}>
      {children}
    </SocketContext.Provider>
  );
}

/**
 * Connection status indicator component.
 * Shows a colored dot with connection state text.
 */
export function ConnectionStatusIndicator() {
  const { status } = useSocketContext();

  const config: Record<ConnectionStatus, { color: string; label: string }> = {
    connected: { color: "bg-green-500", label: "Connected" },
    connecting: {
      color: "bg-yellow-500 animate-pulse",
      label: "Connecting...",
    },
    disconnected: { color: "bg-zinc-600", label: "Disconnected" },
    error: { color: "bg-red-500", label: "Connection Error" },
  };

  const { color, label } = config[status];

  return (
    <div className="flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      <span className="text-xs text-zinc-400">{label}</span>
    </div>
  );
}
