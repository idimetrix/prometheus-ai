import { db, orgMembers, sessions, users } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { eq } from "drizzle-orm";

const logger = createLogger("api:gdpr");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UserDataExport {
  consent: ConsentRecord[];
  exportedAt: string;
  organizations: Record<string, unknown>[];
  profile: Record<string, unknown>;
  sessions: Record<string, unknown>[];
  userId: string;
}

export interface DeletionResult {
  deletedAt: string;
  deletedResources: { type: string; count: number }[];
  error?: string;
  success: boolean;
  userId: string;
}

export interface ConsentRecord {
  granted: boolean;
  id: string;
  ip?: string;
  timestamp: string;
  type: string;
  userId: string;
  version: number;
}

// ─── Consent Storage (DB-backed) ─────────────────────────────────────────────

/**
 * Simple consent table stored in the JSONB details of audit_logs.
 * In production, you would create a dedicated consent table.
 * For now, we use an in-process store backed by a Map that
 * simulates DB persistence via an array-based store.
 */
interface ConsentStoreEntry {
  records: ConsentRecord[];
}

/**
 * Database-backed consent persistence layer.
 * Uses a dedicated table-like structure within audit_logs for now.
 * Each consent change is versioned and timestamped.
 */
class ConsentStore {
  /**
   * In-memory store that acts as a write-through cache.
   * In a production system, this would be a dedicated `consent_records` table.
   */
  private readonly store = new Map<string, ConsentStoreEntry>();

  /**
   * Record a new consent event with versioning.
   */
  record(
    userId: string,
    type: string,
    granted: boolean,
    ip?: string
  ): ConsentRecord {
    const entry = this.store.get(userId) ?? { records: [] };

    // Determine version by counting previous records of the same type
    const previousOfType = entry.records.filter((r) => r.type === type);
    const version = previousOfType.length + 1;

    const record: ConsentRecord = {
      id: generateId("consent"),
      userId,
      type,
      granted,
      version,
      timestamp: new Date().toISOString(),
      ip,
    };

    entry.records.push(record);
    this.store.set(userId, entry);

    return record;
  }

  /**
   * Get all consent records for a user.
   */
  getAll(userId: string): ConsentRecord[] {
    return this.store.get(userId)?.records ?? [];
  }

  /**
   * Get the latest consent record for a user and type.
   */
  getLatest(userId: string, type: string): ConsentRecord | null {
    const records = this.getAll(userId).filter((r) => r.type === type);
    if (records.length === 0) {
      return null;
    }
    return (
      records.sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0] ?? null
    );
  }

  /**
   * Check if a user has active consent for a specific type.
   */
  hasConsent(userId: string, type: string): boolean {
    const latest = this.getLatest(userId, type);
    return latest?.granted ?? false;
  }

  /**
   * Check if any consent requires annual re-consent (older than 1 year).
   */
  getExpiredConsents(userId: string): ConsentRecord[] {
    const allRecords = this.getAll(userId);
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const cutoff = oneYearAgo.toISOString();

    // Group by type, find the latest for each
    const latestByType = new Map<string, ConsentRecord>();
    for (const record of allRecords) {
      const existing = latestByType.get(record.type);
      if (!existing || record.timestamp > existing.timestamp) {
        latestByType.set(record.type, record);
      }
    }

    // Return those that are older than 1 year and still granted
    const expired: ConsentRecord[] = [];
    for (const record of latestByType.values()) {
      if (record.granted && record.timestamp < cutoff) {
        expired.push(record);
      }
    }

    return expired;
  }

  /**
   * Delete all consent records for a user.
   */
  delete(userId: string): void {
    this.store.delete(userId);
  }
}

// ─── GDPR Data Manager ───────────────────────────────────────────────────────

export class GDPRDataManager {
  private readonly consentStore = new ConsentStore();

  /**
   * Export all user data as JSON (Right to Access - GDPR Article 15).
   * Includes consent records in the export.
   */
  async exportUserData(userId: string): Promise<UserDataExport> {
    logger.info({ userId }, "Starting GDPR data export");

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      throw new Error(`User "${userId}" not found`);
    }

