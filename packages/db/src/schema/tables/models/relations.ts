import { relations } from "drizzle-orm";
import { organizations } from "../organizations/organizations";
import { modelConfigs, modelUsage } from "./models";

export const modelUsageRelations = relations(modelUsage, ({ one }) => ({
  organization: one(organizations, {
    fields: [modelUsage.orgId],
    references: [organizations.id],
  }),
}));

export const modelConfigsRelations = relations(modelConfigs, ({ one }) => ({
  organization: one(organizations, {
    fields: [modelConfigs.orgId],
    references: [organizations.id],
  }),
}));
