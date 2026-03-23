import { createLogger } from "@prometheus/logger";

const logger = createLogger("api:security-monitor");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SecurityEventType =
  | "auth_failure"
  | "brute_force"
  | "privilege_escalation"
  | "unusual_api_pattern"
  | "geo_anomaly"
  | "rate_limit_exceeded"
  | "suspicious_input"
  | "unauthorized_resource_access";

export type AlertSeverity = "low" | "medium" | "high" | "critical";

export interface SecurityEvent {
  details: Record<string, unknown>;
  ipAddress?: string;
  orgId?: string;
  severity: AlertSeverity;
  timestamp: number;
  type: SecurityEventType;
  userId?: string;
}

export interface SecurityAlert {
  count: number;
  events: SecurityEvent[];
  message: string;
  severity: AlertSeverity;
  timestamp: number;
  type: SecurityEventType;
}

export interface AlertDestination {
  name: string;
  send(alert: SecurityAlert): Promise<void>;
}

// ---------------------------------------------------------------------------
// Sliding Window Event Store
// ---------------------------------------------------------------------------

const DEFAULT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_EVENTS_PER_WINDOW = 10_000;

class SlidingWindowStore {
  private readonly events: SecurityEvent[] = [];
  private readonly windowMs: number;

  constructor(windowMs: number = DEFAULT_WINDOW_MS) {
    this.windowMs = windowMs;
  }

  add(event: SecurityEvent): void {
    this.events.push(event);
    this.prune();
  }

  query(
    filter: Partial<
      Pick<SecurityEvent, "type" | "userId" | "ipAddress" | "orgId">
    >
  ): SecurityEvent[] {
    this.prune();
    return this.events.filter((e) => {
      if (filter.type && e.type !== filter.type) {
        return false;
      }
      if (filter.userId && e.userId !== filter.userId) {
        return false;
      }
      if (filter.ipAddress && e.ipAddress !== filter.ipAddress) {
        return false;
      }
      if (filter.orgId && e.orgId !== filter.orgId) {
        return false;
      }
      return true;
    });
  }

  count(
    filter: Partial<Pick<SecurityEvent, "type" | "userId" | "ipAddress">>
  ): number {
    return this.query(filter).length;
  }

  private prune(): void {
    const cutoff = Date.now() - this.windowMs;
    while (
      this.events.length > 0 &&
      (this.events[0]?.timestamp ?? 0) < cutoff
    ) {
      this.events.shift();
    }
    // Cap maximum events to prevent memory issues
    while (this.events.length > MAX_EVENTS_PER_WINDOW) {
      this.events.shift();
    }
  }
}

// ---------------------------------------------------------------------------
// Detection Thresholds
// ---------------------------------------------------------------------------

interface DetectionThreshold {
  severity: AlertSeverity;
  threshold: number;
  type: SecurityEventType;
  windowMs: number;
}

const DEFAULT_THRESHOLDS: DetectionThreshold[] = [
  {
    type: "auth_failure",
    threshold: 5,
    windowMs: 5 * 60 * 1000,
    severity: "high",
  },
  {
    type: "brute_force",
    threshold: 10,
    windowMs: 15 * 60 * 1000,
    severity: "critical",
  },
  {
    type: "privilege_escalation",
    threshold: 1,
    windowMs: 60 * 60 * 1000,
    severity: "critical",
  },
  {
    type: "unusual_api_pattern",
    threshold: 20,
    windowMs: 5 * 60 * 1000,
    severity: "medium",
  },
  {
    type: "geo_anomaly",
    threshold: 1,
    windowMs: 60 * 60 * 1000,
    severity: "high",
  },
  {
    type: "rate_limit_exceeded",
    threshold: 10,
    windowMs: 5 * 60 * 1000,
    severity: "medium",
  },
  {
    type: "suspicious_input",
    threshold: 5,
    windowMs: 10 * 60 * 1000,
    severity: "high",
  },
  {
    type: "unauthorized_resource_access",
    threshold: 3,
    windowMs: 10 * 60 * 1000,
    severity: "high",
  },
];

