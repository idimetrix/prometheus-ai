import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const agentAggressivenessValues = [
  "balanced",
  "full_auto",
  "supervised",
] as const;
export type AgentAggressiveness = (typeof agentAggressivenessValues)[number];
export const agentAggressivenessEnum = pgEnum(
  "agent_aggressiveness",
  agentAggressivenessValues
);
export const AgentAggressivenessEnum = createEnumMap(agentAggressivenessValues);
