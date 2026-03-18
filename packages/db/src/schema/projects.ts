import { pgTable, text, timestamp, integer, real, pgEnum } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { organizations } from "./organizations";

export const projectStatusEnum = pgEnum("project_status", ["active", "archived", "setup"]);
export const agentAggressivenessEnum = pgEnum("agent_aggressiveness", ["balanced", "full_auto", "supervised"]);
export const blueprintEnforcementEnum = pgEnum("blueprint_enforcement", ["strict", "flexible", "advisory"]);
export const securityScanLevelEnum = pgEnum("security_scan_level", ["basic", "standard", "thorough"]);
export const deployTargetEnum = pgEnum("deploy_target", ["staging", "production", "manual"]);
export const projectRoleEnum = pgEnum("project_role", ["owner", "contributor", "viewer"]);

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  repoUrl: text("repo_url"),
  techStackPreset: text("tech_stack_preset"),
  status: projectStatusEnum("status").notNull().default("setup"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projectSettings = pgTable("project_settings", {
  projectId: text("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  agentAggressiveness: agentAggressivenessEnum("agent_aggressiveness").notNull().default("balanced"),
  ciLoopMaxIterations: integer("ci_loop_max_iterations").notNull().default(20),
  parallelAgentCount: integer("parallel_agent_count").notNull().default(1),
  blueprintEnforcement: blueprintEnforcementEnum("blueprint_enforcement").notNull().default("strict"),
  testCoverageTarget: integer("test_coverage_target").notNull().default(80),
  securityScanLevel: securityScanLevelEnum("security_scan_level").notNull().default("standard"),
  deployTarget: deployTargetEnum("deploy_target").notNull().default("manual"),
  modelCostBudget: real("model_cost_budget"),
});

export const projectMembers = pgTable("project_members", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  role: projectRoleEnum("role").notNull().default("contributor"),
});

export const projectsRelations = relations(projects, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [projects.orgId],
    references: [organizations.id],
  }),
  settings: one(projectSettings, {
    fields: [projects.id],
    references: [projectSettings.projectId],
  }),
  members: many(projectMembers),
}));
