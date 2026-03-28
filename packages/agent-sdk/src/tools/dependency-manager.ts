/**
 * Dependency Manager — GAP-029
 *
 * Utilities for detecting package managers, generating install commands,
 * checking for version conflicts, and updating lock files across
 * multiple language ecosystems.
 */

import { execInSandbox } from "./sandbox";
import type { ToolExecutionContext } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PackageManagerType =
  | "npm"
  | "pnpm"
  | "yarn"
  | "pip"
  | "cargo"
  | "go";

export interface Conflict {
  /** Description of the conflict */
  description: string;
  /** The package with a conflict */
  packageName: string;
  /** Required version range */
  requiredVersion: string;
  /** Severity of the conflict */
  severity: "error" | "warning";
}

export interface DependencyInfo {
  /** Current version installed */
  currentVersion: string;
  /** Whether this is a dev dependency */
  isDev: boolean;
  /** Latest available version */
  latestVersion?: string;
  /** Package name */
  name: string;
}

// ---------------------------------------------------------------------------
// Detection patterns
// ---------------------------------------------------------------------------

const PM_INDICATORS: Record<PackageManagerType, string[]> = {
  pnpm: ["pnpm-lock.yaml", "pnpm-workspace.yaml"],
  yarn: ["yarn.lock", ".yarnrc.yml", ".yarnrc"],
  npm: ["package-lock.json", "npm-shrinkwrap.json"],
  pip: [
    "requirements.txt",
    "Pipfile",
    "pyproject.toml",
    "setup.py",
    "poetry.lock",
  ],
  cargo: ["Cargo.toml", "Cargo.lock"],
  go: ["go.mod", "go.sum"],
};

// ---------------------------------------------------------------------------
// DependencyManager
// ---------------------------------------------------------------------------

export class DependencyManager {
  /**
   * Detect the package manager used in a project from its file listing.
   * Checks for lock files and configuration files in priority order.
   */
  detectPackageManager(files: string[]): PackageManagerType {
    // Check in priority order (more specific first)
    for (const [pm, indicators] of Object.entries(PM_INDICATORS)) {
      for (const indicator of indicators) {
        if (files.some((f) => f === indicator || f.endsWith(`/${indicator}`))) {
          return pm as PackageManagerType;
        }
      }
    }

    // Fallback: check for package.json (could be npm, pnpm, or yarn)
    if (
      files.some((f) => f === "package.json" || f.endsWith("/package.json"))
    ) {
      return "npm";
    }

    // Default
    return "npm";
  }

  /**
   * Generate the install command for the given package manager and packages.
   */
  getInstallCommand(
    pm: PackageManagerType,
    packages: string[],
    options?: { dev?: boolean }
  ): string {
    const isDev = options?.dev ?? false;
    const pkgList = packages.join(" ");

    switch (pm) {
      case "pnpm":
        return isDev ? `pnpm add -D ${pkgList}` : `pnpm add ${pkgList}`;
      case "yarn":
        return isDev ? `yarn add -D ${pkgList}` : `yarn add ${pkgList}`;
      case "npm":
        return isDev
          ? `npm install --save-dev ${pkgList}`
          : `npm install ${pkgList}`;
      case "pip":
        return `pip install ${pkgList}`;
      case "cargo":
        return packages.map((pkg) => `cargo add ${pkg}`).join(" && ");
      case "go":
        return packages.map((pkg) => `go get ${pkg}`).join(" && ");
      default:
        return `npm install ${pkgList}`;
    }
  }

  /**
   * Generate the command to install all dependencies from the lock file.
   */
  getInstallAllCommand(pm: PackageManagerType): string {
    switch (pm) {
      case "pnpm":
        return "pnpm install";
      case "yarn":
        return "yarn install";
      case "npm":
        return "npm install";
      case "pip":
        return "pip install -r requirements.txt";
      case "cargo":
        return "cargo fetch";
      case "go":
        return "go mod download";
      default:
        return "npm install";
    }
  }

