import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface CLIConfig {
  apiKey: string;
  apiUrl: string;
  projectId?: string;
}

interface ConfigFile {
  apiKey?: string;
  apiUrl?: string;
  defaultProjectId?: string;
}

const CONFIG_DIR = join(homedir(), ".prometheus");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const DEFAULT_API_URL = "http://localhost:4000";

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function readConfigFile(): ConfigFile {
  if (!existsSync(CONFIG_PATH)) {
    return {};
  }
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as ConfigFile;
  } catch {
    return {};
  }
}

/**
 * Save configuration values to ~/.prometheus/config.json.
 * Merges with existing config.
 */
export function saveConfig(updates: Partial<ConfigFile>): void {
  ensureConfigDir();
  const existing = readConfigFile();
  const merged = { ...existing, ...updates };
  writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
}

/**
 * Resolve CLI configuration from environment, config file, and flags.
 * Priority: flags > env vars > config file > defaults
 */
export function resolveConfig(flags?: {
  apiKey?: string;
  apiUrl?: string;
  project?: string;
}): CLIConfig {
  const file = readConfigFile();

  const apiUrl =
    flags?.apiUrl ??
    process.env.PROMETHEUS_API_URL ??
    file.apiUrl ??
    DEFAULT_API_URL;

  const apiKey =
    flags?.apiKey ?? process.env.PROMETHEUS_API_KEY ?? file.apiKey ?? "";

  const projectId =
    flags?.project ??
    process.env.PROMETHEUS_PROJECT_ID ??
    file.defaultProjectId;

  return { apiUrl, apiKey, projectId };
}

/**
 * Read the local .prometheus/config.yml project config if it exists.
 */
export function readProjectConfig(
  directory: string
): Record<string, unknown> | null {
  const ymlPath = join(directory, ".prometheus", "config.yml");
  const jsonPath = join(directory, ".prometheus", "config.json");

  for (const configPath of [jsonPath, ymlPath]) {
    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, "utf-8");
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // Skip unreadable config files
      }
    }
  }
  return null;
}

export type { CLIConfig, ConfigFile };
export { CONFIG_DIR, CONFIG_PATH, DEFAULT_API_URL };
