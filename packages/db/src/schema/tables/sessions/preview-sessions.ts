import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { timestamps } from "../../helpers";
import { sessions } from "./sessions";

/**
 * Preview sessions track running dev server instances inside sandboxes.
 * When an agent starts a dev server (e.g. `npm run dev`), we record the
 * port, framework, and status so the frontend can render a live preview iframe.
 */
export const previewSessions = pgTable(
  "preview_sessions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(
        () => `prev_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`
      ),
    sandboxId: text("sandbox_id").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    /** The port the dev server is listening on inside the sandbox */
    port: integer("port").notNull().default(3000),
    /** Detected framework: next, vite, cra, express, etc. */
    framework: text("framework"),
    /** Status: starting, ready, stopped, error */
    status: text("status").notNull().default("starting"),
    /** Public URL for sharing the preview externally */
    publicUrl: text("public_url"),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("preview_sessions_sandbox_id_idx").on(table.sandboxId),
    index("preview_sessions_session_id_idx").on(table.sessionId),
    index("preview_sessions_status_idx").on(table.status),
  ]
);

export type PreviewSession = typeof previewSessions.$inferSelect;
export type NewPreviewSession = typeof previewSessions.$inferInsert;
