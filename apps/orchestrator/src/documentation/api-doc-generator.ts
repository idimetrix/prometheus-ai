import { createLogger } from "@prometheus/logger";

const logger = createLogger("api-doc-generator");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApiParameter {
  description: string;
  name: string;
  required: boolean;
  type: string;
}

export interface ApiResponse {
  description: string;
  example?: unknown;
  status: number;
}

export interface ApiEndpoint {
  description: string;
  method: string;
  parameters: ApiParameter[];
  path: string;
  requestBody?: { example: unknown; type: string };
  responses: ApiResponse[];
  summary: string;
  tags: string[];
}

export interface ApiDocResult {
  endpoints: ApiEndpoint[];
  markdown: string;
  openApiSpec: string;
}

// ---------------------------------------------------------------------------
// Top-level regex patterns
// ---------------------------------------------------------------------------

// Express-style: app.get("/path", handler) or router.post("/path", ...)
const EXPRESS_ROUTE_RE =
  /(?:app|router)\.(get|post|put|patch|delete|options|head)\s*\(\s*["'`]([^"'`]+)["'`]/g;

// Hono-style: app.get("/path", (c) => ...) or hono.post(...)
const HONO_ROUTE_RE =
  /(?:app|hono|api)\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/g;

// tRPC-style: .query(...) or .mutation(...) with procedure name from key
const TRPC_PROCEDURE_RE =
  /(\w+)\s*:\s*(?:publicProcedure|protectedProcedure|orgProcedure)\s*\.(?:input\s*\([\s\S]*?\)\s*\.)?(?:query|mutation)\s*\(/g;

// Next.js App Router: export async function GET/POST/PUT/DELETE/PATCH
const NEXTJS_ROUTE_RE =
  /export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH)\s*\(/g;

// Zod schema for input parsing
const ZOD_SCHEMA_RE = /z\.object\s*\(\s*\{([\s\S]*?)\}\s*\)/;

// JSDoc comment blocks above functions
const JSDOC_RE = /\/\*\*\s*([\s\S]*?)\s*\*\//g;

// Path parameters like :id or [id]
const PATH_PARAM_RE = /:(\w+)|\[(\w+)\]/g;
const FILE_EXTENSION_RE = /\.(ts|js|tsx|jsx)$/;
const JSDOC_STAR_RE = /^\s*\*\s?/;
const NEXTJS_PATH_RE = /app(.+?)\/route\.(ts|js)$/;

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function extractPathParams(path: string): ApiParameter[] {
  const params: ApiParameter[] = [];
  let paramMatch = PATH_PARAM_RE.exec(path);
  while (paramMatch !== null) {
    const name = paramMatch[1] ?? paramMatch[2] ?? "";
    if (name) {
      params.push({
        name,
        type: "string",
        required: true,
        description: `Path parameter: ${name}`,
      });
    }
    paramMatch = PATH_PARAM_RE.exec(path);
  }
  return params;
}

function extractZodFields(zodBody: string): ApiParameter[] {
  const params: ApiParameter[] = [];
  const fieldRe = /(\w+)\s*:\s*z\.(\w+)\(\)/g;
  let fieldMatch = fieldRe.exec(zodBody);
  while (fieldMatch !== null) {
    const name = fieldMatch[1] ?? "";
    const zodType = fieldMatch[2] ?? "unknown";

    const typeMap: Record<string, string> = {
      string: "string",
      number: "number",
      boolean: "boolean",
      array: "array",
      object: "object",
      date: "string (ISO date)",
      enum: "string (enum)",
    };

    if (name) {
      params.push({
        name,
        type: typeMap[zodType] ?? zodType,
        required: !zodBody.includes(`${name}:`),
        description: `Field: ${name}`,
      });
    }
    fieldMatch = fieldRe.exec(zodBody);
  }
  return params;
}

function inferTag(filePath: string): string {
  const parts = filePath.split("/");
  // Look for meaningful directory names
  for (const part of parts.reverse()) {
    if (part !== "index.ts" && part !== "route.ts" && !part.startsWith(".")) {
      return part.replace(FILE_EXTENSION_RE, "");
    }
  }
  return "default";
}

function extractJsDoc(
  content: string,
  position: number
): { summary: string; description: string } | null {
  // Look for JSDoc comment ending near the position
  let lastDoc: { summary: string; description: string } | null = null;

  let docMatch = JSDOC_RE.exec(content);
  while (docMatch !== null) {
    const docEnd = docMatch.index + docMatch[0].length;
    // JSDoc should be within 200 chars before the route definition
    if (docEnd <= position && position - docEnd < 200) {
      const body = docMatch[1] ?? "";
      const lines = body
        .split("\n")
        .map((l) => l.replace(JSDOC_STAR_RE, "").trim())
        .filter(Boolean);

      lastDoc = {
        summary: lines[0] ?? "",
        description: lines.join(" "),
      };
    }
    docMatch = JSDOC_RE.exec(content);
  }

  return lastDoc;
}

// ---------------------------------------------------------------------------
// Route extraction per framework
// ---------------------------------------------------------------------------

function extractExpressRoutes(
  filePath: string,
  content: string
): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = [];
  let routeMatch = EXPRESS_ROUTE_RE.exec(content);

  while (routeMatch !== null) {
    const method = (routeMatch[1] ?? "get").toUpperCase();
    const path = routeMatch[2] ?? "/";
    const doc = extractJsDoc(content, routeMatch.index);
    const pathParams = extractPathParams(path);

    endpoints.push({
      method,
      path,
      summary: doc?.summary ?? `${method} ${path}`,
      description: doc?.description ?? "",
      parameters: pathParams,
      responses: [
        { status: 200, description: "Success" },
        { status: 500, description: "Internal server error" },
      ],
      tags: [inferTag(filePath)],
    });

    routeMatch = EXPRESS_ROUTE_RE.exec(content);
  }

  return endpoints;
}

function extractHonoRoutes(filePath: string, content: string): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = [];
  let routeMatch = HONO_ROUTE_RE.exec(content);

  while (routeMatch !== null) {
    const method = (routeMatch[1] ?? "get").toUpperCase();
    const path = routeMatch[2] ?? "/";
    const doc = extractJsDoc(content, routeMatch.index);
    const pathParams = extractPathParams(path);

    endpoints.push({
      method,
      path,
      summary: doc?.summary ?? `${method} ${path}`,
      description: doc?.description ?? "",
      parameters: pathParams,
      responses: [
        { status: 200, description: "Success" },
        { status: 500, description: "Internal server error" },
      ],
      tags: [inferTag(filePath)],
    });

    routeMatch = HONO_ROUTE_RE.exec(content);
  }

  return endpoints;
}

function extractTrpcRoutes(filePath: string, content: string): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = [];
  let procMatch = TRPC_PROCEDURE_RE.exec(content);

  while (procMatch !== null) {
    const name = procMatch[1] ?? "unknown";
    const doc = extractJsDoc(content, procMatch.index);

    // Try to extract Zod input schema
    const afterProc = content.slice(procMatch.index, procMatch.index + 500);
    const zodMatch = ZOD_SCHEMA_RE.exec(afterProc);
    const inputParams = zodMatch?.[1] ? extractZodFields(zodMatch[1]) : [];

    const isMutation = afterProc.includes(".mutation(");
    const method = isMutation ? "POST" : "GET";

    endpoints.push({
      method,
      path: `/trpc/${inferTag(filePath)}.${name}`,
      summary:
        doc?.summary ?? `tRPC ${isMutation ? "mutation" : "query"}: ${name}`,
      description: doc?.description ?? "",
      parameters: inputParams,
      requestBody:
        isMutation && inputParams.length > 0
          ? { type: "object", example: {} }
          : undefined,
      responses: [
        { status: 200, description: "Success" },
        { status: 400, description: "Validation error" },
        { status: 401, description: "Unauthorized" },
      ],
      tags: [inferTag(filePath)],
    });

    procMatch = TRPC_PROCEDURE_RE.exec(content);
  }

  return endpoints;
}

function extractNextjsRoutes(filePath: string, content: string): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = [];
  let routeMatch = NEXTJS_ROUTE_RE.exec(content);

  while (routeMatch !== null) {
    const method = routeMatch[1] ?? "GET";
    // Derive path from file path (e.g., app/api/users/route.ts -> /api/users)
    const pathMatch = filePath.match(NEXTJS_PATH_RE);
    const path = pathMatch?.[1] ?? "/";
    const doc = extractJsDoc(content, routeMatch.index);
    const pathParams = extractPathParams(path);

    endpoints.push({
      method,
      path,
      summary: doc?.summary ?? `${method} ${path}`,
      description: doc?.description ?? "",
      parameters: pathParams,
      responses: [
        { status: 200, description: "Success" },
        { status: 500, description: "Internal server error" },
      ],
      tags: [inferTag(filePath)],
    });

    routeMatch = NEXTJS_ROUTE_RE.exec(content);
  }

  return endpoints;
}

// ---------------------------------------------------------------------------
// OpenAPI generation
// ---------------------------------------------------------------------------

function generateOpenApiSpec(endpoints: ApiEndpoint[]): string {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const ep of endpoints) {
    if (!paths[ep.path]) {
      paths[ep.path] = {};
    }

    const method = ep.method.toLowerCase();
    const operation: Record<string, unknown> = {
      summary: ep.summary,
      description: ep.description,
      tags: ep.tags,
      responses: {} as Record<string, unknown>,
    };

    if (ep.parameters.length > 0) {
      operation.parameters = ep.parameters.map((p) => ({
        name: p.name,
        in: "path",
        required: p.required,
        schema: { type: p.type },
        description: p.description,
      }));
    }

    if (ep.requestBody) {
      operation.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: { type: ep.requestBody.type },
          },
        },
      };
    }

    const responses: Record<string, unknown> = {};
    for (const resp of ep.responses) {
      responses[String(resp.status)] = {
        description: resp.description,
      };
    }
    operation.responses = responses;

    (paths[ep.path] as Record<string, unknown>)[method] = operation;
  }

  const spec = {
    openapi: "3.0.3",
    info: {
      title: "API Documentation",
      version: "1.0.0",
      description: "Auto-generated API documentation",
    },
    paths,
  };

  // Simple YAML-like output (JSON for now — can be converted to YAML with a library)
  return JSON.stringify(spec, null, 2);
}

// ---------------------------------------------------------------------------
// Markdown generation
// ---------------------------------------------------------------------------

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: complex analysis logic requires deep nesting
function generateMarkdown(endpoints: ApiEndpoint[]): string {
  const lines: string[] = ["# API Documentation\n"];

  // Group by tag
  const byTag = new Map<string, ApiEndpoint[]>();
  for (const ep of endpoints) {
    const tag = ep.tags[0] ?? "default";
    if (!byTag.has(tag)) {
      byTag.set(tag, []);
    }
    byTag.get(tag)?.push(ep);
  }

  for (const [tag, eps] of byTag) {
    lines.push(`## ${tag}\n`);

    for (const ep of eps) {
      lines.push(`### \`${ep.method} ${ep.path}\`\n`);
      lines.push(`${ep.summary}\n`);

      if (ep.description) {
        lines.push(`${ep.description}\n`);
      }

      if (ep.parameters.length > 0) {
        lines.push("**Parameters:**\n");
        lines.push("| Name | Type | Required | Description |");
        lines.push("|------|------|----------|-------------|");
        for (const p of ep.parameters) {
          lines.push(
            `| ${p.name} | ${p.type} | ${p.required ? "Yes" : "No"} | ${p.description} |`
          );
        }
        lines.push("");
      }

      lines.push("**Responses:**\n");
      for (const r of ep.responses) {
        lines.push(`- \`${r.status}\`: ${r.description}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main generator class
// ---------------------------------------------------------------------------

export class ApiDocGenerator {
  /**
   * Generate API documentation from project source files.
   *
   * Scans files for route definitions across multiple frameworks
   * (Express, Hono, tRPC, Next.js App Router) and produces OpenAPI
   * spec and human-readable markdown.
   *
   * @param projectId - The project being documented
   * @param files - Map of file path -> content
   */
  generate(
    projectId: string,
    files: Map<string, string> = new Map()
  ): ApiDocResult {
    logger.info(
      { projectId, fileCount: files.size },
      "Starting API documentation generation"
    );

    const allEndpoints: ApiEndpoint[] = [];

    for (const [filePath, content] of files) {
      allEndpoints.push(...extractExpressRoutes(filePath, content));
      allEndpoints.push(...extractHonoRoutes(filePath, content));
      allEndpoints.push(...extractTrpcRoutes(filePath, content));
      allEndpoints.push(...extractNextjsRoutes(filePath, content));
    }

    // Deduplicate by method + path
    const seen = new Set<string>();
    const endpoints: ApiEndpoint[] = [];
    for (const ep of allEndpoints) {
      const key = `${ep.method}:${ep.path}`;
      if (!seen.has(key)) {
        seen.add(key);
        endpoints.push(ep);
      }
    }

    // Sort by path then method
    endpoints.sort((a, b) => {
      const pathCmp = a.path.localeCompare(b.path);
      return pathCmp === 0 ? a.method.localeCompare(b.method) : pathCmp;
    });

    const openApiSpec = generateOpenApiSpec(endpoints);
    const markdown = generateMarkdown(endpoints);

    logger.info(
      { projectId, endpointCount: endpoints.length },
      "API documentation generation complete"
    );

    return { endpoints, openApiSpec, markdown };
  }
}
