import { createHash, randomBytes } from "node:crypto";
import { API_KEY_SCOPES, type ApiKeyScope, apiKeys } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { orgAdminProcedure, protectedProcedure, router } from "../trpc";

const logger = createLogger("api:api-keys");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MAX_KEYS_PER_ORG = 25;
const KEY_PREFIX = "pk_live_";
/** Grace period during rotation: old key remains valid for 24 hours */
const ROTATION_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const scopeSchema = z
  .array(z.enum(API_KEY_SCOPES as unknown as [string, ...string[]]))
  .default([]);

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
        scopes: true,
        lastUsed: true,
        expiresAt: true,
        requestCount: true,
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
        scopes: (k.scopes as ApiKeyScope[] | null) ?? [],
        lastUsed: k.lastUsed?.toISOString() ?? null,
        expiresAt: k.expiresAt?.toISOString() ?? null,
        requestCount: k.requestCount,
        createdAt: k.createdAt.toISOString(),
      })),
    };
  }),

  /**
   * Generate a new API key with optional scopes and expiration.
   * The raw key is returned exactly once. Only the SHA-256 hash is stored.
   */
  create: orgAdminProcedure
    .input(
      z.object({
        name: z
          .string()
          .min(1, "Name is required")
          .max(100, "Name must be 100 characters or fewer"),
        scopes: scopeSchema,
        expiresAt: z
          .string()
          .datetime()
          .optional()
          .describe("Optional ISO 8601 expiration date"),
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
        scopes: input.scopes as ApiKeyScope[],
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      });

      logger.info(
        { orgId: ctx.orgId, keyId: id, scopes: input.scopes },
        "API key created"
      );

      return {
        id,
        key: rawKey,
        name: input.name,
        scopes: input.scopes,
        expiresAt: input.expiresAt ?? null,
        message: "Store this key securely. It will not be shown again.",
      };
    }),

  /**
   * Update scopes for an existing API key.
   */
  updateScopes: orgAdminProcedure
    .input(
      z.object({
        keyId: z.string().min(1, "Key ID is required"),
        scopes: scopeSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [updated] = await ctx.db
        .update(apiKeys)
        .set({ scopes: input.scopes as ApiKeyScope[] })
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

      logger.info(
        { orgId: ctx.orgId, keyId: input.keyId, scopes: input.scopes },
        "API key scopes updated"
      );

      return { success: true, scopes: input.scopes };
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
   * Rotate an API key: generate a new key while keeping the old one active
   * for a grace period (24 hours). The old key will be auto-revoked after
   * the grace period expires.
   *
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
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          scopes: apiKeys.scopes,
          expiresAt: apiKeys.expiresAt,
        })
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

      // Schedule old key revocation after grace period (instead of immediate revocation)
      const gracePeriodEnd = new Date(Date.now() + ROTATION_GRACE_PERIOD_MS);

      // Create new key with the same name and scopes
      const rawKey = `${KEY_PREFIX}${randomBytes(32).toString("hex")}`;
      const newKeyHash = hashKey(rawKey);
      const newId = generateId("key");

      // Mark old key for deferred revocation (set revokedAt in the future)
      await ctx.db
        .update(apiKeys)
        .set({ revokedAt: gracePeriodEnd })
        .where(eq(apiKeys.id, input.keyId));

      await ctx.db.insert(apiKeys).values({
        id: newId,
        orgId: ctx.orgId,
        userId: ctx.auth.userId,
        keyHash: newKeyHash,
        name: existing.name,
        scopes: existing.scopes as ApiKeyScope[],
        expiresAt: existing.expiresAt,
      });

      logger.info(
        {
          orgId: ctx.orgId,
          oldKeyId: input.keyId,
          newKeyId: newId,
          gracePeriodEnd: gracePeriodEnd.toISOString(),
        },
        "API key rotated with grace period"
      );

      return {
        id: newId,
        key: rawKey,
        name: existing.name,
        scopes: (existing.scopes as ApiKeyScope[] | null) ?? [],
        revokedKeyId: input.keyId,
        gracePeriodEnd: gracePeriodEnd.toISOString(),
        message:
          "Key rotated. The old key will remain active for 24 hours. Store the new key securely.",
      };
    }),

  /**
   * Get usage analytics for a specific API key.
   */
  usage: protectedProcedure
    .input(
      z.object({
        keyId: z.string().min(1, "Key ID is required"),
      })
    )
    .query(async ({ input, ctx }) => {
      const [key] = await ctx.db
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          lastUsed: apiKeys.lastUsed,
          requestCount: apiKeys.requestCount,
          createdAt: apiKeys.createdAt,
          scopes: apiKeys.scopes,
          expiresAt: apiKeys.expiresAt,
        })
        .from(apiKeys)
        .where(and(eq(apiKeys.id, input.keyId), eq(apiKeys.orgId, ctx.orgId)))
        .limit(1);

      if (!key) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "API key not found",
        });
      }

      return {
        id: key.id,
        name: key.name,
        totalRequests: key.requestCount,
        lastUsed: key.lastUsed?.toISOString() ?? null,
        createdAt: key.createdAt.toISOString(),
        scopes: (key.scopes as ApiKeyScope[] | null) ?? [],
        expiresAt: key.expiresAt?.toISOString() ?? null,
      };
    }),

  /**
   * List all available scopes for documentation / UI purposes.
   */
  availableScopes: protectedProcedure.query(() => {
    return {
      scopes: API_KEY_SCOPES.map((scope) => {
        const [resource, action] = scope.split(":");
        return { scope, resource: resource ?? scope, action: action ?? "read" };
      }),
    };
  }),

  /**
   * Increment the request count for an API key.
   * Called internally by the API key auth middleware.
   */
  incrementUsage: protectedProcedure
    .input(
      z.object({
        keyId: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await ctx.db
        .update(apiKeys)
        .set({
          requestCount: sql`${apiKeys.requestCount} + 1`,
          lastUsed: new Date(),
        })
        .where(eq(apiKeys.id, input.keyId));

      return { success: true };
    }),
});
