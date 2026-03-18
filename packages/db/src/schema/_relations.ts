/**
 * Centralized relations file for parent -> child relationships.
 *
 * Relations where the child references the parent (e.g., tasks -> sessions)
 * live in the child's schema file. Relations where a parent needs to declare
 * `many(child)` are defined here to avoid circular imports.
 */
import { relations } from "drizzle-orm";
import { agents } from "./agents";
import { apiKeys } from "./api-keys";
import { blueprints, blueprintVersions } from "./blueprints";
import {
  creditBalances,
  creditReservations,
  creditTransactions,
} from "./credits";
import { codeEmbeddings, fileIndexes } from "./embeddings";
import { mcpConnections, mcpToolConfigs } from "./integrations";
import {
  agentMemories,
  episodicMemories,
  proceduralMemories,
} from "./memories";
import { modelConfigs, modelUsage } from "./models";
// --- Tables ---
import { organizations, orgMembers } from "./organizations";
import { projectMembers, projectSettings, projects } from "./projects";
import { sessionEvents, sessionMessages, sessions } from "./sessions";
import { subscriptionPlans, subscriptions } from "./subscriptions";
import { taskSteps, tasks } from "./tasks";
import { usageRollups } from "./usage-rollups";
import { userSettings, users } from "./users";

// ─── Organizations ───────────────────────────────────────────────────────────

export const organizationsRelations = relations(
  organizations,
  ({ many, one }) => ({
    members: many(orgMembers),
    projects: many(projects),
    creditBalances: one(creditBalances, {
      fields: [organizations.id],
      references: [creditBalances.orgId],
    }),
    creditTransactions: many(creditTransactions),
    creditReservations: many(creditReservations),
    subscriptions: many(subscriptions),
    mcpConnections: many(mcpConnections),
    apiKeys: many(apiKeys),
    modelConfigs: many(modelConfigs),
    modelUsage: many(modelUsage),
    usageRollups: many(usageRollups),
  })
);

export const orgMembersRelations = relations(orgMembers, ({ one }) => ({
  organization: one(organizations, {
    fields: [orgMembers.orgId],
    references: [organizations.id],
  }),
}));

// ─── Users ───────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ one, many }) => ({
  settings: one(userSettings, {
    fields: [users.id],
    references: [userSettings.userId],
  }),
  orgMemberships: many(orgMembers),
  sessions: many(sessions),
  apiKeys: many(apiKeys),
}));

// ─── Projects ────────────────────────────────────────────────────────────────

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
}));

// ─── Sessions ────────────────────────────────────────────────────────────────

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  project: one(projects, {
    fields: [sessions.projectId],
    references: [projects.id],
  }),
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
  events: many(sessionEvents),
  messages: many(sessionMessages),
  tasks: many(tasks),
  agents: many(agents),
}));

export const sessionEventsRelations = relations(sessionEvents, ({ one }) => ({
  session: one(sessions, {
    fields: [sessionEvents.sessionId],
    references: [sessions.id],
  }),
}));

export const sessionMessagesRelations = relations(
  sessionMessages,
  ({ one }) => ({
    session: one(sessions, {
      fields: [sessionMessages.sessionId],
      references: [sessions.id],
    }),
  })
);

// ─── Tasks ───────────────────────────────────────────────────────────────────

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  session: one(sessions, {
    fields: [tasks.sessionId],
    references: [sessions.id],
  }),
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
  steps: many(taskSteps),
}));

export const taskStepsRelations = relations(taskSteps, ({ one }) => ({
  task: one(tasks, {
    fields: [taskSteps.taskId],
    references: [tasks.id],
  }),
}));

// ─── Agents ──────────────────────────────────────────────────────────────────

export const agentsRelations = relations(agents, ({ one }) => ({
  session: one(sessions, {
    fields: [agents.sessionId],
    references: [sessions.id],
  }),
}));

// ─── Embeddings ──────────────────────────────────────────────────────────────

