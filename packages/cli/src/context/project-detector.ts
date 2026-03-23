import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface ProjectInfo {
  entryPoint: string | null;
  framework: string | null;
  language: string;
  packageManager: string | null;
  testFramework: string | null;
}

/**
 * Auto-detects project language, framework, package manager, test framework,
 * and entry point by inspecting configuration files in the given directory.
 */
export class ProjectDetector {
  /**
   * Detect project information from the given directory.
   */
  detect(directory: string): ProjectInfo {
    const info: ProjectInfo = {
      language: "unknown",
      framework: null,
      packageManager: null,
      testFramework: null,
      entryPoint: null,
    };

    if (this.exists(directory, "package.json")) {
      this.detectNodeProject(directory, info);
    } else if (this.exists(directory, "Cargo.toml")) {
      info.language = "rust";
      info.packageManager = "cargo";
      info.entryPoint = "src/main.rs";
      info.testFramework = "cargo-test";
    } else if (this.exists(directory, "go.mod")) {
      info.language = "go";
      info.packageManager = "go";
      info.entryPoint = "main.go";
      info.testFramework = "go-test";
    } else if (this.exists(directory, "pyproject.toml")) {
      info.language = "python";
      if (this.exists(directory, "poetry.lock")) {
        info.packageManager = "poetry";
      } else if (this.exists(directory, "pdm.lock")) {
        info.packageManager = "pdm";
      } else {
        info.packageManager = "pip";
      }
      info.testFramework = "pytest";
    } else if (this.exists(directory, "requirements.txt")) {
      info.language = "python";
      info.packageManager = "pip";
      info.testFramework = "pytest";
    } else if (this.exists(directory, "Gemfile")) {
      info.language = "ruby";
      info.packageManager = "bundler";
      info.testFramework = "rspec";
    } else if (
      this.exists(directory, "build.gradle") ||
      this.exists(directory, "build.gradle.kts")
    ) {
      info.language = "java";
      info.packageManager = "gradle";
      info.testFramework = "junit";
    } else if (this.exists(directory, "pom.xml")) {
      info.language = "java";
      info.packageManager = "maven";
      info.testFramework = "junit";
    }

    return info;
  }

  private detectNodeProject(directory: string, info: ProjectInfo): void {
    info.language = this.exists(directory, "tsconfig.json")
      ? "typescript"
      : "javascript";

    // Package manager
    if (this.exists(directory, "pnpm-lock.yaml")) {
      info.packageManager = "pnpm";
    } else if (this.exists(directory, "yarn.lock")) {
      info.packageManager = "yarn";
    } else if (this.exists(directory, "bun.lockb")) {
      info.packageManager = "bun";
    } else {
      info.packageManager = "npm";
    }

    // Framework detection
    const frameworkChecks: Array<{ files: string[]; name: string }> = [
      {
        name: "nextjs",
        files: ["next.config.js", "next.config.mjs", "next.config.ts"],
      },
      { name: "nuxt", files: ["nuxt.config.ts", "nuxt.config.js"] },
      { name: "svelte", files: ["svelte.config.js"] },
      { name: "angular", files: ["angular.json"] },
      { name: "remix", files: ["remix.config.js", "remix.config.ts"] },
      { name: "astro", files: ["astro.config.mjs", "astro.config.ts"] },
      { name: "vite", files: ["vite.config.ts", "vite.config.js"] },
      {
        name: "express",
        files: ["src/server.ts", "src/app.ts", "server.ts", "server.js"],
      },
    ];

    for (const check of frameworkChecks) {
      if (check.files.some((f) => this.exists(directory, f))) {
        info.framework = check.name;
        break;
      }
    }

    // Test framework
    if (
      this.exists(directory, "vitest.config.ts") ||
      this.exists(directory, "vitest.config.js")
    ) {
      info.testFramework = "vitest";
    } else if (
      this.exists(directory, "jest.config.ts") ||
      this.exists(directory, "jest.config.js")
    ) {
      info.testFramework = "jest";
    } else if (this.exists(directory, "playwright.config.ts")) {
      info.testFramework = "playwright";
    }

    // Entry point detection
    try {
      const pkgRaw = readFileSync(join(directory, "package.json"), "utf-8");
      const pkg = JSON.parse(pkgRaw) as { main?: string; module?: string };
      info.entryPoint = pkg.main ?? pkg.module ?? null;
    } catch {
      // ignore parse errors
    }
  }

  private exists(directory: string, file: string): boolean {
    return existsSync(join(directory, file));
  }
}

export type { ProjectInfo };
