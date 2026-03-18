import { createLogger } from "@prometheus/logger";
import { MODEL_REGISTRY, createLLMClient, type ModelConfig } from "@prometheus/ai";
import type { RateLimitManager } from "./rate-limiter";

interface CompletionRequest {
  model?: string;
  messages: Array<{ role: string; content: string }>;
  tools?: unknown[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  // Routing hints
  task_type?: string;
  prefer_tier?: number;
  org_id?: string;
  user_api_keys?: Record<string, string>;
}

interface CompletionResponse {
  id: string;
  model: string;
  provider: string;
  choices: Array<{
    message: { role: string; content: string; tool_calls?: unknown[] };
    finish_reason: string;
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export class ModelRouterService {
  private readonly logger = createLogger("model-router:service");
  private readonly rateLimiter: RateLimitManager;

  constructor(rateLimiter: RateLimitManager) {
    this.rateLimiter = rateLimiter;
  }

  async routeCompletion(request: CompletionRequest): Promise<CompletionResponse> {
    // Determine best model based on task type and availability
    const modelKey = this.selectModel(request);
    const modelConfig = MODEL_REGISTRY[modelKey];
    if (!modelConfig) {
      throw new Error(`Model not found: ${modelKey}`);
    }

    // Check rate limits
    if (!this.rateLimiter.canMakeRequest(modelConfig.provider, modelKey)) {
      // Try fallback
      const fallbackKey = this.getFallback(modelKey, request);
      if (fallbackKey) {
        return this.executeCompletion(fallbackKey, request);
      }
      throw new Error(`Rate limited on ${modelConfig.provider}, no fallback available`);
    }

    return this.executeCompletion(modelKey, request);
  }

  private selectModel(request: CompletionRequest): string {
    // If specific model requested, use it
    if (request.model && MODEL_REGISTRY[request.model]) {
      return request.model;
    }

    // Route based on task type
    const taskType = request.task_type ?? "coding";
    const routingMap: Record<string, string> = {
      "codebase-analysis": "gemini/gemini-2.5-flash",
      "architecture": "ollama/deepseek-r1:32b",
      "coding": "ollama/qwen3-coder-next",
      "quick-fix": "cerebras/qwen3-235b",
      "testing": "groq/llama-3.3-70b-versatile",
      "security": "ollama/deepseek-r1:32b",
      "planning": "ollama/qwen3.5:27b",
      "review": "anthropic/claude-sonnet-4-6",
      "complex": "anthropic/claude-opus-4-6",
      "embedding": "ollama/nomic-embed-text",
    };

    return routingMap[taskType] ?? "ollama/qwen3-coder-next";
  }

  private getFallback(modelKey: string, request: CompletionRequest): string | null {
    // Fallback chain: try next tier
    const fallbacks: Record<string, string[]> = {
      "cerebras/qwen3-235b": ["groq/llama-3.3-70b-versatile", "ollama/qwen2.5-coder:14b"],
      "groq/llama-3.3-70b-versatile": ["cerebras/qwen3-235b", "ollama/qwen2.5-coder:14b"],
      "gemini/gemini-2.5-flash": ["ollama/qwen3-coder-next"],
      "ollama/qwen3-coder-next": ["cerebras/qwen3-235b"],
      "ollama/deepseek-r1:32b": ["ollama/qwen3.5:27b"],
      "anthropic/claude-sonnet-4-6": ["ollama/deepseek-r1:32b"],
    };

    const chain = fallbacks[modelKey] ?? [];
    for (const fallback of chain) {
      if (this.rateLimiter.canMakeRequest(
        MODEL_REGISTRY[fallback]?.provider ?? "",
        fallback
      )) {
        this.logger.info({ from: modelKey, to: fallback }, "Falling back to alternative model");
        return fallback;
      }
    }
    return null;
  }

  private async executeCompletion(modelKey: string, request: CompletionRequest): Promise<CompletionResponse> {
    const config = MODEL_REGISTRY[modelKey]!;

    // Check for user-provided API keys
    const apiKey = request.user_api_keys?.[config.provider];
    const client = createLLMClient({
      provider: config.provider,
      apiKey: apiKey,
    });

    this.logger.info({
      model: modelKey,
      provider: config.provider,
      messageCount: request.messages.length,
    }, "Routing completion request");

    // Record rate limit usage
    this.rateLimiter.recordRequest(config.provider, modelKey);

    try {
      const response = await client.chat.completions.create({
        model: config.id,
        messages: request.messages as Parameters<typeof client.chat.completions.create>[0]["messages"],
        tools: request.tools as Parameters<typeof client.chat.completions.create>[0]["tools"],
        temperature: request.temperature ?? 0.1,
        max_tokens: request.max_tokens ?? 4096,
        stream: false,
      });

      return {
        id: response.id,
        model: modelKey,
        provider: config.provider,
        choices: response.choices.map((c) => ({
          message: {
            role: c.message.role,
            content: c.message.content ?? "",
            tool_calls: c.message.tool_calls as unknown[] | undefined,
          },
          finish_reason: c.finish_reason ?? "stop",
        })),
        usage: {
          prompt_tokens: response.usage?.prompt_tokens ?? 0,
          completion_tokens: response.usage?.completion_tokens ?? 0,
          total_tokens: response.usage?.total_tokens ?? 0,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error({ model: modelKey, error: msg }, "Completion request failed");

      // Try fallback on error
      const fallback = this.getFallback(modelKey, request);
      if (fallback) {
        return this.executeCompletion(fallback, request);
      }
      throw error;
    }
  }

  getAvailableModels(): Array<{ id: string; provider: string; tier: number; available: boolean }> {
    return Object.entries(MODEL_REGISTRY).map(([key, config]) => ({
      id: key,
      provider: config.provider,
      tier: config.tier,
      available: this.rateLimiter.canMakeRequest(config.provider, key),
    }));
  }
}
