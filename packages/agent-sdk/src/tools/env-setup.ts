import { z } from "zod";
import { execInSandbox } from "./sandbox";
import type {
  AgentToolDefinition,
  ToolExecutionContext,
  ToolResult,
} from "./types";

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

export const detectStackSchema = z
  .object({
    path: z
      .string()
      .optional()
      .describe(
        "Directory path relative to project root to scan (defaults to project root)"
      ),
  })
  .strict();

export const installDependenciesSchema = z
  .object({
    packageManager: z
      .string()
      .optional()
      .describe(
        "Package manager to use (npm, pnpm, yarn, bun, pip, cargo, go, bundler, composer). Auto-detected if omitted."
      ),
    path: z
      .string()
      .optional()
      .describe("Directory containing the project (relative to project root)"),
  })
  .strict();

export const setupEnvironmentSchema = z
  .object({
    overrides: z
      .record(z.string(), z.string())
      .optional()
      .describe("Key-value overrides for environment variables"),
    path: z
      .string()
      .optional()
      .describe("Directory containing the project (relative to project root)"),
  })
  .strict();

export const verifyBuildSchema = z
  .object({
    buildCommand: z
      .string()
      .optional()
      .describe("Build command to run. Auto-detected if omitted."),
    path: z
      .string()
      .optional()
      .describe("Directory containing the project (relative to project root)"),
  })
  .strict();

export const verifyDevServerSchema = z
  .object({
    devCommand: z
      .string()
      .optional()
      .describe("Dev server command. Auto-detected if omitted."),
    healthEndpoint: z
      .string()
      .optional()
      .describe(
        "Health endpoint to poll (e.g. http://localhost:3000). If omitted, polls common ports."
      ),
    path: z
      .string()
      .optional()
      .describe("Directory containing the project (relative to project root)"),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .max(60_000)
      .optional()
      .describe("How long to wait for the server to be ready (default 15000)"),
  })
  .strict();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveProjectPath(workDir: string, relativePath?: string): string {
  if (!relativePath || relativePath === ".") {
    return workDir;
  }
  if (relativePath.startsWith("/")) {
    return relativePath;
  }
  return `${workDir}/${relativePath}`;
}

/** Run stack detection by listing files then parsing key config files. */
async function runStackDetection(
  ctx: ToolExecutionContext,
  scanDir: string
): Promise<ToolResult> {
  // List files (up to 500, 3 levels deep)
  const listResult = await execInSandbox(
    `find "${scanDir}" -maxdepth 3 -type f ! -path '*/node_modules/*' ! -path '*/.git/*' ! -path '*/vendor/*' ! -path '*/target/*' 2>/dev/null | head -500`,
    ctx
  );

  if (!listResult.success) {
    return {
      success: false,
      output: "",
      error: `Failed to list project files: ${listResult.error}`,
    };
  }

  const files = listResult.output
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => (f.startsWith(scanDir) ? f.slice(scanDir.length + 1) : f));

  // Read key config files for deeper analysis
  const configFiles = [
    "package.json",
    "requirements.txt",
    "pyproject.toml",
    "Gemfile",
    "composer.json",
  ];

  const contentMap: Record<string, string> = {};
  for (const cf of configFiles) {
    if (files.includes(cf)) {
      const readResult = await execInSandbox(
        `cat "${scanDir}/${cf}" 2>/dev/null`,
        ctx
      );
      if (readResult.success) {
        contentMap[cf] = readResult.output;
      }
    }
  }

  // Use dynamic import to avoid hard dependency at bundle time; the package
  // is a workspace sibling so it will always be resolvable at runtime.
  const { detectTechStack } = (await import(
    "@prometheus/config-stacks"
  )) as typeof import("@prometheus/config-stacks");

  const result = await detectTechStack(files, contentMap);

  return {
    success: true,
    output: JSON.stringify(result, null, 2),
    metadata: result as unknown as Record<string, unknown>,
  };
}

