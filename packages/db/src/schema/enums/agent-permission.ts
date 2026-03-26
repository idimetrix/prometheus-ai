import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const agentPermissionValues = ["allowed", "ask", "denied"] as const;
export type AgentPermission = (typeof agentPermissionValues)[number];
export const agentPermissionEnum = pgEnum(
  "agent_permission",
  agentPermissionValues
);
export const AgentPermissionEnum = createEnumMap(agentPermissionValues);
