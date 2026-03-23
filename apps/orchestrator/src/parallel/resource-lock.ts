/**
 * ResourceLock — Redis-based file locking for parallel agent execution.
 *
 * Allows concurrent reads but exclusive writes. Uses Redis SET NX with
 * timeout-based deadlock detection.
 */
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("orchestrator:parallel:resource-lock");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LockType = "read" | "write";

export interface LockInfo {
  acquiredAt: number;
  agentId: string;
  filePath: string;
  lockId: string;
  type: LockType;
}

export interface LockResult {
  lockId: string;
  success: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Read lock timeout in milliseconds. */
const READ_LOCK_TIMEOUT_MS = 10_000;

/** Write lock timeout in milliseconds. */
const WRITE_LOCK_TIMEOUT_MS = 30_000;

/** Polling interval when waiting for a lock. */
const LOCK_POLL_INTERVAL_MS = 200;

/** Maximum wait time before giving up on acquiring a lock. */
const MAX_LOCK_WAIT_MS = 60_000;

// ---------------------------------------------------------------------------
// ResourceLock
// ---------------------------------------------------------------------------

export class ResourceLock {
  private readonly agentId: string;
  private readonly prefix: string;

  /** In-memory tracking for local lock state (supplement to Redis). */
  private readonly localLocks = new Map<string, LockInfo>();

  constructor(sessionId: string, agentId: string) {
    this.agentId = agentId;
    this.prefix = `lock:${sessionId}`;
  }

  /**
   * Acquire a read lock on a file. Multiple read locks can coexist,
   * but a write lock blocks all reads.
   */
  async acquireRead(filePath: string): Promise<LockResult> {
    const lockId = generateId("rlock");

    // Check if there's a write lock
    const writeKey = `${this.prefix}:write:${filePath}`;
    const hasWriteLock = await this.redisExists(writeKey);

    if (hasWriteLock) {
      // Wait for write lock to be released
      const acquired = await this.waitForRelease(
        writeKey,
        READ_LOCK_TIMEOUT_MS
      );
      if (!acquired) {
        logger.warn(
          { filePath, agentId: this.agentId },
          "Timeout waiting for write lock release"
        );
        return { success: false, lockId };
      }
    }

    // Add read lock (read locks are tracked as a set)
    const readKey = `${this.prefix}:readers:${filePath}`;
    await this.redisSetAdd(readKey, lockId);
    await this.redisExpire(readKey, Math.ceil(READ_LOCK_TIMEOUT_MS / 1000));

    const lockInfo: LockInfo = {
      lockId,
      filePath,
      type: "read",
      agentId: this.agentId,
      acquiredAt: Date.now(),
    };
    this.localLocks.set(lockId, lockInfo);

    logger.debug(
      { lockId, filePath, agentId: this.agentId },
      "Read lock acquired"
    );

    return { success: true, lockId };
  }

  /**
   * Acquire an exclusive write lock on a file. Blocks if there are
   * existing read or write locks.
   */
  async acquireWrite(filePath: string): Promise<LockResult> {
    const lockId = generateId("wlock");
    const writeKey = `${this.prefix}:write:${filePath}`;
    const readKey = `${this.prefix}:readers:${filePath}`;

    const startTime = Date.now();

    while (Date.now() - startTime < MAX_LOCK_WAIT_MS) {
      // Check for existing write lock
      const hasWriteLock = await this.redisExists(writeKey);
      if (hasWriteLock) {
        await this.sleep(LOCK_POLL_INTERVAL_MS);
        continue;
      }

      // Check for existing read locks
      const readerCount = await this.redisSetSize(readKey);
      if (readerCount > 0) {
        await this.sleep(LOCK_POLL_INTERVAL_MS);
        continue;
      }

      // Try to acquire write lock atomically (SET NX)
      const acquired = await this.redisSetNx(
        writeKey,
        JSON.stringify({
          lockId,
          agentId: this.agentId,
          acquiredAt: Date.now(),
        })
      );

      if (acquired) {
        await this.redisExpire(
          writeKey,
          Math.ceil(WRITE_LOCK_TIMEOUT_MS / 1000)
        );

        const lockInfo: LockInfo = {
          lockId,
          filePath,
          type: "write",
          agentId: this.agentId,
          acquiredAt: Date.now(),
        };
        this.localLocks.set(lockId, lockInfo);

        logger.debug(
          { lockId, filePath, agentId: this.agentId },
          "Write lock acquired"
        );

        return { success: true, lockId };
      }

      // Another agent grabbed it between our check and SET NX
      await this.sleep(LOCK_POLL_INTERVAL_MS);
    }

    // Deadlock detection: timed out
    logger.error(
      {
        filePath,
        agentId: this.agentId,
        waitedMs: Date.now() - startTime,
      },
      "Deadlock detected: timed out waiting for write lock"
    );

    return { success: false, lockId };
  }

