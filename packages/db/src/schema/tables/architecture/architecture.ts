import {
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { architectureMetricTypeEnum } from "../../enums";
import { projects } from "../projects/projects";

export const architectureSnapshots = pgTable(
  "architecture_snapshots",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    graphData: jsonb("graph_data")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    nodeCount: integer("node_count").notNull().default(0),
    edgeCount: integer("edge_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("architecture_snapshots_project_id_idx").on(table.projectId),
    index("architecture_snapshots_created_idx").on(
      table.projectId,
      table.createdAt
    ),
  ]
);

export const architectureMetrics = pgTable(
  "architecture_metrics",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => architectureSnapshots.id, { onDelete: "cascade" }),
    metricType: architectureMetricTypeEnum("metric_type").notNull(),
    value: real("value").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("architecture_metrics_project_id_idx").on(table.projectId),
    index("architecture_metrics_snapshot_id_idx").on(table.snapshotId),
    index("architecture_metrics_type_idx").on(
      table.projectId,
      table.metricType
    ),
  ]
);
