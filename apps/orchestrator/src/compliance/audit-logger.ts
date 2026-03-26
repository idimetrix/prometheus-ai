import { getInternalAuthHeaders } from "@prometheus/auth";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("orchestrator:audit-logger");

const API_URL = process.env.API_URL ?? "http://localhost:4000";

// ── Top-level regex patterns for PII detection ─────────────────────────────

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX =
  /(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g;
const SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;
const CREDIT_CARD_REGEX = /\b(?:\d{4}[-\s]?){3}\d{4}\b/g;

// ── Top-level regex patterns for license detection ──────────────────────────

const GPL_HEADER_REGEX =
  /GNU\s+General\s+Public\s+License|under\s+the\s+terms\s+of\s+the\s+GPL/gi;
const LGPL_REGEX =
  /GNU\s+Lesser\s+General\s+Public\s+License|under\s+the\s+terms\s+of\s+the\s+LGPL/gi;
const AGPL_REGEX =
  /GNU\s+Affero\s+General\s+Public\s+License|under\s+the\s+terms\s+of\s+the\s+AGPL/gi;
const COPYLEFT_REGEX =
  /copyleft|viral\s+license|share-alike|ShareAlike|CC-BY-SA/gi;

export type AuditEventType =
  | "agent_action"
  | "tool_execution"
  | "approval"
  | "model_call"
  | "data_access"
  | "security_event";

export type AuditOutcome = "success" | "failure" | "blocked";

export interface AuditEvent {
  action: string;
  agentRole: string;
  confidenceScore?: number;
  // For AI governance (ISO 42001)
  decisionRationale?: string;
  eventType: AuditEventType;
  // For IP provenance
  generatedBy?: string;
  id: string;
  inputTokens?: number;
  metadata: Record<string, unknown>;
  modelUsed?: string;
  orgId: string;
  outcome: AuditOutcome;
  outputTokens?: number;
  resource?: string;
  sessionId: string;
  taskId: string;
  timestamp: string;
  userId: string;
}

export interface ComplianceReport {
  blockedActions: number;
  byEventType: Record<string, number>;
  ipProvenance: Array<{
    filePath: string;
    model: string;
    timestamp: string;
  }>;
  modelUsage: Array<{
    model: string;
    calls: number;
    tokens: number;
    costUsd: number;
  }>;
  orgId: string;
  period: { start: string; end: string };
  securityEvents: number;
  totalEvents: number;
}

interface PIIMatch {
  match: string;
  position: number;
  type: string;
}

interface LicenseIssue {
  indicator: string;
  license: string;
}

const DEFAULT_FLUSH_INTERVAL_MS = 5000;

export class AuditLogger {
  private readonly buffer: AuditEvent[] = [];
  private readonly flushIntervalMs: number;
  private readonly apiUrl: string;
  private flushTimer?: ReturnType<typeof setInterval>;

  constructor(opts?: { flushIntervalMs?: number; apiUrl?: string }) {
    this.flushIntervalMs = opts?.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.apiUrl = opts?.apiUrl ?? API_URL;
  }

  /**
   * Log an audit event. Events are buffered and flushed periodically.
   */
  log(event: Omit<AuditEvent, "id" | "timestamp">): void {
    const auditEvent: AuditEvent = {
      ...event,
      id: generateId("aud"),
      timestamp: new Date().toISOString(),
    };

    this.buffer.push(auditEvent);

    logger.debug(
      {
        id: auditEvent.id,
        eventType: auditEvent.eventType,
        action: auditEvent.action,
        outcome: auditEvent.outcome,
      },
      "Audit event logged"
    );
  }

  /**
   * Flush buffered events to persistent storage via the API.
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }

    const events = this.buffer.splice(0, this.buffer.length);

    try {
      const response = await fetch(`${this.apiUrl}/internal/audit-events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getInternalAuthHeaders(),
        },
        body: JSON.stringify({ events }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(`Audit flush failed: ${response.status}`);
      }

      logger.info({ count: events.length }, "Audit events flushed");
    } catch (err: unknown) {
      // Put events back into the buffer for retry
      this.buffer.unshift(...events);
      logger.warn(
        { err, count: events.length },
        "Failed to flush audit events"
      );
    }
  }

  /**
   * Generate a compliance report for an organization over a date range.
   */
  async generateReport(
    orgId: string,
    startDate: string,
    endDate: string
  ): Promise<ComplianceReport> {
    try {
      const params = new URLSearchParams({
        orgId,
        startDate,
        endDate,
      });

      const response = await fetch(
        `${this.apiUrl}/internal/compliance-report?${params.toString()}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            ...getInternalAuthHeaders(),
          },
          signal: AbortSignal.timeout(30_000),
        }
      );

      if (!response.ok) {
        throw new Error(`Compliance report request failed: ${response.status}`);
      }

      const data = (await response.json()) as ComplianceReport;

      logger.info(
        {
          orgId,
          period: { start: startDate, end: endDate },
          totalEvents: data.totalEvents,
        },
        "Compliance report generated"
      );

      return data;
    } catch (err: unknown) {
      logger.error({ err, orgId }, "Failed to generate compliance report");

      // Return an empty report on failure
      return {
        orgId,
        period: { start: startDate, end: endDate },
        totalEvents: 0,
        byEventType: {},
        blockedActions: 0,
        securityEvents: 0,
        modelUsage: [],
        ipProvenance: [],
      };
    }
  }

  /**
   * Start periodic flushing of buffered events.
   */
  start(): void {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setInterval(() => {
      this.flush().catch((err: unknown) => {
        logger.error({ err }, "Periodic audit flush failed");
      });
    }, this.flushIntervalMs);

    logger.info({ intervalMs: this.flushIntervalMs }, "Audit logger started");
  }

  /**
   * Stop periodic flushing and flush any remaining events.
   */
  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }

    await this.flush();
    logger.info("Audit logger stopped");
  }

  /**
   * Detect personally identifiable information (PII) in content.
   * Checks for email addresses, phone numbers, SSNs, and credit card numbers.
   */
  detectPII(content: string): PIIMatch[] {
    const matches: PIIMatch[] = [];

    const patterns: Array<{ type: string; regex: RegExp }> = [
      { type: "email", regex: EMAIL_REGEX },
      { type: "phone", regex: PHONE_REGEX },
      { type: "ssn", regex: SSN_REGEX },
      { type: "credit_card", regex: CREDIT_CARD_REGEX },
    ];

    for (const pattern of patterns) {
      // Reset lastIndex since these are global regexes
      pattern.regex.lastIndex = 0;

      let result = pattern.regex.exec(content);
      while (result !== null) {
        matches.push({
          type: pattern.type,
          match: result[0],
          position: result.index,
        });
        result = pattern.regex.exec(content);
      }
    }

    if (matches.length > 0) {
      logger.warn(
        {
          piiCount: matches.length,
          types: [...new Set(matches.map((m) => m.type))],
        },
        "PII detected in content"
      );
    }

    return matches;
  }

  /**
   * Detect GPL/copyleft license indicators in generated code.
   */
  detectLicenseIssues(content: string): LicenseIssue[] {
    const issues: LicenseIssue[] = [];

    const patterns: Array<{ license: string; regex: RegExp }> = [
      { license: "GPL", regex: GPL_HEADER_REGEX },
      { license: "LGPL", regex: LGPL_REGEX },
      { license: "AGPL", regex: AGPL_REGEX },
      { license: "Copyleft", regex: COPYLEFT_REGEX },
    ];

    for (const pattern of patterns) {
      // Reset lastIndex since these are global regexes
      pattern.regex.lastIndex = 0;

      let result = pattern.regex.exec(content);
      while (result !== null) {
        issues.push({
          license: pattern.license,
          indicator: result[0],
        });
        result = pattern.regex.exec(content);
      }
    }

    if (issues.length > 0) {
      logger.warn(
        {
          issueCount: issues.length,
          licenses: [...new Set(issues.map((i) => i.license))],
        },
        "License compliance issues detected"
      );
    }

    return issues;
  }
}
