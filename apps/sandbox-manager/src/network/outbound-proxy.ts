import { createLogger } from "@prometheus/logger";
import { NetworkAllowlist } from "./allowlist";

const logger = createLogger("sandbox-manager:network:outbound-proxy");

/** Default rate limit: 100 requests per minute per sandbox */
const DEFAULT_RATE_LIMIT_PER_MIN = 100;

/** Rate limit window in milliseconds (1 minute) */
const RATE_LIMIT_WINDOW_MS = 60_000;

/** Maximum request log retention (per sandbox) */
const MAX_LOG_ENTRIES = 1000;

interface ProxyRequestLog {
  destination: string;
  method: string;
  port: number;
  sandboxId: string;
  statusCode: number | null;
  timestamp: Date;
}

interface RateLimitBucket {
  count: number;
  windowStart: number;
}

interface OutboundProxyConfig {
  /** Network allowlist for domain filtering */
  allowlist?: NetworkAllowlist;
  /** Rate limit per sandbox per minute (default: 100) */
  rateLimitPerMin?: number;
}

interface ProxyResult {
  allowed: boolean;
  /** Error message if not allowed */
  error?: string;
  /** Response body (if proxied) */
  responseBody?: string;
  /** HTTP status code from upstream */
  statusCode?: number;
}

/**
 * Outbound proxy for sandbox network access.
 *
 * Routes all outbound API requests from sandboxes through a controlled proxy
 * with logging, rate limiting, and allowlist enforcement.
 *
 * Features:
 * - Per-sandbox rate limiting (configurable, default 100 req/min)
 * - Full request logging with timestamp, sandbox ID, destination
 * - Domain allowlist enforcement
 * - Request/response metadata tracking
 */
export class OutboundProxy {
  private readonly allowlist: NetworkAllowlist;
  private readonly rateLimitPerMin: number;
  private readonly rateLimits = new Map<string, RateLimitBucket>();
  private readonly requestLogs = new Map<string, ProxyRequestLog[]>();

  constructor(config?: OutboundProxyConfig) {
    this.allowlist = config?.allowlist ?? new NetworkAllowlist();
    this.rateLimitPerMin =
      config?.rateLimitPerMin ?? DEFAULT_RATE_LIMIT_PER_MIN;
  }

  /**
   * Proxy an outbound request from a sandbox.
   * Checks allowlist and rate limits before forwarding.
   */
  async proxyRequest(
    sandboxId: string,
    url: string,
    options?: {
      body?: string;
      headers?: Record<string, string>;
      method?: string;
    }
  ): Promise<ProxyResult> {
    const method = options?.method ?? "GET";
    let hostname: string;
    let port: number;

    // Parse the destination URL
    try {
      const parsed = new URL(url);
      hostname = parsed.hostname;
      const defaultPort = parsed.protocol === "https:" ? 443 : 80;
      port = parsed.port ? Number(parsed.port) : defaultPort;
    } catch {
      return { allowed: false, error: `Invalid URL: ${url}` };
    }

    // Check allowlist
    if (!this.allowlist.isAllowed(hostname)) {
      this.logRequest(sandboxId, hostname, port, method, null);
      logger.warn(
        { sandboxId, hostname, method },
        "Outbound request blocked by allowlist"
      );
      return {
        allowed: false,
        error: `Domain ${hostname} is not in the network allowlist`,
      };
    }

    // Check rate limit
    if (!this.checkRateLimit(sandboxId)) {
      this.logRequest(sandboxId, hostname, port, method, null);
      logger.warn(
        { sandboxId, hostname, rateLimit: this.rateLimitPerMin },
        "Outbound request rate limited"
      );
      return {
        allowed: false,
        error: `Rate limit exceeded: ${this.rateLimitPerMin} requests per minute`,
      };
    }

    // Forward the request
    try {
      const response = await fetch(url, {
        method,
        headers: options?.headers,
        body: options?.body,
        signal: AbortSignal.timeout(30_000),
      });

      const responseBody = await response.text();

      this.logRequest(sandboxId, hostname, port, method, response.status);

      logger.debug(
        { sandboxId, hostname, method, statusCode: response.status },
        "Outbound request proxied"
      );

      return {
        allowed: true,
        statusCode: response.status,
        responseBody,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logRequest(sandboxId, hostname, port, method, null);

      logger.error(
        { sandboxId, hostname, method, error: msg },
        "Outbound request failed"
      );

      return {
        allowed: true,
        error: `Proxy request failed: ${msg}`,
      };
    }
  }

  /**
   * Get the request log for a specific sandbox.
   */
  getRequestLog(sandboxId: string): ProxyRequestLog[] {
    return this.requestLogs.get(sandboxId) ?? [];
  }

  /**
   * Get aggregate request stats for a sandbox.
   */
  getRequestStats(sandboxId: string): {
    blocked: number;
    failed: number;
    successful: number;
    total: number;
  } {
    const logs = this.requestLogs.get(sandboxId) ?? [];
    let successful = 0;
    let failed = 0;
    let blocked = 0;

    for (const log of logs) {
      if (log.statusCode === null) {
        blocked++;
      } else if (log.statusCode >= 200 && log.statusCode < 400) {
        successful++;
      } else {
        failed++;
      }
    }

    return {
      total: logs.length,
      successful,
      failed,
      blocked,
    };
  }

  /**
   * Clear request logs for a sandbox (e.g., on sandbox destruction).
   */
  clearLogs(sandboxId: string): void {
    this.requestLogs.delete(sandboxId);
    this.rateLimits.delete(sandboxId);
  }

  /**
   * Get current rate limit status for a sandbox.
   */
  getRateLimitStatus(sandboxId: string): {
    limit: number;
    remaining: number;
    resetsAt: Date;
  } {
    const bucket = this.rateLimits.get(sandboxId);
    const now = Date.now();

    if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
      return {
        limit: this.rateLimitPerMin,
        remaining: this.rateLimitPerMin,
        resetsAt: new Date(now + RATE_LIMIT_WINDOW_MS),
      };
    }

    return {
      limit: this.rateLimitPerMin,
      remaining: Math.max(0, this.rateLimitPerMin - bucket.count),
      resetsAt: new Date(bucket.windowStart + RATE_LIMIT_WINDOW_MS),
    };
  }

  // ─── Private helpers ────────────────────────────────────────────────

  /**
   * Check and consume a rate limit token for a sandbox.
   * Returns true if the request is within limits.
   */
  private checkRateLimit(sandboxId: string): boolean {
    const now = Date.now();
    let bucket = this.rateLimits.get(sandboxId);

    if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
      // New window
      bucket = { count: 0, windowStart: now };
      this.rateLimits.set(sandboxId, bucket);
    }

    if (bucket.count >= this.rateLimitPerMin) {
      return false;
    }

    bucket.count++;
    return true;
  }

  /**
   * Log a proxy request for auditing.
   */
  private logRequest(
    sandboxId: string,
    destination: string,
    port: number,
    method: string,
    statusCode: number | null
  ): void {
    let logs = this.requestLogs.get(sandboxId);
    if (!logs) {
      logs = [];
      this.requestLogs.set(sandboxId, logs);
    }

    logs.push({
      sandboxId,
      destination,
      port,
      method,
      statusCode,
      timestamp: new Date(),
    });

    // Trim to max entries
    if (logs.length > MAX_LOG_ENTRIES) {
      logs.splice(0, logs.length - MAX_LOG_ENTRIES);
    }
  }
}