/** Detect package manager from lockfiles present on disk. */
async function detectPM(
  ctx: ToolExecutionContext,
  dir: string
): Promise<string> {
  const check = await execInSandbox(
    `ls -1 "${dir}"/pnpm-lock.yaml "${dir}"/yarn.lock "${dir}"/bun.lockb "${dir}"/bun.lock "${dir}"/package-lock.json "${dir}"/Pipfile.lock "${dir}"/poetry.lock "${dir}"/requirements.txt "${dir}"/Cargo.toml "${dir}"/go.mod "${dir}"/Gemfile "${dir}"/composer.json 2>/dev/null || true`,
    ctx
  );

  const found = check.output.trim();
  if (found.includes("pnpm-lock.yaml")) {
    return "pnpm";
  }
  if (found.includes("yarn.lock")) {
    return "yarn";
  }
  if (found.includes("bun.lock")) {
    return "bun";
  }
  if (found.includes("package-lock.json")) {
    return "npm";
  }
  if (found.includes("Pipfile.lock")) {
    return "pipenv";
  }
  if (found.includes("poetry.lock")) {
    return "poetry";
  }
  if (found.includes("requirements.txt")) {
    return "pip";
  }
  if (found.includes("Cargo.toml")) {
    return "cargo";
  }
  if (found.includes("go.mod")) {
    return "go";
  }
  if (found.includes("Gemfile")) {
    return "bundler";
  }
  if (found.includes("composer.json")) {
    return "composer";
  }
  return "npm";
}

function installCommand(pm: string): string {
  switch (pm) {
    case "pnpm":
      return "pnpm install --frozen-lockfile || pnpm install";
    case "yarn":
      return "yarn install --frozen-lockfile || yarn install";
    case "bun":
      return "bun install";
    case "npm":
      return "npm ci || npm install";
    case "pip":
      return "pip install -r requirements.txt";
    case "pipenv":
      return "pipenv install";
    case "poetry":
      return "poetry install";
    case "cargo":
      return "cargo build";
    case "go":
      return "go mod download";
    case "bundler":
      return "bundle install";
    case "composer":
      return "composer install";
    default:
      return "npm install";
  }
}

// ---------------------------------------------------------------------------
// Known sandbox-internal service defaults
// ---------------------------------------------------------------------------

const SANDBOX_ENV_DEFAULTS: Record<string, string> = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/app",
  REDIS_URL: "redis://localhost:6379",
  MONGODB_URI: "mongodb://localhost:27017/app",
  PORT: "3000",
  NODE_ENV: "development",
};

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

