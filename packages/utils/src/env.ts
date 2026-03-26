import { z } from "zod";

// ============================================================================
// Shared schema fragments
// ============================================================================

const nodeEnv = z
  .enum(["development", "production", "test"])
  .default("development");

const logLevel = z
  .enum(["fatal", "error", "warn", "info", "debug", "trace"])
  .default("info");

const _urlString = z.string().url();
const portNumber = z.coerce.number().int().min(1).max(65_535);
const optionalString = z.string().optional();
const requiredString = z
  .string()
  .min(1, "This environment variable is required and cannot be empty");

/**
 * Helper: returns true when running in dev mode with auth bypass enabled.
 * Used to relax third-party key requirements (Clerk, Stripe) so developers
 * can start services without needing external accounts.
 */
function isDevBypassMode(): boolean {
  return (
    process.env.DEV_AUTH_BYPASS === "true" &&
    process.env.NODE_ENV !== "production"
  );
}

/** Build a schema field that is required in production, optional in dev bypass mode. */
function requiredInProd(description: string) {
  if (isDevBypassMode()) {
    return z.string().default("").describe(description);
  }
  return requiredString.describe(description);
}

// ============================================================================
// Base schema — vars shared across most services
// ============================================================================

const baseSchema = z.object({
  NODE_ENV: nodeEnv,
  LOG_LEVEL: logLevel,
});

// ============================================================================
// Database + Redis — used by api, queue-worker, orchestrator, etc.
// ============================================================================

const databaseSchema = z.object({
  DATABASE_URL: requiredString.describe(
    "PostgreSQL connection string (e.g. postgresql://user:pass@localhost:5432/prometheus)"
  ),
});

const redisSchema = z.object({
  REDIS_URL: z
    .string()
    .default("redis://localhost:6379")
    .describe("Redis connection URL"),
});

// ============================================================================
// Auth — Clerk
// ============================================================================

const clerkSchema = z.object({
  CLERK_SECRET_KEY: requiredInProd(
    "Clerk secret key — get from https://clerk.com → API Keys"
  ),
  CLERK_WEBHOOK_SECRET: optionalString.describe(
    "Clerk webhook signing secret — needed only by the API webhook handler"
  ),
});

const clerkPublicSchema = z.object({
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: requiredInProd(
    "Clerk publishable key — get from https://clerk.com → API Keys"
  ),
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: z.string().default("/sign-in"),
  NEXT_PUBLIC_CLERK_SIGN_UP_URL: z.string().default("/sign-up"),
});

// ============================================================================
// Stripe — Billing
// ============================================================================

const stripeSchema = z.object({
  STRIPE_SECRET_KEY: requiredInProd(
    "Stripe secret key — get from https://stripe.com → Developers → API Keys"
  ),
  STRIPE_WEBHOOK_SECRET: optionalString.describe(
    "Stripe webhook signing secret — needed only by the API webhook handler"
  ),
  STRIPE_PRICE_STARTER: optionalString,
  STRIPE_PRICE_PRO: optionalString,
  STRIPE_PRICE_TEAM: optionalString,
  STRIPE_PRICE_STUDIO: optionalString,
  STRIPE_PRICE_CREDITS_100: optionalString,
  STRIPE_PRICE_CREDITS_500: optionalString,
  STRIPE_PRICE_CREDITS_1000: optionalString,
  STRIPE_PRICE_CREDITS_5000: optionalString,
});

const stripePublicSchema = z.object({
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: optionalString,
});

// ============================================================================
// LLM Providers
// ============================================================================

const llmProvidersSchema = z.object({
  OLLAMA_BASE_URL: z
    .string()
    .default("http://localhost:11434")
    .describe("Ollama API base URL"),
  CEREBRAS_API_KEY: optionalString,
  GROQ_API_KEY: optionalString,
  GEMINI_API_KEY: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  OPENAI_API_KEY: optionalString,
  OPENROUTER_API_KEY: optionalString,
  MISTRAL_API_KEY: optionalString,
  DEEPSEEK_API_KEY: optionalString,
});

// ============================================================================
// Encryption
// ============================================================================

const encryptionSchema = z.object({
  ENCRYPTION_KEY: requiredString.describe(
    "64-char hex string — generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
  ),
});

// ============================================================================
// Service URLs & Ports
// ============================================================================

