import { createLogger } from "@prometheus/logger";

const logger = createLogger("model-router:byo-model-validator");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BYOModelValidation {
  capabilities: string[];
  contextWindow: number;
  errors: string[];
  latencyMs: number;
  modelId: string;
  provider: string;
  supportsStreaming: boolean;
  supportsTools: boolean;
  valid: boolean;
}

export interface BYOModelBenchmark {
  latencyP50: number;
  latencyP99: number;
  qualityScore: number;
  tokensPerSecond: number;
}

interface ModelConfig {
  apiKey: string;
  baseUrl?: string;
  modelId: string;
  provider: string;
}

// ---------------------------------------------------------------------------
// Provider endpoint resolution
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  groq: "https://api.groq.com/openai/v1",
  cerebras: "https://api.cerebras.ai/v1",
  mistral: "https://api.mistral.ai/v1",
  deepseek: "https://api.deepseek.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  together: "https://api.together.xyz/v1",
  fireworks: "https://api.fireworks.ai/inference/v1",
};

const TEST_PROMPT =
  "Respond with exactly: PROMETHEUS_VALIDATION_OK. Nothing else.";

const BENCHMARK_PROMPTS = [
  "Write a TypeScript function that reverses a string without using the built-in reverse method.",
  "Explain the difference between a stack and a queue in two sentences.",
  "List three common HTTP status codes and what they mean.",
  "Write a SQL query to find duplicate email addresses in a users table.",
  "What is the time complexity of binary search and why?",
];

const TOOL_TEST_PROMPT =
  'You have a tool called "get_weather" that accepts a "city" parameter. Call it for London.';

const TOOL_DEFINITION = {
  type: "function" as const,
  function: {
    name: "get_weather",
    description: "Get the current weather for a city",
    parameters: {
      type: "object",
      properties: {
        city: { type: "string", description: "The city name" },
      },
      required: ["city"],
    },
  },
};

// ---------------------------------------------------------------------------
// BYO Model Validator
// ---------------------------------------------------------------------------

/**
 * Validates and benchmarks user-provided (BYO) model endpoints.
 *
 * Validation checks:
 *  - Endpoint reachability and authentication
 *  - Basic completion capability
 *  - Streaming support
 *  - Tool/function calling support
 *  - Response latency
 *
 * Benchmarking measures:
 *  - Latency percentiles (P50, P99)
 *  - Tokens per second throughput
 *  - Quality score based on instruction following
 */
