import { relations } from "drizzle-orm";
import { organizations } from "../organizations/organizations";
import { usageRollups } from "./usage-rollups";

export const usageRollupsRelations = relations(usageRollups, ({ one }) => ({
  organization: one(organizations, {
    fields: [usageRollups.orgId],
    references: [organizations.id],
  }),
}));
