import { relations } from "drizzle-orm";
import { blueprints } from "../blueprints/blueprints";
import { deployments } from "../deployments/deployments";
import { codeEmbeddings, fileIndexes } from "../embeddings/embeddings";
import { mcpToolConfigs } from "../integrations/integrations";
import {
  agentMemories,
  episodicMemories,
  proceduralMemories,
} from "../memories/memories";
import { organizations } from "../organizations/organizations";
import { sessions } from "../sessions/sessions";
import { tasks } from "../tasks/tasks";
import { users } from "../users/users";
import { agentPermissions } from "./agent-permissions";
import { projectRepositories } from "./project-repositories";
import { projectRules } from "./project-rules";
import { projectMembers, projectSettings, projects } from "./projects";

export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, {
    fields: [projectMembers.projectId],
    references: [projects.id],
  }),
}));

export const projectSettingsRelations = relations(
  projectSettings,
  ({ one }) => ({
    project: one(projects, {
      fields: [projectSettings.projectId],
      references: [projects.id],
    }),
  })
);

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
  sessions: many(sessions),
  tasks: many(tasks),
  blueprints: many(blueprints),
  codeEmbeddings: many(codeEmbeddings),
  fileIndexes: many(fileIndexes),
  agentMemories: many(agentMemories),
  episodicMemories: many(episodicMemories),
  proceduralMemories: many(proceduralMemories),
  mcpToolConfigs: many(mcpToolConfigs),
  deployments: many(deployments),
  rules: many(projectRules),
  repositories: many(projectRepositories),
  agentPermissions: many(agentPermissions),
}));

export const projectRepositoriesRelations = relations(
  projectRepositories,
  ({ one }) => ({
    project: one(projects, {
      fields: [projectRepositories.projectId],
      references: [projects.id],
    }),
    organization: one(organizations, {
      fields: [projectRepositories.orgId],
      references: [organizations.id],
    }),
  })
);

export const projectRulesRelations = relations(projectRules, ({ one }) => ({
  project: one(projects, {
    fields: [projectRules.projectId],
    references: [projects.id],
  }),
  organization: one(organizations, {
    fields: [projectRules.orgId],
    references: [organizations.id],
  }),
}));

export const agentPermissionsRelations = relations(
  agentPermissions,
  ({ one }) => ({
    project: one(projects, {
      fields: [agentPermissions.projectId],
      references: [projects.id],
    }),
    organization: one(organizations, {
      fields: [agentPermissions.orgId],
      references: [organizations.id],
    }),
    creator: one(users, {
      fields: [agentPermissions.createdBy],
      references: [users.id],
    }),
  })
);
