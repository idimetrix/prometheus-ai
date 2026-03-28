import { designToCodeJobs, designUploads } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("api:design");

export const designRouter = router({
  // ---------------------------------------------------------------------------
  // Upload – record a design image upload
  // ---------------------------------------------------------------------------
  upload: protectedProcedure
    .input(
      z.object({
        projectId: z.string().optional(),
        storageUrl: z.string().url(),
        originalFilename: z.string().optional(),
        mimeType: z.string().optional(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        figmaFileKey: z.string().optional(),
        figmaNodeId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .insert(designUploads)
        .values({
          orgId: ctx.orgId,
          userId: ctx.auth.userId,
          projectId: input.projectId,
          storageUrl: input.storageUrl,
          originalFilename: input.originalFilename,
          mimeType: input.mimeType,
          width: input.width,
          height: input.height,
          figmaFileKey: input.figmaFileKey,
          figmaNodeId: input.figmaNodeId,
        })
        .returning();

      const upload = rows[0];
      if (!upload) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create upload",
        });
      }
      logger.info({ uploadId: upload.id, orgId: ctx.orgId }, "Design uploaded");

      return { upload };
    }),

  // ---------------------------------------------------------------------------
  // Analyze – return structured analysis of an uploaded design image
  // ---------------------------------------------------------------------------
  analyze: protectedProcedure
    .input(z.object({ designUploadId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const upload = await ctx.db.query.designUploads.findFirst({
        where: and(
          eq(designUploads.id, input.designUploadId),
          eq(designUploads.orgId, ctx.orgId)
        ),
      });

      if (!upload) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Design upload not found",
        });
      }

      // Mock analysis – will be replaced with real vision model call
      const analysis = {
        layout: {
          type: "flex-column" as const,
          sections: ["header", "hero", "content", "footer"],
          responsive: true,
        },
        colors: {
          primary: "#3B82F6",
          secondary: "#10B981",
          background: "#FFFFFF",
          text: "#1F2937",
          palette: ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6"],
        },
        typography: {
          headingFont: "Inter",
          bodyFont: "Inter",
          sizes: {
            h1: "2.25rem",
            h2: "1.5rem",
            body: "1rem",
            small: "0.875rem",
          },
        },
        components: [
          { type: "navbar", confidence: 0.95 },
          { type: "hero-section", confidence: 0.9 },
          { type: "card-grid", confidence: 0.85 },
          { type: "footer", confidence: 0.92 },
        ],
      };

      // Persist extracted tokens on the upload row
      await ctx.db
        .update(designUploads)
        .set({ extractedTokens: analysis as Record<string, unknown> })
        .where(eq(designUploads.id, upload.id));

      logger.info({ uploadId: upload.id }, "Design analysis completed (mock)");

      return { analysis };
    }),

  // ---------------------------------------------------------------------------
  // Generate – start a design-to-code job
  // ---------------------------------------------------------------------------
  generate: protectedProcedure
    .input(
      z.object({
        designUploadId: z.string(),
        framework: z.enum(["react", "vue", "svelte", "html"]).default("react"),
        conversationId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify ownership
      const upload = await ctx.db.query.designUploads.findFirst({
        where: and(
          eq(designUploads.id, input.designUploadId),
          eq(designUploads.orgId, ctx.orgId)
        ),
      });

      if (!upload) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Design upload not found",
        });
      }

      const jobRows = await ctx.db
        .insert(designToCodeJobs)
        .values({
          designUploadId: input.designUploadId,
          framework: input.framework,
          conversationId: input.conversationId,
          status: "pending",
        })
        .returning();

      const job = jobRows[0];
      if (!job) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create job",
        });
      }
      logger.info(
        { jobId: job.id, uploadId: upload.id, framework: input.framework },
        "Design-to-code job created"
      );

      return { job };
    }),

  // ---------------------------------------------------------------------------
  // Get job – retrieve job status and result
  // ---------------------------------------------------------------------------
  getJob: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ ctx, input }) => {
      const job = await ctx.db.query.designToCodeJobs.findFirst({
        where: eq(designToCodeJobs.id, input.jobId),
        with: { designUpload: true },
      });

      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Design-to-code job not found",
        });
      }

      // Verify org ownership via the linked upload
      if (job.designUpload?.orgId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Design-to-code job not found",
        });
      }

      return { job };
    }),

  // ---------------------------------------------------------------------------
  // List jobs – list design-to-code jobs for the org
  // ---------------------------------------------------------------------------
  listJobs: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }))
    .query(async ({ ctx, input }) => {
      const jobs = await ctx.db.query.designToCodeJobs.findMany({
        with: { designUpload: true },
        where: (fields, { eq: eq_ }) =>
          eq_(
            fields.designUploadId,
            sql`ANY(
            SELECT ${designUploads.id} FROM ${designUploads}
            WHERE ${designUploads.orgId} = ${ctx.orgId}
          )`
          ),
        orderBy: (fields) => desc(fields.createdAt),
        limit: input.limit,
      });

      return { jobs };
    }),

  // ---------------------------------------------------------------------------
  // List uploads – list design uploads for the org
  // ---------------------------------------------------------------------------
  listUploads: protectedProcedure
    .input(
      z.object({
        projectId: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(designUploads.orgId, ctx.orgId)];
      if (input.projectId) {
        conditions.push(eq(designUploads.projectId, input.projectId));
      }

      const uploads = await ctx.db.query.designUploads.findMany({
        where: and(...conditions),
        orderBy: (fields) => desc(fields.createdAt),
        limit: input.limit,
      });

      return { uploads };
    }),

  // ---------------------------------------------------------------------------
  // Refine – trigger a refinement iteration on a job
  // ---------------------------------------------------------------------------
  refine: protectedProcedure
    .input(
      z.object({
        jobId: z.string(),
        feedback: z.string().min(1).max(5000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const job = await ctx.db.query.designToCodeJobs.findFirst({
        where: eq(designToCodeJobs.id, input.jobId),
        with: { designUpload: true },
      });

      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Design-to-code job not found",
        });
      }

      if (job.designUpload?.orgId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Design-to-code job not found",
        });
      }

      const updatedRows = await ctx.db
        .update(designToCodeJobs)
        .set({
          iterations: sql`${designToCodeJobs.iterations} + 1`,
          status: "refining",
        })
        .where(eq(designToCodeJobs.id, input.jobId))
        .returning();

      const updated = updatedRows[0];
      if (!updated) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update job",
        });
      }
      logger.info(
        { jobId: input.jobId, iteration: updated.iterations },
        "Design-to-code refinement triggered"
      );

      return { job: updated };
    }),

  // ---------------------------------------------------------------------------
  // Iterate – chat-based design iteration loop
  // ---------------------------------------------------------------------------
  iterate: protectedProcedure
    .input(
      z.object({
        jobId: z.string(),
        userFeedback: z.string().min(1).max(10_000),
        conversationId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const job = await ctx.db.query.designToCodeJobs.findFirst({
        where: eq(designToCodeJobs.id, input.jobId),
        with: { designUpload: true },
      });

      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Design-to-code job not found",
        });
      }

      if (job.designUpload?.orgId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Design-to-code job not found",
        });
      }

      // Mock LLM iteration: in production, sends original design description +
      // current code + user feedback to the LLM and returns updated code
      const currentCode =
        typeof job.generatedCode === "string" ? job.generatedCode : "";
      const iteratedCode = currentCode
        ? `${currentCode}\n// Iteration ${(job.iterations ?? 0) + 1}: Applied feedback - ${input.userFeedback.slice(0, 100)}`
        : `// Generated code - Iteration ${(job.iterations ?? 0) + 1}\n// Feedback: ${input.userFeedback.slice(0, 100)}\nexport default function Component() {\n  return <div>Updated component</div>;\n}`;

      const updatedRows = await ctx.db
        .update(designToCodeJobs)
        .set({
          generatedCode: iteratedCode,
          iterations: sql`${designToCodeJobs.iterations} + 1`,
          status: "completed",
        })
        .where(eq(designToCodeJobs.id, input.jobId))
        .returning();

      const updated = updatedRows[0];
      if (!updated) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update job",
        });
      }

      logger.info(
        {
          jobId: input.jobId,
          iteration: updated.iterations,
          conversationId: input.conversationId,
        },
        "Design iteration completed"
      );

      return { job: updated, code: iteratedCode };
    }),

  // ---------------------------------------------------------------------------
  // From Figma – create upload from Figma file metadata
  // ---------------------------------------------------------------------------
  fromFigma: protectedProcedure
    .input(
      z.object({
        figmaFileKey: z.string().min(1),
        figmaNodeId: z.string().optional(),
        projectId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const storageUrl = `figma://${input.figmaFileKey}${input.figmaNodeId ? `?nodeId=${input.figmaNodeId}` : ""}`;

      const figmaRows = await ctx.db
        .insert(designUploads)
        .values({
          orgId: ctx.orgId,
          userId: ctx.auth.userId,
          projectId: input.projectId,
          storageUrl,
          figmaFileKey: input.figmaFileKey,
          figmaNodeId: input.figmaNodeId,
          mimeType: "application/figma",
        })
        .returning();

      const upload = figmaRows[0];
      if (!upload) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create upload",
        });
      }
      logger.info(
        { uploadId: upload.id, figmaFileKey: input.figmaFileKey },
        "Design upload created from Figma"
      );

      return { upload };
    }),
});
