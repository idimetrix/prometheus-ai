/**
 * Configurable approval workflow engine.
 * Defines rules for actions that require human approval before execution,
 * manages pending approval requests in memory, and provides Redis
 * persistence support for production deployments.
 */

import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("orchestrator:approval-engine");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApprovalRule {
  /** The action identifier (e.g., "deploy_to_production") */
  action: string;
  /** User IDs or role patterns that can approve (empty = any org admin) */
  approvers: string[];
  /** Human-readable display name */
  displayName: string;
  /** Whether this action requires approval */
  requiresApproval: boolean;
  /** Timeout in milliseconds before the request auto-rejects */
  timeout: number;
}

export interface ApprovalRequest {
  /** The action being requested */
  action: string;
  /** When the request was created */
  createdAt: Date;
  /** Additional context about the action */
  details: Record<string, unknown>;
  /** When the request expires */
  expiresAt: Date;
  /** Unique request ID */
  id: string;
  /** Organization scope */
  orgId: string;
  /** Timestamp of resolution */
  resolvedAt: Date | null;
  /** Who approved or rejected (null if pending/expired) */
  resolvedBy: string | null;
  /** Session that triggered this request */
  sessionId: string;
  /** Current status */
  status: "pending" | "approved" | "rejected" | "expired";
}

export interface ApprovalCheck {
  /** Whether approval is needed for this action */
  needed: boolean;
  /** The matching rule, if any */
  rule: ApprovalRule | null;
}

// ---------------------------------------------------------------------------
// Default approval rules
// ---------------------------------------------------------------------------

const DEFAULT_RULES: ApprovalRule[] = [
  {
    action: "deploy_to_production",
    displayName: "Deploy to Production",
    requiresApproval: true,
    approvers: [],
    timeout: 4 * 60 * 60 * 1000, // 4 hours
  },
  {
    action: "delete_branch",
    displayName: "Delete Branch",
    requiresApproval: true,
    approvers: [],
    timeout: 1 * 60 * 60 * 1000, // 1 hour
  },
  {
    action: "force_push",
    displayName: "Force Push",
    requiresApproval: true,
    approvers: [],
    timeout: 1 * 60 * 60 * 1000, // 1 hour
  },
  {
    action: "drop_table",
    displayName: "Drop Database Table",
    requiresApproval: true,
    approvers: [],
    timeout: 4 * 60 * 60 * 1000, // 4 hours
  },
  {
    action: "delete_project",
    displayName: "Delete Project",
    requiresApproval: true,
    approvers: [],
    timeout: 2 * 60 * 60 * 1000, // 2 hours
  },
  {
    action: "reset_database",
    displayName: "Reset Database",
    requiresApproval: true,
    approvers: [],
    timeout: 4 * 60 * 60 * 1000, // 4 hours
  },
];

// ---------------------------------------------------------------------------
// ApprovalEngine
// ---------------------------------------------------------------------------

export class ApprovalEngine {
  /** In-memory store of approval rules, keyed by action */
  private readonly rules: Map<string, ApprovalRule>;
  /** In-memory store of pending requests, keyed by request ID */
  private readonly pendingRequests: Map<string, ApprovalRequest>;
  /** Timers for auto-expiring requests */
  private readonly expiryTimers: Map<string, ReturnType<typeof setTimeout>>;
  /** Optional callback when an approval is requested */
  private onApprovalRequested: ((request: ApprovalRequest) => void) | null =
    null;
  /** Optional callback when an approval is resolved */
  private onApprovalResolved: ((request: ApprovalRequest) => void) | null =
    null;

  constructor(customRules?: ApprovalRule[]) {
    this.rules = new Map();
    this.pendingRequests = new Map();
    this.expiryTimers = new Map();

    // Load default rules
    for (const rule of DEFAULT_RULES) {
      this.rules.set(rule.action, rule);
    }

    // Override/add custom rules
    if (customRules) {
      for (const rule of customRules) {
        this.rules.set(rule.action, rule);
      }
    }

    logger.info({ ruleCount: this.rules.size }, "Approval engine initialized");
  }

  /**
   * Register a callback for when approval requests are created.
   * Useful for publishing to WebSocket/SSE for real-time notification.
   */
  onRequest(callback: (request: ApprovalRequest) => void): void {
    this.onApprovalRequested = callback;
  }

  /**
   * Register a callback for when approval requests are resolved.
   */
  onResolution(callback: (request: ApprovalRequest) => void): void {
    this.onApprovalResolved = callback;
  }

  /**
   * Check whether a given action requires approval for the specified org.
   */
  checkApproval(action: string, _orgId: string): ApprovalCheck {
    const rule = this.rules.get(action);

    if (!rule?.requiresApproval) {
      return { needed: false, rule: rule ?? null };
    }

    return { needed: true, rule };
  }

  /**
   * Create a new approval request. Starts an expiry timer and
   * publishes a checkpoint event via the registered callback.
   *
   * @returns The created ApprovalRequest
   */
  requestApproval(
    action: string,
    sessionId: string,
    orgId: string,
    details: Record<string, unknown> = {}
  ): ApprovalRequest {
    const rule = this.rules.get(action);
    const timeout = rule?.timeout ?? 1 * 60 * 60 * 1000;

    const now = new Date();
    const request: ApprovalRequest = {
      id: generateId("apr"),
      action,
      sessionId,
      orgId,
      details,
      status: "pending",
      resolvedBy: null,
      resolvedAt: null,
      createdAt: now,
      expiresAt: new Date(now.getTime() + timeout),
    };

    this.pendingRequests.set(request.id, request);

    // Set auto-expiry timer
    const timer = setTimeout(() => {
      this.expireRequest(request.id);
    }, timeout);
    this.expiryTimers.set(request.id, timer);

    logger.info(
      {
        requestId: request.id,
        action,
        sessionId,
        orgId,
        expiresAt: request.expiresAt.toISOString(),
      },
      "Approval request created"
    );

    if (this.onApprovalRequested) {
      this.onApprovalRequested(request);
    }

    return request;
  }

