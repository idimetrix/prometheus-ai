import { relations } from "drizzle-orm";
import { apiKeys } from "../api-keys/api-keys";
import { orgMembers } from "../organizations/organizations";
import { sessions } from "../sessions/sessions";
import { userSettings, users } from "./users";

export const usersRelations = relations(users, ({ one, many }) => ({
  settings: one(userSettings, {
    fields: [users.id],
    references: [userSettings.userId],
  }),
  orgMemberships: many(orgMembers),
  sessions: many(sessions),
  apiKeys: many(apiKeys),
}));
