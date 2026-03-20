import { createLogger } from "@prometheus/logger";
import type { Socket } from "socket.io";

const logger = createLogger("socket-server:backpressure");

const DEFAULT_HIGH_WATER_MARK = 128;
const DEFAULT_LOW_WATER_MARK = 32;

interface BackpressureState {
  bufferedCount: number;
  highWaterMark: number;
  isPaused: boolean;
  lowWaterMark: number;
}

const socketStates = new Map<string, BackpressureState>();

export function initBackpressure(
  socket: Socket,
  highWaterMark = DEFAULT_HIGH_WATER_MARK,
  lowWaterMark = DEFAULT_LOW_WATER_MARK
): void {
  socketStates.set(socket.id, {
    bufferedCount: 0,
    highWaterMark,
    lowWaterMark,
    isPaused: false,
  });

  socket.on("disconnect", () => {
    socketStates.delete(socket.id);
  });
}

export function shouldEmit(socket: Socket): boolean {
  const state = socketStates.get(socket.id);
  if (!state) {
    return true;
  }

  // Check write buffer size
  const transport = socket.conn?.transport;
  const buffered =
    (transport as unknown as { writable?: { writableLength?: number } })
      ?.writable?.writableLength ?? 0;

  state.bufferedCount = buffered;

  if (buffered > state.highWaterMark && !state.isPaused) {
    state.isPaused = true;
    logger.warn(
      { socketId: socket.id, buffered, highWaterMark: state.highWaterMark },
      "Backpressure: pausing writes"
    );
    return false;
  }

  if (buffered < state.lowWaterMark && state.isPaused) {
    state.isPaused = false;
    logger.debug(
      { socketId: socket.id, buffered },
      "Backpressure: resuming writes"
    );
  }

  return !state.isPaused;
}

export function safeEmit(
  socket: Socket,
  event: string,
  data: unknown
): boolean {
  if (!shouldEmit(socket)) {
    return false;
  }
  socket.emit(event, data);
  return true;
}

export function getBackpressureStats(): {
  pausedSockets: number;
  totalTracked: number;
} {
  let pausedSockets = 0;
  for (const state of socketStates.values()) {
    if (state.isPaused) {
      pausedSockets++;
    }
  }
  return {
    totalTracked: socketStates.size,
    pausedSockets,
  };
}
