import type { Database } from "@prometheus/db";
import { projects, releases } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("releases-router");

// ---------------------------------------------------------------------------
// Input Schemas
// ---------------------------------------------------------------------------

const listReleasesSchema = z.object({
  projectId: z.string(),
  limit: z.number().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

const getReleaseSchema = z.object({
  releaseId: z.string(),
});

const createReleaseSchema = z.object({
  projectId: z.string(),
  version: z.string(),
  title: z.string(),
  body: z.string().optional(),
  tagName: z.string().optional(),
  targetBranch: z.string().optional(),
});

const updateReleaseSchema = z.object({
  releaseId: z.string(),
  version: z.string().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  tagName: z.string().optional(),
  targetBranch: z.string().optional(),
});

const publishReleaseSchema = z.object({
  releaseId: z.string(),
});

const generateChangelogSchema = z.object({
  projectId: z.string(),
  sinceVersion: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function verifyProjectAccess(
  db: Database,
  projectId: string,
  orgId: string
) {
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.orgId, orgId)),
    columns: { id: true },
  });
  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }
  return project;
}

async function verifyReleaseAccess(
  db: Database,
  releaseId: string,
  orgId: string
) {
  const release = await db.query.releases.findFirst({
    where: and(eq(releases.id, releaseId), eq(releases.orgId, orgId)),
  });
  if (!release) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Release not found" });
  }
  return release;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const releasesRouter = router({
  // ─── List Releases ───────────────────────────────────────────────────
  list: protectedProcedure
    .input(listReleasesSchema)
    .query(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);

      const conditions = [
        eq(releases.projectId, input.projectId),
        eq(releases.orgId, ctx.orgId),
      ];

      if (input.cursor) {
        const cursorRelease = await ctx.db.query.releases.findFirst({
          where: eq(releases.id, input.cursor),
          columns: { createdAt: true },
        });
        if (cursorRelease) {
          conditions.push(lt(releases.createdAt, cursorRelease.createdAt));
        }
      }

      const results = await ctx.db.query.releases.findMany({
        where: and(...conditions),
        orderBy: [desc(releases.createdAt)],
        limit: input.limit + 1,
      });

      const hasMore = results.length > input.limit;
      const items = hasMore ? results.slice(0, input.limit) : results;

      return {
        releases: items,
        nextCursor: hasMore ? items.at(-1)?.id : null,
      };
    }),

  // ─── Get Release ─────────────────────────────────────────────────────
  get: protectedProcedure
    .input(getReleaseSchema)
    .query(async ({ input, ctx }) => {
      const release = await verifyReleaseAccess(
        ctx.db,
        input.releaseId,
        ctx.orgId
      );
      return release;
    }),

  // ─── Create Release ──────────────────────────────────────────────────
  create: protectedProcedure
    .input(createReleaseSchema)
    .mutation(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);

      const id = generateId("rel");

      const [release] = await ctx.db
        .insert(releases)
        .values({
          id,
          projectId: input.projectId,
          orgId: ctx.orgId,
          version: input.version,
          title: input.title,
          body: input.body ?? null,
          status: "draft",
          tagName: input.tagName ?? `v${input.version}`,
          targetBranch: input.targetBranch ?? "main",
          createdBy: ctx.auth.userId,
        })
        .returning();

      logger.info(
        { releaseId: id, projectId: input.projectId, version: input.version },
        "Release created"
      );

      return release;
    }),

  // ─── Update Release ──────────────────────────────────────────────────
  update: protectedProcedure
    .input(updateReleaseSchema)
    .mutation(async ({ input, ctx }) => {
      const existing = await verifyReleaseAccess(
        ctx.db,
        input.releaseId,
        ctx.orgId
      );

      if (existing.status === "published") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Cannot update a published release",
        });
      }

      const updateData: Record<string, unknown> = {};
      if (input.version !== undefined) {
        updateData.version = input.version;
      }
      if (input.title !== undefined) {
        updateData.title = input.title;
      }
      if (input.body !== undefined) {
        updateData.body = input.body;
      }
      if (input.tagName !== undefined) {
        updateData.tagName = input.tagName;
      }
      if (input.targetBranch !== undefined) {
        updateData.targetBranch = input.targetBranch;
      }

      if (Object.keys(updateData).length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No fields to update",
        });
      }

      const [updated] = await ctx.db
        .update(releases)
        .set(updateData)
        .where(
          and(eq(releases.id, input.releaseId), eq(releases.orgId, ctx.orgId))
        )
        .returning();

      logger.info({ releaseId: input.releaseId }, "Release updated");

      return updated;
    }),

  // ─── Publish Release ─────────────────────────────────────────────────
  publish: protectedProcedure
    .input(publishReleaseSchema)
    .mutation(async ({ input, ctx }) => {
      const existing = await verifyReleaseAccess(
        ctx.db,
        input.releaseId,
        ctx.orgId
      );

      if (existing.status === "published") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Release is already published",
        });
      }

      const [published] = await ctx.db
        .update(releases)
        .set({
          status: "published",
          publishedAt: new Date(),
        })
        .where(
          and(eq(releases.id, input.releaseId), eq(releases.orgId, ctx.orgId))
        )
        .returning();

      logger.info(
        {
          releaseId: input.releaseId,
          version: existing.version,
          tagName: existing.tagName,
        },
        "Release published"
      );

      return published;
    }),

  // ─── Generate Changelog ──────────────────────────────────────────────
  generateChangelog: protectedProcedure
    .input(generateChangelogSchema)
    .query(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);

      // Find the last published release to use as the starting point
      let sinceDate: Date | null = null;
      if (input.sinceVersion) {
        const sinceRelease = await ctx.db.query.releases.findFirst({
          where: and(
            eq(releases.projectId, input.projectId),
            eq(releases.orgId, ctx.orgId),
            eq(releases.version, input.sinceVersion)
          ),
          columns: { publishedAt: true, createdAt: true },
        });
        if (sinceRelease) {
          sinceDate = sinceRelease.publishedAt ?? sinceRelease.createdAt;
        }
      } else {
        // Get the latest published release
        const lastRelease = await ctx.db.query.releases.findFirst({
          where: and(
            eq(releases.projectId, input.projectId),
            eq(releases.orgId, ctx.orgId),
            eq(releases.status, "published")
          ),
          orderBy: [desc(releases.createdAt)],
          columns: { publishedAt: true, createdAt: true, version: true },
        });
        if (lastRelease) {
          sinceDate = lastRelease.publishedAt ?? lastRelease.createdAt;
        }
      }

      // Return a placeholder changelog — the actual git log integration
      // would be handled by the orchestrator/sandbox when generating releases
      return {
        sinceDate: sinceDate?.toISOString() ?? null,
        message:
          "Changelog generation requires git access. Use the agent to auto-generate a changelog from commits.",
        placeholder: true,
      };
    }),
});
