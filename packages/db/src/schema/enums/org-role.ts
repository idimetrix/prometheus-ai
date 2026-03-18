import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const orgRoleValues = ["owner", "admin", "member"] as const;
export type OrgRole = (typeof orgRoleValues)[number];
export const orgRoleEnum = pgEnum("org_role", orgRoleValues);
export const OrgRoleEnum = createEnumMap(orgRoleValues);