// ---------------------------------------------------------------------------
// Log Alert Destination
// ---------------------------------------------------------------------------

class LogAlertDestination implements AlertDestination {
  name = "log";

  send(alert: SecurityAlert): Promise<void> {
    const logFn =
      alert.severity === "critical" || alert.severity === "high"
        ? logger.error.bind(logger)
        : logger.warn.bind(logger);

    logFn(
      {
        type: alert.type,
        severity: alert.severity,
        count: alert.count,
        message: alert.message,
      },
      "Security alert triggered"
    );

    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Webhook Alert Destination
// ---------------------------------------------------------------------------

export class WebhookAlertDestination implements AlertDestination {
  name = "webhook";
  private readonly url: string;
  private readonly headers: Record<string, string>;

  constructor(url: string, headers?: Record<string, string>) {
    this.url = url;
    this.headers = headers ?? {};
  }

  async send(alert: SecurityAlert): Promise<void> {
    try {
      await fetch(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.headers,
        },
        body: JSON.stringify({
          type: alert.type,
          severity: alert.severity,
          message: alert.message,
          count: alert.count,
          timestamp: new Date(alert.timestamp).toISOString(),
          events: alert.events.slice(0, 10), // Limit payload size
        }),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { url: this.url, error: msg },
        "Failed to send security alert to webhook"
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Security Monitor
// ---------------------------------------------------------------------------

export interface SecurityMonitorOptions {
  destinations?: AlertDestination[];
  thresholds?: DetectionThreshold[];
  windowMs?: number;
}

export class SecurityMonitor {
  private readonly store: SlidingWindowStore;
  private readonly destinations: AlertDestination[];
  private readonly thresholds: DetectionThreshold[];
  /** Track recently fired alerts to avoid spam */
  private readonly recentAlerts = new Map<string, number>();
  private readonly alertCooldownMs = 5 * 60 * 1000; // 5 min cooldown between same alerts

  constructor(options?: SecurityMonitorOptions) {
    this.store = new SlidingWindowStore(options?.windowMs);
    this.destinations = options?.destinations ?? [new LogAlertDestination()];
    this.thresholds = options?.thresholds ?? DEFAULT_THRESHOLDS;
  }

  /**
   * Record a security event and check detection thresholds.
   */
  async recordEvent(event: Omit<SecurityEvent, "timestamp">): Promise<void> {
    const fullEvent: SecurityEvent = {
      ...event,
      timestamp: Date.now(),
    };

    this.store.add(fullEvent);

    logger.debug(
      {
        type: event.type,
        severity: event.severity,
        userId: event.userId,
        ip: event.ipAddress,
      },
      "Security event recorded"
    );

    // Check all relevant thresholds
    await this.evaluateThresholds(fullEvent);
  }

  /**
   * Detect repeated auth failures from a single IP or user.
   */
  async detectAuthFailures(ipAddress: string, userId?: string): Promise<void> {
    await this.recordEvent({
      type: "auth_failure",
      severity: "medium",
      ipAddress,
      userId,
      details: { ipAddress, userId },
    });
  }

  /**
   * Detect unusual API patterns (e.g., high frequency from single source).
   */
  async detectUnusualPattern(
    ipAddress: string,
    pattern: string,
    details?: Record<string, unknown>
  ): Promise<void> {
    await this.recordEvent({
      type: "unusual_api_pattern",
      severity: "low",
      ipAddress,
      details: { pattern, ...details },
    });
  }

  /**
   * Detect privilege escalation attempts.
   */
  async detectPrivilegeEscalation(
    userId: string,
    orgId: string,
    attemptedAction: string
  ): Promise<void> {
    await this.recordEvent({
      type: "privilege_escalation",
      severity: "critical",
      userId,
      orgId,
      details: { attemptedAction, orgId },
    });
  }

  /**
   * Detect geographic anomalies (e.g., login from unexpected location).
   */
  async detectGeoAnomaly(
    userId: string,
    ipAddress: string,
    location: string,
    previousLocation?: string
  ): Promise<void> {
    await this.recordEvent({
      type: "geo_anomaly",
      severity: "high",
      userId,
      ipAddress,
      details: { location, previousLocation },
    });
  }

  /**
   * Get current security event counts by type.
   */
  getEventCounts(): Record<SecurityEventType, number> {
    const types: SecurityEventType[] = [
      "auth_failure",
      "brute_force",
      "privilege_escalation",
      "unusual_api_pattern",
      "geo_anomaly",
      "rate_limit_exceeded",
      "suspicious_input",
      "unauthorized_resource_access",
    ];

    const counts: Record<string, number> = {};
    for (const type of types) {
      counts[type] = this.store.count({ type });
    }
    return counts as Record<SecurityEventType, number>;
  }

  /**
   * Get recent events for a given filter.
   */
  getRecentEvents(
    filter: Partial<
      Pick<SecurityEvent, "type" | "userId" | "ipAddress" | "orgId">
    >
  ): SecurityEvent[] {
    return this.store.query(filter);
  }

  /**
   * Add an alert destination at runtime.
   */
  addDestination(destination: AlertDestination): void {
    this.destinations.push(destination);
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private async evaluateThresholds(event: SecurityEvent): Promise<void> {
    for (const threshold of this.thresholds) {
      if (threshold.type !== event.type) {
        continue;
      }

      // Build filter based on the event context
      const filter: Partial<
        Pick<SecurityEvent, "type" | "ipAddress" | "userId">
      > = {
        type: event.type,
      };
      if (event.ipAddress) {
        filter.ipAddress = event.ipAddress;
      }
      if (event.userId) {
        filter.userId = event.userId;
      }

      const count = this.store.count(filter);

      if (count >= threshold.threshold) {
        await this.fireAlert({
          type: event.type,
          severity: threshold.severity,
          count,
          message: this.buildAlertMessage(event.type, count, event),
          timestamp: Date.now(),
          events: this.store.query(filter).slice(-10),
        });
      }
    }
  }

  private async fireAlert(alert: SecurityAlert): Promise<void> {
    // Check cooldown to prevent alert spam
    const alertKey = `${alert.type}:${alert.events[0]?.ipAddress ?? ""}:${alert.events[0]?.userId ?? ""}`;
    const lastFired = this.recentAlerts.get(alertKey);
    if (lastFired && Date.now() - lastFired < this.alertCooldownMs) {
      return;
    }

    this.recentAlerts.set(alertKey, Date.now());

    // Clean up old cooldown entries
    const cutoff = Date.now() - this.alertCooldownMs;
    for (const [key, ts] of this.recentAlerts) {
      if (ts < cutoff) {
        this.recentAlerts.delete(key);
      }
    }

    logger.warn(
      {
        type: alert.type,
        severity: alert.severity,
        count: alert.count,
      },
      "Security alert fired"
    );

    // Send to all destinations in parallel
    await Promise.allSettled(this.destinations.map((dest) => dest.send(alert)));
  }

  private buildAlertMessage(
    type: SecurityEventType,
    count: number,
    event: SecurityEvent
  ): string {
    const source = event.ipAddress ?? event.userId ?? "unknown";

    switch (type) {
      case "auth_failure":
        return `${count} authentication failures detected from ${source}`;
      case "brute_force":
        return `Brute force attack detected: ${count} attempts from ${source}`;
      case "privilege_escalation":
        return `Privilege escalation attempt by user ${event.userId ?? "unknown"}: ${event.details.attemptedAction ?? "unknown action"}`;
      case "unusual_api_pattern":
        return `Unusual API pattern detected: ${count} events from ${source}`;
      case "geo_anomaly":
        return `Geographic anomaly for user ${event.userId ?? "unknown"}: ${event.details.location ?? "unknown"} (previous: ${event.details.previousLocation ?? "unknown"})`;
      case "rate_limit_exceeded":
        return `Rate limit exceeded ${count} times from ${source}`;
      case "suspicious_input":
        return `${count} suspicious input attempts from ${source}`;
      case "unauthorized_resource_access":
        return `${count} unauthorized resource access attempts from ${source}`;
      default:
        return `Security event: ${count} occurrences of ${type}`;
    }
  }
}
