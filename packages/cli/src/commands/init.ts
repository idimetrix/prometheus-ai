import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";

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
      language: "typescript",
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

export const initCommand = new Command("init")
  .description("Initialize Prometheus for a project")
  .option("--path <dir>", "Project directory", process.cwd())
  .action((opts: { path: string }) => {
    const directory = opts.path;
    const configDir = join(directory, ".prometheus");

    if (existsSync(configDir)) {
      console.log("Prometheus already initialized in this directory.");
      console.log(`Config directory: ${configDir}`);
      return;
    }

    console.log(`Initializing Prometheus in ${directory}...\n`);

    // Detect project type
    const projectInfo = detectProject(directory);

    console.log("Detected project:");
    console.log(`  Language:        ${projectInfo.language}`);
    console.log(`  Framework:       ${projectInfo.framework ?? "none"}`);
    console.log(`  Package Manager: ${projectInfo.packageManager ?? "none"}`);
    console.log(`  Test Framework:  ${projectInfo.testFramework ?? "none"}`);
    console.log();

    // Create config directory
    mkdirSync(configDir, { recursive: true });
    mkdirSync(join(configDir, "sessions"), { recursive: true });

    // Write config file
    const config = {
      version: "1.0",
      project: {
        language: projectInfo.language,
        framework: projectInfo.framework,
        packageManager: projectInfo.packageManager,
        testFramework: projectInfo.testFramework,
      },
      settings: {
        autoApprove: false,
        maxAgents: 3,
        defaultMode: "task",
      },
    };

    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify(config, null, 2)
    );

    console.log("Created .prometheus/config.json");
    console.log("Created .prometheus/sessions/");
    console.log("\nPrometheus initialized successfully.");
    console.log('Run "prometheus task <description>" to start working.');
  });
