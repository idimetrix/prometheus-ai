/**
 * Tool Approval Gate
 *
 * Implements tiered trust for tool execution:
 * - auto: read-only tools are approved immediately
 * - audit: write tools are logged and auto-approved
 * - manual: destructive operations require human approval
 *
 * Uses HumanInputRequestEvent/HumanInputResponseEvent from execution-events
 * to coordinate with the user when manual approval is needed.
 */

import { createLogger } from "@prometheus/logger";
import type {
  HumanInputRequestEvent,
  HumanInputResponseEvent,
} from "./execution-events";

const logger = createLogger("orchestrator:tool-approval");

export type ApprovalTier = "auto" | "audit" | "manual";

export interface ApprovalResult {
  approved: boolean;
  reason: string;
  tier: ApprovalTier;
}

/** Read-only tools that are always auto-approved */
const AUTO_APPROVE_TOOLS = new Set([
  "file_read",
  "search_code",
  "search_files",
  "search_grep",
  "search_ripgrep",
  "search_semantic",
  "git_status",
  "git_log",
  "git_diff",
  "git_show",
  "browser_open",
  "browser_navigate",
  "browser_snapshot",
  "browser_screenshot",
  "list_directory",
  "read_file",
]);

/** Write tools that are logged but auto-approved */
const AUDIT_TOOLS = new Set([
  "file_write",
  "file_edit",
  "file_delete",
  "file_create",
  "git_add",
  "git_commit",
  "git_checkout",
  "git_branch",
]);

/** Tools that always require manual approval regardless of args */
const ALWAYS_MANUAL_TOOLS = new Set(["spawn_agent", "kill_agent"]);

/** Regex patterns that flag a terminal command as destructive */
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

function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(command));
}

function extractCommand(args: Record<string, unknown>): string {
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

export class ToolApprovalGate {
  private readonly pendingApprovals = new Map<
    string,
    {
      resolve: (approved: boolean) => void;
      toolName: string;
      args: Record<string, unknown>;
    }
  >();

  /**
   * Check whether a tool invocation should be approved, audited, or
   * sent for human review.
   */
  checkApproval(
    toolName: string,
    args: Record<string, unknown>
  ): ApprovalResult {
    // Auto-approve read-only tools
    if (AUTO_APPROVE_TOOLS.has(toolName)) {
      return {
        approved: true,
        reason: "Read-only tool auto-approved",
        tier: "auto",
      };
    }

    // Always-manual tools
    if (ALWAYS_MANUAL_TOOLS.has(toolName)) {
      logger.info({ toolName, args }, "Tool requires manual approval");
      return {
        approved: false,
        reason: `Tool '${toolName}' requires explicit human approval`,
        tier: "manual",
      };
    }

    // Terminal execution: check for destructive patterns
    if (
      toolName === "terminal_exec" ||
      toolName === "shell_exec" ||
      toolName === "run_command"
    ) {
      const command = extractCommand(args);

      if (isDestructiveCommand(command)) {
        logger.warn(
          { toolName, command: command.slice(0, 200) },
          "Destructive command detected, requiring approval"
        );
        return {
          approved: false,
          reason: `Destructive command detected: ${command.slice(0, 100)}`,
          tier: "manual",
        };
      }
    }

    // Audit-tier: log and auto-approve writes
    if (AUDIT_TOOLS.has(toolName)) {
      logger.info(
        { toolName, filePath: args.filePath ?? args.path ?? "unknown" },
        "Write tool audited and approved"
      );
      return {
        approved: true,
        reason: "Write tool audited and approved",
        tier: "audit",
      };
    }

    // Unknown tools default to audit tier
    logger.info({ toolName }, "Unknown tool defaulting to audit tier");
    return {
      approved: true,
      reason: "Unknown tool audited and approved",
      tier: "audit",
    };
  }

  /**
   * Generate a HumanInputRequestEvent for tools that need manual approval.
   */
  requestHumanApproval(
    toolName: string,
    args: Record<string, unknown>,
    requestId: string
  ): HumanInputRequestEvent {
    const command = extractCommand(args);
    const argsPreview = command
      ? command.slice(0, 200)
      : JSON.stringify(args).slice(0, 200);

    const event: HumanInputRequestEvent = {
      type: "human_input_request",
      requestId,
      question: `Approve execution of '${toolName}'? Args: ${argsPreview}`,
      context: `The tool '${toolName}' has been classified as requiring manual approval due to its potential for destructive side-effects.`,
      suggestedResponses: ["approve", "reject"],
      sessionId: "",
      agentRole: "",
      sequence: 0,
      timestamp: new Date().toISOString(),
    };

    return event;
  }

  /**
   * Register a pending approval that can be resolved later
   * when the human responds.
   */
  registerPending(
    requestId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.pendingApprovals.set(requestId, { resolve, toolName, args });
    });
  }

  /**
   * Handle a human response to a pending approval request.
   * Returns true if the requestId was found and resolved.
   */
  handleResponse(
    requestId: string,
    response: { action: HumanInputResponseEvent["action"]; message: string }
  ): boolean {
    const pending = this.pendingApprovals.get(requestId);

    if (!pending) {
      logger.warn({ requestId }, "No pending approval found for requestId");
      return false;
    }

    const approved = response.action === "approve";

    logger.info(
      {
        requestId,
        toolName: pending.toolName,
        action: response.action,
        message: response.message,
      },
      approved ? "Tool approved by human" : "Tool rejected by human"
    );

    pending.resolve(approved);
    this.pendingApprovals.delete(requestId);
    return true;
  }

  /** Get the number of pending approval requests */
  get pendingCount(): number {
    return this.pendingApprovals.size;
  }
}
