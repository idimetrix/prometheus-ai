/**
 * Default feature flag definitions for the Prometheus platform.
 *
 * Each flag has:
 *  - key: unique identifier used in code via isEnabled("key")
 *  - description: human-readable explanation
 *  - defaultEnabled: whether the flag is on by default
 *  - allowedTiers: if set, only enabled for these plan tiers
 *  - percentage: if set, enables for this % of users (0-100)
 */

import type { FlagDefinition } from "./types";

export const DEFAULT_FLAGS: Record<string, FlagDefinition> = {
  // ── Agent Features ──────────────────────────────────────
  "agent.fleet-mode": {
    key: "agent.fleet-mode",
    description: "Enable multi-agent fleet mode for parallel execution",
    defaultEnabled: true,
    allowedTiers: ["pro", "team", "studio", "enterprise"],
  },
  "agent.auto-fix": {
    key: "agent.auto-fix",
    description: "Allow agents to automatically fix CI failures",
    defaultEnabled: true,
  },
  "agent.browser-tool": {
    key: "agent.browser-tool",
    description: "Enable browser/playwright tool for agents",
    defaultEnabled: false,
    allowedTiers: ["team", "studio", "enterprise"],
  },
  "agent.mcp-tools": {
    key: "agent.mcp-tools",
    description: "Enable MCP (Model Context Protocol) tool integration",
    defaultEnabled: true,
  },

  // ── UI Features ─────────────────────────────────────────
  "ui.transparency-panel": {
    key: "ui.transparency-panel",
    description: "Show detailed agent reasoning and action transparency UI",
    defaultEnabled: true,
  },
  "ui.plan-review": {
    key: "ui.plan-review",
    description: "Show plan review/approval UI before execution",
    defaultEnabled: true,
  },
  "ui.code-search": {
    key: "ui.code-search",
    description: "Enable code search across project files",
    defaultEnabled: true,
  },
  "ui.semantic-search": {
    key: "ui.semantic-search",
    description: "Enable AI-powered semantic code search",
    defaultEnabled: false,
    allowedTiers: ["pro", "team", "studio", "enterprise"],
  },
  "ui.command-palette": {
    key: "ui.command-palette",
    description: "Enable Cmd+K command palette",
    defaultEnabled: true,
  },

  // ── Platform Features ───────────────────────────────────
  "platform.sandbox-isolation": {
    key: "platform.sandbox-isolation",
    description: "Run agent code in isolated sandbox containers",
    defaultEnabled: true,
  },
  "platform.credit-system": {
    key: "platform.credit-system",
    description: "Enable credit-based billing system",
    defaultEnabled: true,
  },
  "platform.webhooks": {
    key: "platform.webhooks",
    description: "Enable webhook notifications for session events",
    defaultEnabled: false,
  },
  "platform.api-keys": {
    key: "platform.api-keys",
    description: "Enable API key authentication for external integrations",
    defaultEnabled: false,
  },

  // ── Experimental ────────────────────────────────────────
  "experimental.streaming-diffs": {
    key: "experimental.streaming-diffs",
    description: "Stream file diffs in real-time during agent execution",
    defaultEnabled: false,
    percentage: 10,
  },
  "experimental.voice-input": {
    key: "experimental.voice-input",
    description: "Allow voice input for task descriptions",
    defaultEnabled: false,
    percentage: 0,
  },
  "experimental.collaborative-sessions": {
    key: "experimental.collaborative-sessions",
    description: "Allow multiple users to view/interact with a session",
    defaultEnabled: false,
    percentage: 0,
  },
};
