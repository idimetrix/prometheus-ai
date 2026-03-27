const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SPECIAL_CHARS_RE = /[\s"'#]/;
const DOUBLE_QUOTE_RE = /"/g;

/**
 * Sandbox Environment Variable Routes
 *
 * Hono routes for managing environment variables inside sandboxes.
 * Variables are written as a `.env` file in the sandbox working directory.
 *
 * Routes:
 *   POST   /sandboxes/:id/env        - Inject environment variables
 *   GET    /sandboxes/:id/env        - List environment variables (masked)
 *   DELETE /sandboxes/:id/env/:key   - Remove an environment variable
 */

import { createLogger } from "@prometheus/logger";
import { Hono } from "hono";
import type { ContainerManager } from "../container";

const logger = createLogger("sandbox:environment-route");

const ENV_FILE_PATH = ".env";

/**
 * Mask a value for display — shows first 2 and last 2 characters if long enough,
 * otherwise replaces entirely with asterisks.
 */
function maskValue(value: string): string {
  if (value.length <= 6) {
    return "*".repeat(value.length);
  }
  return `${value.slice(0, 2)}${"*".repeat(value.length - 4)}${value.slice(-2)}`;
}

/**
 * Parse a `.env` file content into a key-value map.
 * Supports `KEY=VALUE` and `KEY="VALUE"` formats.
 * Ignores comments (lines starting with #) and blank lines.
 */
function parseEnvFile(content: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
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
      vars.set(key, value);
    }
  }
  return vars;
}

/**
 * Serialize a key-value map to `.env` file content.
 */
function serializeEnvFile(vars: Map<string, string>): string {
  const lines: string[] = [
    "# Prometheus Sandbox Environment Variables",
    `# Auto-generated at ${new Date().toISOString()}`,
    "",
  ];

  for (const [key, value] of vars) {
    // Quote values that contain spaces, quotes, or special chars
    if (SPECIAL_CHARS_RE.test(value)) {
      const escaped = value.replace(DOUBLE_QUOTE_RE, '\\"');
      lines.push(`${key}="${escaped}"`);
    } else {
      lines.push(`${key}=${value}`);
    }
  }

  lines.push(""); // trailing newline
  return lines.join("\n");
}

/**
 * Validate an environment variable key.
 * Keys must be uppercase/lowercase alphanumeric with underscores.
 */
function isValidKey(key: string): boolean {
  return ENV_KEY_RE.test(key);
}

/**
 * Create Hono routes for managing sandbox environment variables.
 */
export function createEnvironmentRoutes(
  containerManager: ContainerManager
): Hono {
  const app = new Hono();

  /**
   * POST /sandboxes/:id/env
   *
   * Inject environment variables into a sandbox.
   * Merges with existing variables (overwrites duplicate keys).
   *
   * Body: { variables: Record<string, string> }
   */
  app.post("/sandboxes/:id/env", async (c) => {
    const sandboxId = c.req.param("id");

    try {
      const body = await c.req.json<{ variables: Record<string, string> }>();

      if (!body.variables || typeof body.variables !== "object") {
        return c.json({ error: "variables object is required" }, 400);
      }

      const entries = Object.entries(body.variables);
      if (entries.length === 0) {
        return c.json({ error: "At least one variable is required" }, 400);
      }

      // Validate keys
      for (const [key] of entries) {
        if (!isValidKey(key)) {
          return c.json(
            {
              error: `Invalid environment variable key: "${key}". Keys must match [a-zA-Z_][a-zA-Z0-9_]*`,
            },
            400
          );
        }
      }

      // Read existing env file (if any)
      let existingVars = new Map<string, string>();
      try {
        const existingContent = await containerManager.readFile(
          sandboxId,
          ENV_FILE_PATH
        );
        existingVars = parseEnvFile(existingContent);
      } catch {
        // File doesn't exist yet — that's fine
      }

      // Merge new variables
      for (const [key, value] of entries) {
        existingVars.set(key, value);
      }

      // Write back
      const content = serializeEnvFile(existingVars);
      await containerManager.writeFile(sandboxId, ENV_FILE_PATH, content);

      logger.info(
        {
          sandboxId,
          injectedCount: entries.length,
          totalCount: existingVars.size,
        },
        "Environment variables injected"
      );

      return c.json(
        {
          success: true,
          injected: entries.length,
          total: existingVars.size,
        },
        201
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { sandboxId, error: msg },
        "Failed to inject environment variables"
      );
      return c.json({ error: msg }, 500);
    }
  });

  /**
   * GET /sandboxes/:id/env
   *
   * List all environment variables in a sandbox.
   * Values are masked for security.
   */
  app.get("/sandboxes/:id/env", async (c) => {
    const sandboxId = c.req.param("id");

    try {
      let content: string;
      try {
        content = await containerManager.readFile(sandboxId, ENV_FILE_PATH);
      } catch {
        // No env file — return empty list
        return c.json({ variables: [], count: 0 });
      }

      const vars = parseEnvFile(content);
      const maskedVars = [...vars.entries()].map(([key, value]) => ({
        key,
        value: maskValue(value),
        length: value.length,
      }));

      return c.json({
        variables: maskedVars,
        count: maskedVars.length,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { sandboxId, error: msg },
        "Failed to list environment variables"
      );
      return c.json({ error: msg }, 500);
    }
  });

  /**
   * DELETE /sandboxes/:id/env/:key
   *
   * Remove a specific environment variable from a sandbox.
   */
  app.delete("/sandboxes/:id/env/:key", async (c) => {
    const sandboxId = c.req.param("id");
    const key = c.req.param("key");

    try {
      if (!isValidKey(key)) {
        return c.json({ error: `Invalid key: "${key}"` }, 400);
      }

      let content: string;
      try {
        content = await containerManager.readFile(sandboxId, ENV_FILE_PATH);
      } catch {
        return c.json(
          { error: `Environment variable "${key}" not found` },
          404
        );
      }

      const vars = parseEnvFile(content);

      if (!vars.has(key)) {
        return c.json(
          { error: `Environment variable "${key}" not found` },
          404
        );
      }

      vars.delete(key);

      const updatedContent = serializeEnvFile(vars);
      await containerManager.writeFile(
        sandboxId,
        ENV_FILE_PATH,
        updatedContent
      );

      logger.info(
        { sandboxId, key, remainingCount: vars.size },
        "Environment variable removed"
      );

      return c.json({
        success: true,
        key,
        remaining: vars.size,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { sandboxId, key, error: msg },
        "Failed to remove environment variable"
      );
      return c.json({ error: msg }, 500);
    }
  });

  return app;
}
