/**
 * Role-Specific Tool Access — Maps each agent role to allowed and denied tools.
 *
 * Key restrictions:
 *  - Discovery agents cannot write files
 *  - Security auditors cannot commit or push
 *  - Planner agents are read-only
 */
import type { AgentRole } from "@prometheus/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RoleToolAccess {
  /** Tool names this role is allowed to use */
  allowed: string[];
  /** Tool names this role is explicitly denied */
  denied: string[];
}

// ---------------------------------------------------------------------------
// Tool categories
// ---------------------------------------------------------------------------

const READ_TOOLS = [
  "file_read",
  "file_list",
  "search_files",
  "search_content",
  "search_semantic",
  "read_blueprint",
  "read_brain",
] as const;

const WRITE_TOOLS = ["file_write", "file_edit", "file_delete"] as const;

const GIT_READ_TOOLS = ["git_status", "git_diff"] as const;

const GIT_WRITE_TOOLS = [
  "git_commit",
  "git_push",
  "git_branch",
  "git_create_pr",
] as const;

const EXEC_TOOLS = ["terminal_exec", "terminal_background"] as const;

const BROWSER_TOOLS = ["browser_open", "browser_screenshot"] as const;

const AGENT_TOOLS = ["spawn_agent", "kill_agent", "ask_user"] as const;

// ---------------------------------------------------------------------------
// Role definitions
// ---------------------------------------------------------------------------

const ROLE_ACCESS: Record<string, { allowed: string[]; denied: string[] }> = {
  orchestrator: {
    allowed: [...READ_TOOLS, ...AGENT_TOOLS],
    denied: [...WRITE_TOOLS, ...GIT_WRITE_TOOLS, ...EXEC_TOOLS],
  },
  discovery: {
    allowed: [...READ_TOOLS, "ask_user"],
    denied: [
      ...WRITE_TOOLS,
      ...GIT_WRITE_TOOLS,
      ...EXEC_TOOLS,
      ...BROWSER_TOOLS,
    ],
  },
  architect: {
    allowed: [...READ_TOOLS, "file_write", "file_edit"],
    denied: [
      ...GIT_WRITE_TOOLS,
      ...EXEC_TOOLS,
      ...BROWSER_TOOLS,
      ...AGENT_TOOLS,
    ],
  },
  planner: {
    allowed: [...READ_TOOLS],
    denied: [
      ...WRITE_TOOLS,
      ...GIT_WRITE_TOOLS,
      ...EXEC_TOOLS,
      ...BROWSER_TOOLS,
    ],
  },
  frontend_coder: {
    allowed: [
      ...READ_TOOLS,
      ...WRITE_TOOLS,
      ...GIT_READ_TOOLS,
      ...EXEC_TOOLS,
      ...BROWSER_TOOLS,
    ],
    denied: [...GIT_WRITE_TOOLS, ...AGENT_TOOLS],
  },
  backend_coder: {
    allowed: [...READ_TOOLS, ...WRITE_TOOLS, ...GIT_READ_TOOLS, ...EXEC_TOOLS],
    denied: [...GIT_WRITE_TOOLS, ...BROWSER_TOOLS, ...AGENT_TOOLS],
  },
  integration_coder: {
    allowed: [...READ_TOOLS, ...WRITE_TOOLS, ...GIT_READ_TOOLS, ...EXEC_TOOLS],
    denied: [...GIT_WRITE_TOOLS, ...BROWSER_TOOLS, ...AGENT_TOOLS],
  },
  test_engineer: {
    allowed: [...READ_TOOLS, "file_write", "file_list", ...EXEC_TOOLS],
    denied: [
      "file_delete",
      ...GIT_WRITE_TOOLS,
      ...BROWSER_TOOLS,
      ...AGENT_TOOLS,
    ],
  },
  ci_loop: {
    allowed: [...READ_TOOLS, ...WRITE_TOOLS, ...EXEC_TOOLS],
    denied: [...GIT_WRITE_TOOLS, ...BROWSER_TOOLS, ...AGENT_TOOLS],
  },
  security_auditor: {
    allowed: [...READ_TOOLS, ...GIT_READ_TOOLS, ...EXEC_TOOLS],
    denied: [
      ...WRITE_TOOLS,
      ...GIT_WRITE_TOOLS,
      ...BROWSER_TOOLS,
      ...AGENT_TOOLS,
    ],
  },
  deploy_engineer: {
    allowed: [...READ_TOOLS, ...WRITE_TOOLS, ...GIT_READ_TOOLS, ...EXEC_TOOLS],
    denied: [...GIT_WRITE_TOOLS, ...BROWSER_TOOLS, ...AGENT_TOOLS],
  },
  documentation_specialist: {
    allowed: [...READ_TOOLS, "file_write", "file_list", ...EXEC_TOOLS],
    denied: [
      "file_delete",
      ...GIT_WRITE_TOOLS,
      ...BROWSER_TOOLS,
      ...AGENT_TOOLS,
    ],
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the tool access configuration for a given agent role.
 */
export function getRoleToolAccess(role: AgentRole | string): RoleToolAccess {
  const access = ROLE_ACCESS[role];

  if (!access) {
    // Default: read-only access for unknown roles
    return {
      allowed: [...READ_TOOLS],
      denied: [
        ...WRITE_TOOLS,
        ...GIT_WRITE_TOOLS,
        ...EXEC_TOOLS,
        ...AGENT_TOOLS,
      ],
    };
  }

  return {
    allowed: [...access.allowed],
    denied: [...access.denied],
  };
}

/**
 * Check whether a specific tool is allowed for a given role.
 */
export function isToolAllowed(
  role: AgentRole | string,
  toolName: string
): boolean {
  const access = getRoleToolAccess(role);
  if (access.denied.includes(toolName)) {
    return false;
  }
  return access.allowed.includes(toolName);
}

/**
 * Filter a list of tool names to only those allowed for a role.
 */
export function filterToolsForRole(
  role: AgentRole | string,
  toolNames: string[]
): string[] {
  const access = getRoleToolAccess(role);
  const deniedSet = new Set(access.denied);
  const allowedSet = new Set(access.allowed);

  return toolNames.filter(
    (name) => !deniedSet.has(name) && allowedSet.has(name)
  );
}
