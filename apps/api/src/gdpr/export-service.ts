/**
 * GDPR Organization Data Export & Deletion Service (GAP-029).
 *
 * Provides org-level data export (Right to Data Portability)
 * and org-level data deletion (Right to Erasure) for GDPR compliance.
 */
import {
  agents,
  auditLogs,
  creditTransactions,
  db,
  organizations,
  orgMembers,
  projects,
  sessionEvents,
  sessionMessages,
  sessions,
  taskSteps,
  tasks,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { eq, inArray } from "drizzle-orm";

const logger = createLogger("api:gdpr:export-service");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OrgDataExport {
  data: {
    auditLogs: Record<string, unknown>[];
    billing: Record<string, unknown>[];
    conversations: Record<string, unknown>[];
    members: Record<string, unknown>[];
    organization: Record<string, unknown>;
    projects: Record<string, unknown>[];
    sessions: Record<string, unknown>[];
    settings: Record<string, unknown>;
    tasks: Record<string, unknown>[];
  };
  exportedAt: string;
  format: "json";
  orgId: string;
}

export interface OrgDeletionResult {
  deletedAt: string;
  deletedResources: Array<{ type: string; count: number }>;
  error?: string;
  orgId: string;
  success: boolean;
}

// ─── Export ───────────────────────────────────────────────────────────────────

/**
 * Export all data for an organization as JSON.
 * GDPR Article 20 — Right to Data Portability (org-level).
 */
export async function exportOrgData(orgId: string): Promise<OrgDataExport> {
  logger.info({ orgId }, "Starting org data export");

  // Organization record
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  if (!org) {
    throw new Error(`Organization "${orgId}" not found`);
  }

  // Members
  const members = await db
    .select()
    .from(orgMembers)
    .where(eq(orgMembers.orgId, orgId));

  // Projects
  const orgProjects = await db
    .select()
    .from(projects)
    .where(eq(projects.orgId, orgId));

  const projectIds = orgProjects.map((p) => p.id);

  // Sessions (via projects)
  let orgSessions: (typeof sessions.$inferSelect)[] = [];
  let orgTasks: (typeof tasks.$inferSelect)[] = [];
  let orgTaskSteps: (typeof taskSteps.$inferSelect)[] = [];
  let _orgAgents: (typeof agents.$inferSelect)[] = [];
  let orgMessages: (typeof sessionMessages.$inferSelect)[] = [];

  if (projectIds.length > 0) {
    orgSessions = await db
      .select()
      .from(sessions)
      .where(inArray(sessions.projectId, projectIds));

    const sessionIds = orgSessions.map((s) => s.id);

    if (sessionIds.length > 0) {
      orgTasks = await db
        .select()
        .from(tasks)
        .where(inArray(tasks.sessionId, sessionIds));

      const taskIds = orgTasks.map((t) => t.id);
      if (taskIds.length > 0) {
        orgTaskSteps = await db
          .select()
          .from(taskSteps)
          .where(inArray(taskSteps.taskId, taskIds));
      }

      _orgAgents = await db
        .select()
        .from(agents)
        .where(inArray(agents.sessionId, sessionIds));

      orgMessages = await db
        .select()
        .from(sessionMessages)
        .where(inArray(sessionMessages.sessionId, sessionIds));
    }
  }

  // Billing / credit history
  const billing = await db
    .select()
    .from(creditTransactions)
    .where(eq(creditTransactions.orgId, orgId));

  // Audit logs
  const orgAuditLogs = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.orgId, orgId));

  const exportData: OrgDataExport = {
    format: "json",
    orgId,
    exportedAt: new Date().toISOString(),
    data: {
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        plan: org.planTier,
        createdAt: org.createdAt,
      },
      members: members.map((m) => ({
        userId: m.userId,
        role: m.role,
        joinedAt: m.joinedAt,
      })),
      projects: orgProjects.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        createdAt: p.createdAt,
      })),
      sessions: orgSessions.map((s) => ({
        id: s.id,
        projectId: s.projectId,
        userId: s.userId,
        mode: s.mode,
        status: s.status,
        startedAt: s.startedAt,
      })),
      tasks: orgTasks.map((t) => ({
        id: t.id,
        sessionId: t.sessionId,
        title: t.title,
        status: t.status,
        steps: orgTaskSteps
          .filter((s) => s.taskId === t.id)
          .map((s) => ({
            id: s.id,
            stepNumber: s.stepNumber,
            status: s.status,
          })),
      })),
      conversations: orgMessages.map((m) => ({
        id: m.id,
        sessionId: m.sessionId,
        role: m.role,
        createdAt: m.createdAt,
      })),
      billing: billing.map((b) => ({
        id: b.id,
        type: b.type,
        amount: b.amount,
        description: b.description,
        createdAt: b.createdAt,
      })),
      auditLogs: orgAuditLogs.map((a) => ({
        id: a.id,
        action: a.action,
        resource: a.resource,
        resourceId: a.resourceId,
        createdAt: a.createdAt,
      })),
      settings: {},
    },
  };

  logger.info(
    {
      orgId,
      projectCount: orgProjects.length,
      sessionCount: orgSessions.length,
      taskCount: orgTasks.length,
    },
    "Org data export completed"
  );

  return exportData;
}