const serviceUrlsSchema = z.object({
  APP_URL: z.string().default("http://localhost:3000"),
  NEXT_PUBLIC_API_URL: z.string().default("http://localhost:4000"),
  API_URL: z.string().default("http://localhost:4000"),
  NEXT_PUBLIC_SOCKET_URL: z.string().default("http://localhost:4001"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  ORCHESTRATOR_URL: z.string().default("http://localhost:4002"),
  PROJECT_BRAIN_URL: z.string().default("http://localhost:4003"),
  MODEL_ROUTER_URL: z.string().default("http://localhost:4004"),
  MCP_GATEWAY_URL: z.string().default("http://localhost:4005"),
  SANDBOX_MANAGER_URL: z.string().default("http://localhost:4006"),
  SOCKET_SERVER_URL: z.string().default("http://localhost:4001"),
  QUEUE_WORKER_URL: z.string().default("http://localhost:4007"),
});

const servicePortsSchema = z.object({
  PORT: portNumber.default(4000),
  SOCKET_PORT: portNumber.default(4001),
  ORCHESTRATOR_PORT: portNumber.default(4002),
  PROJECT_BRAIN_PORT: portNumber.default(4003),
  MODEL_ROUTER_PORT: portNumber.default(4004),
  MCP_GATEWAY_PORT: portNumber.default(4005),
  SANDBOX_MANAGER_PORT: portNumber.default(4006),
});

// ============================================================================
// Worker Config
// ============================================================================

const workerSchema = z.object({
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(2),
  ENTERPRISE_CONCURRENCY: z.coerce.number().int().min(1).default(4),
});

// ============================================================================
// Sandbox Manager Config
// ============================================================================

const sandboxSchema = z.object({
  WARM_POOL_SIZE: z.coerce.number().int().min(0).default(2),
  MAX_POOL_SIZE: z.coerce.number().int().min(1).default(10),
  SANDBOX_IDLE_TTL_MS: z.coerce.number().int().min(0).default(1_800_000),
  SANDBOX_IMAGE: z.string().default("node:22-alpine"),
  SANDBOX_BASE_DIR: z.string().default("/tmp/prometheus-sandboxes"),
});

// ============================================================================
// Project Brain Config
// ============================================================================

const projectBrainSchema = z.object({
  EMBEDDING_MODEL: z.string().default("nomic-embed-text"),
});

// ============================================================================
// Optional services
// ============================================================================

const emailSchema = z.object({
  RESEND_API_KEY: optionalString,
});

const monitoringSchema = z.object({
  SENTRY_DSN: optionalString,
});

// ============================================================================
// Per-service composite schemas
// ============================================================================

/** Web app (Next.js) — needs public keys, auth, service URLs */
export const webEnvSchema = baseSchema
  .merge(clerkPublicSchema)
  .merge(clerkSchema.pick({ CLERK_SECRET_KEY: true }))
  .merge(stripePublicSchema)
  .merge(
    serviceUrlsSchema.pick({
      APP_URL: true,
      NEXT_PUBLIC_API_URL: true,
      API_URL: true,
      NEXT_PUBLIC_SOCKET_URL: true,
    })
  )
  .merge(monitoringSchema);

/** API server — needs DB, auth, billing, encryption, service URLs */
export const apiEnvSchema = baseSchema
  .merge(databaseSchema)
  .merge(redisSchema)
  .merge(clerkSchema)
  .merge(stripeSchema)
  .merge(encryptionSchema)
  .merge(
    serviceUrlsSchema.pick({
      APP_URL: true,
      CORS_ORIGIN: true,
      ORCHESTRATOR_URL: true,
      PROJECT_BRAIN_URL: true,
      MODEL_ROUTER_URL: true,
      MCP_GATEWAY_URL: true,
      SANDBOX_MANAGER_URL: true,
    })
  )
  .merge(servicePortsSchema.pick({ PORT: true }))
  .merge(emailSchema)
  .merge(monitoringSchema);

/** Orchestrator — calls model-router, project-brain, sandbox-manager, socket-server */
export const orchestratorEnvSchema = baseSchema
  .merge(databaseSchema)
  .merge(redisSchema)
  .merge(
    serviceUrlsSchema.pick({
      MODEL_ROUTER_URL: true,
      PROJECT_BRAIN_URL: true,
      SANDBOX_MANAGER_URL: true,
      SOCKET_SERVER_URL: true,
    })
  )
  .merge(servicePortsSchema.pick({ ORCHESTRATOR_PORT: true }))
  .merge(monitoringSchema);

/** Queue Worker — processes background jobs, calls orchestrator and sandbox */
export const queueWorkerEnvSchema = baseSchema
  .merge(databaseSchema)
  .merge(redisSchema)
  .merge(workerSchema)
  .merge(
    serviceUrlsSchema.pick({
      APP_URL: true,
      ORCHESTRATOR_URL: true,
      PROJECT_BRAIN_URL: true,
      SANDBOX_MANAGER_URL: true,
    })
  )
  .merge(emailSchema)
  .merge(monitoringSchema);

/** Socket Server — WebSocket connections */
export const socketServerEnvSchema = baseSchema
  .merge(redisSchema)
  .merge(serviceUrlsSchema.pick({ CORS_ORIGIN: true }))
  .merge(servicePortsSchema.pick({ SOCKET_PORT: true }))
  .merge(monitoringSchema);

/** Model Router — routes LLM requests to providers */
export const modelRouterEnvSchema = baseSchema
  .merge(redisSchema)
  .merge(llmProvidersSchema)
  .merge(servicePortsSchema.pick({ MODEL_ROUTER_PORT: true }))
  .merge(monitoringSchema);

/** MCP Gateway — Model Context Protocol gateway */
export const mcpGatewayEnvSchema = baseSchema
  .merge(redisSchema)
  .merge(servicePortsSchema.pick({ MCP_GATEWAY_PORT: true }))
  .merge(monitoringSchema);

/** Project Brain — codebase analysis & embeddings */
export const projectBrainEnvSchema = baseSchema
  .merge(databaseSchema)
  .merge(redisSchema)
  .merge(llmProvidersSchema.pick({ OLLAMA_BASE_URL: true }))
  .merge(projectBrainSchema)
  .merge(servicePortsSchema.pick({ PROJECT_BRAIN_PORT: true }))
  .merge(monitoringSchema);

/** Sandbox Manager — Docker sandbox lifecycle */
export const sandboxManagerEnvSchema = baseSchema
  .merge(sandboxSchema)
  .merge(servicePortsSchema.pick({ SANDBOX_MANAGER_PORT: true }))
  .merge(monitoringSchema);

// ============================================================================
// Validation helper
// ============================================================================

/**
 * Validate and parse environment variables against a Zod schema.
 *
 * @param schema - A Zod object schema describing required/optional env vars
 * @param env    - The env object to validate (defaults to process.env)
 * @returns Typed, validated env object
 * @throws  Formatted error message listing every missing/invalid variable
 *
 * @example
 * ```ts
 * import { validateEnv, apiEnvSchema } from "@prometheus/utils";
 * const env = validateEnv(apiEnvSchema);
 * // env.DATABASE_URL is typed as string
 * ```
 */
export function validateEnv<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >
): z.infer<z.ZodObject<T>> {
  const result = schema.safeParse(env);

  if (result.success) {
    return result.data;
  }

  const errors = result.error.issues.map((issue) => {
    const path = issue.path.join(".");
    const description =
      "description" in issue
        ? (issue as { description?: string }).description
        : undefined;
    let msg = `  ✗ ${path}: ${issue.message}`;
    if (description) {
      msg += ` — ${description}`;
    }
    return msg;
  });

  const message = [
    "",
    "━━━ Environment validation failed ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    ...errors,
    "",
    `${errors.length} variable(s) missing or invalid.`,
    "See .env.example for documentation on each variable.",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
  ].join("\n");

  throw new Error(message);
}

