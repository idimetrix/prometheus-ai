import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/utils",
  "packages/validators",
  "packages/billing",
  "packages/agent-sdk",
  "packages/config-stacks",
  "packages/queue",
  "packages/auth",
  "apps/api",
  "apps/orchestrator",
  "apps/queue-worker",
  "apps/model-router",
  "apps/project-brain",
  "apps/mcp-gateway",
  "apps/sandbox-manager",
]);
