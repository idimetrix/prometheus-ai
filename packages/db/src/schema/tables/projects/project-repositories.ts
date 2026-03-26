import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import {
  repoIndexStatusEnum,
  repoProviderEnum,
  workspaceTypeEnum,
} from "../../enums";
import { timestamps } from "../../helpers";
import { organizations } from "../organizations/organizations";
import { projects } from "./projects";

export const projectRepositories = pgTable(
  "project_repositories",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    repoUrl: text("repo_url").notNull(),
    provider: repoProviderEnum("provider").notNull(),
    defaultBranch: text("default_branch").notNull().default("main"),
    isMonorepo: boolean("is_monorepo").notNull().default(false),
    workspaceType: workspaceTypeEnum("workspace_type"),
    rootPath: text("root_path").notNull().default("/"),
    lastIndexedAt: timestamp("last_indexed_at", {
      withTimezone: true,
      mode: "date",
    }),
    indexStatus: repoIndexStatusEnum("index_status")
      .notNull()
      .default("pending"),
    techStack: jsonb("tech_stack"),
    isPrimary: boolean("is_primary").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    index("project_repos_project_id_idx").on(table.projectId),
    index("project_repos_org_id_idx").on(table.orgId),
    index("project_repos_project_org_idx").on(table.projectId, table.orgId),
  ]
);