export const envSetupTools: AgentToolDefinition[] = [
  {
    name: "detect_stack",
    description:
      "Auto-detect the project's tech stack (languages, frameworks, package manager, monorepo layout) by scanning file structure and parsing config files.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Directory to scan, relative to project root (defaults to root)",
        },
      },
      required: [],
    },
    zodSchema: detectStackSchema,
    permissionLevel: "read",
    creditCost: 1,
    execute: async (input, ctx) => {
      const parsed = detectStackSchema.parse(input);
      const scanDir = resolveProjectPath(ctx.workDir, parsed.path);
      return await runStackDetection(ctx, scanDir);
    },
  },
  {
    name: "install_dependencies",
    description:
      "Install project dependencies using the detected or specified package manager (npm, pnpm, yarn, pip, cargo, go, bundler, composer, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        packageManager: {
          type: "string",
          description: "Package manager to use (auto-detected if omitted)",
        },
        path: {
          type: "string",
          description: "Project directory relative to project root",
        },
      },
      required: [],
    },
    zodSchema: installDependenciesSchema,
    permissionLevel: "execute",
    creditCost: 3,
    execute: async (input, ctx) => {
      const parsed = installDependenciesSchema.parse(input);
      const dir = resolveProjectPath(ctx.workDir, parsed.path);
      const pm = parsed.packageManager ?? (await detectPM(ctx, dir));
      const cmd = installCommand(pm);

      const result = await execInSandbox(`cd "${dir}" && ${cmd}`, ctx, 120_000);

      return {
        success: result.success,
        output: result.success
          ? `Dependencies installed successfully using ${pm}.\n${result.output.slice(-500)}`
          : result.output,
        error: result.error,
        metadata: { packageManager: pm },
      };
    },
  },
  {
    name: "setup_environment",
    description:
      "Create a .env file from .env.example or .env.template with sensible defaults for sandbox-internal services (DATABASE_URL, REDIS_URL, etc.). Optionally override specific values.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Project directory relative to project root",
        },
        overrides: {
          type: "object",
          description: "Key-value overrides for environment variables",
        },
      },
      required: [],
    },
    zodSchema: setupEnvironmentSchema,
    permissionLevel: "write",
    creditCost: 2,
    execute: async (input, ctx) => {
      const parsed = setupEnvironmentSchema.parse(input);
      const dir = resolveProjectPath(ctx.workDir, parsed.path);

      // Find template file
      const templateCheck = await execInSandbox(
        `ls -1 "${dir}/.env.example" "${dir}/.env.template" 2>/dev/null || true`,
        ctx
      );
      const templates = templateCheck.output.trim().split("\n").filter(Boolean);
      const templateFile = templates[0];

      let envContent: string;

      if (templateFile) {
        // Read the template
        const readResult = await execInSandbox(`cat "${templateFile}"`, ctx);
        if (!readResult.success) {
          return {
            success: false,
            output: "",
            error: `Failed to read template: ${readResult.error}`,
          };
        }
        // Replace placeholder values with sandbox defaults
        envContent = readResult.output
          .split("\n")
          .map((line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) {
              return line;
            }

            const eqIdx = line.indexOf("=");
            if (eqIdx === -1) {
              return line;
            }

            const key = line.slice(0, eqIdx).trim();
            const value = line.slice(eqIdx + 1).trim();

            // Apply user overrides first
            if (parsed.overrides && key in parsed.overrides) {
              return `${key}=${parsed.overrides[key]}`;
            }

            // Fill empty or placeholder values with known defaults
            if (
              !value ||
              value === '""' ||
              value === "''" ||
              value.startsWith("your_") ||
              value.startsWith("<") ||
              value === "changeme"
            ) {
              const defaultVal = SANDBOX_ENV_DEFAULTS[key];
              if (defaultVal) {
                return `${key}=${defaultVal}`;
              }
            }

            return line;
          })
          .join("\n");
      } else {
        // No template — generate a minimal .env
        const lines: string[] = [
          "# Auto-generated by Prometheus environment setup",
          "",
        ];
        const allVars = {
          ...SANDBOX_ENV_DEFAULTS,
          ...parsed.overrides,
        };
        for (const [key, val] of Object.entries(allVars)) {
          lines.push(`${key}=${val}`);
        }
        envContent = lines.join("\n");
      }

      // Write .env file
      const writeResult = await execInSandbox(
        `cat > "${dir}/.env" << 'PROMETHEUS_ENV_EOF'\n${envContent}\nPROMETHEUS_ENV_EOF`,
        ctx
      );

      if (!writeResult.success) {
        return {
          success: false,
          output: "",
          error: `Failed to write .env: ${writeResult.error}`,
        };
      }

      return {
        success: true,
        output: `Environment file created at ${dir}/.env${templateFile ? ` (from ${templateFile})` : " (generated)"}`,
        metadata: { templateUsed: templateFile ?? null },
      };
    },
  },
  {
    name: "verify_build",
    description:
      "Run the project build command and report success or failure. Auto-detects the build command from package.json or tech stack if not specified.",
    inputSchema: {
      type: "object",
      properties: {
        buildCommand: {
          type: "string",
          description: "Build command to run (auto-detected if omitted)",
        },
        path: {
          type: "string",
          description: "Project directory relative to project root",
        },
      },
      required: [],
    },
    zodSchema: verifyBuildSchema,
    permissionLevel: "execute",
    creditCost: 3,
    execute: async (input, ctx) => {
      const parsed = verifyBuildSchema.parse(input);
      const dir = resolveProjectPath(ctx.workDir, parsed.path);

      let buildCmd = parsed.buildCommand;

      if (!buildCmd) {
        // Try to detect from stack
        const detection = await runStackDetection(ctx, dir);
        if (detection.metadata) {
          buildCmd = (detection.metadata as Record<string, unknown>)
            .buildCommand as string | undefined;
        }
      }

      if (!buildCmd) {
        return {
          success: false,
          output: "",
          error:
            "Could not determine build command. Please specify it explicitly.",
        };
      }

      const result = await execInSandbox(
        `cd "${dir}" && ${buildCmd}`,
        ctx,
        120_000
      );

      return {
        success: result.success,
        output: result.success
          ? `Build succeeded: ${buildCmd}\n${result.output.slice(-500)}`
          : `Build failed: ${buildCmd}\n${result.output}\n${result.error ?? ""}`,
        error: result.error,
        metadata: { buildCommand: buildCmd },
      };
    },
  },
  {
    name: "verify_dev_server",
    description:
      "Start the dev server and wait for it to become ready by polling a health endpoint or common port. Reports the server URL on success.",
    inputSchema: {
      type: "object",
      properties: {
        devCommand: {
          type: "string",
          description: "Dev server command (auto-detected if omitted)",
        },
        healthEndpoint: {
          type: "string",
          description:
            "Health endpoint URL to poll (e.g. http://localhost:3000)",
        },
        path: {
          type: "string",
          description: "Project directory relative to project root",
        },
        timeoutMs: {
          type: "number",
          description: "Timeout in milliseconds (default 15000, max 60000)",
        },
      },
      required: [],
    },
    zodSchema: verifyDevServerSchema,
    permissionLevel: "execute",
    creditCost: 3,
    execute: async (input, ctx) => {
      const parsed = verifyDevServerSchema.parse(input);
      const dir = resolveProjectPath(ctx.workDir, parsed.path);
      const timeout = parsed.timeoutMs ?? 15_000;

      let devCmd = parsed.devCommand;

      if (!devCmd) {
        const detection = await runStackDetection(ctx, dir);
        if (detection.metadata) {
          devCmd = (detection.metadata as Record<string, unknown>).devCommand as
            | string
            | undefined;
        }
      }

      if (!devCmd) {
        return {
          success: false,
          output: "",
          error:
            "Could not determine dev command. Please specify it explicitly.",
        };
      }

      // Start the dev server in background
      const logFile = `/tmp/prometheus-dev-${ctx.sandboxId}.log`;
      const bgResult = await execInSandbox(
        `cd "${dir}" && nohup ${devCmd} > "${logFile}" 2>&1 & echo $!`,
        ctx
      );

      if (!bgResult.success) {
        return {
          success: false,
          output: "",
          error: `Failed to start dev server: ${bgResult.error}`,
        };
      }

      const pid = bgResult.output.trim();

      // Determine endpoint to poll
      const endpoint = parsed.healthEndpoint ?? "http://localhost:3000";

      // Poll for readiness
      const pollInterval = 2000;
      const maxAttempts = Math.ceil(timeout / pollInterval);

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        // Wait before polling
        await execInSandbox("sleep 2", ctx);

        const curlResult = await execInSandbox(
          `curl -s -o /dev/null -w "%{http_code}" --max-time 3 "${endpoint}" 2>/dev/null || echo "000"`,
          ctx
        );

        const statusCode = curlResult.output.trim();
        if (statusCode !== "000" && statusCode !== "") {
          const code = Number.parseInt(statusCode, 10);
          if (code >= 200 && code < 500) {
            return {
              success: true,
              output: `Dev server is ready at ${endpoint} (HTTP ${statusCode}). PID: ${pid}`,
              metadata: {
                pid: Number.parseInt(pid, 10),
                endpoint,
                logFile,
                devCommand: devCmd,
              },
            };
          }
        }
      }

      // Grab last few lines of log for diagnostics
      const tailResult = await execInSandbox(
        `tail -20 "${logFile}" 2>/dev/null || true`,
        ctx
      );

      return {
        success: false,
        output: `Dev server did not become ready within ${timeout}ms.\nPID: ${pid}\nLast output:\n${tailResult.output}`,
        error: `Server not ready at ${endpoint} after ${timeout}ms`,
        metadata: {
          pid: Number.parseInt(pid, 10),
          logFile,
          devCommand: devCmd,
        },
      };
    },
  },
];
