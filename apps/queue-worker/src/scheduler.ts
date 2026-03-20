import { createLogger } from "@prometheus/logger";
import {
  cleanupSandboxQueue,
  reconciliationQueue,
  redis,
  usageRollupQueue,
} from "@prometheus/queue";
import { Queue } from "bullmq";

const logger = createLogger("queue-worker:scheduler");

/** Memory consolidation queue for nightly dedup/decay jobs */
const memoryConsolidationQueue = new Queue("memory-consolidation", {
  connection: redis,
});

/**
 * Registers repeatable (cron-like) jobs on startup using BullMQ's repeat option.
 * These are idempotent — BullMQ deduplicates repeatable jobs by name + pattern.
 */
export async function setupScheduledJobs(): Promise<void> {
  // Usage rollup — every hour
  await usageRollupQueue.add(
    "scheduled:usage-rollup",
    {
      orgId: "__all__",
      periodStart: "",
      periodEnd: "",
      metrics: {
        tasksCompleted: 0,
        creditsUsed: 0,
        costUsd: 0,
        tokensIn: 0,
        tokensOut: 0,
      },
    },
    {
      repeat: { pattern: "0 * * * *" },
      jobId: "scheduled:usage-rollup",
    }
  );

  // Cleanup sandboxes — every 30 minutes
  await cleanupSandboxQueue.add(
    "scheduled:cleanup-sandbox",
    {
      sandboxId: "__stale__",
      sessionId: "",
      projectId: "",
      orgId: "",
      reason: "timeout" as const,
      preserveArtifacts: false,
    },
    {
      repeat: { pattern: "*/30 * * * *" },
      jobId: "scheduled:cleanup-sandbox",
    }
  );

  // Credit reconciliation — daily at 3am UTC
  await reconciliationQueue.add(
    "scheduled:credit-reconciliation",
    {},
    {
      repeat: { pattern: "0 3 * * *" },
      jobId: "scheduled:credit-reconciliation",
    }
  );

  // Stale worktree cleanup — every 6 hours
  await cleanupSandboxQueue.add(
    "scheduled:stale-worktree-cleanup",
    {
      sandboxId: "__worktrees__",
      sessionId: "",
      projectId: "",
      orgId: "",
      reason: "timeout" as const,
      preserveArtifacts: false,
    },
    {
      repeat: { pattern: "0 */6 * * *" },
      jobId: "scheduled:stale-worktree-cleanup",
    }
  );

  // DLQ replay — every 15 minutes
  // Replays eligible dead-letter queue entries back to their original queues
  await cleanupSandboxQueue.add(
    "scheduled:dlq-replay",
    {
      sandboxId: "__dlq-replay__",
      sessionId: "",
      projectId: "",
      orgId: "",
      reason: "timeout" as const,
      preserveArtifacts: false,
    },
    {
      repeat: { pattern: "*/15 * * * *" },
      jobId: "scheduled:dlq-replay",
    }
  );

  // Nightly memory consolidation — 2am UTC
  // Deduplicates/merges similar memories and applies decay
  // (reduces relevance for memories not accessed in 30 days)
  await memoryConsolidationQueue.add(
    "scheduled:memory-consolidation",
    {
      operations: ["deduplicate", "merge_similar", "decay"],
      decayConfig: {
        inactiveDaysThreshold: 30,
        decayFactor: 0.8,
      },
    },
    {
      repeat: { pattern: "0 2 * * *" },
      jobId: "scheduled:memory-consolidation",
    }
  );

  logger.info("Scheduled jobs registered");
}
