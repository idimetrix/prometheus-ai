import { relations } from "drizzle-orm";
import { apiKeys } from "../api-keys/api-keys";
import {
  creditBalances,
  creditReservations,
  creditTransactions,
} from "../credits/credits";
import { mcpConnections } from "../integrations/integrations";
import { modelConfigs, modelUsage } from "../models/models";
import { projects } from "../projects/projects";
import { subscriptions } from "../subscriptions/subscriptions";
import { usageRollups } from "../usage-rollups/usage-rollups";
import { organizations, orgMembers } from "./organizations";
import { teamAgentQuotas } from "./team-agent-quotas";

export const organizationsRelations = relations(
  organizations,
  ({ many, one }) => ({
    members: many(orgMembers),
    projects: many(projects),
    creditBalances: one(creditBalances, {
      fields: [organizations.id],
      references: [creditBalances.orgId],
    }),
    creditTransactions: many(creditTransactions),
    creditReservations: many(creditReservations),
    subscriptions: many(subscriptions),
    mcpConnections: many(mcpConnections),
    apiKeys: many(apiKeys),
    modelConfigs: many(modelConfigs),
    modelUsage: many(modelUsage),
    usageRollups: many(usageRollups),
    teamAgentQuotas: many(teamAgentQuotas),
  })
);

export const orgMembersRelations = relations(orgMembers, ({ one }) => ({
  organization: one(organizations, {
    fields: [orgMembers.orgId],
    references: [organizations.id],
  }),
}));

export const teamAgentQuotasRelations = relations(
  teamAgentQuotas,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [teamAgentQuotas.orgId],
      references: [organizations.id],
    }),
  })
);
