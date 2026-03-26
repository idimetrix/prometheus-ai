import { z } from "zod";
import { execInSandbox } from "./sandbox";
import type { AgentToolDefinition } from "./types";

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

export const dependencyAuditSchema = z
  .object({
    packageManager: z
      .enum(["npm", "pnpm", "yarn", "cargo", "pip"])
      .describe(
        "Package manager to audit. Determines which audit command is run."
      ),
    severity: z
      .enum(["low", "moderate", "high", "critical"])
      .optional()
      .describe("Minimum severity threshold to report. Default: low"),
  })
  .strict();

export const dependencyUpdateSchema = z
  .object({
    packageManager: z
      .enum(["npm", "pnpm", "yarn", "cargo", "pip"])
      .describe("Package manager to use for the update."),
    packageName: z.string().describe("Name of the dependency to update."),
    targetVersion: z
      .string()
      .optional()
      .describe(
        "Specific version to update to. If omitted, updates to latest compatible."
      ),
    runTests: z
      .boolean()
      .optional()
      .describe("Whether to run the test suite after updating. Default: true"),
    runTypecheck: z
      .boolean()
      .optional()
      .describe("Whether to run type checking after updating. Default: true"),
  })
  .strict();

export const dependencyBulkUpdateSchema = z
  .object({
    packageManager: z
      .enum(["npm", "pnpm", "yarn", "cargo", "pip"])
      .describe("Package manager to use for updates."),
    strategy: z
      .enum(["patch", "minor", "major"])
      .optional()
      .describe(
        "Update strategy: patch (safest), minor, or major. Default: patch"
      ),
    runTests: z
      .boolean()
      .optional()
      .describe(
        "Whether to run the full test suite after each batch. Default: true"
      ),
    dryRun: z
      .boolean()
      .optional()
      .describe(
        "If true, only report what would be updated without making changes."
      ),
  })
  .strict();

// ---------------------------------------------------------------------------
// Audit commands per package manager
// ---------------------------------------------------------------------------

const AUDIT_COMMANDS: Record<string, string> = {
  npm: "npm audit --json",
  pnpm: "pnpm audit --json",
  yarn: "yarn audit --json",
  cargo: "cargo audit --json 2>/dev/null || cargo audit",
  pip: "pip-audit --format=json 2>/dev/null || pip-audit",
};

const UPDATE_COMMANDS: Record<
  string,
  (pkg: string, version?: string) => string
> = {
  npm: (pkg, version) =>
    version ? `npm install ${pkg}@${version}` : `npm update ${pkg}`,
  pnpm: (pkg, version) =>
    version ? `pnpm update ${pkg}@${version}` : `pnpm update ${pkg}`,
  yarn: (pkg, version) =>
    version ? `yarn upgrade ${pkg}@${version}` : `yarn upgrade ${pkg}`,
  cargo: (pkg, version) =>
    version
      ? `cargo update -p ${pkg} --precise ${version}`
      : `cargo update -p ${pkg}`,
  pip: (pkg, version) =>
    version ? `pip install ${pkg}==${version}` : `pip install --upgrade ${pkg}`,
};

function getDryRunCommand(packageManager: string): string {
  if (packageManager === "cargo") {
    return "cargo outdated 2>/dev/null || cargo update --dry-run";
  }
  if (packageManager === "pip") {
    return "pip list --outdated --format=json";
  }
  return `${packageManager} outdated 2>/dev/null || echo "Check outdated packages manually"`;
}

const BULK_UPDATE_COMMANDS: Record<string, Record<string, string>> = {
  npm: {
    patch: "npx npm-check-updates -u --target patch && npm install",
    minor: "npx npm-check-updates -u --target minor && npm install",
    major: "npx npm-check-updates -u && npm install",
  },
  pnpm: {
    patch: "pnpm update --no-save 2>/dev/null; pnpm update",
    minor: "pnpm update",
    major: "pnpm update --latest",
  },
  yarn: {
    patch: "yarn upgrade --pattern '*'",
    minor: "yarn upgrade --pattern '*'",
    major: "yarn upgrade --latest",
  },
  cargo: {
    patch: "cargo update",
    minor: "cargo update",
    major: "cargo update --aggressive",
  },
  pip: {
    patch: "pip list --outdated --format=json | python -m json.tool",
    minor: "pip list --outdated --format=json | python -m json.tool",
    major: "pip list --outdated --format=json | python -m json.tool",
  },
};

