import { index, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "../organizations/organizations";
import { sessions } from "../sessions/sessions";
import { tasks } from "../tasks/tasks";

export const qualityReviews = pgTable(
  "quality_reviews",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    overallScore: real("overall_score").notNull(),
    correctnessScore: real("correctness_score").notNull(),
    styleScore: real("style_score").notNull(),
    securityScore: real("security_score").notNull(),
    performanceScore: real("performance_score").notNull(),
    reasoning: text("reasoning").notNull(),
    verdict: text("verdict", {
      enum: ["approved", "needs_review", "rejected"],
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("quality_reviews_task_idx").on(table.taskId),
    index("quality_reviews_session_idx").on(table.sessionId),
    index("quality_reviews_org_idx").on(table.orgId),
    index("quality_reviews_verdict_idx").on(table.orgId, table.verdict),
  ]
);
