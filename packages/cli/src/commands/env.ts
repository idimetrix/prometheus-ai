import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import { APIClient } from "../api-client";
import { resolveConfig } from "../config";

interface EnvVar {
  environment: string;
  key: string;
  updatedAt: string;
  value: string;
}

function displayEnvVars(vars: EnvVar[]): void {
  if (vars.length === 0) {
    console.log("No environment variables configured.");
    return;
  }

  console.log("Environment Variables:\n");
  const maxKeyLen = Math.max(...vars.map((v) => v.key.length), 3);
  for (const v of vars) {
    const masked = `${v.value.slice(0, 4)}${"*".repeat(Math.max(0, v.value.length - 4))}`;
    console.log(`  ${v.key.padEnd(maxKeyLen)}  ${masked}  [${v.environment}]`);
  }
  console.log(`\n${vars.length} variable(s) total`);
}

function parseEnvFile(filePath: string): Array<{ key: string; value: string }> {
  const absolutePath = resolve(filePath);
  const content = readFileSync(absolutePath, "utf-8");
  const pairs: Array<{ key: string; value: string }> = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) {
      continue;
    }
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) {
      pairs.push({ key, value });
    }
  }
  return pairs;
}

interface EnvListOpts {
  apiKey?: string;
  apiUrl?: string;
  project?: string;
}

interface EnvSetOpts {
  apiKey?: string;
  apiUrl?: string;
  environment: string;
  project?: string;
}

interface EnvDeleteOpts {
  apiKey?: string;
  apiUrl?: string;
  project?: string;
}

interface EnvImportOpts {
  apiKey?: string;
  apiUrl?: string;
  environment: string;
  project?: string;
}

function requireProjectId(config: { projectId?: string }): string {
  if (!config.projectId) {
    console.error(
      "Error: Project ID required. Use --project or set PROMETHEUS_PROJECT_ID"
    );
    process.exit(1);
  }
  return config.projectId;
}

export const envCommand = new Command("env").description(
  "Manage project environment variables"
);

envCommand
  .command("list")
  .description("List environment variables for a project")
  .option("-p, --project <id>", "Project ID")
  .option("--api-url <url>", "Prometheus API URL")
  .option("--api-key <key>", "Prometheus API key")
  .action(async (opts: EnvListOpts) => {
    const config = resolveConfig({
      apiUrl: opts.apiUrl,
      apiKey: opts.apiKey,
      project: opts.project,
    });
    const client = new APIClient(config);
    const projectId = requireProjectId(config);

    try {
      const vars = await client.listEnvVars(projectId);
      displayEnvVars(vars);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
  });

envCommand
  .command("set <keyValue>")
  .description("Set an environment variable (KEY=VALUE)")
  .option("-p, --project <id>", "Project ID")
  .option(
    "-e, --environment <env>",
    "Target environment (development|staging|production)",
    "development"
  )
  .option("--api-url <url>", "Prometheus API URL")
  .option("--api-key <key>", "Prometheus API key")
  .action(async (keyValue: string, opts: EnvSetOpts) => {
    const config = resolveConfig({
      apiUrl: opts.apiUrl,
      apiKey: opts.apiKey,
      project: opts.project,
    });
    const client = new APIClient(config);
    const projectId = requireProjectId(config);

    const eqIdx = keyValue.indexOf("=");
    if (eqIdx === -1) {
      console.error(
        'Error: Expected format KEY=VALUE (e.g., API_KEY="secret")'
      );
      process.exit(1);
    }

    const key = keyValue.slice(0, eqIdx);
    const value = keyValue.slice(eqIdx + 1);

    try {
      await client.setEnvVar(projectId, key, value, opts.environment);
      console.log(`Set ${key} for ${opts.environment}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
  });

envCommand
  .command("delete <key>")
  .description("Delete an environment variable")
  .option("-p, --project <id>", "Project ID")
  .option("--api-url <url>", "Prometheus API URL")
  .option("--api-key <key>", "Prometheus API key")
  .action(async (key: string, opts: EnvDeleteOpts) => {
    const config = resolveConfig({
      apiUrl: opts.apiUrl,
      apiKey: opts.apiKey,
      project: opts.project,
    });
    const client = new APIClient(config);
    const projectId = requireProjectId(config);

    try {
      await client.deleteEnvVar(projectId, key);
      console.log(`Deleted ${key}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
  });

envCommand
  .command("import <file>")
  .description("Import environment variables from a .env file")
  .option("-p, --project <id>", "Project ID")
  .option(
    "-e, --environment <env>",
    "Target environment (development|staging|production)",
    "development"
  )
  .option("--api-url <url>", "Prometheus API URL")
  .option("--api-key <key>", "Prometheus API key")
  .action(async (file: string, opts: EnvImportOpts) => {
    const config = resolveConfig({
      apiUrl: opts.apiUrl,
      apiKey: opts.apiKey,
      project: opts.project,
    });
    const client = new APIClient(config);
    const projectId = requireProjectId(config);

    try {
      const pairs = parseEnvFile(file);
      if (pairs.length === 0) {
        console.log("No variables found in file.");
        return;
      }

      console.log(
        `Importing ${pairs.length} variable(s) to ${opts.environment}...\n`
      );

      let successCount = 0;
      for (const pair of pairs) {
        try {
          await client.setEnvVar(
            projectId,
            pair.key,
            pair.value,
            opts.environment
          );
          console.log(`  Set ${pair.key}`);
          successCount++;
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error(`  Failed to set ${pair.key}: ${msg}`);
        }
      }

      console.log(`\nImported ${successCount}/${pairs.length} variable(s)`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
  });
