import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { timestamps } from "../../helpers";
import { organizations } from "../organizations/organizations";
import { projects } from "./projects";

export const sshKeys = pgTable(
  "ssh_keys",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    publicKey: text("public_key").notNull(),
    encryptedPrivateKey: text("encrypted_private_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    keyType: text("key_type").notNull().default("ed25519"),
    lastUsedAt: timestamp("last_used_at", {
      withTimezone: true,
      mode: "date",
    }),
    ...timestamps,
  },
  (table) => [
    index("ssh_keys_org_id_project_id_idx").on(table.orgId, table.projectId),
    index("ssh_keys_org_id_idx").on(table.orgId),
    index("ssh_keys_fingerprint_idx").on(table.fingerprint),
  ]
);
