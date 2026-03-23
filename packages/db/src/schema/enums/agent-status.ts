import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const agentStatusValues = [
  "idle",
  "working",
  "error",
  "terminated",
] as const;
export type AgentStatus = (typeof agentStatusValues)[number];
export const agentStatusEnum = pgEnum("agent_status", agentStatusValues);
export const AgentStatusEnum = createEnumMap(agentStatusValues);
