import { db, orgMembers, sessions, users } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { eq } from "drizzle-orm";

const logger = createLogger("api:gdpr");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UserDataExport {
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
  ip?: string;
  timestamp: string;
  type: string;
  userId: string;
}

// ─── GDPR Data Manager ───────────────────────────────────────────────────────

export class GDPRDataManager {
  private readonly consentStore = new Map<string, ConsentRecord[]>();

  /**
   * Export all user data as JSON (Right to Access - GDPR Article 15).
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
    };

    logger.info(
      {
        userId,
        orgCount: memberships.length,
        sessionCount: userSessions.length,
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

      // Clear consent records
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
   * Record user consent (GDPR Article 7).
   */
  recordConsent(
    userId: string,
    type: string,
    granted: boolean,
    ip?: string
  ): void {
    const record: ConsentRecord = {
      userId,
      type,
      granted,
      timestamp: new Date().toISOString(),
      ip,
    };

    const existing = this.consentStore.get(userId) ?? [];
    existing.push(record);
    this.consentStore.set(userId, existing);

    logger.info({ userId, type, granted }, "Consent record saved");
  }

  /**
   * Get all consent records for a user.
   */
  getConsentRecords(userId: string): ConsentRecord[] {
    return this.consentStore.get(userId) ?? [];
  }

  /**
   * Check if a user has active consent for a specific type.
   */
  hasConsent(userId: string, type: string): boolean {
    const records = this.consentStore.get(userId) ?? [];
    // Find the most recent record for this type
    const latest = records
      .filter((r) => r.type === type)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
    return latest?.granted ?? false;
  }
}
