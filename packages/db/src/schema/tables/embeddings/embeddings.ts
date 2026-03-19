import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  vector,
} from "drizzle-orm/pg-core";
import { projects } from "../projects/projects";

export const codeEmbeddings = pgTable(
  "code_embeddings",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    chunkIndex: integer("chunk_index").notNull().default(0),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 768 }),
    embedding256: vector("embedding_256", { dimensions: 256 }),
    symbolType: text("symbol_type", {
      enum: [
        "function",
        "class",
        "interface",
        "type",
        "variable",
        "module",
        "component",
        "other",
      ],
    }),
    symbolName: text("symbol_name"),
    startLine: integer("start_line"),
    endLine: integer("end_line"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("code_embeddings_project_file_idx").on(
      table.projectId,
      table.filePath
    ),
    index("code_embeddings_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops")
    ),
    index("code_embeddings_embedding_256_idx").using(
      "hnsw",
      table.embedding256.op("vector_cosine_ops")
    ),
    index("code_embeddings_symbol_idx").on(
      table.projectId,
      table.symbolType,
      table.symbolName
    ),
  ]
);

export const fileIndexes = pgTable(
  "file_indexes",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    fileHash: text("file_hash").notNull(),
    language: text("language"),
    loc: integer("loc"),
    lastIndexed: timestamp("last_indexed", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("file_indexes_project_path_idx").on(table.projectId, table.filePath),
  ]
);
