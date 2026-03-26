import {
  boolean,
  index,
  integer,
  pgTable,
  real,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import {
  agentAggressivenessEnum,
  blueprintEnforcementEnum,
  deployTargetEnum,
  projectRoleEnum,
  projectStatusEnum,
  securityScanLevelEnum,
} from "../../enums";
import { timestamps } from "../../helpers";
import { organizations } from "../organizations/organizations";

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    repoUrl: text("repo_url"),
    techStackPreset: text("tech_stack_preset"),
    status: projectStatusEnum("status").notNull().default("setup"),
    /** URL-safe slug for public sharing (null = private) */
    shareSlug: text("share_slug"),
    /** Whether the project is publicly visible */
    isPublic: boolean("is_public").notNull().default(false),
    /** ID of the project this was forked from */
    forkedFromId: text("forked_from_id"),
    /** Number of times this project has been forked */
    forkCount: integer("fork_count").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    index("projects_org_id_status_idx").on(table.orgId, table.status),
    index("projects_org_id_idx").on(table.orgId),
    uniqueIndex("projects_share_slug_idx").on(table.shareSlug),
    index("projects_is_public_idx").on(table.isPublic),
    index("projects_forked_from_id_idx").on(table.forkedFromId),
  ]
);

export const projectSettings = pgTable("project_settings", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  agentAggressiveness: agentAggressivenessEnum("agent_aggressiveness")
    .notNull()
    .default("balanced"),
  ciLoopMaxIterations: integer("ci_loop_max_iterations").notNull().default(20),
  parallelAgentCount: integer("parallel_agent_count").notNull().default(1),
  blueprintEnforcement: blueprintEnforcementEnum("blueprint_enforcement")
    .notNull()
    .default("strict"),
  testCoverageTarget: integer("test_coverage_target").notNull().default(80),
  securityScanLevel: securityScanLevelEnum("security_scan_level")
    .notNull()
    .default("standard"),
  deployTarget: deployTargetEnum("deploy_target").notNull().default("manual"),
  modelCostBudget: real("model_cost_budget"),
});

export const projectMembers = pgTable(
  "project_members",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: projectRoleEnum("role").notNull().default("contributor"),
  },
  (table) => [
    index("project_members_project_id_idx").on(table.projectId),
    index("project_members_user_id_idx").on(table.userId),
  ]
);