  /**
   * Release a lock by its ID.
   */
  async release(lockId: string): Promise<void> {
    const lockInfo = this.localLocks.get(lockId);
    if (!lockInfo) {
      logger.warn({ lockId }, "Attempted to release unknown lock");
      return;
    }

    if (lockInfo.type === "write") {
      const writeKey = `${this.prefix}:write:${lockInfo.filePath}`;
      await this.redisDel(writeKey);
    } else {
      const readKey = `${this.prefix}:readers:${lockInfo.filePath}`;
      await this.redisSetRemove(readKey, lockId);
    }

    this.localLocks.delete(lockId);

    logger.debug(
      {
        lockId,
        filePath: lockInfo.filePath,
        type: lockInfo.type,
        agentId: this.agentId,
        heldMs: Date.now() - lockInfo.acquiredAt,
      },
      "Lock released"
    );
  }

  /**
   * Release all locks held by this agent.
   */
  async releaseAll(): Promise<void> {
    const lockIds = Array.from(this.localLocks.keys());
    for (const lockId of lockIds) {
      await this.release(lockId);
    }
    logger.info(
      { agentId: this.agentId, released: lockIds.length },
      "All locks released"
    );
  }

  /**
   * Get all locks currently held by this agent.
   */
  getHeldLocks(): LockInfo[] {
    return Array.from(this.localLocks.values());
  }

  // ---------------------------------------------------------------------------
  // Redis helpers (lazy import to avoid top-level side effects)
  // ---------------------------------------------------------------------------

  private async redisExists(key: string): Promise<boolean> {
    const { redis } = await import("@prometheus/queue");
    return (await redis.exists(key)) === 1;
  }

  private async redisSetNx(key: string, value: string): Promise<boolean> {
    const { redis } = await import("@prometheus/queue");
    const result = await redis.set(key, value, "NX");
    return result === "OK";
  }

  private async redisExpire(key: string, seconds: number): Promise<void> {
    const { redis } = await import("@prometheus/queue");
    await redis.expire(key, seconds);
  }

  private async redisDel(key: string): Promise<void> {
    const { redis } = await import("@prometheus/queue");
    await redis.del(key);
  }

  private async redisSetAdd(key: string, member: string): Promise<void> {
    const { redis } = await import("@prometheus/queue");
    await redis.sadd(key, member);
  }

  private async redisSetRemove(key: string, member: string): Promise<void> {
    const { redis } = await import("@prometheus/queue");
    await redis.srem(key, member);
  }

  private async redisSetSize(key: string): Promise<number> {
    const { redis } = await import("@prometheus/queue");
    return redis.scard(key);
  }

  private async waitForRelease(
    key: string,
    timeoutMs: number
  ): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const exists = await this.redisExists(key);
      if (!exists) {
        return true;
      }
      await this.sleep(LOCK_POLL_INTERVAL_MS);
    }
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
