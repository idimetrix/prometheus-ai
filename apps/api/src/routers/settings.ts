import { z } from "zod";
import { router, protectedProcedure } from "../trpc";

export const settingsRouter = router({
  getApiKeys: protectedProcedure.query(async ({ ctx }) => {
    // TODO: Query api_keys for org
    return { keys: [] as Array<{ id: string; name: string; lastUsed: string | null; createdAt: string }> };
  }),

  createApiKey: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(100) }))
    .mutation(async ({ input, ctx }) => {
      // TODO: Generate and store API key
      return { id: "", key: "pk_live_xxx", name: input.name };
    }),

  revokeApiKey: protectedProcedure
    .input(z.object({ keyId: z.string() }))
    .mutation(async ({ input }) => {
      // TODO: Revoke API key
      return { success: true };
    }),

  getModelPreferences: protectedProcedure.query(async ({ ctx }) => {
    // TODO: Query model_configs for org
    return {
      defaultModel: null as string | null,
      customKeys: [] as Array<{ provider: string; configured: boolean }>,
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
      // TODO: Store model config (encrypt API key)
      return { success: true };
    }),

  getIntegrations: protectedProcedure.query(async ({ ctx }) => {
    // TODO: Query mcp_connections for org
    return {
      integrations: [] as Array<{
        provider: string;
        status: "connected" | "disconnected" | "error";
        connectedAt: string | null;
      }>,
    };
  }),

  connectIntegration: protectedProcedure
    .input(z.object({
      provider: z.string(),
      credentials: z.record(z.string()),
    }))
    .mutation(async ({ input, ctx }) => {
      // TODO: Store encrypted credentials, verify connection
      return { success: true, status: "connected" as const };
    }),

  disconnectIntegration: protectedProcedure
    .input(z.object({ provider: z.string() }))
    .mutation(async ({ input, ctx }) => {
      // TODO: Remove credentials
      return { success: true };
    }),
});
