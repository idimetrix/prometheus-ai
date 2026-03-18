import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  vector,
} from "drizzle-orm/pg-core";
import { memoryTypeEnum } from "../../enums";
import { projects } from "../projects/projects";

export const agentMemories = pgTable(
  "agent_memories",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    memoryType: memoryTypeEnum("memory_type").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 768 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("agent_memories_project_id_idx").on(table.projectId),
    index("agent_memories_project_type_idx").on(
      table.projectId,
      table.memoryType
    ),
    index("agent_memories_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops")
    ),
  ]
);

export const episodicMemories = pgTable(
  "episodic_memories",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    decision: text("decision").notNull(),
    reasoning: text("reasoning"),
    outcome: text("outcome"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("episodic_memories_project_id_idx").on(table.projectId)]
);

export const proceduralMemories = pgTable(
  "procedural_memories",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    procedureName: text("procedure_name").notNull(),
    steps: jsonb("steps").notNull().default([]),
    lastUsed: timestamp("last_used", { withTimezone: true }),
  },
  (table) => [index("procedural_memories_project_id_idx").on(table.projectId)]
);
