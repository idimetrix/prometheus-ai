/**
 * Deploy Preview Router (GAP-024)
 *
 * Manages preview deployments for projects:
 * - Trigger preview deployments via MCP adapters (Vercel, Netlify, Docker)
 * - Get deployment status and logs
 * - List preview deployments for a session or project
 * - Run smoke tests against deployment URLs
 * - Rollback deployments
 */

import { deployments, projects } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("api:deploy-preview");

const MCP_GATEWAY_URL = process.env.MCP_GATEWAY_URL ?? "http://localhost:4005";

const deployProviderSchema = z.enum(["vercel", "netlify", "docker"]);

export const deployPreviewRouter = router({
  // ---------------------------------------------------------------------------
  // Trigger a preview deployment
  // ---------------------------------------------------------------------------
  trigger: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1, "Project ID is required"),
        sessionId: z.string().optional(),
        provider: deployProviderSchema,
        branch: z.string().min(1, "Branch is required"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const project = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          eq(projects.orgId, ctx.orgId)
        ),
      });

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      const deploymentId = generateId("deploy");

      // Insert deployment record
      await ctx.db.insert(deployments).values({
        id: deploymentId,
        projectId: input.projectId,
        orgId: ctx.orgId,
        provider: input.provider,
        branch: input.branch,
        status: "queued",
        sessionId: input.sessionId ?? null,
      });

      // Trigger deployment via MCP gateway (async)
      triggerMCPDeployment({
        deploymentId,
        projectId: input.projectId,
        provider: input.provider,
        branch: input.branch,
        orgId: ctx.orgId,
      }).catch((error) => {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(
          { deploymentId, error: msg },
          "MCP deployment trigger failed"
        );
      });

      logger.info(
        {
          deploymentId,
          projectId: input.projectId,
          provider: input.provider,
          branch: input.branch,
        },
        "Preview deployment triggered"
      );

      return {
        id: deploymentId,
        status: "queued" as const,
        provider: input.provider,
        branch: input.branch,
      };
    }),

  // ---------------------------------------------------------------------------
  // Get deployment status
  // ---------------------------------------------------------------------------
  getStatus: protectedProcedure
    .input(
      z.object({
        deploymentId: z.string().min(1, "Deployment ID is required"),
      })
    )
    .query(async ({ input, ctx }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(
          eq(deployments.id, input.deploymentId),
          eq(deployments.orgId, ctx.orgId)
        ),
      });

      if (!deployment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Deployment not found",
        });
      }

      return {
        id: deployment.id,
        projectId: deployment.projectId,
        status: deployment.status,
        provider: deployment.provider,
        branch: deployment.branch,
        url: deployment.url,
        createdAt: deployment.createdAt,
        buildLogs: deployment.buildLogs,
        errorMessage: deployment.errorMessage,
      };
    }),

  // ---------------------------------------------------------------------------
  // List preview deployments for a project or session
  // ---------------------------------------------------------------------------
  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        sessionId: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ input, ctx }) => {
      const conditions = [
        eq(deployments.projectId, input.projectId),
        eq(deployments.orgId, ctx.orgId),
      ];

      if (input.sessionId) {
        conditions.push(eq(deployments.sessionId, input.sessionId));
      }

      const results = await ctx.db
        .select({
          id: deployments.id,
          projectId: deployments.projectId,
          status: deployments.status,
          provider: deployments.provider,
          branch: deployments.branch,
          url: deployments.url,
          createdAt: deployments.createdAt,
          sessionId: deployments.sessionId,
        })
        .from(deployments)
        .where(and(...conditions))
        .orderBy(desc(deployments.createdAt))
        .limit(input.limit);

      return { deployments: results, total: results.length };
    }),

  // ---------------------------------------------------------------------------
  // Run smoke test against a deployment URL
  // ---------------------------------------------------------------------------
  smokeTest: protectedProcedure
    .input(
      z.object({
        deploymentId: z.string().min(1),
        url: z.string().url().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(
          eq(deployments.id, input.deploymentId),
          eq(deployments.orgId, ctx.orgId)
        ),
      });

      if (!deployment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Deployment not found",
        });
      }

      const targetUrl = input.url ?? deployment.url;
      if (!targetUrl) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "No URL available for smoke test. Deployment may still be in progress.",
        });
      }

      try {
        const startTime = Date.now();
        const response = await fetch(targetUrl, {
          method: "GET",
          headers: { "User-Agent": "Prometheus-Smoke-Test/1.0" },
          signal: AbortSignal.timeout(30_000),
        });

        const durationMs = Date.now() - startTime;
        const body = await response.text();

        const checks = [
          {
            check: "http_status",
            passed: response.status >= 200 && response.status < 400,
            detail: `HTTP ${response.status}`,
          },
          {
            check: "response_time",
            passed: durationMs < 30_000,
            detail: `${durationMs}ms`,
          },
          {
            check: "non_empty_body",
            passed: body.length > 0,
            detail: `${body.length} bytes`,
          },
        ];

        const allPassed = checks.every((c) => c.passed);

        logger.info(
          {
            deploymentId: deployment.id,
            url: targetUrl,
            passed: allPassed,
            durationMs,
            httpStatus: response.status,
          },
          "Smoke test completed"
        );

        return {
          url: targetUrl,
          passed: allPassed,
          durationMs,
          httpStatus: response.status,
          checks,
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(
          { deploymentId: deployment.id, url: targetUrl, error: msg },
          "Smoke test failed"
        );

        return {
          url: targetUrl,
          passed: false,
          durationMs: 0,
          httpStatus: 0,
          checks: [
            {
              check: "connectivity",
              passed: false,
              detail: msg,
            },
          ],
        };
      }
    }),

  // ---------------------------------------------------------------------------
  // Rollback a deployment
  // ---------------------------------------------------------------------------
  rollback: protectedProcedure
    .input(
      z.object({
        deploymentId: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(
          eq(deployments.id, input.deploymentId),
          eq(deployments.orgId, ctx.orgId)
        ),
      });

      if (!deployment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Deployment not found",
        });
      }

      // Update status to deleted (rollback = remove the preview)
      await ctx.db
        .update(deployments)
        .set({ status: "deleted" })
        .where(eq(deployments.id, deployment.id));

      // Trigger rollback via MCP gateway
      triggerMCPRollback({
        deploymentId: deployment.id,
        projectId: deployment.projectId,
        provider: deployment.provider,
        orgId: ctx.orgId,
      }).catch((error) => {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(
          { deploymentId: deployment.id, error: msg },
          "MCP rollback trigger failed"
        );
      });

      logger.info(
        { deploymentId: deployment.id },
        "Deployment rollback triggered"
      );

      return { id: deployment.id, status: "deleted" as const };
    }),
});