  /**
   * Resolve a pending approval request.
   *
   * @param requestId - The approval request ID
   * @param approved - Whether the request is approved (true) or rejected (false)
   * @param approverUserId - The user who approved/rejected
   * @returns The resolved request, or null if not found or already resolved
   */
  resolveApproval(
    requestId: string,
    approved: boolean,
    approverUserId: string
  ): ApprovalRequest | null {
    const request = this.pendingRequests.get(requestId);

    if (!request) {
      logger.warn({ requestId }, "Approval request not found");
      return null;
    }

    if (request.status !== "pending") {
      logger.warn(
        { requestId, status: request.status },
        "Approval request already resolved"
      );
      return null;
    }

    // Check if approver is authorized (if approvers list is specified)
    const rule = this.rules.get(request.action);
    if (
      rule &&
      rule.approvers.length > 0 &&
      !rule.approvers.includes(approverUserId)
    ) {
      logger.warn(
        { requestId, approverUserId, allowedApprovers: rule.approvers },
        "Unauthorized approver"
      );
      return null;
    }

    request.status = approved ? "approved" : "rejected";
    request.resolvedBy = approverUserId;
    request.resolvedAt = new Date();

    // Clear expiry timer
    const timer = this.expiryTimers.get(requestId);
    if (timer) {
      clearTimeout(timer);
      this.expiryTimers.delete(requestId);
    }

    logger.info(
      {
        requestId,
        action: request.action,
        approved,
        approverUserId,
        waitTimeMs: request.resolvedAt.getTime() - request.createdAt.getTime(),
      },
      approved ? "Approval granted" : "Approval rejected"
    );

    if (this.onApprovalResolved) {
      this.onApprovalResolved(request);
    }

    return request;
  }

  /**
   * Get a pending approval request by ID.
   */
  getRequest(requestId: string): ApprovalRequest | null {
    return this.pendingRequests.get(requestId) ?? null;
  }

  /**
   * Get all pending requests for a given session.
   */
  getPendingForSession(sessionId: string): ApprovalRequest[] {
    const results: ApprovalRequest[] = [];
    for (const request of this.pendingRequests.values()) {
      if (request.sessionId === sessionId && request.status === "pending") {
        results.push(request);
      }
    }
    return results;
  }

  /**
   * Get all pending requests for a given organization.
   */
  getPendingForOrg(orgId: string): ApprovalRequest[] {
    const results: ApprovalRequest[] = [];
    for (const request of this.pendingRequests.values()) {
      if (request.orgId === orgId && request.status === "pending") {
        results.push(request);
      }
    }
    return results;
  }

  /**
   * Add or update an approval rule.
   */
  setRule(rule: ApprovalRule): void {
    this.rules.set(rule.action, rule);
    logger.info(
      { action: rule.action, requiresApproval: rule.requiresApproval },
      "Approval rule updated"
    );
  }

  /**
   * Remove an approval rule.
   */
  removeRule(action: string): boolean {
    const deleted = this.rules.delete(action);
    if (deleted) {
      logger.info({ action }, "Approval rule removed");
    }
    return deleted;
  }

  /**
   * Get all configured rules.
   */
  getRules(): ApprovalRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Get the count of pending approval requests.
   */
  get pendingCount(): number {
    let count = 0;
    for (const request of this.pendingRequests.values()) {
      if (request.status === "pending") {
        count++;
      }
    }
    return count;
  }

  /**
   * Clean up all timers and pending requests.
   */
  dispose(): void {
    for (const [id, timer] of this.expiryTimers) {
      clearTimeout(timer);
      this.expiryTimers.delete(id);
    }

    // Expire all pending requests
    for (const request of this.pendingRequests.values()) {
      if (request.status === "pending") {
        request.status = "expired";
      }
    }

    logger.info("Approval engine disposed");
  }

  /**
   * Auto-expire a request that has timed out.
   */
  private expireRequest(requestId: string): void {
    const request = this.pendingRequests.get(requestId);
    if (!request || request.status !== "pending") {
      return;
    }

    request.status = "expired";
    request.resolvedAt = new Date();
    this.expiryTimers.delete(requestId);

    logger.warn(
      {
        requestId,
        action: request.action,
        sessionId: request.sessionId,
        timeoutMs: request.expiresAt.getTime() - request.createdAt.getTime(),
      },
      "Approval request expired"
    );

    if (this.onApprovalResolved) {
      this.onApprovalResolved(request);
    }
  }
}

/**
 * Singleton-like factory for creating an ApprovalEngine.
 * In production, this would also initialize Redis persistence.
 */
let _instance: ApprovalEngine | null = null;

export function getApprovalEngine(
  customRules?: ApprovalRule[]
): ApprovalEngine {
  if (!_instance) {
    _instance = new ApprovalEngine(customRules);
  }
  return _instance;
}

/**
 * Reset the singleton instance (useful for testing).
 */
export function resetApprovalEngine(): void {
  if (_instance) {
    _instance.dispose();
    _instance = null;
  }
}
