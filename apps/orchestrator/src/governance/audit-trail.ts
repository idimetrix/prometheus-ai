/**
 * Audit Trail — Append-only governance event log.
 * Records all governance decisions for compliance and debugging.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:audit-trail");

export interface AuditEvent {
  agentRole: string;
  details: unknown;
  eventType: string;
  id?: string;
  orgId?: string;
  projectId?: string;
  sessionId?: string;
  severity: string;
  timestamp?: string;
}

export class AuditTrail {
  private readonly events: AuditEvent[] = [];
  private readonly sessionId?: string;
  private readonly orgId?: string;
  private readonly projectId?: string;

  constructor(opts?: {
    sessionId?: string;
    orgId?: string;
    projectId?: string;
  }) {
    this.sessionId = opts?.sessionId;
    this.orgId = opts?.orgId;
    this.projectId = opts?.projectId;
  }

  record(
    event: Omit<
      AuditEvent,
      "timestamp" | "id" | "sessionId" | "orgId" | "projectId"
    >
  ): void {
    const fullEvent: AuditEvent = {
      ...event,
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sessionId: this.sessionId,
      orgId: this.orgId,
      projectId: this.projectId,
      timestamp: new Date().toISOString(),
    };

    this.events.push(fullEvent);

    logger.info(
      {
        eventType: event.eventType,
        agentRole: event.agentRole,
        severity: event.severity,
      },
      "Governance event recorded"
    );
  }

  getEvents(filters?: {
    agentRole?: string;
    eventType?: string;
    severity?: string;
    since?: string;
  }): AuditEvent[] {
    let events = [...this.events];

    if (filters?.agentRole) {
      events = events.filter((e) => e.agentRole === filters.agentRole);
    }
    if (filters?.eventType) {
      events = events.filter((e) => e.eventType === filters.eventType);
    }
    if (filters?.severity) {
      events = events.filter((e) => e.severity === filters.severity);
    }
    if (filters?.since) {
      const since = new Date(filters.since).getTime();
      events = events.filter(
        (e) => e.timestamp && new Date(e.timestamp).getTime() >= since
      );
    }

    return events;
  }

  getEventCount(): number {
    return this.events.length;
  }

  /**
   * Export all events for persistence. In production, this would write
   * to the governance_events DB table.
   */
  export(): AuditEvent[] {
    return [...this.events];
  }
}
