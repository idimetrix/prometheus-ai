import {
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { projects } from "../projects/projects";

export const graphNodes = pgTable(
  "graph_nodes",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    nodeType: text("node_type", {
      enum: [
        "file",
        "function",
        "class",
        "module",
        "component",
        "interface",
        "type",
      ],
    }).notNull(),
    name: text("name").notNull(),
    filePath: text("file_path").notNull(),
    metadata: jsonb("metadata").default({}),
    startLine: integer("start_line"),
    endLine: integer("end_line"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("graph_nodes_project_path_idx").on(table.projectId, table.filePath),
    index("graph_nodes_project_type_idx").on(table.projectId, table.nodeType),
    index("graph_nodes_project_name_idx").on(table.projectId, table.name),
  ]
);

export const graphEdges = pgTable(
  "graph_edges",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => graphNodes.id, { onDelete: "cascade" }),
    targetId: text("target_id")
      .notNull()
      .references(() => graphNodes.id, { onDelete: "cascade" }),
    edgeType: text("edge_type", {
      enum: [
        "imports",
        "calls",
        "extends",
        "implements",
        "depends_on",
        "contains",
        "exports",
        "uses_type",
      ],
    }).notNull(),
    metadata: jsonb("metadata").default({}),
    weight: real("weight").default(1.0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("graph_edges_project_source_idx").on(table.projectId, table.sourceId),
    index("graph_edges_project_target_idx").on(table.projectId, table.targetId),
    index("graph_edges_source_type_idx").on(table.sourceId, table.edgeType),
  ]
);
