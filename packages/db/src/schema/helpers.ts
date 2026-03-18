import { generateId } from "@prometheus/utils";
import { sql } from "drizzle-orm";
import { text, timestamp } from "drizzle-orm/pg-core";

export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
};

/** Standalone primary key column using generateId() */
export const id = text("id")
  .primaryKey()
  .$defaultFn(() => generateId());

/** SQL predicate for soft-delete filtering */
export const notDeleted = sql`deleted_at IS NULL`;
