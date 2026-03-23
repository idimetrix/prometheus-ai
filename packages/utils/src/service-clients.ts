import { HttpClient } from "./http-client";

const MODEL_ROUTER_URL =
  process.env.MODEL_ROUTER_URL ?? "http://localhost:4004";
const PROJECT_BRAIN_URL =
  process.env.PROJECT_BRAIN_URL ?? "http://localhost:4003";
const SANDBOX_MANAGER_URL =
  process.env.SANDBOX_MANAGER_URL ?? "http://localhost:4006";
const ORCHESTRATOR_URL =
  process.env.ORCHESTRATOR_URL ?? "http://localhost:4002";

/** Pre-configured HttpClient for model-router with long timeout for LLM inference */
export const modelRouterClient = new HttpClient({
  baseUrl: MODEL_ROUTER_URL,
  timeout: 120_000,
  maxRetries: 2,
  retryBaseDelay: 2000,
  circuitBreakerThreshold: 5,
  circuitBreakerResetMs: 30_000,
});

/** Pre-configured HttpClient for project-brain with moderate timeout */
export const projectBrainClient = new HttpClient({
  baseUrl: PROJECT_BRAIN_URL,
  timeout: 10_000,
  maxRetries: 2,
  retryBaseDelay: 1000,
  circuitBreakerThreshold: 5,
  circuitBreakerResetMs: 30_000,
});

/** Pre-configured HttpClient for sandbox-manager */
export const sandboxManagerClient = new HttpClient({
  baseUrl: SANDBOX_MANAGER_URL,
  timeout: 30_000,
  maxRetries: 2,
  retryBaseDelay: 1000,
  circuitBreakerThreshold: 5,
  circuitBreakerResetMs: 30_000,
});

/** Pre-configured HttpClient for orchestrator (long timeout for task processing) */
export const orchestratorClient = new HttpClient({
  baseUrl: ORCHESTRATOR_URL,
  timeout: 3_600_000,
  maxRetries: 1,
  retryBaseDelay: 5000,
  circuitBreakerThreshold: 3,
  circuitBreakerResetMs: 60_000,
});
