import { basename, relative, resolve, sep } from "node:path";
import { createLogger } from "@prometheus/logger";

const logger = createLogger("sandbox-manager:security");

const ENV_VAR_PREFIX_RE = /^(\w+=\S+\s+)+/;
const COMMAND_SPLIT_RE = /\s+/;
const PIPE_SPLIT_RE = /[;|&]+/;
const SUBSHELL_OPEN_RE = /^\(+/;
const SUBSHELL_CLOSE_RE = /\)+$/;
const PARENT_DIR_RE = /^\.\./;
const GIT_CONFIG_RE = /\/\.git\/config$/;
const DOTENV_RE = /\/\.env$/;
const DOTENV_VARIANT_RE = /\/\.env\..+$/;

const COMMAND_ALLOWLIST = new Set([
  "node",
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "git",
  "python",
  "python3",
  "pip",
  "pip3",
  "docker",
  "ls",
  "cat",
  "head",
  "tail",
  "mkdir",
  "rm",
  "cp",
  "mv",
  "touch",
  "find",
  "grep",
  "awk",
  "sed",
  "wc",
  "sort",
  "uniq",
  "diff",
  "echo",
  "printf",
  "pwd",
  "cd",
  "env",
  "which",
  "whoami",
  "date",
  "curl",
  "wget",
  "tar",
  "gzip",
  "gunzip",
  "zip",
  "unzip",
  "tsc",
  "tsx",
  "esbuild",
  "vite",
  "vitest",
  "jest",
  "prettier",
  "eslint",
  "cargo",
  "rustc",
  "go",
  "make",
  "cmake",
  "sh",
  "bash",
  "test",
  "true",
  "false",
  "chmod",
  "chown",
  "xargs",
  "tr",
  "cut",
  "tee",
  "less",
  "more",
]);

const DANGEROUS_PATTERNS = [
  /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/\s*$/, // rm -rf /
  /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/\*\s*$/, // rm -rf /*
  /rm\s+-[a-zA-Z]*r[a-zA-Z]*\s+-[a-zA-Z]*f[a-zA-Z]*\s+\/(?:\s|$)/, // rm -r -f /
  /mkfs\./,
  /dd\s+.+of=\/dev\//,
  /shutdown/,
  /reboot/,
  /poweroff/,
  /init\s+[06]/,
  /halt/,
  /systemctl\s+(stop|disable|mask|halt|poweroff|reboot)/,
  /:(){ :\|:& };:/, // Fork bomb
  />\s*\/dev\/sd[a-z]/,
  />\s*\/proc\//,
  />\s*\/sys\//,
  /chmod\s+[0-7]*777\s+\//,
  /chown\s+-R\s+.*\s+\//,
  /iptables\s+-F/,
  /curl\s+.*\|\s*(sh|bash)/, // Piped curl to shell
  /wget\s+.*\|\s*(sh|bash)/, // Piped wget to shell
  /nc\s+-[a-zA-Z]*l/, // Netcat listener
  /python[3]?\s+-c\s+.*import\s+os.*system/, // python os.system
  /\beval\b.*\$\(/, // eval with command substitution
];

const ENVIRONMENT_BLOCKLIST = new Set([
  "DOCKER_HOST",
  "DOCKER_TLS_VERIFY",
  "KUBECONFIG",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "AZURE_CLIENT_SECRET",
  "DATABASE_URL",
  "REDIS_URL",
  "CLERK_SECRET_KEY",
  "STRIPE_SECRET_KEY",
  "ENCRYPTION_KEY",
]);

/**
 * Extract the base command from a shell command string.
 */
function extractBaseCommand(command: string): string {
  const trimmed = command.trim();
  // Skip environment variable assignments at the beginning
  const withoutEnvVars = trimmed.replace(ENV_VAR_PREFIX_RE, "");
  const parts = withoutEnvVars.split(COMMAND_SPLIT_RE);
  const base = parts[0] ?? "";
  // Handle paths like /usr/bin/node -> node
  return basename(base);
}

/**
 * Validate a command against security rules.
 * Returns { valid: true } or { valid: false, reason: string }.
 */
export function validateCommand(command: string): {
  valid: boolean;
  reason?: string;
} {
  if (!command || command.trim().length === 0) {
    return { valid: false, reason: "Empty command" };
  }

  // Check for dangerous patterns first
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      logger.warn({ command }, "Blocked dangerous command pattern");
      return {
        valid: false,
        reason: "Command matches a blocked dangerous pattern",
      };
    }
  }

  // For piped commands and compound commands, validate each segment
  const segments = command
    .split(PIPE_SPLIT_RE)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const segment of segments) {
    // Skip subshells and redirections-only parts
    const cleaned = segment
      .replace(SUBSHELL_OPEN_RE, "")
      .replace(SUBSHELL_CLOSE_RE, "")
      .trim();
    if (!cleaned) {
      continue;
    }

    const baseCmd = extractBaseCommand(cleaned);
    if (!baseCmd) {
      continue;
    }

    if (!COMMAND_ALLOWLIST.has(baseCmd)) {
      logger.warn(
        { command, baseCommand: baseCmd },
        "Blocked non-allowlisted command"
      );
      return {
        valid: false,
        reason: `Command '${baseCmd}' is not in the allowlist`,
      };
    }
  }

  return { valid: true };
}

/**
 * Validate a file path to prevent sandbox escape.
 * The file path must stay within the sandbox root directory.
 */
export function validateFilePath(
  sandboxRoot: string,
  filePath: string
): { valid: boolean; reason?: string } {
  // Resolve to absolute path relative to sandbox root
  const resolved = resolve(sandboxRoot, filePath);
  const normalizedRoot = resolve(sandboxRoot);

  if (
    !resolved.startsWith(normalizedRoot + sep) &&
    resolved !== normalizedRoot
  ) {
    logger.warn(
      { sandboxRoot, filePath, resolved },
      "Blocked path escape attempt"
    );
    return { valid: false, reason: "File path escapes sandbox root" };
  }

  // Block certain sensitive paths even within sandbox
  const relativePath = relative(normalizedRoot, resolved);
  const sensitivePatterns = [
    PARENT_DIR_RE,
    GIT_CONFIG_RE,
    DOTENV_RE,
    DOTENV_VARIANT_RE,
  ];

  for (const pattern of sensitivePatterns) {
    if (pattern.test(relativePath) || pattern.test(`/${relativePath}`)) {
      // Allow reading .env files but log a warning
      logger.warn({ filePath: relativePath }, "Accessing sensitive file path");
    }
  }

  return { valid: true };
}

/**
 * Sanitize environment variables by removing sensitive entries.
 */
export function sanitizeEnvironment(
  env: Record<string, string>
): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (!ENVIRONMENT_BLOCKLIST.has(key)) {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Check if a command timeout is within acceptable bounds.
 */
export function validateTimeout(timeout: number): {
  valid: boolean;
  timeout: number;
} {
  const MIN_TIMEOUT = 1000; // 1 second
  const MAX_TIMEOUT = 300_000; // 5 minutes
  const DEFAULT_TIMEOUT = 60_000; // 1 minute

  if (typeof timeout !== "number" || Number.isNaN(timeout)) {
    return { valid: true, timeout: DEFAULT_TIMEOUT };
  }

  if (timeout < MIN_TIMEOUT) {
    return { valid: true, timeout: MIN_TIMEOUT };
  }

  if (timeout > MAX_TIMEOUT) {
    return { valid: false, timeout: MAX_TIMEOUT };
  }

  return { valid: true, timeout };
}
