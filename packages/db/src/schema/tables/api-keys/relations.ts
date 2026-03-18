import { relations } from "drizzle-orm";
import { organizations } from "../organizations/organizations";
import { users } from "../users/users";
import { apiKeys } from "./api-keys";

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  organization: one(organizations, {
    fields: [apiKeys.orgId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [apiKeys.userId],
    references: [users.id],
  }),
}));