// ---------------------------------------------------------------------------
// MCP gateway helpers (async, fire-and-forget)
// ---------------------------------------------------------------------------

async function triggerMCPDeployment(params: {
  branch: string;
  deploymentId: string;
  orgId: string;
  projectId: string;
  provider: string;
}): Promise<void> {
  try {
    const response = await fetch(
      `${MCP_GATEWAY_URL}/api/adapters/${params.provider}/deploy`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: params.projectId,
          branch: params.branch,
          type: "preview",
          deploymentId: params.deploymentId,
        }),
        signal: AbortSignal.timeout(120_000),
      }
    );

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      logger.warn(
        {
          status: response.status,
          deploymentId: params.deploymentId,
          error: errBody.slice(0, 200),
        },
        "MCP deploy request failed"
      );
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(
      { deploymentId: params.deploymentId, error: msg },
      "MCP deploy request error"
    );
  }
}

async function triggerMCPRollback(params: {
  deploymentId: string;
  orgId: string;
  projectId: string;
  provider: string;
}): Promise<void> {
  try {
    const response = await fetch(
      `${MCP_GATEWAY_URL}/api/adapters/${params.provider}/rollback`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: params.projectId,
          deploymentId: params.deploymentId,
        }),
        signal: AbortSignal.timeout(120_000),
      }
    );

    if (!response.ok) {
      logger.warn(
        { status: response.status, deploymentId: params.deploymentId },
        "MCP rollback request failed"
      );
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(
      { deploymentId: params.deploymentId, error: msg },
      "MCP rollback request error"
    );
  }
}
