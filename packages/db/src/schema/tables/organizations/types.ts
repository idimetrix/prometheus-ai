import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { organizations, orgMembers } from "./organizations";

export const insertOrganizationSchema = createInsertSchema(organizations);
export const selectOrganizationSchema = createSelectSchema(organizations);
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;

export const insertOrgMemberSchema = createInsertSchema(orgMembers);
export const selectOrgMemberSchema = createSelectSchema(orgMembers);
export type OrgMember = typeof orgMembers.$inferSelect;
export type NewOrgMember = typeof orgMembers.$inferInsert;
