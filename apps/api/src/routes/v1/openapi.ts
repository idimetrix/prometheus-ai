import { Hono } from "hono";

/**
 * OpenAPI 3.1 specification for the Prometheus REST API v1.
 */
function buildOpenAPISpec(): object {
  const serverUrl = process.env.API_URL ?? "http://localhost:4000";

  return {
    openapi: "3.1.0",
    info: {
      title: "Prometheus REST API",
      description:
        "Public REST API for headless/automation use of the Prometheus AI engineering platform. Authenticate using API keys with the format `Authorization: Bearer pk_live_...`.",
      version: "1.0.0",
      contact: { name: "Prometheus Team" },
    },
    servers: [
      {
        url: serverUrl,
        description:
          process.env.NODE_ENV === "production"
            ? "Production"
            : "Local development",
      },
    ],
    security: [{ apiKeyAuth: [] }],
    tags: [
      { name: "Tasks", description: "Create, monitor, and manage agent tasks" },
      { name: "Sessions", description: "Manage interactive agent sessions" },
      { name: "Projects", description: "Project CRUD and import" },
      { name: "API Keys", description: "API key lifecycle management" },
    ],
    paths: {
      // ── Tasks ─────────────────────────────────────────────────────────
      "/api/v1/tasks": {
        post: {
          tags: ["Tasks"],
          summary: "Create and enqueue a task",
          operationId: "createTask",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateTaskRequest" },
                example: {
                  projectId: "proj_abc123",
                  description: "Add dark mode toggle to the settings page",
                  mode: "task",
                  priority: 50,
                  waitForCompletion: false,
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Task created",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/TaskCreated" },
                  example: {
                    id: "task_xyz789",
                    sessionId: "ses_abc123",
                    status: "pending",
                    createdAt: "2026-03-26T12:00:00.000Z",
                  },
                },
              },
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
            "429": { $ref: "#/components/responses/RateLimited" },
          },
        },
        get: {
          tags: ["Tasks"],
          summary: "List tasks",
          operationId: "listTasks",
          parameters: [
            { name: "projectId", in: "query", schema: { type: "string" } },
            { name: "status", in: "query", schema: { type: "string" } },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 50, maximum: 100 },
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", default: 0 },
            },
          ],
          responses: {
            "200": {
              description: "Task list",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/TaskList" },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
      },
      "/api/v1/tasks/{id}": {
        get: {
          tags: ["Tasks"],
          summary: "Get task status and result",
          operationId: "getTask",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Task details",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/TaskDetail" },
                },
              },
            },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/api/v1/tasks/{id}/events": {
        get: {
          tags: ["Tasks"],
          summary: "SSE stream of task events",
          operationId: "streamTaskEvents",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Server-Sent Events stream",
              content: { "text/event-stream": { schema: { type: "string" } } },
            },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/api/v1/tasks/{id}/cancel": {
        post: {
          tags: ["Tasks"],
          summary: "Cancel a running task",
          operationId: "cancelTask",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Task cancelled" },
            "404": { $ref: "#/components/responses/NotFound" },
            "409": { description: "Task already in terminal state" },
          },
        },
      },

      // ── Sessions ──────────────────────────────────────────────────────
      "/api/v1/sessions": {
        post: {
          tags: ["Sessions"],
          summary: "Create a session",
          operationId: "createSession",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateSessionRequest" },
                example: {
                  projectId: "proj_abc123",
                  mode: "task",
                  prompt: "Refactor the auth module to use JWT",
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Session created",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/SessionCreated" },
                },
              },
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
      },
      "/api/v1/sessions/{id}": {
        get: {
          tags: ["Sessions"],
          summary: "Get session with events",
          operationId: "getSession",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Session details with events and messages",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/SessionDetail" },
                },
              },
            },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/api/v1/sessions/{id}/messages": {
        post: {
          tags: ["Sessions"],
          summary: "Send message to session",
          operationId: "sendSessionMessage",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["content"],
                  properties: {
                    content: { type: "string", description: "Message content" },
                  },
                },
                example: { content: "Also add unit tests for the auth module" },
              },
            },
          },
          responses: {
            "201": { description: "Message sent" },
            "404": { $ref: "#/components/responses/NotFound" },
            "409": { description: "Session not active" },
          },
        },
      },
      "/api/v1/sessions/{id}/stream": {
        get: {
          tags: ["Sessions"],
          summary: "SSE stream of session events",
          operationId: "streamSessionEvents",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Server-Sent Events stream",
              content: { "text/event-stream": { schema: { type: "string" } } },
            },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/api/v1/sessions/{id}/pause": {
        post: {
          tags: ["Sessions"],
          summary: "Pause session",
          operationId: "pauseSession",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Session paused" },
            "404": { $ref: "#/components/responses/NotFound" },
            "409": { description: "Session not active" },
          },
        },
      },
      "/api/v1/sessions/{id}/resume": {
        post: {
          tags: ["Sessions"],
          summary: "Resume session",
          operationId: "resumeSession",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Session resumed" },
            "404": { $ref: "#/components/responses/NotFound" },
            "409": { description: "Session not paused" },
          },
        },
      },
      "/api/v1/sessions/{id}/cancel": {
        post: {
          tags: ["Sessions"],
          summary: "Cancel session",
          operationId: "cancelSession",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Session cancelled" },
            "404": { $ref: "#/components/responses/NotFound" },
            "409": { description: "Session already ended" },
          },
        },
      },

      // ── Projects ──────────────────────────────────────────────────────
      "/api/v1/projects": {
        get: {
          tags: ["Projects"],
          summary: "List projects",
          operationId: "listProjects",
          parameters: [
            { name: "status", in: "query", schema: { type: "string" } },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 50 },
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", default: 0 },
            },
          ],
          responses: {
            "200": {
              description: "Project list",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ProjectList" },
                },
              },
            },
          },
        },
        post: {
          tags: ["Projects"],
          summary: "Create project",
          operationId: "createProject",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateProjectRequest" },
                example: {
                  name: "My App",
                  description: "Next.js SaaS application",
                  repoUrl: "https://github.com/org/my-app",
                  techStackPreset: "nextjs",
                },
              },
            },
          },
          responses: {
            "201": { description: "Project created" },
            "400": { $ref: "#/components/responses/BadRequest" },
          },
        },
      },
      "/api/v1/projects/{id}": {
        get: {
          tags: ["Projects"],
          summary: "Get project details",
          operationId: "getProject",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Project details" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/api/v1/projects/{id}/import": {
        post: {
          tags: ["Projects"],
          summary: "Import/re-import from repo",
          operationId: "importProject",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    repoUrl: {
                      type: "string",
                      description: "Override repo URL",
                    },
                    fullReindex: { type: "boolean", default: true },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Import job queued" },
            "400": { description: "No repo URL" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },

      // ── API Keys ──────────────────────────────────────────────────────
      "/api/v1/api-keys": {
        post: {
          tags: ["API Keys"],
          summary: "Create new API key",
          operationId: "createApiKey",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateApiKeyRequest" },
                example: {
                  name: "CI/CD Pipeline",
                  scopes: ["tasks:read", "tasks:write", "sessions:read"],
                  projectIds: ["proj_abc123"],
                  expiresAt: "2027-01-01T00:00:00.000Z",
                },
              },
            },
          },
          responses: {
            "201": {
              description: "API key created (key shown only once)",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ApiKeyCreated" },
                },
              },
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "412": { description: "Maximum key limit reached" },
          },
        },
        get: {
          tags: ["API Keys"],
          summary: "List API keys (without key values)",
          operationId: "listApiKeys",
          responses: {
            "200": {
              description: "API key list",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ApiKeyList" },
                },
              },
            },
          },
        },
      },
      "/api/v1/api-keys/{id}": {
        delete: {
          tags: ["API Keys"],
          summary: "Revoke API key",
          operationId: "revokeApiKey",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Key revoked" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        apiKeyAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "API Key",
          description:
            "API key authentication. Use the format `Authorization: Bearer pk_live_...`. Keys are created via the dashboard or the API keys endpoint.",
        },
      },
      responses: {
        BadRequest: {
          description: "Bad Request - invalid or missing parameters",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
        Unauthorized: {
          description: "Unauthorized - missing or invalid API key",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
        NotFound: {
          description: "Resource not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
        RateLimited: {
          description:
            "Rate limit exceeded (default: 60 requests per minute per API key). Check X-RateLimit-* headers.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: { type: "string" },
            message: { type: "string" },
          },
        },
        CreateTaskRequest: {
          type: "object",
          required: ["projectId", "description"],
          properties: {
            projectId: { type: "string", description: "Target project ID" },
            description: {
              type: "string",
              description: "Task description / prompt",
            },
            mode: { type: "string", enum: ["task", "plan"], default: "task" },
            priority: {
              type: "integer",
              default: 50,
              minimum: 1,
              maximum: 100,
            },
            waitForCompletion: {
              type: "boolean",
              default: false,
              description:
                "Long-poll until task completes (up to 120s timeout)",
            },
          },
        },
        TaskCreated: {
          type: "object",
          properties: {
            id: { type: "string" },
            sessionId: { type: "string" },
            status: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        TaskDetail: {
          type: "object",
          properties: {
            id: { type: "string" },
            sessionId: { type: "string" },
            projectId: { type: "string" },
            status: {
              type: "string",
              enum: [
                "pending",
                "queued",
                "running",
                "completed",
                "failed",
                "cancelled",
              ],
            },
            title: { type: "string" },
            description: { type: "string" },
            result: { type: "object", nullable: true },
            error: { type: "string", nullable: true },
            creditsConsumed: { type: "integer" },
            createdAt: { type: "string", format: "date-time" },
            completedAt: {
              type: "string",
              format: "date-time",
              nullable: true,
            },
          },
        },
        TaskList: {
          type: "object",
          properties: {
            tasks: {
              type: "array",
              items: { $ref: "#/components/schemas/TaskDetail" },
            },
            hasMore: { type: "boolean" },
            total: { type: "integer" },
          },
        },
        CreateSessionRequest: {
          type: "object",
          required: ["projectId", "mode"],
          properties: {
            projectId: { type: "string" },
            mode: { type: "string", enum: ["task", "ask", "plan", "design"] },
            prompt: {
              type: "string",
              description: "Optional initial prompt to start work immediately",
            },
          },
        },
        SessionCreated: {
          type: "object",
          properties: {
            id: { type: "string" },
            projectId: { type: "string" },
            mode: { type: "string" },
            status: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        SessionDetail: {
          type: "object",
          properties: {
            id: { type: "string" },
            projectId: { type: "string" },
            mode: { type: "string" },
            status: { type: "string" },
            startedAt: { type: "string", format: "date-time" },
            endedAt: { type: "string", format: "date-time", nullable: true },
            events: { type: "array", items: { type: "object" } },
            messages: { type: "array", items: { type: "object" } },
          },
        },
        CreateProjectRequest: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            repoUrl: { type: "string", format: "uri" },
            techStackPreset: { type: "string" },
          },
        },
        ProjectList: {
          type: "object",
          properties: {
            projects: { type: "array", items: { type: "object" } },
            hasMore: { type: "boolean" },
          },
        },
        CreateApiKeyRequest: {
          type: "object",
          required: ["name", "scopes"],
          properties: {
            name: { type: "string", description: "Human-readable key name" },
            scopes: {
              type: "array",
              items: {
                type: "string",
                enum: [
                  "sessions:read",
                  "sessions:write",
                  "projects:read",
                  "projects:write",
                  "fleet:manage",
                  "tasks:read",
                  "tasks:write",
                  "audit:read",
                  "billing:read",
                  "settings:read",
                  "settings:write",
                ],
              },
              description: "Permission scopes for the key",
            },
            projectIds: {
              type: "array",
              items: { type: "string" },
              nullable: true,
              description: "Restrict key to specific projects (null = all)",
            },
            expiresAt: {
              type: "string",
              format: "date-time",
              nullable: true,
              description: "Expiration timestamp (null = never)",
            },
          },
        },
        ApiKeyCreated: {
          type: "object",
          properties: {
            id: { type: "string" },
            key: {
              type: "string",
              description: "Raw API key (shown only once)",
            },
            name: { type: "string" },
            scopes: { type: "array", items: { type: "string" } },
            projectIds: {
              type: "array",
              items: { type: "string" },
              nullable: true,
            },
            expiresAt: { type: "string", format: "date-time", nullable: true },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        ApiKeyList: {
          type: "object",
          properties: {
            keys: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  scopes: { type: "array", items: { type: "string" } },
                  projectIds: {
                    type: "array",
                    items: { type: "string" },
                    nullable: true,
                  },
                  lastUsed: {
                    type: "string",
                    format: "date-time",
                    nullable: true,
                  },
                  expiresAt: {
                    type: "string",
                    format: "date-time",
                    nullable: true,
                  },
                  requestCount: { type: "integer" },
                  createdAt: { type: "string", format: "date-time" },
                },
              },
            },
          },
        },
      },
    },
  };
}

const openapiApp = new Hono();

// GET /api/v1/openapi.json - Return the OpenAPI spec
openapiApp.get("/openapi.json", (c) => {
  return c.json(buildOpenAPISpec());
});

// GET /api/v1/docs - Serve Scalar API documentation
openapiApp.get("/docs", (c) => {
  const specUrl = `${process.env.API_URL ?? "http://localhost:4000"}/api/v1/openapi.json`;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Prometheus API Documentation</title>
</head>
<body>
  <script id="api-reference" data-url="${specUrl}"></script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>`;
  return c.html(html);
});

export { openapiApp };
