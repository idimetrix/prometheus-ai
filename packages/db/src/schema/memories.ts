import { pgTable, text, timestamp, jsonb, vector, pgEnum } from "drizzle-orm/pg-core";
import { projects } from "./projects";

export const memoryTypeEnum = pgEnum("memory_type", [
  "semantic", "episodic", "procedural", "architectural", "convention",
]);

export const agentMemories = pgTable("agent_memories", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  memoryType: memoryTypeEnum("memory_type").notNull(),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 768 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const episodicMemories = pgTable("episodic_memories", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  decision: text("decision").notNull(),
  reasoning: text("reasoning"),
  outcome: text("outcome"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const proceduralMemories = pgTable("procedural_memories", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  procedureName: text("procedure_name").notNull(),
  steps: jsonb("steps").notNull().default([]),
  lastUsed: timestamp("last_used", { withTimezone: true }),
});
