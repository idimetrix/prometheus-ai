import { createHash, randomBytes } from "node:crypto";
import { apiKeys, db } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { and, eq, gt, isNull, lt } from "drizzle-orm";

const logger = createLogger("api:api-key-manager");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateApiKeyOptions {
  name: string;
  orgId: string;
  ttlDays: number;
  userId: string;
}

export interface ApiKeyInfo {
  createdAt: Date;
  expiresAt: Date | null;
  id: string;
  inGracePeriod: boolean;
  isExpired: boolean;
  lastUsed: Date | null;
  name: string;
}

export interface ValidateResult {
  keyId?: string;
  orgId?: string;
  reason?: string;
  userId?: string;
  valid: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const KEY_PREFIX = "pk_live_";
const GRACE_PERIOD_HOURS = 24;

// ─── API Key Manager ──────────────────────────────────────────────────────────

function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

function generateRawKey(): string {
  return `${KEY_PREFIX}${randomBytes(32).toString("hex")}`;
}

export class ApiKeyManager {
  /**
   * Create a new API key with expiry.
   * Returns the raw key (only shown once) and the key metadata.
   */
  async create(
    options: CreateApiKeyOptions
  ): Promise<{ rawKey: string; keyId: string }> {
    const rawKey = generateRawKey();
    const keyHash = hashKey(rawKey);
    const keyId = generateId("key");

    const expiresAt =
      options.ttlDays > 0
        ? new Date(Date.now() + options.ttlDays * 24 * 60 * 60 * 1000)
        : null;

    await db.insert(apiKeys).values({
      id: keyId,
      orgId: options.orgId,
      userId: options.userId,
      name: options.name,
      keyHash,
      expiresAt,
    });

    logger.info(
      { keyId, orgId: options.orgId, ttlDays: options.ttlDays },
      "API key created"
    );

    return { rawKey, keyId };
  }

  /**
   * Rotate an API key: creates a new key and revokes the old one.
   * Returns the new raw key.
   */
  async rotate(keyId: string): Promise<{ rawKey: string; newKeyId: string }> {
    const existing = await db.query.apiKeys.findFirst({
      where: and(eq(apiKeys.id, keyId), isNull(apiKeys.revokedAt)),
    });

    if (!existing) {
      throw new Error(`API key "${keyId}" not found or already revoked`);
    }

    // Create replacement key with same config
    const result = await this.create({
      orgId: existing.orgId,
      userId: existing.userId,
      name: `${existing.name} (rotated)`,
      ttlDays: existing.expiresAt
        ? Math.ceil(
            (existing.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
          )
        : 0,
    });

    // Revoke old key
    await this.revoke(keyId);

    logger.info(
      { oldKeyId: keyId, newKeyId: result.keyId, orgId: existing.orgId },
      "API key rotated"
    );

    return { rawKey: result.rawKey, newKeyId: result.keyId };
  }

  /**
   * Revoke an API key immediately.
   */
  async revoke(keyId: string): Promise<void> {
    await db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(apiKeys.id, keyId));

    logger.info({ keyId }, "API key revoked");
  }

  /**
   * Validate a raw API key.
   * Supports a 24-hour grace period after expiry.
   */
  async validate(rawKey: string): Promise<ValidateResult> {
    if (!rawKey.startsWith(KEY_PREFIX)) {
      return { valid: false, reason: "Invalid key format" };
    }

    const keyHash = hashKey(rawKey);
    const key = await db.query.apiKeys.findFirst({
      where: and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)),
    });

    if (!key) {
      return { valid: false, reason: "Key not found or revoked" };
    }

    // Check expiry with grace period
    if (key.expiresAt) {
      const graceDeadline = new Date(
        key.expiresAt.getTime() + GRACE_PERIOD_HOURS * 60 * 60 * 1000
      );
      const now = new Date();

      if (now > graceDeadline) {
        return { valid: false, reason: "Key expired beyond grace period" };
      }

      if (now > key.expiresAt) {
        logger.warn(
          { keyId: key.id, expiresAt: key.expiresAt.toISOString() },
          "API key in grace period, will expire soon"
        );
      }
    }

    // Update last-used (fire-and-forget)
    db.update(apiKeys)
      .set({ lastUsed: new Date() })
      .where(eq(apiKeys.id, key.id))
      .catch(() => {
        /* fire-and-forget */
      });

    return {
      valid: true,
      keyId: key.id,
      orgId: key.orgId,
      userId: key.userId,
    };
  }

  /**
   * List API keys for an organization (without exposing hashes).
   */
  async listForOrg(orgId: string): Promise<ApiKeyInfo[]> {
    const keys = await db.query.apiKeys.findMany({
      where: and(eq(apiKeys.orgId, orgId), isNull(apiKeys.revokedAt)),
    });

    const now = new Date();

    return keys.map((key) => {
      const isExpired = key.expiresAt ? now > key.expiresAt : false;
      const graceDeadline = key.expiresAt
        ? new Date(
            key.expiresAt.getTime() + GRACE_PERIOD_HOURS * 60 * 60 * 1000
          )
        : null;
      const inGracePeriod =
        isExpired && graceDeadline ? now <= graceDeadline : false;

      return {
        id: key.id,
        name: key.name,
        createdAt: key.createdAt,
        expiresAt: key.expiresAt,
        lastUsed: key.lastUsed,
        isExpired,
        inGracePeriod,
      };
    });
  }

  /**
   * Get keys that will expire within the given number of days.
   * Used for sending auto-rotation reminders.
   */
  async getExpiringKeys(withinDays: number): Promise<ApiKeyInfo[]> {
    const futureDate = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000);
    const now = new Date();

    const keys = await db.query.apiKeys.findMany({
      where: and(
        isNull(apiKeys.revokedAt),
        gt(apiKeys.expiresAt, now),
        lt(apiKeys.expiresAt, futureDate)
      ),
    });

    return keys.map((key) => ({
      id: key.id,
      name: key.name,
      createdAt: key.createdAt,
      expiresAt: key.expiresAt,
      lastUsed: key.lastUsed,
      isExpired: false,
      inGracePeriod: false,
    }));
  }
}
