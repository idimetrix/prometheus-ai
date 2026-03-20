import { appRouter } from "./routers";

/**
 * Describes a single OpenAPI path entry derived from a tRPC procedure.
 */
interface PathItem {
  operationId: string;
  parameters?: Array<{
    name: string;
    in: string;
    required: boolean;
    schema: { type: string };
  }>;
  requestBody?: {
    content: { "application/json": { schema: { type: string } } };
  };
  responses: Record<string, { description: string }>;
  security?: Record<string, string[]>[];
  summary: string;
  tags: string[];
}

/**
 * Procedure metadata extracted from the tRPC router tree.
 */
interface ProcedureMeta {
  path: string;
  procedure: string;
  router: string;
  type: "query" | "mutation" | "subscription";
}

/**
 * Walk the tRPC router definition and extract procedure metadata.
 *
 * tRPC routers expose their procedures via `_def.procedures` (flat map) or
 * `_def.record` (nested sub-routers). The actual shape depends on the tRPC
 * version — we handle both v10 and v11 layouts defensively.
 */
function extractProcedures(routerDef: unknown): ProcedureMeta[] {
  const procedures: ProcedureMeta[] = [];
  const def = (routerDef as { _def?: Record<string, unknown> })?._def;
  if (!def) {
    return procedures;
  }

  // v10: flat `procedures` map keyed by "router.procedure"
  const flatProcedures = def.procedures as
    | Record<string, { _def?: { type?: string } }>
    | undefined;

  if (flatProcedures && typeof flatProcedures === "object") {
    for (const [fullPath, proc] of Object.entries(flatProcedures)) {
      const parts = fullPath.split(".");
      const router = parts.slice(0, -1).join(".") || "root";
      const procedure = parts.at(-1) ?? fullPath;
      const type =
        (proc?._def?.type as ProcedureMeta["type"]) ?? inferType(procedure);
      procedures.push({ type, path: fullPath, router, procedure });
    }
    return procedures;
  }

  // v11 / alternative: nested `record` map
  const record = def.record as Record<string, unknown> | undefined;
  if (record && typeof record === "object") {
    for (const [routerName, sub] of Object.entries(record)) {
      const subDef = (sub as { _def?: Record<string, unknown> })?._def;
      const subRecord =
        (subDef?.procedures as Record<string, unknown>) ??
        (subDef?.record as Record<string, unknown>);

      if (subRecord && typeof subRecord === "object") {
        for (const [procName, proc] of Object.entries(subRecord)) {
          const type =
            ((proc as { _def?: { type?: string } })?._def
              ?.type as ProcedureMeta["type"]) ?? inferType(procName);
          procedures.push({
            type,
            path: `${routerName}.${procName}`,
            router: routerName,
            procedure: procName,
          });
        }
      }
    }
    return procedures;
  }

  return procedures;
}

/**
 * Best-effort heuristic to determine whether a procedure is a query or
 * mutation based on its name when the runtime type is unavailable.
 */
function inferType(name: string): ProcedureMeta["type"] {
  const mutationPrefixes = [
    "create",
    "update",
    "delete",
    "remove",
    "submit",
    "cancel",
    "revoke",
    "connect",
    "disconnect",
    "install",
    "uninstall",
    "configure",
    "enable",
    "disable",
    "pause",
    "resume",
    "stop",
    "send",
    "store",
    "change",
    "reactivate",
    "purchase",
    "set",
    "upsert",
    "add",
    "approve",
    "reject",
    "modify",
    "takeover",
    "release",
    "trigger",
    "select",
    "export",
    "request",
    "analyze",
    "scaffold",
    "suggest",
    "dispatch",
  ];
  const lower = name.toLowerCase();
  return mutationPrefixes.some((p) => lower.startsWith(p))
    ? "mutation"
    : "query";
}

const CAMEL_CASE_BOUNDARY = /([a-z])([A-Z])/g;
const FIRST_CHAR = /^./;

/** Human-readable label from a camelCase procedure name. */
function humanize(name: string): string {
  return name
    .replace(CAMEL_CASE_BOUNDARY, "$1 $2")
    .replace(FIRST_CHAR, (c) => c.toUpperCase());
}

/**
 * Router-level metadata used to populate OpenAPI tags.
 */