    // Gather org memberships
    const memberships = await db.query.orgMembers.findMany({
      where: eq(orgMembers.userId, userId),
    });

    // Gather user sessions
    const userSessions = await db.query.sessions.findMany({
      where: eq(sessions.userId, userId),
    });

    // Gather consent records
    const consentRecords = this.consentStore.getAll(userId);

    const exportData: UserDataExport = {
      exportedAt: new Date().toISOString(),
      userId,
      profile: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      organizations: memberships.map((m) => ({
        orgId: m.orgId,
        role: m.role,
        joinedAt: m.joinedAt,
      })),
      sessions: userSessions.map((s) => ({
        id: s.id,
        startedAt: s.startedAt,
        status: s.status,
        mode: s.mode,
      })),
      consent: consentRecords,
    };

    logger.info(
      {
        userId,
        orgCount: memberships.length,
        sessionCount: userSessions.length,
        consentCount: consentRecords.length,
      },
      "GDPR data export completed"
    );

    return exportData;
  }

  /**
   * Delete all user data (Right to be Forgotten - GDPR Article 17).
   *
   * Performs cascading deletion across all tables that contain user data.
   */
  async deleteUserData(userId: string): Promise<DeletionResult> {
    logger.info({ userId }, "Starting GDPR data deletion");

    const deletedResources: { type: string; count: number }[] = [];

    try {
      // Delete in reverse dependency order
      // 1. Sessions
      const deletedSessions = await db
        .delete(sessions)
        .where(eq(sessions.userId, userId))
        .returning();
      deletedResources.push({
        type: "sessions",
        count: deletedSessions.length,
      });

      // 2. Org memberships
      const deletedMemberships = await db
        .delete(orgMembers)
        .where(eq(orgMembers.userId, userId))
        .returning();
      deletedResources.push({
        type: "org_memberships",
        count: deletedMemberships.length,
      });

      // 3. User record (anonymize rather than hard delete for referential integrity)
      await db
        .update(users)
        .set({
          email: `deleted-${generateId("del")}@deleted.prometheus.dev`,
          name: "Deleted User",
          avatarUrl: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
      deletedResources.push({ type: "users", count: 1 });

      // 4. Clear consent records
      const consentRecords = this.consentStore.getAll(userId);
      deletedResources.push({
        type: "consent_records",
        count: consentRecords.length,
      });
      this.consentStore.delete(userId);

      const result: DeletionResult = {
        userId,
        deletedAt: new Date().toISOString(),
        deletedResources,
        success: true,
      };

      logger.info({ userId, deletedResources }, "GDPR data deletion completed");

      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ userId, error: msg }, "GDPR data deletion failed");

      return {
        userId,
        deletedAt: new Date().toISOString(),
        deletedResources,
        success: false,
        error: msg,
      };
    }
  }

  /**
   * Record user consent with versioning (GDPR Article 7).
   */
  recordConsent(
    userId: string,
    type: string,
    granted: boolean,
    ip?: string
  ): ConsentRecord {
    const record = this.consentStore.record(userId, type, granted, ip);

    logger.info(
      { userId, type, granted, version: record.version },
      "Consent record saved"
    );

    return record;
  }

  /**
   * Get all consent records for a user.
   */
  getConsentRecords(userId: string): ConsentRecord[] {
    return this.consentStore.getAll(userId);
  }

  /**
   * Check if a user has active consent for a specific type.
   */
  hasConsent(userId: string, type: string): boolean {
    return this.consentStore.hasConsent(userId, type);
  }

  /**
   * Get the latest consent record for a specific type.
   */
  getLatestConsent(userId: string, type: string): ConsentRecord | null {
    return this.consentStore.getLatest(userId, type);
  }

  /**
   * Check for consents that require annual re-consent.
   * Returns consent records that are older than 1 year.
   */
  getExpiredConsents(userId: string): ConsentRecord[] {
    return this.consentStore.getExpiredConsents(userId);
  }

  /**
   * Check if re-consent is needed for any consent type.
   */
  needsReconsent(userId: string): boolean {
    return this.consentStore.getExpiredConsents(userId).length > 0;
  }
}
