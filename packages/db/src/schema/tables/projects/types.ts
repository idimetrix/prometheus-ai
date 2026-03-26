import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { agentPermissions } from "./agent-permissions";
import { projectMembers, projectSettings, projects } from "./projects";

export const insertProjectSchema = createInsertSchema(projects);
export const selectProjectSchema = createSelectSchema(projects);
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export const insertProjectSettingsSchema = createInsertSchema(projectSettings);
export const selectProjectSettingsSchema = createSelectSchema(projectSettings);
export type ProjectSettings = typeof projectSettings.$inferSelect;
export type NewProjectSettings = typeof projectSettings.$inferInsert;

export const insertProjectMemberSchema = createInsertSchema(projectMembers);
export const selectProjectMemberSchema = createSelectSchema(projectMembers);
export type ProjectMember = typeof projectMembers.$inferSelect;
export type NewProjectMember = typeof projectMembers.$inferInsert;

export const insertAgentPermissionSchema = createInsertSchema(agentPermissions);
export const selectAgentPermissionSchema = createSelectSchema(agentPermissions);
export type AgentPermissionRow = typeof agentPermissions.$inferSelect;
export type NewAgentPermission = typeof agentPermissions.$inferInsert;
