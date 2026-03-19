import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      name: "packages/utils",
      root: "packages/utils",
      coverage: {
        thresholds: { lines: 80, branches: 70, functions: 80 },
      },
    },
  },
  {
    test: {
      name: "packages/validators",
      root: "packages/validators",
      coverage: {
        thresholds: { lines: 80, branches: 70, functions: 80 },
      },
    },
  },
  {
    test: {
      name: "packages/billing",
      root: "packages/billing",
      coverage: {
        thresholds: { lines: 80, branches: 70, functions: 80 },
      },
    },
  },
  {
    test: {
      name: "packages/agent-sdk",
      root: "packages/agent-sdk",
      coverage: {
        thresholds: { lines: 80, branches: 70, functions: 80 },
      },
    },
  },
  {
    test: {
      name: "packages/config-stacks",
      root: "packages/config-stacks",
      coverage: {
        thresholds: { lines: 80, branches: 70, functions: 80 },
      },
    },
  },
  {
    test: {
      name: "packages/queue",
      root: "packages/queue",
      coverage: {
        thresholds: { lines: 80, branches: 70, functions: 80 },
      },
    },
  },
  {
    test: {
      name: "packages/auth",
      root: "packages/auth",
      coverage: {
        thresholds: { lines: 80, branches: 70, functions: 80 },
      },
    },
  },
  {
    test: {
      name: "packages/ai",
      root: "packages/ai",
      coverage: {
        thresholds: { lines: 80, branches: 70, functions: 80 },
      },
    },
  },
  {
    test: {
      name: "packages/logger",
      root: "packages/logger",
      coverage: {
        thresholds: { lines: 80, branches: 70, functions: 80 },
      },
    },
  },
  {
    test: {
      name: "packages/types",
      root: "packages/types",
      coverage: {
        thresholds: { lines: 80, branches: 70, functions: 80 },
      },
    },
  },
  {
    test: {
      name: "packages/feature-flags",
      root: "packages/feature-flags",
      coverage: {
        thresholds: { lines: 80, branches: 70, functions: 80 },
      },
    },
  },
  {
    test: {
      name: "packages/test-utils",
      root: "packages/test-utils",
      coverage: {
        thresholds: { lines: 80, branches: 70, functions: 80 },
      },
    },
  },
  {
    test: {
      name: "apps/api",
      root: "apps/api",
      coverage: {
        thresholds: { lines: 80, branches: 70, functions: 80 },
      },
    },
  },
  {
    test: {
      name: "apps/orchestrator",
      root: "apps/orchestrator",
      coverage: {
        thresholds: { lines: 80, branches: 70, functions: 80 },
      },
    },
  },
  {
    test: {
      name: "apps/queue-worker",
      root: "apps/queue-worker",
      coverage: {
        thresholds: { lines: 80, branches: 70, functions: 80 },
      },
    },
  },
  {
    test: {
      name: "apps/model-router",
      root: "apps/model-router",
      coverage: {
        thresholds: { lines: 80, branches: 70, functions: 80 },
      },
    },
  },
  {
    test: {
      name: "apps/project-brain",
      root: "apps/project-brain",
      coverage: {
        thresholds: { lines: 80, branches: 70, functions: 80 },
      },
    },
  },
  {
    test: {
      name: "apps/mcp-gateway",
      root: "apps/mcp-gateway",
      coverage: {
        thresholds: { lines: 80, branches: 70, functions: 80 },
      },
    },
  },
  {
    test: {
      name: "apps/sandbox-manager",
      root: "apps/sandbox-manager",
      coverage: {
        thresholds: { lines: 80, branches: 70, functions: 80 },
      },
    },
  },
]);