  /**
   * Check for dependency version conflicts in the project.
   * Runs the appropriate audit/check command in the sandbox.
   */
  async checkConflicts(
    _sandboxId: string,
    pm: PackageManagerType,
    ctx: ToolExecutionContext
  ): Promise<Conflict[]> {
    const conflicts: Conflict[] = [];

    const checkCommand = this.getConflictCheckCommand(pm);
    if (!checkCommand) {
      return conflicts;
    }

    const result = await execInSandbox(checkCommand, ctx, 60_000);

    if (!result.success && result.output) {
      // Parse the output for conflict information
      const parsed = this.parseConflictOutput(pm, result.output);
      conflicts.push(...parsed);
    }

    return conflicts;
  }

  /**
   * Generate the command to update the lock file.
   */
  getUpdateLockCommand(pm: PackageManagerType): string {
    switch (pm) {
      case "pnpm":
        return "pnpm install --lockfile-only";
      case "yarn":
        return "yarn install --mode update-lockfile";
      case "npm":
        return "npm install --package-lock-only";
      case "pip":
        return "pip freeze > requirements.txt";
      case "cargo":
        return "cargo update";
      case "go":
        return "go mod tidy";
      default:
        return "npm install --package-lock-only";
    }
  }

  /**
   * Generate the command to remove a package.
   */
  getRemoveCommand(pm: PackageManagerType, packages: string[]): string {
    const pkgList = packages.join(" ");

    switch (pm) {
      case "pnpm":
        return `pnpm remove ${pkgList}`;
      case "yarn":
        return `yarn remove ${pkgList}`;
      case "npm":
        return `npm uninstall ${pkgList}`;
      case "pip":
        return `pip uninstall -y ${pkgList}`;
      case "cargo":
        return packages.map((pkg) => `cargo remove ${pkg}`).join(" && ");
      case "go":
        return `go mod edit ${packages.map((p) => `-droprequire ${p}`).join(" ")} && go mod tidy`;
      default:
        return `npm uninstall ${pkgList}`;
    }
  }

  /**
   * Generate the command to audit dependencies for security vulnerabilities.
   */
  getAuditCommand(pm: PackageManagerType): string {
    switch (pm) {
      case "pnpm":
        return "pnpm audit --json";
      case "yarn":
        return "yarn npm audit --json";
      case "npm":
        return "npm audit --json";
      case "pip":
        return "pip audit --format json";
      case "cargo":
        return "cargo audit --json";
      case "go":
        return "govulncheck ./...";
      default:
        return "npm audit --json";
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getConflictCheckCommand(pm: PackageManagerType): string | null {
    switch (pm) {
      case "npm":
        return "npm ls --json 2>&1 || true";
      case "pnpm":
        return "pnpm ls --json 2>&1 || true";
      case "yarn":
        return "yarn info --json 2>&1 || true";
      case "pip":
        return "pip check 2>&1 || true";
      case "cargo":
        return "cargo tree --duplicates 2>&1 || true";
      case "go":
        return "go mod verify 2>&1 || true";
      default:
        return null;
    }
  }

  private parseConflictOutput(
    pm: PackageManagerType,
    output: string
  ): Conflict[] {
    const conflicts: Conflict[] = [];

    switch (pm) {
      case "npm":
      case "pnpm":
      case "yarn": {
        // Parse peer dependency and version conflict warnings
        const peerDepRe =
          /(?:peer dep|ERESOLVE|unmet peer|version conflict).*?["']?(\S+?)["']?\s/gi;
        let match = peerDepRe.exec(output);
        while (match !== null) {
          conflicts.push({
            packageName: match[1] ?? "unknown",
            requiredVersion: "compatible",
            description: match[0].trim(),
            severity: "warning",
          });
          match = peerDepRe.exec(output);
        }
        break;
      }
      case "pip": {
        // Parse pip check output: "package X.Y.Z has requirement ..."
        const pipRe = /(\S+)\s+[\d.]+\s+has requirement\s+(\S+)/g;
        let pipMatch = pipRe.exec(output);
        while (pipMatch !== null) {
          conflicts.push({
            packageName: pipMatch[1] ?? "unknown",
            requiredVersion: pipMatch[2] ?? "unknown",
            description: pipMatch[0],
            severity: "error",
          });
          pipMatch = pipRe.exec(output);
        }
        break;
      }
      default:
        break;
    }

    return conflicts;
  }
}
