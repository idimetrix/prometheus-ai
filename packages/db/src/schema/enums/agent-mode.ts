import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const agentModeValues = [
  "task",
  "ask",
  "plan",
  "watch",
  "fleet",
  "design",
] as const;
export type AgentMode = (typeof agentModeValues)[number];
export const agentModeEnum = pgEnum("agent_mode", agentModeValues);
export const AgentModeEnum = createEnumMap(agentModeValues);
