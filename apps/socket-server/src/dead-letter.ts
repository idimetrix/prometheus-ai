import { createLogger } from "@prometheus/logger";

const logger = createLogger("socket-server:dead-letter");

interface DeadLetterEntry {
  error: string;
  event: string;
  rawData: string;
  socketId: string;
  timestamp: string;
}

const MAX_DLQ_SIZE = 1000;
const dlq: DeadLetterEntry[] = [];

export function addToDeadLetterQueue(
  socketId: string,
  event: string,
  rawData: unknown,
  error: Error | string
): void {
  const entry: DeadLetterEntry = {
    socketId,
    event,
    rawData: typeof rawData === "string" ? rawData : JSON.stringify(rawData),
    error: typeof error === "string" ? error : error.message,
    timestamp: new Date().toISOString(),
  };

  dlq.push(entry);
  if (dlq.length > MAX_DLQ_SIZE) {
    dlq.shift();
  }

  logger.warn(
    { socketId, event, error: entry.error, dlqSize: dlq.length },
    "Message added to dead letter queue"
  );
}

export function getDeadLetterQueue(limit = 100): DeadLetterEntry[] {
  return dlq.slice(-limit);
}

export function getDeadLetterQueueSize(): number {
  return dlq.length;
}

export function clearDeadLetterQueue(): number {
  const count = dlq.length;
  dlq.length = 0;
  return count;
}
