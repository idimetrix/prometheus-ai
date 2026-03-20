import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";

interface DetectedProjectInfo {
  framework: string | null;
  language: string;
  packageManager: string | null;
  testFramework: string | null;
}

function detectProject(directory: string): DetectedProjectInfo {
  const info: DetectedProjectInfo = {
    language: "unknown",
    framework: null,
    packageManager: null,
    testFramework: null,
  };

  // Detect by config files
  if (existsSync(join(directory, "package.json"))) {
    info.language = "typescript";
    if (existsSync(join(directory, "pnpm-lock.yaml"))) {
      info.packageManager = "pnpm";
    } else if (existsSync(join(directory, "yarn.lock"))) {
      info.packageManager = "yarn";
    } else {
      info.packageManager = "npm";
    }

    // Detect framework
    if (
      existsSync(join(directory, "next.config.js")) ||
      existsSync(join(directory, "next.config.mjs")) ||
      existsSync(join(directory, "next.config.ts"))
    ) {
      info.framework = "nextjs";
    } else if (existsSync(join(directory, "nuxt.config.ts"))) {
      info.framework = "nuxt";
    } else if (existsSync(join(directory, "svelte.config.js"))) {
      info.framework = "svelte";
    } else if (existsSync(join(directory, "angular.json"))) {
      info.framework = "angular";
    }

    // Detect test framework
    if (
      existsSync(join(directory, "vitest.config.ts")) ||
      existsSync(join(directory, "vitest.config.js"))
    ) {
      info.testFramework = "vitest";
    } else if (
      existsSync(join(directory, "jest.config.ts")) ||
      existsSync(join(directory, "jest.config.js"))
    ) {
      info.testFramework = "jest";
    }
  } else if (existsSync(join(directory, "Cargo.toml"))) {
    info.language = "rust";
    info.packageManager = "cargo";
  } else if (existsSync(join(directory, "go.mod"))) {
    info.language = "go";
    info.packageManager = "go";
  } else if (existsSync(join(directory, "pyproject.toml"))) {
    info.language = "python";
    info.packageManager = existsSync(join(directory, "poetry.lock"))
      ? "poetry"
      : "pip";
  } else if (existsSync(join(directory, "requirements.txt"))) {
    info.language = "python";
    info.packageManager = "pip";
  } else if (existsSync(join(directory, "Gemfile"))) {
    info.language = "ruby";
    info.packageManager = "bundler";
  }

  return info;
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
