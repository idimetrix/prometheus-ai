import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const taskStatusValues = [
  "pending",
  "queued",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
] as const;
export type TaskStatus = (typeof taskStatusValues)[number];
export const taskStatusEnum = pgEnum("task_status", taskStatusValues);
export const TaskStatusEnum = createEnumMap(taskStatusValues);
