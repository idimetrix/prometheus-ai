import { db, mcpConnections } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { decrypt, encrypt, generateId } from "@prometheus/utils";
import { and, eq } from "drizzle-orm";

const logger = createLogger("mcp-gateway:credential-store");

/**
 * Persistent credential store backed by PostgreSQL with AES-256-GCM encryption.
 *
 * Credentials are stored in the `mcp_connections` table and survive service
 * restarts. An in-memory cache avoids DB round-trips on hot paths.
 */
export class CredentialStore {
  private readonly cache = new Map<string, Record<string, string>>();

  private cacheKey(orgId: string, provider: string): string {
    return `${orgId}:${provider}`;
  }

  /**
   * Store encrypted credentials for an org + provider.
   * Merges with any existing credentials.
   */
  async store(
    orgId: string,
    provider: string,
    credentials: Record<string, string>
  ): Promise<void> {
    const existing = await this.retrieve(orgId, provider);
    const merged = { ...existing, ...credentials };
    const encrypted = encrypt(JSON.stringify(merged));

    const key = this.cacheKey(orgId, provider);

    // Upsert: try to find existing row
    const [existingRow] = await db
      .select({ id: mcpConnections.id })
      .from(mcpConnections)
      .where(
        and(
          eq(mcpConnections.orgId, orgId),
          eq(mcpConnections.provider, provider)
        )
      )
      .limit(1);

    if (existingRow) {
      await db
        .update(mcpConnections)
        .set({
          credentialsEncrypted: encrypted,
          status: "connected",
          connectedAt: new Date(),
        })
        .where(eq(mcpConnections.id, existingRow.id));
    } else {
      await db.insert(mcpConnections).values({
        id: generateId("mcp"),
        orgId,
        provider,
        credentialsEncrypted: encrypted,
        status: "connected",
        connectedAt: new Date(),
      });
    }

    // Update cache
    this.cache.set(key, merged);

    logger.info(
      { orgId, provider, keys: Object.keys(credentials) },
      "Credentials stored"
    );
  }

  /**
   * Retrieve and decrypt credentials for an org + provider.
   * Returns undefined if no credentials are stored.
   */
  async retrieve(
    orgId: string,
    provider: string
  ): Promise<Record<string, string> | undefined> {
    const key = this.cacheKey(orgId, provider);

    // Check cache first
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    // Load from DB
    const [row] = await db
      .select({
        credentialsEncrypted: mcpConnections.credentialsEncrypted,
      })
      .from(mcpConnections)
      .where(
        and(
          eq(mcpConnections.orgId, orgId),
          eq(mcpConnections.provider, provider)
        )
      )
      .limit(1);

    if (!row?.credentialsEncrypted) {
      return undefined;
    }

    try {
      const decrypted = decrypt(row.credentialsEncrypted);
      const credentials = JSON.parse(decrypted) as Record<string, string>;
      this.cache.set(key, credentials);
      return credentials;
    } catch (error) {
      logger.error(
        { orgId, provider, error: String(error) },
        "Failed to decrypt credentials"
      );
      return undefined;
    }
  }

  /**
   * Delete credentials for an org + provider.
   */
  async delete(orgId: string, provider: string): Promise<boolean> {
    const key = this.cacheKey(orgId, provider);
    this.cache.delete(key);

    // Check if row exists before deleting
    const [existing] = await db
      .select({ id: mcpConnections.id })
      .from(mcpConnections)
      .where(
        and(
          eq(mcpConnections.orgId, orgId),
          eq(mcpConnections.provider, provider)
        )
      )
      .limit(1);

    if (!existing) {
      return false;
    }

    await db.delete(mcpConnections).where(eq(mcpConnections.id, existing.id));

    return true;
  }

  /**
   * List all stored credential providers for an org.
   */
  async listForOrg(
    orgId: string
  ): Promise<Array<{ provider: string; status: string }>> {
    const rows = await db
      .select({
        provider: mcpConnections.provider,
        status: mcpConnections.status,
      })
      .from(mcpConnections)
      .where(eq(mcpConnections.orgId, orgId));

    return rows;
  }

  /**
   * Load all credentials from DB into the in-memory cache.
   * Called on service startup to hydrate the cache.
   */
  async loadAll(): Promise<number> {
    const rows = await db
      .select({
        orgId: mcpConnections.orgId,
        provider: mcpConnections.provider,
        credentialsEncrypted: mcpConnections.credentialsEncrypted,
      })
      .from(mcpConnections)
      .where(eq(mcpConnections.status, "connected"));

    let loaded = 0;
    for (const row of rows) {
      if (!row.credentialsEncrypted) {
        continue;
      }

      try {
        const decrypted = decrypt(row.credentialsEncrypted);
        const credentials = JSON.parse(decrypted) as Record<string, string>;
        const key = this.cacheKey(row.orgId, row.provider);
        this.cache.set(key, credentials);
        loaded++;
      } catch (error) {
        logger.error(
          { orgId: row.orgId, provider: row.provider, error: String(error) },
          "Failed to load credentials on startup"
        );
      }
    }

    logger.info({ loaded, total: rows.length }, "Credentials loaded from DB");
    return loaded;
  }
}
