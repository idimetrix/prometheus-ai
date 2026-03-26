import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { APIClient } from "../api-client";
import type { CLIConfig } from "../config";
import { resolveConfig, saveConfig } from "../config";
import { PROMETHEUS_MD_TEMPLATE } from "../prometheus-md";

interface DetectedProjectInfo {
  framework: string | null;
  language: string;
  packageManager: string | null;
  testFramework: string | null;
}

function detectPackageManager(directory: string): string {
  if (existsSync(join(directory, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (existsSync(join(directory, "yarn.lock"))) {
    return "yarn";
  }
  if (existsSync(join(directory, "bun.lockb"))) {
    return "bun";
  }
  return "npm";
}

function detectFramework(directory: string): string | null {
  const frameworkFiles: Array<{ files: string[]; framework: string }> = [
    {
      files: ["next.config.js", "next.config.mjs", "next.config.ts"],
      framework: "nextjs",
    },
    { files: ["nuxt.config.ts"], framework: "nuxt" },
    { files: ["svelte.config.js"], framework: "svelte" },
    { files: ["angular.json"], framework: "angular" },
    { files: ["remix.config.js", "remix.config.ts"], framework: "remix" },
    { files: ["astro.config.mjs", "astro.config.ts"], framework: "astro" },
  ];
  for (const entry of frameworkFiles) {
    if (entry.files.some((f) => existsSync(join(directory, f)))) {
      return entry.framework;
    }
  }
  return null;
}

function detectTestFramework(directory: string): string | null {
  const testFiles: Array<{ files: string[]; framework: string }> = [
    { files: ["vitest.config.ts", "vitest.config.js"], framework: "vitest" },
    { files: ["jest.config.ts", "jest.config.js"], framework: "jest" },
    { files: ["playwright.config.ts"], framework: "playwright" },
  ];
  for (const entry of testFiles) {
    if (entry.files.some((f) => existsSync(join(directory, f)))) {
      return entry.framework;
    }
  }
  return null;
}

function detectNonJsProject(directory: string): DetectedProjectInfo | null {
  const detectors: Array<{
    file: string;
    language: string;
    packageManager: string | (() => string);
  }> = [
    { file: "Cargo.toml", language: "rust", packageManager: "cargo" },
    { file: "go.mod", language: "go", packageManager: "go" },
    {
      file: "pyproject.toml",
      language: "python",
      packageManager: () =>
        existsSync(join(directory, "poetry.lock")) ? "poetry" : "pip",
    },
    { file: "requirements.txt", language: "python", packageManager: "pip" },
    { file: "Gemfile", language: "ruby", packageManager: "bundler" },
  ];

  for (const d of detectors) {
    if (existsSync(join(directory, d.file))) {
      return {
        language: d.language,
        framework: null,
        packageManager:
          typeof d.packageManager === "function"
            ? d.packageManager()
            : d.packageManager,
        testFramework: null,
      };
    }
  }
  return null;
}

function detectProject(directory: string): DetectedProjectInfo {
  if (existsSync(join(directory, "package.json"))) {
    return {
      language: existsSync(join(directory, "tsconfig.json"))
        ? "typescript"
        : "javascript",
      packageManager: detectPackageManager(directory),
      framework: detectFramework(directory),
      testFramework: detectTestFramework(directory),
    };
  }

  return (
    detectNonJsProject(directory) ?? {
      language: "unknown",
      framework: null,
      packageManager: null,
      testFramework: null,
    }
  );
}

function detectGitRemote(directory: string): string | null {
  try {
    const remote = execSync("git remote get-url origin", {
      cwd: directory,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return remote || null;
  } catch {
    return null;
  }
}

async function tryCreateRemoteProject(
  config: CLIConfig,
  directory: string,
  _projectInfo: DetectedProjectInfo,
  _repoUrl: string | null
): Promise<string | undefined> {
  if (!config.apiKey) {
    console.log("Note: No API key set. Skipping remote project creation.");
    console.log(
      "  Set PROMETHEUS_API_KEY or run 'prometheus init --api-key <key>'\n"
    );
    return undefined;
  }

  try {
    const client = new APIClient(config);
    const projects = await client.listProjects();
    const projectName = directory.split("/").pop() ?? "unnamed-project";
    const existing = projects.find((p) => p.name === projectName);
    if (existing) {
      console.log(`Found existing project on Prometheus: ${existing.id}`);
      saveConfig({ defaultProjectId: existing.id });
      return existing.id;
    }
    console.log(
      "Note: Project not found on Prometheus. Continuing with local setup."
    );
    return undefined;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(
      `Note: Could not create project via API (${msg}). Continuing with local setup.`
    );
    return undefined;
  }
}

function writeProjectFiles(
  directory: string,
  configDir: string,
  projectInfo: DetectedProjectInfo,
  projectId: string | undefined,
  repoUrl: string | null
): void {
  mkdirSync(configDir, { recursive: true });
  mkdirSync(join(configDir, "sessions"), { recursive: true });

  const configLines = [
    "# Prometheus Project Configuration",
    'version: "1.0"',
    "",
    "project:",
    `  language: ${projectInfo.language}`,
    `  framework: ${projectInfo.framework ?? "none"}`,
    `  packageManager: ${projectInfo.packageManager ?? "none"}`,
    `  testFramework: ${projectInfo.testFramework ?? "none"}`,
    projectId ? `  id: ${projectId}` : "",
    repoUrl ? `  repoUrl: ${repoUrl}` : "",
    "",
    "settings:",
    "  autoApprove: false",
    "  maxAgents: 3",
    "  defaultMode: task",
  ];

  writeFileSync(
    join(configDir, "config.yml"),
    configLines.filter(Boolean).join("\n")
  );
  console.log("Created .prometheus/config.yml");

  const prometheusMdPath = join(directory, ".prometheus.md");
  const altRulesPath = join(configDir, "rules.md");
  if (!(existsSync(prometheusMdPath) || existsSync(altRulesPath))) {
    writeFileSync(prometheusMdPath, PROMETHEUS_MD_TEMPLATE);
    console.log("Created .prometheus.md (project rules template)");
  }

  console.log("Created .prometheus/sessions/");
}

export const initCommand = new Command("init")
  .description("Initialize Prometheus for a project")
  .option("--path <dir>", "Project directory", process.cwd())
  .option("--api-url <url>", "Prometheus API URL")
  .option("--api-key <key>", "Prometheus API key")
  .action(async (opts: { apiKey?: string; apiUrl?: string; path: string }) => {
    const directory = opts.path;
    const configDir = join(directory, ".prometheus");

    if (existsSync(join(configDir, "config.yml"))) {
      console.log("Prometheus already initialized in this directory.");
      console.log(`Config directory: ${configDir}`);
      return;
    }

    console.log(`Initializing Prometheus in ${directory}...\n`);

    const projectInfo = detectProject(directory);
    const repoUrl = detectGitRemote(directory);

    console.log("Detected project:");
    console.log(`  Language:        ${projectInfo.language}`);
    console.log(`  Framework:       ${projectInfo.framework ?? "none"}`);
    console.log(`  Package Manager: ${projectInfo.packageManager ?? "none"}`);
    console.log(`  Test Framework:  ${projectInfo.testFramework ?? "none"}`);
    if (repoUrl) {
      console.log(`  Git Remote:      ${repoUrl}`);
    }
    console.log();

    const config = resolveConfig({
      apiUrl: opts.apiUrl,
      apiKey: opts.apiKey,
    });

    const projectId = await tryCreateRemoteProject(
      config,
      directory,
      projectInfo,
      repoUrl
    );

    writeProjectFiles(directory, configDir, projectInfo, projectId, repoUrl);

    console.log("\nPrometheus initialized successfully.");
    if (projectId) {
      console.log(`Project ID: ${projectId}`);
    }
    console.log('Run "prometheus task <description>" to start working.');
  });
