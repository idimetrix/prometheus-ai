import {
  boolean,
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { reviewSeverityEnum, reviewStatusEnum } from "../../enums";
import { timestamps } from "../../helpers";
import { projects } from "../projects/projects";
import { sessions } from "../sessions/sessions";

export const codeReviews = pgTable(
  "code_reviews",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    status: reviewStatusEnum("status").notNull().default("pending"),
    reviewType: text("review_type").notNull(),
    filesReviewed: integer("files_reviewed").notNull().default(0),
    overallScore: real("overall_score"),
    summary: text("summary"),
    ...timestamps,
  },
  (table) => [
    index("code_reviews_project_id_idx").on(table.projectId),
    index("code_reviews_session_id_idx").on(table.sessionId),
    index("code_reviews_status_idx").on(table.projectId, table.status),
  ]
);

export const reviewComments = pgTable(
  "review_comments",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id")
      .notNull()
      .references(() => codeReviews.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    lineStart: integer("line_start").notNull(),
    lineEnd: integer("line_end"),
    severity: reviewSeverityEnum("severity").notNull(),
    category: text("category").notNull(),
    comment: text("comment").notNull(),
    suggestedFix: text("suggested_fix"),
    resolved: boolean("resolved").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("review_comments_review_id_idx").on(table.reviewId),
    index("review_comments_file_idx").on(table.reviewId, table.filePath),
    index("review_comments_severity_idx").on(table.reviewId, table.severity),
  ]
);
