import { exec } from "node:child_process";
import { access, copyFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { createLogger } from "@prometheus/logger";

const execAsync = promisify(exec);

const logger = createLogger("sandbox-manager:auto-setup");

const SETUP_TIMEOUT_MS = 120_000; // 2 minutes

export interface SetupResult {
  errors: string[];
  installedPackages: number;
  language: string | null;
  packageManager: string | null;
  success: boolean;
}

interface DetectedProject {
  installCommand: string;
  language: string;
  manifestFile: string;
  packageManager: string;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect project type from manifest files in the workspace.
 */
async function detectProjectType(
  workspaceDir: string
): Promise<DetectedProject | null> {
  // Check in priority order

  // Node.js — detect preferred package manager
  if (await fileExists(join(workspaceDir, "package.json"))) {
    // Check lockfiles to determine package manager
    if (await fileExists(join(workspaceDir, "pnpm-lock.yaml"))) {
      return {
        language: "node",
        packageManager: "pnpm",
        manifestFile: "package.json",
        installCommand: "pnpm install --frozen-lockfile || pnpm install",
      };
    }
    if (await fileExists(join(workspaceDir, "yarn.lock"))) {
      return {
        language: "node",
        packageManager: "yarn",
        manifestFile: "package.json",
        installCommand: "yarn install --frozen-lockfile || yarn install",
      };
    }
    if (await fileExists(join(workspaceDir, "bun.lockb"))) {
      return {
        language: "node",
        packageManager: "bun",
        manifestFile: "package.json",
        installCommand: "bun install",
      };
    }
    return {
      language: "node",
      packageManager: "npm",
      manifestFile: "package.json",
      installCommand: "npm ci || npm install",
    };
  }

  // Python
  if (await fileExists(join(workspaceDir, "requirements.txt"))) {
    return {
      language: "python",
      packageManager: "pip",
      manifestFile: "requirements.txt",
      installCommand: "pip install -r requirements.txt",
    };
  }

  if (await fileExists(join(workspaceDir, "pyproject.toml"))) {
    if (await fileExists(join(workspaceDir, "poetry.lock"))) {
      return {
        language: "python",
        packageManager: "poetry",
        manifestFile: "pyproject.toml",
        installCommand: "poetry install",
      };
    }
    return {
      language: "python",
      packageManager: "pip",
      manifestFile: "pyproject.toml",
      installCommand: "pip install -e .",
    };
  }

  // Go
  if (await fileExists(join(workspaceDir, "go.mod"))) {
    return {
      language: "go",
      packageManager: "go",
      manifestFile: "go.mod",
      installCommand: "go mod download",
    };
  }

  // Rust
  if (await fileExists(join(workspaceDir, "Cargo.toml"))) {
    return {
      language: "rust",
      packageManager: "cargo",
      manifestFile: "Cargo.toml",
      installCommand: "cargo fetch",
    };
  }

  // Ruby
  if (await fileExists(join(workspaceDir, "Gemfile"))) {
    return {
      language: "ruby",
      packageManager: "bundler",
      manifestFile: "Gemfile",
      installCommand: "bundle install",
    };
  }

  return null;
}

/**
 * Count packages from a manifest file.
 */
async function countPackages(
  workspaceDir: string,
  project: DetectedProject
): Promise<number> {
  try {
    const manifestPath = join(workspaceDir, project.manifestFile);
    const content = await readFile(manifestPath, "utf-8");

    if (project.language === "node") {
      const pkg = JSON.parse(content) as Record<string, unknown>;
      const deps = Object.keys(
        (pkg.dependencies as Record<string, unknown>) ?? {}
      );
      const devDeps = Object.keys(
        (pkg.devDependencies as Record<string, unknown>) ?? {}
      );
      return deps.length + devDeps.length;
    }

    if (
      project.language === "python" &&
      project.manifestFile === "requirements.txt"
    ) {
      return content
        .split("\n")
        .filter((line) => line.trim() && !line.startsWith("#")).length;
    }

    // For other languages, return 0 as we can't easily parse
    return 0;
  } catch {
    return 0;
  }
}

/**
 * Copy .env.example to .env if .env doesn't exist.
 */
async function setupEnvFile(workspaceDir: string): Promise<boolean> {
  const envPath = join(workspaceDir, ".env");
  const examplePath = join(workspaceDir, ".env.example");

  if ((await fileExists(examplePath)) && !(await fileExists(envPath))) {
    try {
      await copyFile(examplePath, envPath);
      logger.info("Copied .env.example to .env");
      return true;
    } catch {
      logger.warn("Failed to copy .env.example to .env");
    }
  }

  return false;
}

/**
 * Auto-detect project type and install dependencies in a sandbox workspace.
 *
 * Detects: package.json (Node), requirements.txt (Python), go.mod (Go),
 * Cargo.toml (Rust), Gemfile (Ruby).
 *
 * Also copies .env.example to .env if it exists and .env does not.
 */
export async function autoSetupEnvironment(
  _sandboxId: string,
  workspaceDir: string
): Promise<SetupResult> {
  const errors: string[] = [];

  logger.info({ workspaceDir }, "Starting auto-setup environment detection");

  // Detect project type
  const project = await detectProjectType(workspaceDir);

  if (!project) {
    logger.info("No recognized project type detected");
    return {
      success: true,
      language: null,
      packageManager: null,
      installedPackages: 0,
      errors: [],
    };
  }

  logger.info(
    { language: project.language, packageManager: project.packageManager },
    "Project type detected"
  );

  // Copy .env.example to .env
  await setupEnvFile(workspaceDir);

  // Count packages before install
  const packageCount = await countPackages(workspaceDir, project);

  // Run install command
  try {
    await execAsync(project.installCommand, {
      cwd: workspaceDir,
      timeout: SETUP_TIMEOUT_MS,
      env: { ...process.env, CI: "true" },
    });

    logger.info(
      {
        language: project.language,
        packageManager: project.packageManager,
        packages: packageCount,
      },
      "Dependencies installed successfully"
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    errors.push(`Install failed: ${msg}`);
    logger.warn(
      { error: msg, command: project.installCommand },
      "Dependency installation failed"
    );
  }

  return {
    success: errors.length === 0,
    language: project.language,
    packageManager: project.packageManager,
    installedPackages: packageCount,
    errors,
  };
}
