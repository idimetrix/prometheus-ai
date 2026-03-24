import { createHash, randomBytes } from "node:crypto";
import {
  apiKeys,
  modelConfigs,
  organizations,
  orgMembers,
  userSettings,
  users,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { encrypt, generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("api:settings");

export const settingsRouter = router({
  // ---------------------------------------------------------------------------
  // Org settings CRUD
  // ---------------------------------------------------------------------------
  getOrgSettings: protectedProcedure.query(async ({ ctx }) => {
    const org = await ctx.db.query.organizations.findFirst({
      where: eq(organizations.id, ctx.orgId),
    });

    if (!org) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Organization not found",
      });
    }

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      planTier: org.planTier,
      hasStripeCustomer: !!org.stripeCustomerId,
      createdAt: org.createdAt.toISOString(),
    };
  }),

  updateOrgSettings: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100).optional(),
        slug: z
          .string()
          .min(3)
          .max(50)
          .regex(
            /^[a-z0-9-]+$/,
            "Slug must be lowercase alphanumeric with hyphens"
          )
          .optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Verify user is admin or owner
      const membership = await ctx.db.query.orgMembers.findFirst({
        where: and(
          eq(orgMembers.orgId, ctx.orgId),
          eq(orgMembers.userId, ctx.auth.userId)
        ),
      });

      if (!membership || membership.role === "member") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admin or owner role required",
        });
      }

      // Check slug uniqueness if changing
      if (input.slug) {
        const existing = await ctx.db.query.organizations.findFirst({
          where: eq(organizations.slug, input.slug),
        });
        if (existing && existing.id !== ctx.orgId) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Slug already taken",
          });
        }
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name) {
        updateData.name = input.name;
      }
      if (input.slug) {
        updateData.slug = input.slug;
      }

      const [updated] = await ctx.db
        .update(organizations)
        .set(updateData)
        .where(eq(organizations.id, ctx.orgId))
        .returning();

      logger.info(
        { orgId: ctx.orgId, fields: Object.keys(input) },
        "Org settings updated"
      );

      return {
        id: updated?.id,
        name: updated?.name,
        slug: updated?.slug,
      };
    }),

  // ---------------------------------------------------------------------------
  // User settings CRUD
  // ---------------------------------------------------------------------------
  getUserSettings: protectedProcedure.query(async ({ ctx }) => {
    const settings = await ctx.db.query.userSettings.findFirst({
      where: eq(userSettings.userId, ctx.auth.userId),
    });

    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, ctx.auth.userId),
      columns: { email: true, name: true, avatarUrl: true },
    });

    return {
      theme: settings?.theme ?? "system",
      defaultModel: settings?.defaultModel ?? null,
      notificationsEnabled: settings?.notificationsEnabled ?? true,
      email: user?.email ?? null,
      name: user?.name ?? null,
      avatarUrl: user?.avatarUrl ?? null,
    };
  }),

  updateUserSettings: protectedProcedure
    .input(
      z.object({
        theme: z.enum(["light", "dark", "system"]).optional(),
        defaultModel: z.string().nullable().optional(),
        notificationsEnabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const existing = await ctx.db.query.userSettings.findFirst({
        where: eq(userSettings.userId, ctx.auth.userId),
      });

      const values: Record<string, unknown> = {};
      if (input.theme !== undefined) {
        values.theme = input.theme;
      }
      if (input.defaultModel !== undefined) {
        values.defaultModel = input.defaultModel;
      }
      if (input.notificationsEnabled !== undefined) {
        values.notificationsEnabled = input.notificationsEnabled;
      }

      if (existing) {
        await ctx.db
          .update(userSettings)
          .set(values)
          .where(eq(userSettings.userId, ctx.auth.userId));
      } else {
        await ctx.db.insert(userSettings).values({
          userId: ctx.auth.userId,
          theme: input.theme ?? "system",
          defaultModel: input.defaultModel ?? null,
          notificationsEnabled: input.notificationsEnabled ?? true,
        });
      }

      logger.info({ userId: ctx.auth.userId }, "User settings updated");
      return { success: true };
    }),

  // ---------------------------------------------------------------------------
  // API Keys
  // ---------------------------------------------------------------------------
  getApiKeys: protectedProcedure.query(async ({ ctx }) => {
    const keys = await ctx.db.query.apiKeys.findMany({
      where: and(eq(apiKeys.orgId, ctx.orgId), isNull(apiKeys.revokedAt)),
      columns: { id: true, name: true, lastUsed: true, createdAt: true },
    });

    return {
      keys: keys.map((k) => ({
        id: k.id,
        name: k.name,
        lastUsed: k.lastUsed?.toISOString() ?? null,
        createdAt: k.createdAt.toISOString(),
      })),
    };
  }),

  createApiKey: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(100) }))
    .mutation(async ({ input, ctx }) => {
      const rawKey = `pk_live_${randomBytes(32).toString("hex")}`;
      const keyHash = createHash("sha256").update(rawKey).digest("hex");
      const id = generateId("key");

      await ctx.db.insert(apiKeys).values({
        id,
        orgId: ctx.orgId,
        userId: ctx.auth.userId,
        keyHash,
        name: input.name,
      });

      logger.info({ orgId: ctx.orgId, keyId: id }, "API key created");
      return { id, key: rawKey, name: input.name };
    }),

  revokeApiKey: protectedProcedure
    .input(z.object({ keyId: z.string().min(1, "Key ID is required") }))
    .mutation(async ({ input, ctx }) => {
      const [updated] = await ctx.db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.id, input.keyId), eq(apiKeys.orgId, ctx.orgId)))
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "API key not found",
        });
      }

      logger.info({ orgId: ctx.orgId, keyId: input.keyId }, "API key revoked");
      return { success: true };
    }),

  // ---------------------------------------------------------------------------
  // Model configs (add/remove/prioritize providers, BYO API keys)
  // ---------------------------------------------------------------------------
  getModelConfigs: protectedProcedure.query(async ({ ctx }) => {
    const configs = await ctx.db.query.modelConfigs.findMany({
      where: eq(modelConfigs.orgId, ctx.orgId),
    });

    const defaultConfig = configs.find((c) => c.isDefault);

    return {
      defaultModel: defaultConfig?.modelId ?? null,
      configs: configs.map((c) => ({
        id: c.id,
        provider: c.provider,
        modelId: c.modelId,
        isDefault: c.isDefault,
        priority: c.priority,
        hasApiKey: !!c.apiKeyEncrypted,
      })),
    };
  }),

  upsertModelConfig: protectedProcedure
    .input(
      z.object({
        provider: z.string().min(1, "Provider is required").max(100),
        modelId: z.string().min(1, "Model ID is required").max(200),
        apiKey: z.string().max(500).optional(),
        isDefault: z.boolean().optional(),
        priority: z.number().int().min(0).max(100).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const existing = await ctx.db.query.modelConfigs.findFirst({
        where: and(
          eq(modelConfigs.orgId, ctx.orgId),
          eq(modelConfigs.provider, input.provider)
        ),
      });

      // If setting as default, unset all other defaults
      if (input.isDefault) {
        await ctx.db
          .update(modelConfigs)
          .set({ isDefault: false })
          .where(eq(modelConfigs.orgId, ctx.orgId));
      }

      const apiKeyEncrypted = input.apiKey ? encrypt(input.apiKey) : undefined;

      if (existing) {
        await ctx.db
          .update(modelConfigs)
          .set({
            modelId: input.modelId,
            isDefault: input.isDefault ?? false,
            ...(apiKeyEncrypted ? { apiKeyEncrypted } : {}),
            ...(input.priority === undefined
              ? {}
              : { priority: input.priority }),
          })
          .where(eq(modelConfigs.id, existing.id));
        return { id: existing.id, action: "updated" as const };
      }
      const id = generateId("mc");
      await ctx.db.insert(modelConfigs).values({
        id,
        orgId: ctx.orgId,
        provider: input.provider,
        modelId: input.modelId,
        isDefault: input.isDefault ?? false,
        ...(apiKeyEncrypted ? { apiKeyEncrypted } : {}),
        ...(input.priority === undefined ? {} : { priority: input.priority }),
      });
      return { id, action: "created" as const };
    }),

  removeModelConfig: protectedProcedure
    .input(z.object({ configId: z.string().min(1, "Config ID is required") }))
    .mutation(async ({ input, ctx }) => {
      const config = await ctx.db.query.modelConfigs.findFirst({
        where: and(
          eq(modelConfigs.id, input.configId),
          eq(modelConfigs.orgId, ctx.orgId)
        ),
      });

      if (!config) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Model config not found",
        });
      }

      await ctx.db
        .delete(modelConfigs)
        .where(
          and(
            eq(modelConfigs.id, input.configId),
            eq(modelConfigs.orgId, ctx.orgId)
          )
        );

      logger.info(
        { orgId: ctx.orgId, configId: input.configId },
        "Model config removed"
      );
      return { success: true };
    }),

  setModelPriority: protectedProcedure
    .input(
      z.object({
        configId: z.string().min(1, "Config ID is required"),
        priority: z.number().int().min(0).max(100),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [updated] = await ctx.db
        .update(modelConfigs)
        .set({ priority: input.priority })
        .where(
          and(
            eq(modelConfigs.id, input.configId),
            eq(modelConfigs.orgId, ctx.orgId)
          )
        )
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Model config not found",
        });
      }

      return { success: true };
    }),

  // ---------------------------------------------------------------------------
  // Legacy compatibility endpoints
  // ---------------------------------------------------------------------------
  getModelPreferences: protectedProcedure.query(async ({ ctx }) => {
    const configs = await ctx.db.query.modelConfigs.findMany({
      where: eq(modelConfigs.orgId, ctx.orgId),
    });

    const defaultConfig = configs.find((c) => c.isDefault);

    return {
      defaultModel: defaultConfig?.modelId ?? null,
      customKeys: configs.map((c) => ({
        provider: c.provider,
        configured: !!c.apiKeyEncrypted,
      })),
    };
  }),

  setModelPreference: protectedProcedure
    .input(
      z.object({
        provider: z.string().min(1, "Provider is required").max(100),
        modelId: z.string().max(200).optional(),
        apiKey: z.string().max(500).optional(),
        isDefault: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const existing = await ctx.db.query.modelConfigs.findFirst({
        where: and(
          eq(modelConfigs.orgId, ctx.orgId),
          eq(modelConfigs.provider, input.provider)
        ),
      });

      const apiKeyEncrypted = input.apiKey ? encrypt(input.apiKey) : undefined;

      if (existing) {
        await ctx.db
          .update(modelConfigs)
          .set({
            ...(input.modelId === undefined ? {} : { modelId: input.modelId }),
            isDefault: input.isDefault ?? false,
            ...(apiKeyEncrypted ? { apiKeyEncrypted } : {}),
          })
          .where(eq(modelConfigs.id, existing.id));
      } else {
        await ctx.db.insert(modelConfigs).values({
          id: generateId("mc"),
          orgId: ctx.orgId,
          provider: input.provider,
          modelId: input.modelId ?? "",
          isDefault: input.isDefault ?? false,
          ...(apiKeyEncrypted ? { apiKeyEncrypted } : {}),
        });
      }

      return { success: true };
    }),
});
