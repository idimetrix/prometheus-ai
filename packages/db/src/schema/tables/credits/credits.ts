import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import {
  creditReservationStatusEnum,
  creditTransactionTypeEnum,
} from "../../enums";
import { organizations } from "../organizations/organizations";

export const creditTransactions = pgTable(
  "credit_transactions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    type: creditTransactionTypeEnum("type").notNull(),
    amount: integer("amount").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    taskId: text("task_id"),
    description: text("description").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("credit_transactions_org_id_idx").on(table.orgId),
    index("credit_transactions_org_type_idx").on(table.orgId, table.type),
    index("credit_transactions_task_id_idx").on(table.taskId),
  ]
);

export const creditBalances = pgTable("credit_balances", {
  orgId: text("org_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  balance: integer("balance").notNull().default(0),
  reserved: integer("reserved").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const creditReservations = pgTable(
  "credit_reservations",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    taskId: text("task_id").notNull(),
    amount: integer("amount").notNull(),
    status: creditReservationStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("credit_reservations_org_id_idx").on(table.orgId),
    index("credit_reservations_org_status_idx").on(table.orgId, table.status),
    index("credit_reservations_task_id_idx").on(table.taskId),
  ]
);
