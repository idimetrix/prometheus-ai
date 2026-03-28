import { previewSessions } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("api:preview");

const PREVIEW_STATUSES = ["starting", "ready", "stopped", "error"] as const;

export const previewRouter = router({
  // ---------------------------------------------------------------------------
  // Start a preview session for a sandbox
  // ---------------------------------------------------------------------------
  start: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1, "Session ID is required"),
        sandboxId: z.string().min(1, "Sandbox ID is required"),
        port: z.number().int().min(1).max(65_535).default(3000),
        framework: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const id = generateId("prev");

      const [preview] = await ctx.db
        .insert(previewSessions)
        .values({
          id,
          sessionId: input.sessionId,
          sandboxId: input.sandboxId,
          port: input.port,
          framework: input.framework ?? null,
          status: "starting",
        })
        .returning();

      logger.info(
        {
          orgId: ctx.orgId,
          previewId: id,
          sessionId: input.sessionId,
          sandboxId: input.sandboxId,
          port: input.port,
        },
        "Preview session started"
      );

      return preview;
    }),

  // ---------------------------------------------------------------------------
  // Get preview session status
  // ---------------------------------------------------------------------------
  status: protectedProcedure
    .input(
      z.object({
        previewSessionId: z.string().min(1, "Preview session ID is required"),
      })
    )
    .query(async ({ input, ctx }) => {
      const preview = await ctx.db.query.previewSessions.findFirst({
        where: eq(previewSessions.id, input.previewSessionId),
      });

      if (!preview) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Preview session not found",
        });
      }

      return preview;
    }),

  // ---------------------------------------------------------------------------
  // List all preview sessions for a given session
  // ---------------------------------------------------------------------------
  listForSession: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1, "Session ID is required"),
      })
    )
    .query(async ({ input, ctx }) => {
      const previews = await ctx.db.query.previewSessions.findMany({
        where: eq(previewSessions.sessionId, input.sessionId),
      });

      return { previews };
    }),

  // ---------------------------------------------------------------------------
  // Update preview session status
  // ---------------------------------------------------------------------------
  updateStatus: protectedProcedure
    .input(
      z.object({
        previewSessionId: z.string().min(1, "Preview session ID is required"),
        status: z.enum(PREVIEW_STATUSES),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [updated] = await ctx.db
        .update(previewSessions)
        .set({ status: input.status })
        .where(eq(previewSessions.id, input.previewSessionId))
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Preview session not found",
        });
      }

      logger.info(
        {
          orgId: ctx.orgId,
          previewId: input.previewSessionId,
          status: input.status,
        },
        "Preview session status updated"
      );

      return updated;
    }),

  // ---------------------------------------------------------------------------
  // List all active ports for a sandbox
  // ---------------------------------------------------------------------------
  ports: protectedProcedure
    .input(
      z.object({
        sandboxId: z.string().min(1, "Sandbox ID is required"),
      })
    )
    .query(async ({ input, ctx }) => {
      const activePreviews = await ctx.db.query.previewSessions.findMany({
        where: and(
          eq(previewSessions.sandboxId, input.sandboxId),
          eq(previewSessions.status, "ready")
        ),
      });

      return {
        ports: activePreviews.map((p) => ({
          id: p.id,
          port: p.port,
          framework: p.framework,
          publicUrl: p.publicUrl,
        })),
      };
    }),
});