const ROUTER_DESCRIPTIONS: Record<string, string> = {
  health: "Health check endpoints",
  sessions: "Agent session management",
  tasks: "Task submission and tracking",
  projects: "Project CRUD and configuration",
  queue: "Queue position and statistics",
  billing: "Billing, subscriptions, and credits",
  stats: "Analytics and usage metrics",
  settings: "Organization and user settings",
  brain: "Knowledge graph and memory management",
  fleet: "Multi-agent fleet orchestration",
  user: "User profile and preferences",
  integrations: "Third-party integration management",
  apiKeys: "API key management",
  plugins: "Plugin lifecycle management",
  architecture: "Codebase architecture analysis",
  codeAnalysis: "Static code analysis tools",
  audit: "Audit logs and compliance",
  blueprintsEnhanced: "Blueprint analysis and scaffolding",
};

/**
 * Generate an OpenAPI 3.0 specification from the tRPC appRouter.
 *
 * Since tRPC does not natively expose OpenAPI metadata, this function
 * introspects the router tree and produces a best-effort spec that
 * documents every procedure as a REST-style endpoint under `/trpc/*`.
 */
export function generateOpenAPISpec(): object {
  const procedures = extractProcedures(appRouter);

  // If runtime introspection yielded nothing (e.g. the tRPC internals
  // changed), fall back to a statically-known procedure list derived from
  // the router source code.
  const procs = procedures.length > 0 ? procedures : getStaticProcedureList();

  const paths: Record<string, Record<string, PathItem>> = {};
  const tagSet = new Set<string>();

  for (const proc of procs) {
    const tag = proc.router;
    tagSet.add(tag);

    const httpMethod = proc.type === "mutation" ? "post" : "get";
    const pathKey = `/trpc/${proc.path}`;

    const pathItem: PathItem = {
      summary: humanize(proc.procedure),
      operationId: proc.path.replace(/\./g, "_"),
      tags: [tag],
      responses: {
        "200": { description: "Successful response" },
        "401": { description: "Unauthorized" },
        "403": { description: "Forbidden" },
        "500": { description: "Internal server error" },
      },
    };

    // All procedures except health.check require auth
    if (proc.path !== "health.check") {
      pathItem.security = [{ bearerAuth: [] }, { apiKeyAuth: [] }];
    }

    // Queries accept input as a JSON-encoded query parameter
    if (proc.type === "query") {
      pathItem.parameters = [
        {
          name: "input",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
      ];
    }

    // Mutations accept a JSON body
    if (proc.type === "mutation") {
      pathItem.requestBody = {
        content: {
          "application/json": {
            schema: { type: "object" },
          },
        },
      };
    }

    paths[pathKey] = { [httpMethod]: pathItem };
  }

  const tags = [...tagSet].sort().map((t) => ({
    name: t,
    description: ROUTER_DESCRIPTIONS[t] ?? humanize(t),
  }));

  return {
    openapi: "3.0.3",
    info: {
      title: "Prometheus API",
      description:
        "AI-powered engineering platform API. All endpoints are served via tRPC over HTTP. Queries use GET with a JSON-encoded `input` query parameter; mutations use POST with a JSON request body.",
      version: "0.1.0",
      contact: {
        name: "Prometheus Team",
      },
    },
    servers: [
      {
        url: process.env.API_URL ?? "http://localhost:4000",
        description:
          process.env.NODE_ENV === "production"
            ? "Production"
            : "Local development",
      },
    ],
    paths,
    tags,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Clerk JWT token",
        },
        apiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "Authorization",
          description: "API key with 'Bearer pm_...' format",
        },
      },
    },
  };
}

/**
 * Static fallback procedure list based on the router source code.
 * Used when runtime introspection of the tRPC router tree fails.
 */
