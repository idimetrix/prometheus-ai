import { pgTable, text, timestamp, integer, index, vector } from "drizzle-orm/pg-core";
import { projects } from "./projects";

export const codeEmbeddings = pgTable("code_embeddings", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  filePath: text("file_path").notNull(),
  chunkIndex: integer("chunk_index").notNull().default(0),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 768 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("code_embeddings_project_file_idx").on(table.projectId, table.filePath),
]);

export const fileIndexes = pgTable("file_indexes", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  filePath: text("file_path").notNull(),
  fileHash: text("file_hash").notNull(),
  language: text("language"),
  loc: integer("loc"),
  lastIndexed: timestamp("last_indexed", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("file_indexes_project_path_idx").on(table.projectId, table.filePath),
]);
