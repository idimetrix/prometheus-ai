import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const sessionStatusValues = [
  "active",
  "paused",
  "completed",
  "failed",
  "cancelled",
] as const;
export type SessionStatus = (typeof sessionStatusValues)[number];
export const sessionStatusEnum = pgEnum("session_status", sessionStatusValues);
export const SessionStatusEnum = createEnumMap(sessionStatusValues);
