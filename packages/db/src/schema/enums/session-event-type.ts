import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const sessionEventTypeValues = [
  "agent_output",
  "file_change",
  "plan_update",
  "task_status",
  "queue_position",
  "credit_update",
  "checkpoint",
  "error",
  "reasoning",
  "terminal_output",
  "browser_screenshot",
  "pr_created",
] as const;
export type SessionEventType = (typeof sessionEventTypeValues)[number];
export const sessionEventTypeEnum = pgEnum(
  "session_event_type",
  sessionEventTypeValues
);
export const SessionEventTypeEnum = createEnumMap(sessionEventTypeValues);
