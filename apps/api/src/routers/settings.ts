import { z } from "zod";
import { eq, and, isNull } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { apiKeys, modelConfigs, mcpConnections } from "@prometheus/db";
import { generateId } from "@prometheus/utils";
import { encrypt, decrypt } from "@prometheus/utils";
import { createHash, randomBytes } from "node:crypto";

export const settingsRouter = router({
  getApiKeys: protectedProcedure.query(async ({ ctx }) => {
    const keys = await ctx.db.query.apiKeys.findMany({
      where: and(
        eq(apiKeys.orgId, ctx.orgId),
        isNull(apiKeys.revokedAt),
      ),
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

      return { id, key: rawKey, name: input.name };
    }),

  revokeApiKey: protectedProcedure
    .input(z.object({ keyId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const [updated] = await ctx.db.update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(
          eq(apiKeys.id, input.keyId),
          eq(apiKeys.orgId, ctx.orgId),
        ))
        .returning();
      return { success: !!updated };
    }),

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
    .input(z.object({
      provider: z.string(),
      modelId: z.string().optional(),
      apiKey: z.string().optional(),
      isDefault: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const existing = await ctx.db.query.modelConfigs.findFirst({
        where: and(
          eq(modelConfigs.orgId, ctx.orgId),
          eq(modelConfigs.provider, input.provider),
        ),
      });

      const values = {
        orgId: ctx.orgId,
        provider: input.provider,
        modelId: input.modelId ?? "",
        apiKeyEncrypted: input.apiKey ? encrypt(input.apiKey) : undefined,
        isDefault: input.isDefault ?? false,
      };

      if (existing) {
        await ctx.db.update(modelConfigs)
          .set(values)
          .where(eq(modelConfigs.id, existing.id));
      } else {
        await ctx.db.insert(modelConfigs).values({
          id: generateId("mc"),
          ...values,
        });
      }

      return { success: true };
    }),

  getIntegrations: protectedProcedure.query(async ({ ctx }) => {
    const connections = await ctx.db.query.mcpConnections.findMany({
      where: eq(mcpConnections.orgId, ctx.orgId),
    });

    return {
      integrations: connections.map((c) => ({
        provider: c.provider,
        status: c.status,
        connectedAt: c.connectedAt?.toISOString() ?? null,
      })),
    };
  }),

  connectIntegration: protectedProcedure
    .input(z.object({
      provider: z.string(),
      credentials: z.record(z.string()),
    }))
    .mutation(async ({ input, ctx }) => {
      const encrypted = encrypt(JSON.stringify(input.credentials));
      const id = generateId("mcp");

      const existing = await ctx.db.query.mcpConnections.findFirst({
        where: and(
          eq(mcpConnections.orgId, ctx.orgId),
          eq(mcpConnections.provider, input.provider),
        ),
      });

      if (existing) {
        await ctx.db.update(mcpConnections)
          .set({
            credentialsEncrypted: encrypted,
            status: "connected",
            connectedAt: new Date(),
          })
          .where(eq(mcpConnections.id, existing.id));
      } else {
        await ctx.db.insert(mcpConnections).values({
          id,
          orgId: ctx.orgId,
          provider: input.provider,
          credentialsEncrypted: encrypted,
          status: "connected",
          connectedAt: new Date(),
        });
      }

      return { success: true, status: "connected" as const };
    }),

  disconnectIntegration: protectedProcedure
    .input(z.object({ provider: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.db.update(mcpConnections)
        .set({
          credentialsEncrypted: null,
          status: "disconnected",
        })
        .where(and(
          eq(mcpConnections.orgId, ctx.orgId),
          eq(mcpConnections.provider, input.provider),
        ));
      return { success: true };
    }),
});
