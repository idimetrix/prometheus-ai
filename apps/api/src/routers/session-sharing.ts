import { randomBytes } from "node:crypto";
import { sessionShares } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../trpc";

const logger = createLogger("api:session-sharing");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateShareToken(): string {
  return randomBytes(32).toString("base64url");
}

function buildShareUrl(token: string): string {
  const baseUrl = process.env.WEB_URL ?? "http://localhost:3000";
  return `${baseUrl}/shared/session/${token}`;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const sessionSharingRouter = router({
  /**
   * Create a share link for a session.
   *
   * Generates a unique token and returns a URL that can be shared with
   * collaborators. An optional expiration can be set.
   */
  share: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1, "Session ID is required"),
        permission: z.enum(["viewer", "editor", "admin"]).default("viewer"),
        expiresInHours: z
          .number()
          .int()
          .min(1)
          .max(8760) // 1 year
          .optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const token = generateShareToken();
      const id = generateId("share");
      const now = new Date();
      const expiresAt = input.expiresInHours
        ? new Date(now.getTime() + input.expiresInHours * 60 * 60 * 1000)
        : null;

      await ctx.db.insert(sessionShares).values({
        id,
        sessionId: input.sessionId,
        orgId: ctx.orgId,
        userId: ctx.auth.userId,
        permission: input.permission,
        shareToken: token,
        expiresAt,
      });

      logger.info(
        {
          orgId: ctx.orgId,
          userId: ctx.auth.userId,
          sessionId: input.sessionId,
          shareId: id,
          permission: input.permission,
        },
        "Session share created"
      );

      return {
        id,
        url: buildShareUrl(token),
        token,
        permission: input.permission,
        expiresAt: expiresAt?.toISOString() ?? null,
        createdAt: now.toISOString(),
      };
    }),

  /**
   * List all active shares for a given session.
   *
   * Active shares are those that have not been soft-deleted (deletedAt IS NULL).
   */
  listShares: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1, "Session ID is required"),
      })
    )
    .query(async ({ input, ctx }) => {
      const rows = await ctx.db
        .select()
        .from(sessionShares)
        .where(
          and(
            eq(sessionShares.sessionId, input.sessionId),
            eq(sessionShares.orgId, ctx.orgId),
            isNull(sessionShares.deletedAt)
          )
        );

      logger.info(
        {
          orgId: ctx.orgId,
          sessionId: input.sessionId,
          count: rows.length,
        },
        "Listed session shares"
      );

      return {
        shares: rows.map((s) => ({
          id: s.id,
          url: buildShareUrl(s.shareToken),
          permission: s.permission,
          createdBy: s.userId,
          createdAt: s.createdAt.toISOString(),
          expiresAt: s.expiresAt?.toISOString() ?? null,
          accessCount: 0,
          lastAccessedAt: null,
        })),
      };
    }),

  /**
   * Revoke a share link so it can no longer be used.
   *
   * Soft-deletes the share by setting deletedAt.
   */
  revokeShare: protectedProcedure
    .input(
      z.object({
        shareId: z.string().min(1, "Share ID is required"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [share] = await ctx.db
        .select()
        .from(sessionShares)
        .where(
          and(
            eq(sessionShares.id, input.shareId),
            eq(sessionShares.orgId, ctx.orgId),
            isNull(sessionShares.deletedAt)
          )
        )
        .limit(1);

      if (!share) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Share link not found or already revoked",
        });
      }

      const now = new Date();

      await ctx.db
        .update(sessionShares)
        .set({ deletedAt: now })
        .where(eq(sessionShares.id, input.shareId));

      logger.info(
        { orgId: ctx.orgId, shareId: input.shareId },
        "Session share revoked"
      );

      return { success: true, revokedAt: now.toISOString() };
    }),

  /**
   * Retrieve a shared session by its share token.
   *
   * This is the public-facing endpoint used when someone opens a share link.
   * It validates the token, checks expiration, and returns the session data
   * according to the share's permission level.
   */
  getSharedSession: publicProcedure
    .input(
      z.object({
        token: z.string().min(1, "Share token is required"),
      })
    )
    .query(async ({ input, ctx }) => {
      const [share] = await ctx.db
        .select()
        .from(sessionShares)
        .where(
          and(
            eq(sessionShares.shareToken, input.token),
            isNull(sessionShares.deletedAt)
          )
        )
        .limit(1);

      if (!share) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Share link not found or has been revoked",
        });
      }

      // Check expiration
      if (share.expiresAt && share.expiresAt < new Date()) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Share link has expired",
        });
      }

      return {
        sessionId: share.sessionId,
        permission: share.permission,
        sharedBy: share.userId,
        sharedAt: share.createdAt.toISOString(),
        expiresAt: share.expiresAt?.toISOString() ?? null,
      };
    }),

  /**
   * Update the permission level on an existing share link.
   */
  updatePermission: protectedProcedure
    .input(
      z.object({
        shareId: z.string().min(1, "Share ID is required"),
        permission: z.enum(["viewer", "editor", "admin"]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [share] = await ctx.db
        .select()
        .from(sessionShares)
        .where(
          and(
            eq(sessionShares.id, input.shareId),
            eq(sessionShares.orgId, ctx.orgId),
            isNull(sessionShares.deletedAt)
          )
        )
        .limit(1);

      if (!share) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Share link not found or already revoked",
        });
      }

      await ctx.db
        .update(sessionShares)
        .set({ permission: input.permission })
        .where(eq(sessionShares.id, input.shareId));

      logger.info(
        {
          orgId: ctx.orgId,
          shareId: input.shareId,
          previousPermission: share.permission,
          newPermission: input.permission,
        },
        "Session share permission updated"
      );

      return {
        success: true,
        shareId: input.shareId,
        permission: input.permission,
      };
    }),
});
