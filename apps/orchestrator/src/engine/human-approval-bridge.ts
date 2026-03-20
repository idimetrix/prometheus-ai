/**
 * HumanApprovalBridge — Bridges the AI SDK 6 streaming path with
 * human-in-the-loop approval for destructive or high-risk tool calls.
 *
 * Maintains a map of pending approvals (toolCallId -> Promise resolver)
 * so the WebSocket handler can resolve them asynchronously. Integrates
 * with the existing ToolApprovalGate for tier classification and
 * HumanApprovalBridge (Redis) for cross-process communication.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:human-approval-bridge");

/** Regex patterns that flag a tool call as destructive */
const DESTRUCTIVE_PATTERNS = [
  /\brm\s+(-rf?|--recursive)\b/,
  /\brm\s+-[a-zA-Z]*f[a-zA-Z]*\b/,
  /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i,
  /\bTRUNCATE\s+TABLE\b/i,
  /\bgit\s+push\s+--force\b/,
  /\bgit\s+push\s+-f\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-[a-zA-Z]*f/,
  /\bDELETE\s+FROM\s+\S+\s*(;|\s*$)/i,
  /\bformat\s+[cC]:/,
  /\bsudo\s+rm\b/,
  /\bchmod\s+777\b/,
  /\bchown\s+-R\s+/,
  /\bdocker\s+system\s+prune\b/,
  /\bkubectl\s+delete\b/,
];

/** Tools that always require manual approval regardless of arguments */
const ALWAYS_MANUAL_TOOLS = new Set(["spawn_agent", "kill_agent"]);

/**
 * Extract a command string from tool arguments, checking common field names.
 */
function extractCommandArg(args: Record<string, unknown>): string {
  if (typeof args.command === "string") {
    return args.command;
  }
  if (typeof args.cmd === "string") {
    return args.cmd;
  }
  if (typeof args.script === "string") {
    return args.script;
  }
  return "";
}

interface PendingApproval {
  args: Record<string, unknown>;
  createdAt: number;
  reject: (reason: Error) => void;
  resolve: (approved: boolean) => void;
  toolName: string;
}

export interface ApprovalRequest {
  args: Record<string, unknown>;
  reason: string;
  toolCallId: string;
  toolName: string;
}

export interface ApprovalEvent {
  args: Record<string, unknown>;
  reason: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  type: "approval_required";
}

export class HumanApprovalBridge {
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly sessionId: string;
  private readonly timeoutMs: number;

  constructor(sessionId: string, timeoutMs = 300_000) {
    this.sessionId = sessionId;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Check whether a tool call with the given name and arguments
   * matches known destructive patterns.
   */
  isDestructive(toolName: string, args: Record<string, unknown>): boolean {
    // Always-manual tools are considered destructive
    if (ALWAYS_MANUAL_TOOLS.has(toolName)) {
      return true;
    }

    // Check terminal commands for destructive patterns
    if (
      toolName === "terminal_exec" ||
      toolName === "shell_exec" ||
      toolName === "run_command"
    ) {
      const command = extractCommandArg(args);

      return DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(command));
    }

    // Check for destructive SQL in any string argument
    const argsStr = JSON.stringify(args);
    return DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(argsStr));
  }

  /**
   * Request human approval for a tool call. Emits an approval event
   * and returns a Promise that resolves when the WebSocket handler
   * calls `resolveApproval()`.
   *
   * Returns `true` if approved, `false` if rejected or timed out.
   */
  requestApproval(
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>
  ): { event: ApprovalEvent; promise: Promise<boolean> } {
    const reason = this.getDestructiveReason(toolName, args);

    logger.info(
      { toolCallId, toolName, sessionId: this.sessionId, reason },
      "Requesting human approval for tool call"
    );

    const event: ApprovalEvent = {
      type: "approval_required",
      toolCallId,
      toolName,
      args,
      reason,
      sessionId: this.sessionId,
    };

    const promise = new Promise<boolean>((resolve, reject) => {
      const pending: PendingApproval = {
        toolName,
        args,
        resolve,
        reject,
        createdAt: Date.now(),
      };

      this.pendingApprovals.set(toolCallId, pending);

      // Auto-reject after timeout
      setTimeout(() => {
        if (this.pendingApprovals.has(toolCallId)) {
          this.pendingApprovals.delete(toolCallId);
          logger.warn(
            { toolCallId, toolName, timeoutMs: this.timeoutMs },
            "Approval request timed out"
          );
          resolve(false);
        }
      }, this.timeoutMs);
    });

    return { event, promise };
  }

  /**
   * Resolve a pending approval request. Called by the WebSocket handler
   * when the user approves or rejects the tool call.
   *
   * Returns `true` if the toolCallId was found and resolved.
   */
  resolveApproval(toolCallId: string, approved: boolean): boolean {
    const pending = this.pendingApprovals.get(toolCallId);
    if (!pending) {
      logger.warn({ toolCallId }, "No pending approval found for toolCallId");
      return false;
    }

    logger.info(
      {
        toolCallId,
        toolName: pending.toolName,
        approved,
        waitTimeMs: Date.now() - pending.createdAt,
      },
      approved ? "Tool call approved by human" : "Tool call rejected by human"
    );

    pending.resolve(approved);
    this.pendingApprovals.delete(toolCallId);
    return true;
  }

  /**
   * Get the number of pending approval requests.
   */
  get pendingCount(): number {
    return this.pendingApprovals.size;
  }

  /**
   * Get all pending approval request IDs.
   */
  getPendingIds(): string[] {
    return [...this.pendingApprovals.keys()];
  }

  /**
   * Clean up all pending approvals by rejecting them.
   */
  dispose(): void {
    for (const [id, pending] of this.pendingApprovals) {
      pending.resolve(false);
      logger.info({ toolCallId: id }, "Disposed pending approval");
    }
    this.pendingApprovals.clear();
  }

  /**
   * Get a human-readable reason why this tool call is considered destructive.
   */
  private getDestructiveReason(
    toolName: string,
    args: Record<string, unknown>
  ): string {
    if (ALWAYS_MANUAL_TOOLS.has(toolName)) {
      return `Tool '${toolName}' always requires manual approval`;
    }

    const command = extractCommandArg(args);

    if (command) {
      for (const pattern of DESTRUCTIVE_PATTERNS) {
        if (pattern.test(command)) {
          return `Destructive command detected: ${command.slice(0, 100)}`;
        }
      }
    }

    return `Tool '${toolName}' flagged as potentially destructive`;
  }
}

/**
 * Factory function to create a HumanApprovalBridge for the AI SDK 6 path.
 */
export function createApprovalBridge(
  sessionId: string,
  timeoutMs?: number
): HumanApprovalBridge {
  return new HumanApprovalBridge(sessionId, timeoutMs);
}
