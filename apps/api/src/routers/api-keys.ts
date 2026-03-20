import { createHash, randomBytes } from "node:crypto";
import { apiKeys } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { orgAdminProcedure, protectedProcedure, router } from "../trpc";

const logger = createLogger("api:api-keys");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MAX_KEYS_PER_ORG = 25;
const KEY_PREFIX = "pk_live_";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Mask the key for display: show prefix + first 4 hex chars + ... + last 4.
 */
function maskKey(name: string): string {
  return `${KEY_PREFIX}${"*".repeat(8)}...${name.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const apiKeysRouter = router({
  /**
   * List all active (non-revoked) API keys for the org.
   * Keys are shown masked -- the raw key is never stored or returned after creation.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const keys = await ctx.db.query.apiKeys.findMany({
      where: and(eq(apiKeys.orgId, ctx.orgId), isNull(apiKeys.revokedAt)),
      columns: {
        id: true,
        name: true,
        lastUsed: true,
        createdAt: true,
        keyHash: true,
      },
      orderBy: [desc(apiKeys.createdAt)],
    });

    return {
      keys: keys.map((k) => ({
        id: k.id,
        name: k.name,
        maskedKey: maskKey(k.keyHash),
        lastUsed: k.lastUsed?.toISOString() ?? null,
        createdAt: k.createdAt.toISOString(),
      })),
    };
  }),

  /**
   * Generate a new API key. The raw key is returned exactly once.
   * Only the SHA-256 hash is stored.
   */
  create: orgAdminProcedure
    .input(
      z.object({
        name: z
          .string()
          .min(1, "Name is required")
          .max(100, "Name must be 100 characters or fewer"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Enforce per-org key limit
      const existingCount = await ctx.db.query.apiKeys.findMany({
        where: and(eq(apiKeys.orgId, ctx.orgId), isNull(apiKeys.revokedAt)),
        columns: { id: true },
      });

      if (existingCount.length >= MAX_KEYS_PER_ORG) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Maximum of ${MAX_KEYS_PER_ORG} active API keys per organization`,
        });
      }

      const rawKey = `${KEY_PREFIX}${randomBytes(32).toString("hex")}`;
      const keyHash = hashKey(rawKey);
      const id = generateId("key");

      await ctx.db.insert(apiKeys).values({
        id,
        orgId: ctx.orgId,
        userId: ctx.auth.userId,
        keyHash,
        name: input.name,
      });

      logger.info({ orgId: ctx.orgId, keyId: id }, "API key created");

      return {
        id,
        key: rawKey,
        name: input.name,
        message: "Store this key securely. It will not be shown again.",
      };
    }),

  /**
   * Revoke an API key. It can no longer be used for authentication.
   */
  revoke: orgAdminProcedure
    .input(
      z.object({
        keyId: z.string().min(1, "Key ID is required"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [updated] = await ctx.db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(apiKeys.id, input.keyId),
            eq(apiKeys.orgId, ctx.orgId),
            isNull(apiKeys.revokedAt)
          )
        )
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "API key not found or already revoked",
        });
      }

      logger.info({ orgId: ctx.orgId, keyId: input.keyId }, "API key revoked");
      return { success: true };
    }),

  /**
   * Rotate an API key: revoke the current key and issue a new one atomically.
   * Returns the new raw key (shown once).
   */
  rotate: orgAdminProcedure
    .input(
      z.object({
        keyId: z.string().min(1, "Key ID is required"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Find the existing key
      const [existing] = await ctx.db
        .select({ id: apiKeys.id, name: apiKeys.name })
        .from(apiKeys)
        .where(
          and(
            eq(apiKeys.id, input.keyId),
            eq(apiKeys.orgId, ctx.orgId),
            isNull(apiKeys.revokedAt)
          )
        )
        .limit(1);

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "API key not found or already revoked",
        });
      }

      // Revoke old key and create new one
      const rawKey = `${KEY_PREFIX}${randomBytes(32).toString("hex")}`;
      const newKeyHash = hashKey(rawKey);
      const newId = generateId("key");

      await ctx.db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(eq(apiKeys.id, input.keyId));

      await ctx.db.insert(apiKeys).values({
        id: newId,
        orgId: ctx.orgId,
        userId: ctx.auth.userId,
        keyHash: newKeyHash,
        name: existing.name,
      });

      logger.info(
        { orgId: ctx.orgId, oldKeyId: input.keyId, newKeyId: newId },
        "API key rotated"
      );

      return {
        id: newId,
        key: rawKey,
        name: existing.name,
        revokedKeyId: input.keyId,
        message:
          "Key rotated. Store the new key securely. It will not be shown again.",
      };
    }),
});