export const codeEmbeddingsRelations = relations(codeEmbeddings, ({ one }) => ({
  project: one(projects, {
    fields: [codeEmbeddings.projectId],
    references: [projects.id],
  }),
}));

export const fileIndexesRelations = relations(fileIndexes, ({ one }) => ({
  project: one(projects, {
    fields: [fileIndexes.projectId],
    references: [projects.id],
  }),
}));

// ─── Memories ────────────────────────────────────────────────────────────────

export const agentMemoriesRelations = relations(agentMemories, ({ one }) => ({
  project: one(projects, {
    fields: [agentMemories.projectId],
    references: [projects.id],
  }),
}));

export const episodicMemoriesRelations = relations(
  episodicMemories,
  ({ one }) => ({
    project: one(projects, {
      fields: [episodicMemories.projectId],
      references: [projects.id],
    }),
  })
);

export const proceduralMemoriesRelations = relations(
  proceduralMemories,
  ({ one }) => ({
    project: one(projects, {
      fields: [proceduralMemories.projectId],
      references: [projects.id],
    }),
  })
);

// ─── Credits ─────────────────────────────────────────────────────────────────

export const creditBalancesRelations = relations(creditBalances, ({ one }) => ({
  organization: one(organizations, {
    fields: [creditBalances.orgId],
    references: [organizations.id],
  }),
}));

export const creditTransactionsRelations = relations(
  creditTransactions,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [creditTransactions.orgId],
      references: [organizations.id],
    }),
  })
);

export const creditReservationsRelations = relations(
  creditReservations,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [creditReservations.orgId],
      references: [organizations.id],
    }),
  })
);

// ─── Models ──────────────────────────────────────────────────────────────────

export const modelUsageRelations = relations(modelUsage, ({ one }) => ({
  organization: one(organizations, {
    fields: [modelUsage.orgId],
    references: [organizations.id],
  }),
}));

export const modelConfigsRelations = relations(modelConfigs, ({ one }) => ({
  organization: one(organizations, {
    fields: [modelConfigs.orgId],
    references: [organizations.id],
  }),
}));

// ─── Blueprints ──────────────────────────────────────────────────────────────

export const blueprintsRelations = relations(blueprints, ({ one, many }) => ({
  project: one(projects, {
    fields: [blueprints.projectId],
    references: [projects.id],
  }),
  versions: many(blueprintVersions),
}));

export const blueprintVersionsRelations = relations(
  blueprintVersions,
  ({ one }) => ({
    blueprint: one(blueprints, {
      fields: [blueprintVersions.blueprintId],
      references: [blueprints.id],
    }),
  })
);

// ─── Subscriptions ───────────────────────────────────────────────────────────

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  organization: one(organizations, {
    fields: [subscriptions.orgId],
    references: [organizations.id],
  }),
  plan: one(subscriptionPlans, {
    fields: [subscriptions.planId],
    references: [subscriptionPlans.id],
  }),
}));

export const subscriptionPlansRelations = relations(
  subscriptionPlans,
  ({ many }) => ({
    subscriptions: many(subscriptions),
  })
);

// ─── Integrations ────────────────────────────────────────────────────────────

export const mcpConnectionsRelations = relations(mcpConnections, ({ one }) => ({
  organization: one(organizations, {
    fields: [mcpConnections.orgId],
    references: [organizations.id],
  }),
}));

export const mcpToolConfigsRelations = relations(mcpToolConfigs, ({ one }) => ({
  project: one(projects, {
    fields: [mcpToolConfigs.projectId],
    references: [projects.id],
  }),
}));

// ─── API Keys ────────────────────────────────────────────────────────────────

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  organization: one(organizations, {
    fields: [apiKeys.orgId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [apiKeys.userId],
    references: [users.id],
  }),
}));

// ─── Usage Rollups ───────────────────────────────────────────────────────────

export const usageRollupsRelations = relations(usageRollups, ({ one }) => ({
  organization: one(organizations, {
    fields: [usageRollups.orgId],
    references: [organizations.id],
  }),
}));
