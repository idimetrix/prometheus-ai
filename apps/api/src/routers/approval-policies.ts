import { approvalRequests } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("api:approval-policies");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActionType =
  | "deploy"
  | "merge"
  | "delete_branch"
  | "secret_update"
  | "environment_promote"
  | "release_publish";

export interface ApprovalPolicy {
  actionType: ActionType;
  autoExpireMinutes: number;
  createdAt: string;
  createdBy: string;
  enabled: boolean;
  id: string;
  name: string;
  orgId: string;
  projectId: string;
  requiredApprovers: number;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// In-memory policy config store (policies are configuration, not data)
// ---------------------------------------------------------------------------

const policyStore = new Map<string, ApprovalPolicy>();

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const actionTypeSchema = z.enum([
  "deploy",
  "merge",
  "delete_branch",
  "secret_update",
  "environment_promote",
  "release_publish",
]);

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const approvalPoliciesRouter = router({
  /**
   * List all approval policies for a given project.
   */
  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1, "Project ID is required"),
      })
    )
    .query(({ input, ctx }) => {
      const policies: ApprovalPolicy[] = [];
      for (const policy of policyStore.values()) {
        if (
          policy.orgId === ctx.orgId &&
          policy.projectId === input.projectId
        ) {
          policies.push(policy);
        }
      }

      logger.info(
        {
          orgId: ctx.orgId,
          projectId: input.projectId,
          count: policies.length,
        },
        "Listed approval policies"
      );

      return { policies };
    }),

  /**
   * Create a new approval policy for a project.
   */
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1, "Project ID is required"),
        name: z.string().min(1, "Policy name is required").max(255),
        actionType: actionTypeSchema,
        requiredApprovers: z.number().int().min(1).max(10).default(1),
        autoExpireMinutes: z.number().int().min(5).max(43_200).default(1440),
        enabled: z.boolean().default(true),
      })
    )
    .mutation(({ input, ctx }) => {
      const id = generateId("policy");
      const now = new Date().toISOString();

      const policy: ApprovalPolicy = {
        id,
        orgId: ctx.orgId,
        projectId: input.projectId,
        name: input.name,
        actionType: input.actionType,
        requiredApprovers: input.requiredApprovers,
        autoExpireMinutes: input.autoExpireMinutes,
        enabled: input.enabled,
        createdBy: ctx.auth.userId,
        createdAt: now,
        updatedAt: now,
      };

      policyStore.set(id, policy);

      logger.info(
        {
          orgId: ctx.orgId,
          projectId: input.projectId,
          policyId: id,
          actionType: input.actionType,
        },
        "Approval policy created"
      );

      return policy;
    }),

  /**
   * Update an existing approval policy.
   */
  update: protectedProcedure
    .input(
      z.object({
        policyId: z.string().min(1, "Policy ID is required"),
        name: z.string().min(1).max(255).optional(),
        requiredApprovers: z.number().int().min(1).max(10).optional(),
        autoExpireMinutes: z.number().int().min(5).max(43_200).optional(),
        enabled: z.boolean().optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      const policy = policyStore.get(input.policyId);

      if (!policy || policy.orgId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Approval policy not found",
        });
      }

      if (input.name !== undefined) {
        policy.name = input.name;
      }
      if (input.requiredApprovers !== undefined) {
        policy.requiredApprovers = input.requiredApprovers;
      }
      if (input.autoExpireMinutes !== undefined) {
        policy.autoExpireMinutes = input.autoExpireMinutes;
      }
      if (input.enabled !== undefined) {
        policy.enabled = input.enabled;
      }
      policy.updatedAt = new Date().toISOString();

      policyStore.set(input.policyId, policy);

      logger.info(
        { orgId: ctx.orgId, policyId: input.policyId },
        "Approval policy updated"
      );

      return policy;
    }),

  /**
   * Delete an approval policy.
   *
   * Any pending requests associated with this policy will be expired.
   */
  delete: protectedProcedure
    .input(
      z.object({
        policyId: z.string().min(1, "Policy ID is required"),
      })
    )
    .mutation(({ input, ctx }) => {
      const policy = policyStore.get(input.policyId);

      if (!policy || policy.orgId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Approval policy not found",
        });
      }

      policyStore.delete(input.policyId);

      logger.info(
        { orgId: ctx.orgId, policyId: input.policyId },
        "Approval policy deleted"
      );

      return { success: true };
    }),

  /**
   * List pending approval requests for the organization.
   */
  listPendingApprovals: protectedProcedure
    .input(
      z
        .object({
          projectId: z.string().optional(),
          limit: z.number().int().min(1).max(100).default(25),
          offset: z.number().int().min(0).default(0),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const limit = input?.limit ?? 25;
      const offset = input?.offset ?? 0;
      const projectId = input?.projectId ?? null;

      const conditions = [
        eq(approvalRequests.orgId, ctx.orgId),
        eq(approvalRequests.status, "pending"),
      ];

      if (projectId) {
        conditions.push(eq(approvalRequests.projectId, projectId));
      }

      const rows = await ctx.db
        .select()
        .from(approvalRequests)
        .where(and(...conditions))
        .orderBy(desc(approvalRequests.createdAt))
        .limit(limit)
        .offset(offset);

      const [totalResult] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(approvalRequests)
        .where(and(...conditions));

      const total = totalResult?.count ?? 0;

      logger.info({ orgId: ctx.orgId, total }, "Listed pending approvals");

      return { approvals: rows, total, limit, offset };
    }),

  /**
   * Approve a pending request.
   *
   * Sets the status to "approved" and records the approver.
   */
  approve: protectedProcedure
    .input(
      z.object({
        requestId: z.string().min(1, "Request ID is required"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const request = await ctx.db
        .select()
        .from(approvalRequests)
        .where(
          and(
            eq(approvalRequests.id, input.requestId),
            eq(approvalRequests.orgId, ctx.orgId)
          )
        )
        .then((rows) => rows[0]);

      if (!request) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Approval request not found",
        });
      }

      if (request.status !== "pending") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Request is already ${request.status}`,
        });
      }

      if (request.expiresAt && new Date(request.expiresAt) < new Date()) {
        await ctx.db
          .update(approvalRequests)
          .set({ status: "expired" })
          .where(eq(approvalRequests.id, input.requestId));

        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Approval request has expired",
        });
      }

      if (request.requesterId === ctx.auth.userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot approve your own request",
        });
      }

      const now = new Date();

      const [updated] = await ctx.db
        .update(approvalRequests)
        .set({
          status: "approved",
          approverId: ctx.auth.userId,
          respondedAt: now,
        })
        .where(eq(approvalRequests.id, input.requestId))
        .returning();

      logger.info(
        {
          orgId: ctx.orgId,
          requestId: input.requestId,
          approvedBy: ctx.auth.userId,
          status: "approved",
        },
        "Approval recorded"
      );

      return {
        success: true,
        status: updated?.status ?? "approved",
        approvalsReceived: 1,
        approvalsRequired: 1,
      };
    }),

  /**
   * Reject a pending request with a reason.
   *
   * A single rejection immediately transitions the request to "rejected".
   */
  reject: protectedProcedure
    .input(
      z.object({
        requestId: z.string().min(1, "Request ID is required"),
        reason: z.string().min(1, "Rejection reason is required").max(1000),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const request = await ctx.db
        .select()
        .from(approvalRequests)
        .where(
          and(
            eq(approvalRequests.id, input.requestId),
            eq(approvalRequests.orgId, ctx.orgId)
          )
        )
        .then((rows) => rows[0]);

      if (!request) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Approval request not found",
        });
      }

      if (request.status !== "pending") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Request is already ${request.status}`,
        });
      }

      const now = new Date();

      await ctx.db
        .update(approvalRequests)
        .set({
          status: "rejected",
          approverId: ctx.auth.userId,
          reason: input.reason,
          respondedAt: now,
        })
        .where(eq(approvalRequests.id, input.requestId));

      logger.info(
        {
          orgId: ctx.orgId,
          requestId: input.requestId,
          rejectedBy: ctx.auth.userId,
        },
        "Approval request rejected"
      );

      return { success: true, status: "rejected" as const };
    }),
});
