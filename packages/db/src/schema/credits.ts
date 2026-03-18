import { pgTable, text, timestamp, integer, real, pgEnum } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { organizations } from "./organizations";

export const creditTransactionTypeEnum = pgEnum("credit_transaction_type", [
  "purchase", "consumption", "refund", "bonus", "subscription_grant",
]);

export const creditReservationStatusEnum = pgEnum("credit_reservation_status", [
  "active", "committed", "released",
]);

export const creditTransactions = pgTable("credit_transactions", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  type: creditTransactionTypeEnum("type").notNull(),
  amount: integer("amount").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  taskId: text("task_id"),
  description: text("description").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const creditBalances = pgTable("credit_balances", {
  orgId: text("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  balance: integer("balance").notNull().default(0),
  reserved: integer("reserved").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const creditReservations = pgTable("credit_reservations", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  taskId: text("task_id").notNull(),
  amount: integer("amount").notNull(),
  status: creditReservationStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const creditTransactionsRelations = relations(creditTransactions, ({ one }) => ({
  organization: one(organizations, {
    fields: [creditTransactions.orgId],
    references: [organizations.id],
  }),
}));
