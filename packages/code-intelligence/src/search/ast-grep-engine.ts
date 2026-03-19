/**
 * ast-grep pattern search and replace engine.
 *
 * Provides a wrapper around ast-grep for structural code search
 * and transformation using AST patterns rather than text regex.
 */

import { spawn } from "node:child_process";
import { createLogger } from "@prometheus/logger";

function spawnWithInput(
  cmd: string,
  args: string[],
  input: string,
  timeout = 30_000
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { timeout });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr || `Process exited with code ${code}`));
      }
    });
    proc.stdin.write(input);
    proc.stdin.end();
  });
}
const logger = createLogger("code-intelligence:ast-grep");

/**
 * A single match from an ast-grep search.
 */
export interface AstGrepMatch {
  /** End column (0-indexed) */
  endColumn: number;
  /** End line (0-indexed) */
  endLine: number;
  /** The file path where the match was found (if searching files) */
  file?: string;
  /** Named captures from metavariables (e.g., $NAME, $ARGS) */
  metaVariables: Record<string, string>;
  /** Start column (0-indexed) */
  startColumn: number;
  /** Start line (0-indexed) */
  startLine: number;
  /** The matched source text */
  text: string;
}

/**
 * Raw JSON output shape from ast-grep CLI.
 */
interface AstGrepJsonMatch {
  file?: string;
  metaVariables?: Record<string, { text: string }>;
  range: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  text: string;
}

/**
 * Supported ast-grep language identifiers.
 */
export type AstGrepLanguage =
  | "typescript"
  | "tsx"
  | "javascript"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "c"
  | "cpp"
  | "ruby"
  | "kotlin"
  | "swift"
  | "css"
  | "html";

/**
 * Check if ast-grep (sg) binary is available on the system.
 */
async function ensureAstGrepAvailable(): Promise<void> {
  try {
    await spawnWithInput("sg", ["--version"], "");
  } catch {
    throw new Error(
      "ast-grep CLI (sg) is not installed or not in PATH. " +
        "Install it with: npm install -g @ast-grep/cli"
    );
  }
}

/**
 * Parse raw ast-grep JSON output into typed matches.
 */
function parseAstGrepOutput(stdout: string): AstGrepMatch[] {
  if (!stdout.trim()) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    logger.warn("Failed to parse ast-grep JSON output");
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.map((match: unknown): AstGrepMatch => {
    const m = match as AstGrepJsonMatch;
    const metaVariables: Record<string, string> = {};

    if (m.metaVariables) {
      for (const [key, value] of Object.entries(m.metaVariables)) {
        if (value && typeof value === "object" && "text" in value) {
          metaVariables[key] = value.text;
        }
      }
    }

    return {
      text: m.text,
      startLine: m.range.start.line,
      endLine: m.range.end.line,
      startColumn: m.range.start.column,
      endColumn: m.range.end.column,
      file: m.file,
      metaVariables,
    };
  });
}

/**
 * Search for AST patterns in source code using ast-grep.
 *
 * Uses structural pattern matching rather than text regex, so patterns
 * match based on the AST structure. Supports metavariables like `$NAME`
 * to capture parts of the match.
 *
 * @param pattern - ast-grep pattern (e.g., "console.log($MSG)")
 * @param language - The language to parse the code as
 * @param code - The source code string to search
 * @returns Array of matches found in the code
 *
 * @example
 * ```ts
 * const matches = await astGrepSearch(
 *   "console.log($MSG)",
 *   "typescript",
 *   'console.log("hello"); console.log(42);'
 * );
 * // matches[0].metaVariables.$MSG === '"hello"'
 * ```
 */
export async function astGrepSearch(
  pattern: string,
  language: AstGrepLanguage,
  code: string
): Promise<AstGrepMatch[]> {
  await ensureAstGrepAvailable();

  try {
    const { stdout } = await spawnWithInput(
      "sg",
      ["--pattern", pattern, "--lang", language, "--json", "--stdin"],
      code
    );

    const matches = parseAstGrepOutput(stdout);

    logger.debug(
      { pattern, language, matchCount: matches.length },
      `ast-grep search found ${matches.length} matches`
    );

    return matches;
  } catch (error: unknown) {
    if (isExecError(error) && error.stdout) {
      // ast-grep returns non-zero exit code when no matches found
      // but may still produce valid output
      return parseAstGrepOutput(error.stdout);
    }

    const message =
      error instanceof Error ? error.message : "Unknown ast-grep error";
    logger.error(
      { pattern, language, error },
      `ast-grep search failed: ${message}`
    );
    throw new Error(`ast-grep search failed: ${message}`);
  }
}

/**
 * Replace AST patterns in source code using ast-grep.
 *
 * Performs structural find-and-replace using AST pattern matching.
 * Metavariables captured in the pattern can be referenced in the replacement.
 *
 * @param pattern - ast-grep pattern to find (e.g., "console.log($MSG)")
 * @param replacement - Replacement pattern (e.g., "logger.info($MSG)")
 * @param language - The language to parse the code as
 * @param code - The source code string to transform
 * @returns The transformed source code
 *
 * @example
 * ```ts
 * const result = await astGrepReplace(
 *   "console.log($MSG)",
 *   "logger.info($MSG)",
 *   "typescript",
 *   'console.log("hello");'
 * );
 * // result === 'logger.info("hello");'
 * ```
 */
export async function astGrepReplace(
  pattern: string,
  replacement: string,
  language: AstGrepLanguage,
  code: string
): Promise<string> {
  await ensureAstGrepAvailable();

  try {
    const { stdout } = await spawnWithInput(
      "sg",
      [
        "--pattern",
        pattern,
        "--rewrite",
        replacement,
        "--lang",
        language,
        "--stdin",
      ],
      code
    );

    logger.debug(
      { pattern, replacement, language },
      "ast-grep replace completed"
    );

    return stdout;
  } catch (error: unknown) {
    if (isExecError(error) && error.stdout) {
      // If no matches, ast-grep returns the original code
      return error.stdout;
    }

    const message =
      error instanceof Error ? error.message : "Unknown ast-grep error";
    logger.error(
      { pattern, replacement, language, error },
      `ast-grep replace failed: ${message}`
    );
    throw new Error(`ast-grep replace failed: ${message}`);
  }
}

/**
 * Type guard for exec errors that may contain stdout/stderr.
 */
function isExecError(
  error: unknown
): error is Error & { stdout: string; stderr: string } {
  return (
    error instanceof Error &&
    "stdout" in error &&
    typeof (error as Record<string, unknown>).stdout === "string"
  );
}