function getStaticProcedureList(): ProcedureMeta[] {
  const spec: Record<string, [string, ProcedureMeta["type"]][]> = {
    health: [["check", "query"]],
    sessions: [
      ["create", "mutation"],
      ["get", "query"],
      ["list", "query"],
      ["pause", "mutation"],
      ["resume", "mutation"],
      ["cancel", "mutation"],
      ["sendMessage", "mutation"],
      ["timeline", "query"],
      ["approvePlan", "mutation"],
      ["rejectPlan", "mutation"],
      ["modifyPlan", "mutation"],
      ["takeover", "mutation"],
      ["approve", "mutation"],
      ["reject", "mutation"],
      ["release", "mutation"],
    ],
    tasks: [
      ["submit", "mutation"],
      ["get", "query"],
      ["list", "query"],
      ["updateStatus", "mutation"],
      ["cancel", "mutation"],
      ["estimateCost", "query"],
    ],
    projects: [
      ["create", "mutation"],
      ["get", "query"],
      ["list", "query"],
      ["update", "mutation"],
      ["delete", "mutation"],
      ["updateSettings", "mutation"],
      ["addMember", "mutation"],
      ["updateMember", "mutation"],
      ["removeMember", "mutation"],
      ["getBlueprint", "query"],
      ["listBlueprintVersions", "query"],
      ["triggerFileIndex", "mutation"],
      ["stats", "query"],
      ["listTechStackPresets", "query"],
      ["selectTechStackPreset", "mutation"],
      ["search", "query"],
    ],
    queue: [
      ["position", "query"],
      ["stats", "query"],
    ],
    billing: [
      ["getBalance", "query"],
      ["getPlan", "query"],
      ["getSubscription", "query"],
      ["createCheckout", "mutation"],
      ["changePlan", "mutation"],
      ["cancelSubscription", "mutation"],
      ["reactivateSubscription", "mutation"],
      ["createPortalSession", "mutation"],
      ["getCreditPacks", "query"],
      ["purchaseCredits", "mutation"],
      ["getTransactions", "query"],
      ["getUsage", "query"],
      ["createCheckoutSession", "mutation"],
      ["getCurrentPlan", "query"],
      ["getUsageHistory", "query"],
      ["getInvoices", "query"],
    ],
    stats: [
      ["overview", "query"],
      ["taskMetrics", "query"],
      ["creditConsumption", "query"],
      ["costBreakdown", "query"],
      ["agentPerformance", "query"],
      ["sessionStats", "query"],
      ["modelUsage", "query"],
      ["modelUsageBySlot", "query"],
      ["roi", "query"],
    ],
    settings: [
      ["getOrgSettings", "query"],
      ["updateOrgSettings", "mutation"],
      ["getUserSettings", "query"],
      ["updateUserSettings", "mutation"],
      ["getApiKeys", "query"],
      ["createApiKey", "mutation"],
      ["revokeApiKey", "mutation"],
      ["getModelConfigs", "query"],
      ["upsertModelConfig", "mutation"],
      ["removeModelConfig", "mutation"],
      ["setModelPriority", "mutation"],
      ["getModelPreferences", "query"],
      ["setModelPreference", "mutation"],
    ],
    brain: [
      ["search", "query"],
      ["getMemories", "query"],
      ["storeMemory", "mutation"],
      ["getEpisodicMemories", "query"],
      ["getProceduralMemories", "query"],
      ["getBlueprint", "query"],
      ["graph", "query"],
    ],
    fleet: [
      ["dispatch", "mutation"],
      ["status", "query"],
      ["pause", "mutation"],
      ["resume", "mutation"],
      ["stop", "mutation"],
    ],
    user: [
      ["profile", "query"],
      ["updateProfile", "mutation"],
      ["updateSettings", "mutation"],
      ["organizations", "query"],
    ],
    integrations: [
      ["list", "query"],
      ["available", "query"],
      ["connect", "mutation"],
      ["disconnect", "mutation"],
      ["testConnection", "mutation"],
      ["getToolConfigs", "query"],
      ["setToolConfig", "mutation"],
    ],
    apiKeys: [
      ["list", "query"],
      ["create", "mutation"],
      ["revoke", "mutation"],
    ],
    plugins: [
      ["list", "query"],
      ["install", "mutation"],
      ["uninstall", "mutation"],
      ["configure", "mutation"],
      ["enable", "mutation"],
      ["disable", "mutation"],
    ],
    architecture: [
      ["getGraph", "query"],
      ["getNodeDetail", "query"],
      ["getImpactAnalysis", "query"],
      ["getMetrics", "query"],
    ],
    codeAnalysis: [
      ["analyzeFile", "query"],
      ["detectDeadCode", "query"],
      ["measureTechDebt", "query"],
      ["suggestRefactoring", "mutation"],
      ["findPerformanceIssues", "query"],
    ],
    audit: [
      ["getAuditLog", "query"],
      ["exportUserData", "mutation"],
      ["requestDataDeletion", "mutation"],
      ["getComplianceReport", "query"],
    ],
    blueprintsEnhanced: [
      ["analyze", "mutation"],
      ["scaffold", "mutation"],
      ["getComponents", "query"],
      ["updateComponent", "mutation"],
    ],
  };

  const result: ProcedureMeta[] = [];
  for (const [router, procs] of Object.entries(spec)) {
    for (const [procedure, type] of procs) {
      result.push({
        type,
        path: `${router}.${procedure}`,
        router,
        procedure,
      });
    }
  }
  return result;
}
