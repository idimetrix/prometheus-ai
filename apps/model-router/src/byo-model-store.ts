import crypto from "node:crypto";
import { createLogger } from "@prometheus/logger";

const logger = createLogger("model-router:byo-store");

const ENCRYPTION_KEY = process.env.MODEL_KEY_ENCRYPTION_KEY;
if (!ENCRYPTION_KEY && process.env.NODE_ENV === "production") {
  throw new Error(
    "MODEL_KEY_ENCRYPTION_KEY must be set in production to encrypt user API keys"
  );
}
const EFFECTIVE_ENCRYPTION_KEY =
  ENCRYPTION_KEY ?? "prometheus-dev-key-32-chars-long!";
const ALGORITHM = "aes-256-gcm";

interface StoredModelKey {
  authTag: string;
  createdAt: Date;
  encryptedKey: string;
  iv: string;
  lastUsedAt: Date | null;
  orgId: string;
  provider: string;
}

/**
 * BYOModelStore persists user model API keys with AES-256-GCM encryption.
 * In production, keys are stored in the database. This implementation
 * uses an in-memory store with encryption/decryption.
 */
export class BYOModelStore {
  private readonly keys = new Map<string, StoredModelKey>();

  /**
   * Store an encrypted API key for an org+provider.
   */
  store(orgId: string, provider: string, apiKey: string): void {
    const { encrypted, iv, authTag } = this.encrypt(apiKey);

    this.keys.set(`${orgId}:${provider}`, {
      orgId,
      provider,
      encryptedKey: encrypted,
      iv,
      authTag,
      createdAt: new Date(),
      lastUsedAt: null,
    });

    logger.info({ orgId, provider }, "Model API key stored");
  }

  /**
   * Retrieve and decrypt an API key.
   */
  retrieve(orgId: string, provider: string): string | null {
    const stored = this.keys.get(`${orgId}:${provider}`);
    if (!stored) {
      return null;
    }

    stored.lastUsedAt = new Date();

    try {
      return this.decrypt(stored.encryptedKey, stored.iv, stored.authTag);
    } catch (err) {
      logger.error({ orgId, provider, err }, "Failed to decrypt model key");
      return null;
    }
  }

  /**
   * Remove a stored key.
   */
  remove(orgId: string, provider: string): boolean {
    return this.keys.delete(`${orgId}:${provider}`);
  }

  /**
   * List stored providers for an org (without exposing keys).
   */
  listProviders(orgId: string): Array<{
    provider: string;
    createdAt: Date;
    lastUsedAt: Date | null;
  }> {
    return Array.from(this.keys.values())
      .filter((k) => k.orgId === orgId)
      .map((k) => ({
        provider: k.provider,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
      }));
  }

  /**
   * Test a model key by making a lightweight request.
   */
  async testKey(
    provider: string,
    apiKey: string
  ): Promise<{ valid: boolean; error?: string }> {
    const endpoints: Record<string, string> = {
      anthropic: "https://api.anthropic.com/v1/messages",
      openai: "https://api.openai.com/v1/models",
      gemini: "https://generativelanguage.googleapis.com/v1/models",
      groq: "https://api.groq.com/openai/v1/models",
      cerebras: "https://api.cerebras.ai/v1/models",
      mistral: "https://api.mistral.ai/v1/models",
    };

    const endpoint = endpoints[provider];
    if (!endpoint) {
      return { valid: false, error: `Unknown provider: ${provider}` };
    }

    try {
      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "x-api-key": apiKey, // For Anthropic
        },
        signal: AbortSignal.timeout(10_000),
      });

      // 200 or 401/403 means the endpoint is reachable
      if (response.ok) {
        return { valid: true };
      }

      if (response.status === 401 || response.status === 403) {
        return { valid: false, error: "Invalid API key" };
      }

      return { valid: false, error: `Provider returned ${response.status}` };
    } catch (err) {
      return {
        valid: false,
        error: `Connection failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private encrypt(text: string): {
    encrypted: string;
    iv: string;
    authTag: string;
  } {
    const key = crypto.scryptSync(
      EFFECTIVE_ENCRYPTION_KEY,
      "prometheus-salt",
      32
    );
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");

    return { encrypted, iv: iv.toString("hex"), authTag };
  }

  private decrypt(
    encrypted: string,
    ivHex: string,
    authTagHex: string
  ): string {
    const key = crypto.scryptSync(
      EFFECTIVE_ENCRYPTION_KEY,
      "prometheus-salt",
      32
    );
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }
}
