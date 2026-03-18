import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const creditTransactionTypeValues = [
  "purchase",
  "consumption",
  "refund",
  "bonus",
  "subscription_grant",
] as const;
export type CreditTransactionType =
  (typeof creditTransactionTypeValues)[number];
export const creditTransactionTypeEnum = pgEnum(
  "credit_transaction_type",
  creditTransactionTypeValues
);
export const CreditTransactionTypeEnum = createEnumMap(
  creditTransactionTypeValues
);