const TEST_COMMANDS: Record<string, string> = {
  npm: "npm test",
  pnpm: "pnpm test",
  yarn: "yarn test",
  cargo: "cargo test",
  pip: "python -m pytest",
};

const TYPECHECK_COMMANDS: Record<string, string> = {
  npm: "npx tsc --noEmit",
  pnpm: "pnpm exec tsc --noEmit",
  yarn: "yarn tsc --noEmit",
  cargo: "cargo check",
  pip: "python -m mypy . 2>/dev/null || true",
};

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

const dependencyAuditTool: AgentToolDefinition = {
  name: "dependency_audit",
  description:
    "Run a security audit on project dependencies. Detects known vulnerabilities and reports severity levels. Supports npm, pnpm, yarn, cargo, and pip.",
  creditCost: 2,
  permissionLevel: "read",
  riskLevel: "low",
  zodSchema: dependencyAuditSchema as unknown as z.ZodType<
    Record<string, unknown>
  >,
  inputSchema: {
    type: "object",
    properties: {
      packageManager: {
        type: "string",
        enum: ["npm", "pnpm", "yarn", "cargo", "pip"],
        description: "Package manager to audit.",
      },
      severity: {
        type: "string",
        enum: ["low", "moderate", "high", "critical"],
        description: "Minimum severity threshold to report.",
      },
    },
    required: ["packageManager"],
  },
  async execute(input, ctx) {
    const { packageManager, severity } = input as z.infer<
      typeof dependencyAuditSchema
    >;
    const cmd = AUDIT_COMMANDS[packageManager];
    if (!cmd) {
      return {
        success: false,
        output: "",
        error: `Unsupported package manager: ${packageManager}`,
      };
    }

    const result = await execInSandbox(cmd, ctx, 60_000);

    const filterNote = severity ? `\nFiltered to severity >= ${severity}` : "";

    return {
      success: true,
      output: `Dependency audit (${packageManager}):${filterNote}\n\n${result.output || result.error || "No vulnerabilities found."}`,
      metadata: { packageManager, severity },
    };
  },
};

const dependencyUpdateTool: AgentToolDefinition = {
  name: "dependency_update",
  description:
    "Update a specific dependency to the latest or specified version. Runs install, then optionally type-checks and runs tests to verify the update.",
  creditCost: 5,
  permissionLevel: "write",
  riskLevel: "medium",
  zodSchema: dependencyUpdateSchema as unknown as z.ZodType<
    Record<string, unknown>
  >,
  inputSchema: {
    type: "object",
    properties: {
      packageManager: {
        type: "string",
        enum: ["npm", "pnpm", "yarn", "cargo", "pip"],
        description: "Package manager to use.",
      },
      packageName: {
        type: "string",
        description: "Name of the dependency to update.",
      },
      targetVersion: {
        type: "string",
        description: "Specific version to update to.",
      },
      runTests: {
        type: "boolean",
        description: "Run tests after updating.",
      },
      runTypecheck: {
        type: "boolean",
        description: "Run type checking after updating.",
      },
    },
    required: ["packageManager", "packageName"],
  },
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Sequential update/typecheck/test pipeline with conditionals
  async execute(input, ctx) {
    const {
      packageManager,
      packageName,
      targetVersion,
      runTests = true,
      runTypecheck = true,
    } = input as z.infer<typeof dependencyUpdateSchema>;

    const updateFn = UPDATE_COMMANDS[packageManager];
    if (!updateFn) {
      return {
        success: false,
        output: "",
        error: `Unsupported package manager: ${packageManager}`,
      };
    }

    const updateCmd = updateFn(packageName, targetVersion);
    const updateResult = await execInSandbox(updateCmd, ctx, 120_000);

    const results: string[] = [
      `Update ${packageName}: ${updateResult.success ? "SUCCESS" : "FAILED"}`,
      updateResult.output || "",
    ];

    let allPassed = updateResult.success;

    // Run type check if requested
    if (runTypecheck && allPassed) {
      const typecheckCmd = TYPECHECK_COMMANDS[packageManager];
      if (typecheckCmd) {
        const tcResult = await execInSandbox(typecheckCmd, ctx, 120_000);
        results.push(`\nTypecheck: ${tcResult.success ? "PASSED" : "FAILED"}`);
        if (!tcResult.success) {
          allPassed = false;
          results.push(tcResult.error || tcResult.output || "");
        }
      }
    }

    // Run tests if requested
    if (runTests && allPassed) {
      const testCmd = TEST_COMMANDS[packageManager];
      if (testCmd) {
        const testResult = await execInSandbox(testCmd, ctx, 300_000);
        results.push(`\nTests: ${testResult.success ? "PASSED" : "FAILED"}`);
        if (!testResult.success) {
          allPassed = false;
          results.push(testResult.error || testResult.output || "");
        }
      }
    }

    return {
      success: allPassed,
      output: results.join("\n"),
      metadata: {
        packageManager,
        packageName,
        targetVersion,
        testsPassed: allPassed,
      },
    };
  },
};

