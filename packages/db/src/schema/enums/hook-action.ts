import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const hookActionValues = [
  "run_command",
  "call_webhook",
  "block",
  "transform",
] as const;
export type HookAction = (typeof hookActionValues)[number];
export const hookActionEnum = pgEnum("hook_action", hookActionValues);
export const HookActionEnum = createEnumMap(hookActionValues);