// ─── Deletion ─────────────────────────────────────────────────────────────────

/**
 * Delete all data for an organization.
 * GDPR Article 17 — Right to Erasure (org-level).
 */
export async function deleteOrgData(orgId: string): Promise<OrgDeletionResult> {
  logger.info({ orgId }, "Starting org data deletion");

  const deletedResources: Array<{ type: string; count: number }> = [];

  try {
    // Gather project IDs
    const orgProjects = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.orgId, orgId));
    const projectIds = orgProjects.map((p) => p.id);

    // Gather session IDs
    let sessionIds: string[] = [];
    if (projectIds.length > 0) {
      const orgSessions = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(inArray(sessions.projectId, projectIds));
      sessionIds = orgSessions.map((s) => s.id);
    }

    // Delete in reverse dependency order
    if (sessionIds.length > 0) {
      // Task steps and tasks
      const orgTasks = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(inArray(tasks.sessionId, sessionIds));
      const taskIds = orgTasks.map((t) => t.id);

      if (taskIds.length > 0) {
        const deletedSteps = await db
          .delete(taskSteps)
          .where(inArray(taskSteps.taskId, taskIds))
          .returning();
        deletedResources.push({
          type: "task_steps",
          count: deletedSteps.length,
        });

        const deletedTasks = await db
          .delete(tasks)
          .where(inArray(tasks.id, taskIds))
          .returning();
        deletedResources.push({ type: "tasks", count: deletedTasks.length });
      }

      // Agents
      const deletedAgents = await db
        .delete(agents)
        .where(inArray(agents.sessionId, sessionIds))
        .returning();
      deletedResources.push({ type: "agents", count: deletedAgents.length });

      // Session events and messages
      const deletedEvents = await db
        .delete(sessionEvents)
        .where(inArray(sessionEvents.sessionId, sessionIds))
        .returning();
      deletedResources.push({
        type: "session_events",
        count: deletedEvents.length,
      });

      const deletedMessages = await db
        .delete(sessionMessages)
        .where(inArray(sessionMessages.sessionId, sessionIds))
        .returning();
      deletedResources.push({
        type: "session_messages",
        count: deletedMessages.length,
      });

      // Sessions
      const deletedSessions = await db
        .delete(sessions)
        .where(inArray(sessions.id, sessionIds))
        .returning();
      deletedResources.push({
        type: "sessions",
        count: deletedSessions.length,
      });
    }

    // Projects
    if (projectIds.length > 0) {
      const deletedProjects = await db
        .delete(projects)
        .where(inArray(projects.id, projectIds))
        .returning();
      deletedResources.push({
        type: "projects",
        count: deletedProjects.length,
      });
    }

    // Credit transactions
    const deletedCredits = await db
      .delete(creditTransactions)
      .where(eq(creditTransactions.orgId, orgId))
      .returning();
    deletedResources.push({
      type: "credit_transactions",
      count: deletedCredits.length,
    });

    // Audit logs
    const deletedAudit = await db
      .delete(auditLogs)
      .where(eq(auditLogs.orgId, orgId))
      .returning();
    deletedResources.push({ type: "audit_logs", count: deletedAudit.length });

    // Org members
    const deletedMembers = await db
      .delete(orgMembers)
      .where(eq(orgMembers.orgId, orgId))
      .returning();
    deletedResources.push({
      type: "org_members",
      count: deletedMembers.length,
    });

    // Organization
    const deletedOrg = await db
      .delete(organizations)
      .where(eq(organizations.id, orgId))
      .returning();
    deletedResources.push({ type: "organizations", count: deletedOrg.length });

    logger.info({ orgId, deletedResources }, "Org data deletion completed");

    return {
      orgId,
      success: true,
      deletedAt: new Date().toISOString(),
      deletedResources,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ orgId, error: msg }, "Org data deletion failed");

    return {
      orgId,
      success: false,
      deletedAt: new Date().toISOString(),
      deletedResources,
      error: msg,
    };
  }
}
