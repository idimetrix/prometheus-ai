import { browserScreenshots, browserSessions } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("api:browser");

export const browserRouter = router({
  // ---------------------------------------------------------------------------
  // Create a persistent browser session
  // ---------------------------------------------------------------------------
  createSession: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1, "Session ID is required"),
        sandboxId: z.string().min(1, "Sandbox ID is required"),
        viewportWidth: z.number().int().min(320).max(3840).optional(),
        viewportHeight: z.number().int().min(240).max(2160).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const id = generateId("brs");

      const [session] = await ctx.db
        .insert(browserSessions)
        .values({
          id,
          sessionId: input.sessionId,
          sandboxId: input.sandboxId,
          status: "active",
          viewportWidth: input.viewportWidth ?? 1280,
          viewportHeight: input.viewportHeight ?? 720,
        })
        .returning();

      logger.info(
        {
          orgId: ctx.orgId,
          browserSessionId: id,
          sessionId: input.sessionId,
          sandboxId: input.sandboxId,
        },
        "Browser session created"
      );

      return session;
    }),

  // ---------------------------------------------------------------------------
  // Navigate to a URL
  // ---------------------------------------------------------------------------
  navigate: protectedProcedure
    .input(
      z.object({
        browserSessionId: z.string().min(1, "Browser session ID is required"),
        url: z.string().url("Must be a valid URL"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [updated] = await ctx.db
        .update(browserSessions)
        .set({
          currentUrl: input.url,
          lastActiveAt: new Date(),
        })
        .where(eq(browserSessions.id, input.browserSessionId))
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Browser session not found",
        });
      }

      logger.info(
        {
          orgId: ctx.orgId,
          browserSessionId: input.browserSessionId,
          url: input.url,
        },
        "Browser navigated"
      );

      return updated;
    }),

  // ---------------------------------------------------------------------------
  // Record a screenshot
  // ---------------------------------------------------------------------------
  screenshot: protectedProcedure
    .input(
      z.object({
        browserSessionId: z.string().min(1, "Browser session ID is required"),
        storageUrl: z.string().min(1, "Storage URL is required"),
        url: z.string().optional(),
        visionAnalysis: z.string().optional(),
        domSnapshot: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const id = generateId("bsc");

      const [screenshot] = await ctx.db
        .insert(browserScreenshots)
        .values({
          id,
          browserSessionId: input.browserSessionId,
          storageUrl: input.storageUrl,
          url: input.url ?? null,
          visionAnalysis: input.visionAnalysis ?? null,
          domSnapshot: input.domSnapshot ?? null,
        })
        .returning();

      logger.info(
        {
          orgId: ctx.orgId,
          screenshotId: id,
          browserSessionId: input.browserSessionId,
        },
        "Browser screenshot recorded"
      );

      return screenshot;
    }),

  // ---------------------------------------------------------------------------
  // Get browser session details
  // ---------------------------------------------------------------------------
  getSession: protectedProcedure
    .input(
      z.object({
        browserSessionId: z.string().min(1, "Browser session ID is required"),
      })
    )
    .query(async ({ input, ctx }) => {
      const session = await ctx.db.query.browserSessions.findFirst({
        where: eq(browserSessions.id, input.browserSessionId),
      });

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Browser session not found",
        });
      }

      return session;
    }),

  // ---------------------------------------------------------------------------
  // List screenshots for a browser session
  // ---------------------------------------------------------------------------
  listScreenshots: protectedProcedure
    .input(
      z.object({
        browserSessionId: z.string().min(1, "Browser session ID is required"),
        limit: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ input, ctx }) => {
      const screenshots = await ctx.db.query.browserScreenshots.findMany({
        where: eq(browserScreenshots.browserSessionId, input.browserSessionId),
        orderBy: desc(browserScreenshots.capturedAt),
        limit: input.limit,
      });

      return { screenshots };
    }),

  // ---------------------------------------------------------------------------
  // Close a browser session
  // ---------------------------------------------------------------------------
  closeSession: protectedProcedure
    .input(
      z.object({
        browserSessionId: z.string().min(1, "Browser session ID is required"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [closed] = await ctx.db
        .update(browserSessions)
        .set({
          status: "closed",
          lastActiveAt: new Date(),
        })
        .where(eq(browserSessions.id, input.browserSessionId))
        .returning();

      if (!closed) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Browser session not found",
        });
      }

      logger.info(
        {
          orgId: ctx.orgId,
          browserSessionId: input.browserSessionId,
        },
        "Browser session closed"
      );

      return closed;
    }),
});
