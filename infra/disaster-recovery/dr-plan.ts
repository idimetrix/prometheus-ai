/**
 * Disaster Recovery Plan — GAP-108
 *
 * Defines backup schedules, recovery procedures, and failover logic
 * for the Prometheus platform.
 */

export interface BackupConfig {
  /** Storage destination (MinIO bucket) */
  destination: string;
  /** Retention period in days */
  retentionDays: number;
  /** Cron schedule for automated backups */
  schedule: string;
  /** Whether to verify backups after creation */
  verify: boolean;
}

export interface RecoveryObjective {
  /** Recovery Point Objective — max acceptable data loss */
  rpo: string;
  /** Recovery Time Objective — max acceptable downtime */
  rto: string;
}

export const BACKUP_CONFIGS: Record<string, BackupConfig> = {
  database: {
    schedule: "0 */6 * * *", // Every 6 hours
    retentionDays: 30,
    destination: "s3://prometheus-backups/database/",
    verify: true,
  },
  redis: {
    schedule: "0 * * * *", // Every hour
    retentionDays: 7,
    destination: "s3://prometheus-backups/redis/",
    verify: false,
  },
  minio: {
    schedule: "0 2 * * *", // Daily at 2 AM
    retentionDays: 90,
    destination: "s3://prometheus-backups/objects/",
    verify: true,
  },
  config: {
    schedule: "0 0 * * *", // Daily at midnight
    retentionDays: 365,
    destination: "s3://prometheus-backups/config/",
    verify: true,
  },
};

export const RECOVERY_OBJECTIVES: Record<string, RecoveryObjective> = {
  database: { rto: "15 minutes", rpo: "6 hours" },
  redis: { rto: "5 minutes", rpo: "1 hour" },
  services: { rto: "10 minutes", rpo: "0 (stateless)" },
  sandboxes: { rto: "30 minutes", rpo: "last checkpoint" },
};

export const FAILOVER_PROCEDURES = {
  database: {
    steps: [
      "1. Detect primary database failure (health check fails 3x)",
      "2. Promote read replica to primary",
      "3. Update DATABASE_URL in all services",
      "4. Restart services with new connection",
      "5. Verify data integrity",
      "6. Set up new replica from promoted primary",
    ],
    automated: true,
    estimatedTime: "5-15 minutes",
  },
  redis: {
    steps: [
      "1. Detect Redis failure",
      "2. Switch to Redis Sentinel failover",
      "3. Services auto-reconnect via Sentinel",
      "4. Verify pub/sub and queue functionality",
    ],
    automated: true,
    estimatedTime: "1-5 minutes",
  },
  services: {
    steps: [
      "1. K8s detects pod failure via liveness probe",
      "2. Pod automatically rescheduled",
      "3. Health check passes",
      "4. Traffic routed to new pod",
    ],
    automated: true,
    estimatedTime: "30 seconds - 2 minutes",
  },
  fullRecovery: {
    steps: [
      "1. Provision new infrastructure (Terraform apply)",
      "2. Restore database from latest backup",
      "3. Restore Redis from latest RDB",
      "4. Restore MinIO objects from backup",
      "5. Deploy all services (K8s apply)",
      "6. Run health checks on all services",
      "7. Verify end-to-end task execution",
      "8. Update DNS to point to new infrastructure",
      "9. Monitor for 1 hour",
    ],
    automated: false,
    estimatedTime: "30-60 minutes",
  },
};

/**
 * Generate backup command for a given component.
 */
export function getBackupCommand(component: string): string {
  switch (component) {
    case "database":
      return "pg_dump $DATABASE_URL | gzip > backup.sql.gz && aws s3 cp backup.sql.gz s3://prometheus-backups/database/$(date +%Y%m%d_%H%M%S).sql.gz";
    case "redis":
      return "redis-cli -u $REDIS_URL BGSAVE && aws s3 cp /var/lib/redis/dump.rdb s3://prometheus-backups/redis/$(date +%Y%m%d_%H%M%S).rdb";
    case "minio":
      return "mc mirror prometheus/ s3://prometheus-backups/objects/$(date +%Y%m%d)/";
    default:
      return `echo "Unknown component: ${component}"`;
  }
}

/**
 * Generate restore command for a given component.
 */
export function getRestoreCommand(
  component: string,
  backupPath: string
): string {
  switch (component) {
    case "database":
      return `aws s3 cp ${backupPath} - | gunzip | psql $DATABASE_URL`;
    case "redis":
      return `aws s3 cp ${backupPath} /var/lib/redis/dump.rdb && redis-cli -u $REDIS_URL DEBUG RELOAD`;
    case "minio":
      return `mc mirror ${backupPath} prometheus/`;
    default:
      return `echo "Unknown component: ${component}"`;
  }
}
