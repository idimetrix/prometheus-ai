import {
  index,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { correctionTypeEnum, experimentStatusEnum } from "../../enums";
import { timestamps } from "../../helpers";
import { organizations } from "../organizations/organizations";
import { sessions } from "../sessions/sessions";
import { users } from "../users/users";

export const userCorrections = pgTable(
  "user_corrections",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    correctionType: correctionTypeEnum("correction_type").notNull(),
    original: text("original").notNull(),
    corrected: text("corrected").notNull(),
    context: text("context"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("user_corrections_org_id_idx").on(table.orgId),
    index("user_corrections_user_id_idx").on(table.userId),
    index("user_corrections_session_id_idx").on(table.sessionId),
    index("user_corrections_type_idx").on(table.orgId, table.correctionType),
  ]
);

export const agentPerformanceMetrics = pgTable(
  "agent_performance_metrics",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    agentRole: text("agent_role").notNull(),
    metricType: text("metric_type").notNull(),
    value: real("value").notNull(),
    period: text("period").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("agent_perf_metrics_org_id_idx").on(table.orgId),
    index("agent_perf_metrics_role_idx").on(table.orgId, table.agentRole),
    index("agent_perf_metrics_type_idx").on(
      table.orgId,
      table.agentRole,
      table.metricType
    ),
  ]
);

export const strategyExperiments = pgTable(
  "strategy_experiments",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    experimentName: text("experiment_name").notNull(),
    strategyA: text("strategy_a").notNull(),
    strategyB: text("strategy_b").notNull(),
    resultsA: jsonb("results_a").$type<Record<string, unknown>>().default({}),
    resultsB: jsonb("results_b").$type<Record<string, unknown>>().default({}),
    winner: text("winner"),
    status: experimentStatusEnum("status").notNull().default("running"),
    ...timestamps,
  },
  (table) => [
    index("strategy_experiments_org_id_idx").on(table.orgId),
    index("strategy_experiments_status_idx").on(table.orgId, table.status),
  ]
);
