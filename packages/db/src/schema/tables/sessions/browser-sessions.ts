import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { timestamps } from "../../helpers";
import { sessions } from "./sessions";

/**
 * Browser sessions track persistent Chromium instances inside sandboxes.
 * Unlike ephemeral browser tool calls, these maintain cookies, auth state,
 * and navigation history across multiple agent interactions.
 */
export const browserSessions = pgTable(
  "browser_sessions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(
        () => `brs_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`
      ),
    sandboxId: text("sandbox_id").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    /** Status: active, idle, closed */
    status: text("status").notNull().default("active"),
    currentUrl: text("current_url"),
    viewportWidth: integer("viewport_width").default(1280),
    viewportHeight: integer("viewport_height").default(720),
    /** Serialized cookies for session persistence */
    cookiesSnapshot: jsonb("cookies_snapshot")
      .$type<Record<string, unknown>[]>()
      .default([]),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("browser_sessions_sandbox_id_idx").on(table.sandboxId),
    index("browser_sessions_session_id_idx").on(table.sessionId),
    index("browser_sessions_status_idx").on(table.status),
  ]
);

/**
 * Screenshots captured during browser sessions.
 * Stores both the raw screenshot and any vision model analysis.
 */
export const browserScreenshots = pgTable(
  "browser_screenshots",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(
        () => `bsc_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`
      ),
    browserSessionId: text("browser_session_id")
      .notNull()
      .references(() => browserSessions.id, { onDelete: "cascade" }),
    url: text("url"),
    /** MinIO storage URL for the screenshot image */
    storageUrl: text("storage_url"),
    /** Vision model analysis of the screenshot */
    visionAnalysis: text("vision_analysis"),
    /** Accessibility tree / DOM snapshot for structured interaction */
    domSnapshot: jsonb("dom_snapshot").$type<Record<string, unknown>>(),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("browser_screenshots_session_id_idx").on(table.browserSessionId),
    index("browser_screenshots_captured_at_idx").on(table.capturedAt),
  ]
);

export type BrowserSession = typeof browserSessions.$inferSelect;
export type NewBrowserSession = typeof browserSessions.$inferInsert;
export type BrowserScreenshot = typeof browserScreenshots.$inferSelect;
export type NewBrowserScreenshot = typeof browserScreenshots.$inferInsert;
