import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import {
  creditBalances,
  creditReservations,
  creditTransactions,
  processedWebhookEvents,
} from "./credits";

export const insertCreditTransactionSchema =
  createInsertSchema(creditTransactions);
export const selectCreditTransactionSchema =
  createSelectSchema(creditTransactions);
export type CreditTransaction = typeof creditTransactions.$inferSelect;
export type NewCreditTransaction = typeof creditTransactions.$inferInsert;

export const insertCreditBalanceSchema = createInsertSchema(creditBalances);
export const selectCreditBalanceSchema = createSelectSchema(creditBalances);
export type CreditBalance = typeof creditBalances.$inferSelect;
export type NewCreditBalance = typeof creditBalances.$inferInsert;

export const insertCreditReservationSchema =
  createInsertSchema(creditReservations);
export const selectCreditReservationSchema =
  createSelectSchema(creditReservations);
export type CreditReservation = typeof creditReservations.$inferSelect;
export type NewCreditReservation = typeof creditReservations.$inferInsert;

export const insertProcessedWebhookEventSchema = createInsertSchema(
  processedWebhookEvents
);
export const selectProcessedWebhookEventSchema = createSelectSchema(
  processedWebhookEvents
);
export type ProcessedWebhookEvent = typeof processedWebhookEvents.$inferSelect;
export type NewProcessedWebhookEvent =
  typeof processedWebhookEvents.$inferInsert;
