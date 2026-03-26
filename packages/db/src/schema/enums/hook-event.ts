import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const hookEventValues = [
  "before_file_write",
  "after_file_write",
  "before_terminal_exec",
  "after_terminal_exec",
  "before_git_commit",
  "after_git_commit",
  "before_git_push",
  "after_git_push",
  "on_task_start",
  "on_task_complete",
  "on_error",
] as const;
export type HookEvent = (typeof hookEventValues)[number];
export const hookEventEnum = pgEnum("hook_event", hookEventValues);
export const HookEventEnum = createEnumMap(hookEventValues);
