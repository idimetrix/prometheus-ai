// ============================================================================
// Shared Service Registry
// ============================================================================
// Central registry of all Prometheus service URLs with sensible defaults.
// Services should import from here rather than hard-coding URLs.
// ============================================================================

/**
 * Service URL configuration. Each service reads its URL from the corresponding
 * environment variable, falling back to the local development default.
 *
 * @example
 * ```ts
 * import { services } from "@prometheus/utils";
 * const resp = await fetch(`${services.orchestrator}/health`);
 * ```
 */
export const services = {
  /** Web frontend (Next.js) — port 3000 */
  web: process.env.APP_URL || "http://localhost:3000",

  /** API server (Hono + tRPC) — port 4000 */
  api: process.env.API_URL || "http://localhost:4000",

  /** Socket server (Socket.io) — port 4001 */
  socketServer: process.env.SOCKET_SERVER_URL || "http://localhost:4001",

  /** Orchestrator (agent task routing) — port 4002 */
  orchestrator: process.env.ORCHESTRATOR_URL || "http://localhost:4002",

  /** Project Brain (codebase analysis) — port 4003 */
  projectBrain: process.env.PROJECT_BRAIN_URL || "http://localhost:4003",

  /** Model Router (LLM provider routing) — port 4004 */
  modelRouter: process.env.MODEL_ROUTER_URL || "http://localhost:4004",

  /** MCP Gateway (tool integrations) — port 4005 */
  mcpGateway: process.env.MCP_GATEWAY_URL || "http://localhost:4005",

  /** Sandbox Manager (container lifecycle) — port 4006 */
  sandboxManager: process.env.SANDBOX_MANAGER_URL || "http://localhost:4006",

  /** Queue Worker health endpoint — port 4007 */
  queueWorker: process.env.QUEUE_WORKER_URL || "http://localhost:4007",
} as const;

/** Service name literals for type-safe lookups */
export type ServiceName = keyof typeof services;

/** Default port assignments for each service */
export const servicePorts: Record<ServiceName, number> = {
  web: 3000,
  api: 4000,
  socketServer: 4001,
  orchestrator: 4002,
  projectBrain: 4003,
  modelRouter: 4004,
  mcpGateway: 4005,
  sandboxManager: 4006,
  queueWorker: 4007,
};

/**
 * Check liveness of a remote service by hitting its /live endpoint.
 * Returns true if the service responds with HTTP 200, false otherwise.
 * Non-throwing — safe to call during startup or health checks.
 */
export async function checkServiceLiveness(
  name: ServiceName,
  timeoutMs = 3000
): Promise<boolean> {
  try {
    const url = services[name];
    const resp = await fetch(`${url}/live`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Check readiness of a remote service by hitting its /ready endpoint.
 * Returns the parsed JSON response on success, null on failure.
 * Non-throwing — safe to call during startup or health checks.
 */
export async function checkServiceReadiness(
  name: ServiceName,
  timeoutMs = 5000
): Promise<Record<string, unknown> | null> {
  try {
    const url = services[name];
    const resp = await fetch(`${url}/ready`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (resp.ok) {
      return (await resp.json()) as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}
