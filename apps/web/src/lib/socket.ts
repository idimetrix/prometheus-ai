"use client";

import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 15;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

function getBackoffDelay(attempt: number): number {
  const delay = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  // Add jitter (0-25% of delay)
  return delay + Math.random() * delay * 0.25;
}

async function getClerkToken(): Promise<string | null> {
  try {
    const session = (
      window as unknown as {
        Clerk?: { session?: { getToken: () => Promise<string> } };
      }
    ).Clerk?.session;
    if (session) {
      return await session.getToken();
    }
  } catch {
    // Clerk not loaded yet
  }
  return null;
}

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export interface SocketConfig {
  onError?: (error: Error) => void;
  onStatusChange?: (status: ConnectionStatus) => void;
  url?: string;
}

export function getSocket(config?: SocketConfig): Socket {
  if (socket) {
    return socket;
  }

  const url =
    config?.url ??
    process.env.NEXT_PUBLIC_SOCKET_URL ??
    "http://localhost:4001";

  socket = io(url, {
    autoConnect: false,
    transports: ["websocket", "polling"],
    reconnection: false, // We handle reconnection manually for exponential backoff
    auth: async (cb) => {
      const token = await getClerkToken();
      cb({ token });
    },
  });

  socket.on("connect", () => {
    reconnectAttempts = 0;
    config?.onStatusChange?.("connected");
  });

  socket.on("disconnect", (reason) => {
    config?.onStatusChange?.("disconnected");
    if (reason !== "io client disconnect") {
      scheduleReconnect(config);
    }
  });

  socket.on("connect_error", (error) => {
    config?.onStatusChange?.("error");
    config?.onError?.(error);
    scheduleReconnect(config);
  });

  return socket;
}

function scheduleReconnect(config?: SocketConfig) {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    return;
  }
  if (!socket) {
    return;
  }

  reconnectAttempts++;
  const delay = getBackoffDelay(reconnectAttempts);

  config?.onStatusChange?.("connecting");

  setTimeout(() => {
    if (socket && !socket.connected) {
      socket.connect();
    }
  }, delay);
}

export function connectSocket(config?: SocketConfig): Socket {
  const s = getSocket(config);
  if (!s.connected) {
    config?.onStatusChange?.("connecting");
    s.connect();
  }
  return s;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
    reconnectAttempts = 0;
  }
}

export function joinRoom(room: string): void {
  socket?.emit("join", { room });
}

export function leaveRoom(room: string): void {
  socket?.emit("leave", { room });
}
