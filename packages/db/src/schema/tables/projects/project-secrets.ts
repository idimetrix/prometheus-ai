import {
  boolean,
  index,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { secretEnvironmentEnum } from "../../enums";
import { timestamps } from "../../helpers";
import { organizations } from "../organizations/organizations";
import { users } from "../users/users";
import { projects } from "./projects";

export const projectSecrets = pgTable(
  "project_secrets",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    encryptedValue: text("encrypted_value").notNull(),
    environment: secretEnvironmentEnum("environment").notNull().default("all"),
    description: text("description"),
    isSecret: boolean("is_secret").notNull().default(true),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("project_secrets_project_key_env_idx").on(
      table.projectId,
      table.key,
      table.environment
    ),
    index("project_secrets_project_id_idx").on(table.projectId),
    index("project_secrets_org_id_idx").on(table.orgId),
  ]
);
