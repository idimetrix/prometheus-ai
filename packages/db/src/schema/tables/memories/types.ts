import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import {
  agentMemories,
  episodicMemories,
  proceduralMemories,
} from "./memories";

export const insertAgentMemorySchema = createInsertSchema(agentMemories);
export const selectAgentMemorySchema = createSelectSchema(agentMemories);
export type AgentMemory = typeof agentMemories.$inferSelect;
export type NewAgentMemory = typeof agentMemories.$inferInsert;

export const insertEpisodicMemorySchema = createInsertSchema(episodicMemories);
export const selectEpisodicMemorySchema = createSelectSchema(episodicMemories);
export type EpisodicMemory = typeof episodicMemories.$inferSelect;
export type NewEpisodicMemory = typeof episodicMemories.$inferInsert;

export const insertProceduralMemorySchema =
  createInsertSchema(proceduralMemories);
export const selectProceduralMemorySchema =
  createSelectSchema(proceduralMemories);
export type ProceduralMemory = typeof proceduralMemories.$inferSelect;
export type NewProceduralMemory = typeof proceduralMemories.$inferInsert;
