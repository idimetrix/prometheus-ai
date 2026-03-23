/**
 * Destructive Action Detector
 *
 * Evaluates tool calls to determine if they perform destructive operations
 * that should require human approval before execution.
 */

export interface DestructiveCheckResult {
  isDestructive: boolean;
  reason: string;
  requiresApproval: boolean;
}

interface ToolCallInput {
  args: Record<string, unknown>;
  name: string;
}

/** Patterns that indicate destructive terminal commands */
const DESTRUCTIVE_COMMAND_PATTERNS: Array<{ pattern: RegExp; reason: string }> =
  [
    {
      pattern: /\bgit\s+push\s+(--force|-f)\b/,
      reason: "Force push overwrites remote history",
    },
    {
      pattern: /\bgit\s+reset\s+--hard\b/,
      reason: "Hard reset discards uncommitted changes",
    },
    {
      pattern: /\bgit\s+clean\s+-[a-zA-Z]*f/,
      reason: "Git clean removes untracked files permanently",
    },
    {
      pattern: /\bgit\s+branch\s+-[dD]\b/,
      reason: "Deleting a branch may lose commits",
    },
    {
      pattern: /\brm\s+(-rf?|--recursive)\b/,
      reason: "Recursive file deletion",
    },
    {
      pattern: /\bsudo\s+rm\b/,
      reason: "Privileged file deletion",
    },
    {
      pattern: /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i,
      reason: "Dropping database objects permanently destroys data",
    },
    {
      pattern: /\bTRUNCATE\s+TABLE\b/i,
      reason: "Truncating a table removes all rows",
    },
    {
      pattern: /\bDELETE\s+FROM\s+\S+\s*(;|\s*$)/i,
      reason: "Unqualified DELETE removes all rows from table",
    },
    {
      pattern: /\bchmod\s+777\b/,
      reason: "Setting world-writable permissions is a security risk",
    },
  ];

/** Tool names that are inherently destructive */
const DESTRUCTIVE_TOOL_NAMES: Record<string, string> = {
  deploy_production: "Deploying to production affects live users",
  deploy_to_production: "Deploying to production affects live users",
  delete_branch: "Deleting branches may lose unmerged work",
  delete_repository: "Deleting a repository is permanent",
  force_push: "Force push overwrites remote history",
  drop_table: "Dropping tables permanently destroys data",
  reset_database: "Resetting a database permanently destroys data",
  destroy_infrastructure: "Destroying infrastructure removes live resources",
};

/** Argument patterns that indicate destructive intent */
const DESTRUCTIVE_ARG_PATTERNS: Array<{
  argKey: string;
  pattern: RegExp;
  reason: string;
}> = [
  {
    argKey: "environment",
    pattern: /^prod(uction)?$/i,
    reason: "Operation targets production environment",
  },
  {
    argKey: "target",
    pattern: /^prod(uction)?$/i,
    reason: "Operation targets production environment",
  },
  {
    argKey: "force",
    pattern: /^true$/i,
    reason: "Force flag bypasses safety checks",
  },
  {
    argKey: "branch",
    pattern: /^(main|master|release\/)$/,
    reason: "Operation targets a protected branch",
  },
];

/**
 * Detect whether a tool call represents a destructive action.
 *
 * Checks:
 * 1. Whether the tool name itself is known-destructive
 * 2. Whether terminal_exec commands match destructive patterns
 * 3. Whether arguments indicate destructive intent (e.g. targeting production)
 */
export function detectDestructiveAction(
  toolCall: ToolCallInput
): DestructiveCheckResult {
  const { name, args } = toolCall;

  // Check tool name
  if (name in DESTRUCTIVE_TOOL_NAMES) {
    return {
      isDestructive: true,
      reason: DESTRUCTIVE_TOOL_NAMES[name] ?? "Known destructive tool",
      requiresApproval: true,
    };
  }

  // Check terminal command content
  if (name === "terminal_exec" && typeof args.command === "string") {
    for (const { pattern, reason } of DESTRUCTIVE_COMMAND_PATTERNS) {
      if (pattern.test(args.command)) {
        return {
          isDestructive: true,
          reason,
          requiresApproval: true,
        };
      }
    }
  }

  // Check argument patterns for any tool
  for (const { argKey, pattern, reason } of DESTRUCTIVE_ARG_PATTERNS) {
    const value = args[argKey];
    if (typeof value === "string" && pattern.test(value)) {
      return {
        isDestructive: true,
        reason,
        requiresApproval: true,
      };
    }
  }

  return {
    isDestructive: false,
    reason: "",
    requiresApproval: false,
  };
}