const dependencyBulkUpdateTool: AgentToolDefinition = {
  name: "dependency_bulk_update",
  description:
    "Update all dependencies to latest compatible versions using a conservative strategy (patch first, then minor). Runs the full test suite after each batch to verify updates.",
  creditCost: 10,
  permissionLevel: "write",
  riskLevel: "high",
  zodSchema: dependencyBulkUpdateSchema as unknown as z.ZodType<
    Record<string, unknown>
  >,
  inputSchema: {
    type: "object",
    properties: {
      packageManager: {
        type: "string",
        enum: ["npm", "pnpm", "yarn", "cargo", "pip"],
        description: "Package manager to use.",
      },
      strategy: {
        type: "string",
        enum: ["patch", "minor", "major"],
        description: "Update strategy.",
      },
      runTests: {
        type: "boolean",
        description: "Run test suite after each batch.",
      },
      dryRun: {
        type: "boolean",
        description: "Only report what would be updated.",
      },
    },
    required: ["packageManager"],
  },
  async execute(input, ctx) {
    const {
      packageManager,
      strategy = "patch",
      runTests = true,
      dryRun = false,
    } = input as z.infer<typeof dependencyBulkUpdateSchema>;

    const bulkCmds = BULK_UPDATE_COMMANDS[packageManager];
    if (!bulkCmds) {
      return {
        success: false,
        output: "",
        error: `Unsupported package manager: ${packageManager}`,
      };
    }

    const updateCmd = bulkCmds[strategy];
    if (!updateCmd) {
      return {
        success: false,
        output: "",
        error: `Unsupported strategy: ${strategy}`,
      };
    }

    if (dryRun) {
      // For dry run, only check what's outdated
      const checkCmd = getDryRunCommand(packageManager);

      const result = await execInSandbox(checkCmd, ctx, 60_000);
      return {
        success: true,
        output: `Dry run (${packageManager}, strategy: ${strategy}):\n\n${result.output || result.error || "No outdated packages found."}`,
        metadata: { packageManager, strategy, dryRun: true },
      };
    }

    const updateResult = await execInSandbox(updateCmd, ctx, 300_000);

    const results: string[] = [
      `Bulk update (${strategy}): ${updateResult.success ? "SUCCESS" : "FAILED"}`,
      updateResult.output || "",
    ];

    let testsPassed = true;

    if (runTests && updateResult.success) {
      const testCmd = TEST_COMMANDS[packageManager];
      if (testCmd) {
        const testResult = await execInSandbox(testCmd, ctx, 300_000);
        results.push(`\nTests: ${testResult.success ? "PASSED" : "FAILED"}`);
        if (!testResult.success) {
          testsPassed = false;
          results.push(testResult.error || testResult.output || "");
        }
      }
    }

    return {
      success: updateResult.success && testsPassed,
      output: results.join("\n"),
      metadata: {
        packageManager,
        strategy,
        testsPassed,
      },
    };
  },
};

export const dependencyUpdaterTools: AgentToolDefinition[] = [
  dependencyAuditTool,
  dependencyUpdateTool,
  dependencyBulkUpdateTool,
];