// ============================================================================
// Convenience typed env getters (lazy-validated singletons)
// ============================================================================

function createEnvGetter<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  let cached: z.infer<z.ZodObject<T>> | undefined;
  return (): z.infer<z.ZodObject<T>> => {
    if (!cached) {
      cached = validateEnv(schema);
    }
    return cached;
  };
}

/** Get validated env for the **web** app */
export const getWebEnv = createEnvGetter(webEnvSchema);

/** Get validated env for the **API** server */
export const getApiEnv = createEnvGetter(apiEnvSchema);

/** Get validated env for the **orchestrator*/
export const getOrchestratorEnv = createEnvGetter(orchestratorEnvSchema);

/** Get validated env for the **queue worker*/
export const getQueueWorkerEnv = createEnvGetter(queueWorkerEnvSchema);

/** Get validated env for the **socket server*/
export const getSocketServerEnv = createEnvGetter(socketServerEnvSchema);

/** Get validated env for the **model router*/
export const getModelRouterEnv = createEnvGetter(modelRouterEnvSchema);

/** Get validated env for the **MCP gateway*/
export const getMcpGatewayEnv = createEnvGetter(mcpGatewayEnvSchema);

/** Get validated env for the **project brain*/
export const getProjectBrainEnv = createEnvGetter(projectBrainEnvSchema);

/** Get validated env for the **sandbox manager*/
export const getSandboxManagerEnv = createEnvGetter(sandboxManagerEnvSchema);
