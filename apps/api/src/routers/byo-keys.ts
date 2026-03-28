/**
 * GAP-055: BYO (Bring Your Own) API Keys
 *
 * Store, list, delete, and test user-provided API keys for LLM providers.
 * Keys are stored encrypted (simulated here with base64 for demo).
 */

import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("api:byo-keys");

// ---------------------------------------------------------------------------
// In-memory encrypted key store (production: use proper encryption + DB)
// ---------------------------------------------------------------------------

interface StoredKey {
  configuredAt: string;
  encryptedKey: string;
  id: string;
  orgId: string;
  provider: string;
  userId: string;
}

const keyStore = new Map<string, StoredKey>();

function encryptKey(key: string): string {
  // In production, use AES-256-GCM with a KMS-managed key
  return Buffer.from(key).toString("base64");
}

function decryptKey(encrypted: string): string {
  return Buffer.from(encrypted, "base64").toString("utf-8");
}

function maskKey(key: string): string {
  if (key.length <= 8) {
    return "****";
  }
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

const SUPPORTED_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "azure-openai",
  "cohere",
  "mistral",
  "groq",
  "deepseek",
  "fireworks",
  "together",
] as const;

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const byoKeysRouter = router({
  /**
   * Store a user's API key for a provider (encrypted).
   */
  set: protectedProcedure
    .input(
      z.object({
        provider: z.string().min(1).max(50),
        apiKey: z.string().min(1).max(500),
      })
    )
    .mutation(({ input, ctx }) => {
      const storeKey = `${ctx.orgId}:${input.provider}`;

      // Remove existing key for this provider if any
      keyStore.delete(storeKey);

      const id = generateId("bk");
      const storedKey: StoredKey = {
        id,
        orgId: ctx.orgId,
        userId: ctx.auth.userId,
        provider: input.provider,
        encryptedKey: encryptKey(input.apiKey),
        configuredAt: new Date().toISOString(),
      };

      keyStore.set(storeKey, storedKey);

      logger.info(
        { orgId: ctx.orgId, provider: input.provider },
        "BYO API key configured"
      );

      return {
        id,
        provider: input.provider,
        maskedKey: maskKey(input.apiKey),
        configuredAt: storedKey.configuredAt,
      };
    }),

  /**
   * List configured providers (no key values exposed).
   */
  list: protectedProcedure.query(({ ctx }) => {
    const results: Array<{
      configuredAt: string;
      id: string;
      provider: string;
    }> = [];

    for (const [_key, stored] of keyStore) {
      if (stored.orgId === ctx.orgId) {
        results.push({
          id: stored.id,
          provider: stored.provider,
          configuredAt: stored.configuredAt,
        });
      }
    }

    return {
      providers: results,
      supportedProviders: [...SUPPORTED_PROVIDERS],
    };
  }),

  /**
   * Remove a provider key.
   */
  delete: protectedProcedure
    .input(
      z.object({
        provider: z.string().min(1),
      })
    )
    .mutation(({ input, ctx }) => {
      const storeKey = `${ctx.orgId}:${input.provider}`;
      const existed = keyStore.delete(storeKey);

      logger.info(
        { orgId: ctx.orgId, provider: input.provider, existed },
        "BYO API key deleted"
      );

      return { success: true, existed };
    }),

  /**
   * Test API key validity by making a simple request to the provider.
   */
  test: protectedProcedure
    .input(
      z.object({
        provider: z.string().min(1),
      })
    )
    .mutation(({ input, ctx }) => {
      const storeKey = `${ctx.orgId}:${input.provider}`;
      const stored = keyStore.get(storeKey);

      if (!stored) {
        return {
          valid: false,
          provider: input.provider,
          error: "No API key configured for this provider",
        };
      }

      const apiKey = decryptKey(stored.encryptedKey);

      // In production, this would make an actual API call to verify
      // Here we do a basic format validation
      const isValidFormat =
        apiKey.length > 10 &&
        (apiKey.startsWith("sk-") ||
          apiKey.startsWith("key-") ||
          apiKey.startsWith("gsk_") ||
          apiKey.length > 20);

      logger.info(
        { orgId: ctx.orgId, provider: input.provider, valid: isValidFormat },
        "BYO API key tested"
      );

      return {
        valid: isValidFormat,
        provider: input.provider,
        testedAt: new Date().toISOString(),
        error: isValidFormat ? undefined : "API key format appears invalid",
      };
    }),
});