export class BYOModelValidator {
  /**
   * Validate a user-provided model endpoint by sending test requests
   * to verify connectivity, capabilities, and basic functionality.
   */
  async validate(config: ModelConfig): Promise<BYOModelValidation> {
    const errors: string[] = [];
    const capabilities: string[] = [];
    let supportsStreaming = false;
    let supportsTools = false;
    let contextWindow = 0;
    let latencyMs = 0;

    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URLS[config.provider];
    if (!baseUrl) {
      return {
        valid: false,
        modelId: config.modelId,
        provider: config.provider,
        capabilities: [],
        contextWindow: 0,
        supportsStreaming: false,
        supportsTools: false,
        latencyMs: 0,
        errors: [
          `Unknown provider "${config.provider}" and no baseUrl provided`,
        ],
      };
    }

    logger.info(
      { provider: config.provider, modelId: config.modelId },
      "Starting BYO model validation"
    );

    // -----------------------------------------------------------------------
    // 1. Basic completion test
    // -----------------------------------------------------------------------
    try {
      const start = Date.now();
      const response = await this.chatCompletion(baseUrl, config, [
        { role: "user", content: TEST_PROMPT },
      ]);
      latencyMs = Date.now() - start;

      if (response.ok) {
        capabilities.push("chat-completion");
        const body = (await response.json()) as Record<string, unknown>;
        const content = extractContent(body, config.provider);

        if (content?.includes("PROMETHEUS_VALIDATION_OK")) {
          capabilities.push("instruction-following");
        }

        // Try to extract context window from model info
        contextWindow = extractContextWindow(body, config.modelId);
      } else {
        const errorBody = await response.text();
        const statusError = `Completion request failed (${response.status}): ${truncate(errorBody, 200)}`;
        errors.push(statusError);
        logger.warn(
          { status: response.status, provider: config.provider },
          statusError
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Completion request error: ${msg}`);
      logger.error(
        { err: msg, provider: config.provider },
        "Completion test failed"
      );
    }

    // -----------------------------------------------------------------------
    // 2. Streaming support test
    // -----------------------------------------------------------------------
    try {
      const response = await this.chatCompletion(
        baseUrl,
        config,
        [{ role: "user", content: "Say hello." }],
        { stream: true }
      );

      if (response.ok) {
        supportsStreaming = true;
        capabilities.push("streaming");
        // Consume the stream to avoid connection leaks
        await response.text();
      } else {
        // Streaming not supported is not an error — many models work fine without it
        logger.debug(
          { provider: config.provider },
          "Model does not support streaming"
        );
      }
    } catch {
      logger.debug(
        { provider: config.provider },
        "Streaming test failed (non-critical)"
      );
    }

    // -----------------------------------------------------------------------
    // 3. Tool/function calling test
    // -----------------------------------------------------------------------
    try {
      const response = await this.chatCompletion(
        baseUrl,
        config,
        [{ role: "user", content: TOOL_TEST_PROMPT }],
        { tools: [TOOL_DEFINITION] }
      );

      if (response.ok) {
        const body = (await response.json()) as Record<string, unknown>;
        const hasToolCalls = checkToolCalls(body, config.provider);
        if (hasToolCalls) {
          supportsTools = true;
          capabilities.push("tool-calling");
        }
      }
    } catch {
      logger.debug(
        { provider: config.provider },
        "Tool calling test failed (non-critical)"
      );
    }

    // -----------------------------------------------------------------------
    // 4. Determine context window from known models if not extracted
    // -----------------------------------------------------------------------
    if (contextWindow === 0) {
      contextWindow = estimateContextWindow(config.modelId);
    }

    const valid =
      errors.length === 0 && capabilities.includes("chat-completion");

    const result: BYOModelValidation = {
      valid,
      modelId: config.modelId,
      provider: config.provider,
      capabilities,
      contextWindow,
      supportsStreaming,
      supportsTools,
      latencyMs,
      errors,
    };

    logger.info(
      {
        valid: result.valid,
        provider: config.provider,
        modelId: config.modelId,
        capabilities: result.capabilities,
        latencyMs: result.latencyMs,
        errorCount: result.errors.length,
      },
      "BYO model validation complete"
    );

    return result;
  }

  /**
   * Benchmark the model with a standard prompt set to measure latency,
   * throughput, and output quality.
   */
  async benchmark(config: ModelConfig): Promise<BYOModelBenchmark> {
    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URLS[config.provider];
    if (!baseUrl) {
      throw new Error(
        `Unknown provider "${config.provider}" and no baseUrl provided`
      );
    }

    logger.info(
      { provider: config.provider, modelId: config.modelId },
      "Starting BYO model benchmark"
    );

    const latencies: number[] = [];
    const tokenCounts: number[] = [];
    const durations: number[] = [];
    let qualityHits = 0;

    for (const prompt of BENCHMARK_PROMPTS) {
      try {
        const start = Date.now();
        const response = await this.chatCompletion(baseUrl, config, [
          { role: "user", content: prompt },
        ]);
        const elapsed = Date.now() - start;
        latencies.push(elapsed);

        if (response.ok) {
          const body = (await response.json()) as Record<string, unknown>;
          const content = extractContent(body, config.provider) ?? "";
          const tokens = extractTokenCount(body) ?? estimateTokens(content);

          tokenCounts.push(tokens);
          durations.push(elapsed);

          // Quality heuristic: response should be at least 20 chars and
          // not just an error message
          if (content.length >= 20 && !content.startsWith("Error")) {
            qualityHits++;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
          { prompt: prompt.slice(0, 40), err: msg },
          "Benchmark prompt failed"
        );
        latencies.push(30_000); // Penalty for failures
      }
    }

    // Calculate percentiles
    const sorted = [...latencies].sort((a, b) => a - b);
    const latencyP50 = percentile(sorted, 50);
    const latencyP99 = percentile(sorted, 99);

    // Calculate tokens per second
    const totalTokens = tokenCounts.reduce((sum, t) => sum + t, 0);
    const totalDurationSec =
      durations.reduce((sum, d) => sum + d, 0) / 1000 || 1;
    const tokensPerSecond = Math.round(totalTokens / totalDurationSec);

    // Quality score: percentage of successful, coherent responses
    const qualityScore = Math.round(
      (qualityHits / BENCHMARK_PROMPTS.length) * 100
    );

    const result: BYOModelBenchmark = {
      latencyP50,
      latencyP99,
      tokensPerSecond,
      qualityScore,
    };

    logger.info(
      {
        provider: config.provider,
        modelId: config.modelId,
        ...result,
      },
      "BYO model benchmark complete"
    );

    return result;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Send a chat completion request using the OpenAI-compatible API format.
   * Most providers (OpenAI, Groq, Together, Fireworks, DeepSeek, OpenRouter,
   * Mistral, Cerebras) support this format. Anthropic uses a different format
   * that is handled via provider-specific branching.
   */
  private chatCompletion(
    baseUrl: string,
    config: ModelConfig,
    messages: Array<{ role: string; content: string }>,
    options?: {
      stream?: boolean;
      tools?: Array<{
        type: string;
        function: {
          name: string;
          description: string;
          parameters: Record<string, unknown>;
        };
      }>;
    }
  ): Promise<Response> {
    if (config.provider === "anthropic") {
      return this.anthropicCompletion(baseUrl, config, messages, options);
    }

    if (config.provider === "gemini") {
      return this.geminiCompletion(baseUrl, config, messages, options);
    }

    // OpenAI-compatible API
    const body: Record<string, unknown> = {
      model: config.modelId,
      messages,
      max_tokens: 256,
    };

    if (options?.stream) {
      body.stream = true;
    }
    if (options?.tools) {
      body.tools = options.tools;
    }

    return fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  }

  /** Anthropic Messages API */
  private anthropicCompletion(
    baseUrl: string,
    config: ModelConfig,
    messages: Array<{ role: string; content: string }>,
    options?: { stream?: boolean; tools?: unknown[] }
  ): Promise<Response> {
    // Anthropic requires separating the system message
    const systemMsg = messages.find((m) => m.role === "system");
    const userMessages = messages.filter((m) => m.role !== "system");

    const body: Record<string, unknown> = {
      model: config.modelId,
      max_tokens: 256,
      messages: userMessages,
    };

    if (systemMsg) {
      body.system = systemMsg.content;
    }
    if (options?.stream) {
      body.stream = true;
    }
    if (options?.tools) {
      body.tools = (
        options.tools as Array<{
          type: string;
          function: {
            name: string;
            description: string;
            parameters: Record<string, unknown>;
          };
        }>
      ).map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }

    return fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  }

  /** Google Gemini API */
  private geminiCompletion(
    baseUrl: string,
    config: ModelConfig,
    messages: Array<{ role: string; content: string }>,
    _options?: { stream?: boolean; tools?: unknown[] }
  ): Promise<Response> {
    const contents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const body = {
      contents,
      generationConfig: { maxOutputTokens: 256 },
    };

    return fetch(
      `${baseUrl}/models/${config.modelId}:generateContent?key=${config.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      }
    );
  }
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/** Extract content from a completion response body based on provider format */
function extractContent(
  body: Record<string, unknown>,
  provider: string
): string | undefined {
  if (provider === "anthropic") {
    const content = body.content as Array<{ text?: string }> | undefined;
    return content?.[0]?.text;
  }

  if (provider === "gemini") {
    const candidates = body.candidates as
      | Array<{ content?: { parts?: Array<{ text?: string }> } }>
      | undefined;
    return candidates?.[0]?.content?.parts?.[0]?.text;
  }

  // OpenAI-compatible
  const choices = body.choices as
    | Array<{ message?: { content?: string } }>
    | undefined;
  return choices?.[0]?.message?.content ?? undefined;
}

/** Check if the response contains tool calls */
function checkToolCalls(
  body: Record<string, unknown>,
  provider: string
): boolean {
  if (provider === "anthropic") {
    const content = body.content as Array<{ type?: string }> | undefined;
    return content?.some((c) => c.type === "tool_use") ?? false;
  }

  // OpenAI-compatible
  const choices = body.choices as
    | Array<{ message?: { tool_calls?: unknown[] } }>
    | undefined;
  const toolCalls = choices?.[0]?.message?.tool_calls;
  return Array.isArray(toolCalls) && toolCalls.length > 0;
}

/** Extract token count from response usage metadata */
function extractTokenCount(body: Record<string, unknown>): number | undefined {
  const usage = body.usage as
    | { completion_tokens?: number; output_tokens?: number }
    | undefined;
  return usage?.completion_tokens ?? usage?.output_tokens;
}

/** Estimate token count from text (rough: ~4 chars per token) */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Extract context window from model metadata or response */
function extractContextWindow(
  body: Record<string, unknown>,
  modelId: string
): number {
  // Some providers include model info in the response
  const modelInfo = body.model_info as { context_length?: number } | undefined;
  if (modelInfo?.context_length) {
    return modelInfo.context_length;
  }

  return estimateContextWindow(modelId);
}

/** Estimate context window from model ID based on known model patterns */
function estimateContextWindow(modelId: string): number {
  const id = modelId.toLowerCase();

  if (id.includes("gpt-4o") || id.includes("gpt-4-turbo")) {
    return 128_000;
  }
  if (id.includes("gpt-4")) {
    return 8192;
  }
  if (id.includes("gpt-3.5")) {
    return 16_385;
  }
  if (id.includes("claude-3") || id.includes("claude-4")) {
    return 200_000;
  }
  if (id.includes("claude-2")) {
    return 100_000;
  }
  if (id.includes("gemini-1.5") || id.includes("gemini-2")) {
    return 1_000_000;
  }
  if (id.includes("gemini")) {
    return 32_000;
  }
  if (id.includes("mixtral") || id.includes("mistral-large")) {
    return 32_768;
  }
  if (id.includes("llama-3.1") || id.includes("llama-3.2")) {
    return 128_000;
  }
  if (id.includes("llama")) {
    return 8192;
  }
  if (id.includes("deepseek")) {
    return 64_000;
  }
  if (id.includes("qwen")) {
    return 32_768;
  }

  // Default for unknown models
  return 4096;
}

/** Calculate the nth percentile of a sorted array */
function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const idx = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

/** Truncate a string to a maximum length */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) {
    return str;
  }
  return `${str.slice(0, maxLen)}...`;
}
