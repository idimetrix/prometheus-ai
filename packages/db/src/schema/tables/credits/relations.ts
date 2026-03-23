import { relations } from "drizzle-orm";
import { organizations } from "../organizations/organizations";
import {
  creditBalances,
  creditReservations,
  creditTransactions,
} from "./credits";

export const creditBalancesRelations = relations(creditBalances, ({ one }) => ({
  organization: one(organizations, {
    fields: [creditBalances.orgId],
    references: [organizations.id],
  }),
}));

export const creditTransactionsRelations = relations(
  creditTransactions,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [creditTransactions.orgId],
      references: [organizations.id],
    }),
  })
);

export const creditReservationsRelations = relations(
  creditReservations,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [creditReservations.orgId],
      references: [organizations.id],
    }),
  })
);
