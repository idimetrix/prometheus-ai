import { createHash } from "node:crypto";
import type { AgentRole } from "@prometheus/types";
import type { AgentContext } from "../base-agent";
import { AGENT_ROLES } from "../roles";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromptVersion {
  date: string;
  hash: string;
  role: string;
  version: number;
}

// ---------------------------------------------------------------------------
// Version registry — bump version when prompts change materially
// ---------------------------------------------------------------------------

const PROMPT_VERSIONS: Record<string, { date: string; version: number }> = {
  orchestrator: { version: 2, date: "2026-03-20" },
  discovery: { version: 1, date: "2026-01-15" },
  architect: { version: 1, date: "2026-01-15" },
  planner: { version: 1, date: "2026-01-15" },
  frontend_coder: { version: 1, date: "2026-01-15" },
  backend_coder: { version: 1, date: "2026-01-15" },
  integration_coder: { version: 1, date: "2026-01-15" },
  test_engineer: { version: 1, date: "2026-01-15" },
  ci_loop: { version: 1, date: "2026-01-15" },
  security_auditor: { version: 1, date: "2026-01-15" },
  deploy_engineer: { version: 1, date: "2026-01-15" },
  documentation_specialist: { version: 1, date: "2026-01-15" },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildStubContext(role: string): AgentContext {
  return {
    agentRole: role as AgentRole,
    blueprintContent: null,
    orgId: "org_stub",
    projectContext: null,
    projectId: "proj_stub",
    sessionId: "sess_stub",
    userId: "user_stub",
  };
}

function computePromptHash(promptText: string): string {
  return createHash("sha256").update(promptText).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return the current version number for a given agent role.
 */
export function getCurrentVersion(role: string): number {
  const entry = PROMPT_VERSIONS[role];
  if (!entry) {
    throw new Error(
      `Unknown role: ${role}. Available: ${Object.keys(PROMPT_VERSIONS).join(", ")}`
    );
  }
  return entry.version;
}

/**
 * Compute a deterministic hash of the current system prompt for a role.
 * Useful for regression detection — if the hash changes, the prompt changed.
 */
export function getPromptHash(role: string): string {
  const config = AGENT_ROLES[role];
  if (!config) {
    throw new Error(
      `Unknown role: ${role}. Available: ${Object.keys(AGENT_ROLES).join(", ")}`
    );
  }
  const agent = config.create();
  const ctx = buildStubContext(role);
  agent.initialize(ctx);
  const fullPrompt = `${agent.getReasoningProtocol()}\n\n${agent.getSystemPrompt(ctx)}`;
  return computePromptHash(fullPrompt);
}

/**
 * Return full version metadata for every registered role.
 */
export function getAllVersions(): PromptVersion[] {
  return Object.entries(PROMPT_VERSIONS).map(([role, meta]) => ({
    role,
    version: meta.version,
    date: meta.date,
    hash: getPromptHash(role),
  }));
}

/**
 * Return full version metadata for a single role.
 */
export function getVersionInfo(role: string): PromptVersion {
  const version = getCurrentVersion(role);
  const entry = PROMPT_VERSIONS[role];
  if (!entry) {
    throw new Error(`Unknown role: ${role}`);
  }
  return {
    role,
    version,
    date: entry.date,
    hash: getPromptHash(role),
  };
}
