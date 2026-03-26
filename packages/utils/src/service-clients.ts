import { HttpClient } from "./http-client";
import { services } from "./services";

/**
 * Build default headers that include the internal service secret when set.
 * This ensures all service-to-service calls are authenticated.
 */
function internalHeaders(): Record<string, string> {
  const secret = process.env.INTERNAL_SERVICE_SECRET;
  return secret ? { "x-internal-secret": secret } : {};
}

/** Pre-configured HttpClient for model-router with long timeout for LLM inference */
export const modelRouterClient = new HttpClient({
  baseUrl: services.modelRouter,
  timeout: 120_000,
  maxRetries: 2,
  retryBaseDelay: 2000,
  circuitBreakerThreshold: 5,
  circuitBreakerResetMs: 30_000,
  defaultHeaders: internalHeaders(),
});

/** Pre-configured HttpClient for project-brain with moderate timeout */
export const projectBrainClient = new HttpClient({
  baseUrl: services.projectBrain,
  timeout: 10_000,
  maxRetries: 2,
  retryBaseDelay: 1000,
  circuitBreakerThreshold: 5,
  circuitBreakerResetMs: 30_000,
  defaultHeaders: internalHeaders(),
});

/** Pre-configured HttpClient for sandbox-manager */
export const sandboxManagerClient = new HttpClient({
  baseUrl: services.sandboxManager,
  timeout: 30_000,
  maxRetries: 2,
  retryBaseDelay: 1000,
  circuitBreakerThreshold: 5,
  circuitBreakerResetMs: 30_000,
  defaultHeaders: internalHeaders(),
});

/** Pre-configured HttpClient for orchestrator (long timeout for task processing) */
export const orchestratorClient = new HttpClient({
  baseUrl: services.orchestrator,
  timeout: 3_600_000,
  maxRetries: 1,
  retryBaseDelay: 5000,
  circuitBreakerThreshold: 3,
  circuitBreakerResetMs: 60_000,
  defaultHeaders: internalHeaders(),
});

/** Pre-configured HttpClient for MCP Gateway with moderate timeout */
export const mcpGatewayClient = new HttpClient({
  baseUrl: services.mcpGateway,
  timeout: 30_000,
  maxRetries: 2,
  retryBaseDelay: 1000,
  circuitBreakerThreshold: 5,
  circuitBreakerResetMs: 30_000,
  defaultHeaders: internalHeaders(),
});

/** Pre-configured HttpClient for Socket Server (used for push notifications) */
export const socketServerClient = new HttpClient({
  baseUrl: services.socketServer,
  timeout: 5000,
  maxRetries: 1,
  retryBaseDelay: 500,
  circuitBreakerThreshold: 5,
  circuitBreakerResetMs: 15_000,
  defaultHeaders: internalHeaders(),
});

/** Pre-configured HttpClient for Queue Worker health checks */
export const queueWorkerClient = new HttpClient({
  baseUrl: services.queueWorker,
  timeout: 5000,
  maxRetries: 1,
  retryBaseDelay: 500,
  circuitBreakerThreshold: 5,
  circuitBreakerResetMs: 15_000,
  defaultHeaders: internalHeaders(),
});
