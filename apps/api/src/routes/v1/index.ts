import type { AuthContext } from "@prometheus/auth";
import type { ApiKeyScope, Database } from "@prometheus/db";
import { db } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { apiKeysV1 } from "./api-keys";
import { chatV1 } from "./chat";
import { completionsV1 } from "./completions";
import inlineCompletions from "./completions/inline";
import { integrationsV1 } from "./integrations";
import { openapiApp } from "./openapi";
import { projectsV1 } from "./projects";
import { sessionsV1 } from "./sessions";
import { tasksV1 } from "./tasks";
import { zapierV1 } from "./zapier";

const logger = createLogger("api:v1");

interface V1Env {
  Variables: {
    apiKeyAuth: AuthContext;
    apiKeyId: string;
    apiKeyScopes: ApiKeyScope[];
    db: Database;
    orgId: string;
    planTier: string;
    userId: string;
  };
}

const v1App = new Hono<V1Env>();

// ── Permissive CORS for API access ──────────────────────────────────────────
v1App.use(
  "/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
    exposeHeaders: [
      "X-Request-Id",
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
      "X-RateLimit-Reset",
    ],
    maxAge: 600,
  })
);

// ── OpenAPI docs (no auth required) ─────────────────────────────────────────
v1App.route("/", openapiApp);

// ── API key auth enforcement for all other v1 routes ────────────────────────
v1App.use("/*", async (c, next) => {
  // Skip auth for OpenAPI spec and docs
  const path = c.req.path;
  if (path.endsWith("/openapi.json") || path.endsWith("/docs")) {
    await next();
    return;
  }

  const apiKeyAuth = c.get("apiKeyAuth") as AuthContext | undefined;
  const apiKeyId = c.get("apiKeyId") as string | undefined;

  if (!(apiKeyAuth && apiKeyId)) {
    return c.json(
      {
        error: "Unauthorized",
        message:
          "API key required. Use Authorization: Bearer pk_live_... header.",
      },
      401
    );
  }

  // Inject db into context for route handlers
  c.set("db", db);
  c.set("orgId", apiKeyAuth.orgId ?? apiKeyAuth.userId);
  c.set("userId", apiKeyAuth.userId);

  await next();
});

// ── Scope enforcement middleware factory ─────────────────────────────────────
function requireScope(scope: string): MiddlewareHandler<V1Env> {
  return async (c, next) => {
    const scopes = (c.get("apiKeyScopes") as ApiKeyScope[] | undefined) ?? [];

    // Empty scopes = full access (legacy keys)
    if (scopes.length === 0) {
      await next();
      return;
    }

    // Check direct match or wildcard
    const [resource] = scope.split(":");
    if (
      scopes.includes(scope as ApiKeyScope) ||
      scopes.includes(`${resource}:*` as ApiKeyScope) ||
      scopes.includes("*" as ApiKeyScope)
    ) {
      await next();
      return;
    }

    // Write implies read
    if (scope.endsWith(":read") && resource) {
      const writeScope = `${resource}:write` as ApiKeyScope;
      if (scopes.includes(writeScope)) {
        await next();
        return;
      }
    }

    logger.warn({ scope, scopes }, "API key missing required scope");
    return c.json(
      {
        error: "Forbidden",
        message: `API key missing required scope: ${scope}`,
      },
      403
    );
  };
}

// ── Apply scope middleware per resource path ─────────────────────────────────
v1App.use("/tasks/*", requireScope("tasks:read"));
v1App.use("/tasks", requireScope("tasks:read"));
v1App.use("/sessions/*", requireScope("sessions:read"));
v1App.use("/sessions", requireScope("sessions:read"));
v1App.use("/projects/*", requireScope("projects:read"));
v1App.use("/projects", requireScope("projects:read"));
v1App.use("/api-keys/*", requireScope("settings:read"));
v1App.use("/api-keys", requireScope("settings:read"));
v1App.use("/chat/*", requireScope("sessions:read"));
v1App.use("/chat", requireScope("sessions:read"));
v1App.use("/completions/*", requireScope("sessions:read"));
v1App.use("/completions", requireScope("sessions:read"));
v1App.use("/integrations/*", requireScope("projects:read"));
v1App.use("/integrations", requireScope("projects:read"));
v1App.use("/zapier/*", requireScope("sessions:read"));
v1App.use("/zapier", requireScope("sessions:read"));

// ── Mount sub-routers ───────────────────────────────────────────────────────
v1App.route("/tasks", tasksV1);
v1App.route("/sessions", sessionsV1);
v1App.route("/projects", projectsV1);
v1App.route("/api-keys", apiKeysV1);
v1App.route("/chat", chatV1);
v1App.route("/completions", completionsV1);
v1App.route("/completions/inline", inlineCompletions);
v1App.route("/integrations", integrationsV1);
v1App.route("/zapier", zapierV1);

export { v1App };
