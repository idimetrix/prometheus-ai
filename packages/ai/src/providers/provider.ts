// =============================================================================
// @prometheus/ai — Universal Provider Wrapper
// =============================================================================
// A single OpenAI-SDK-based provider that works for ALL 9 providers
// (Ollama, Cerebras, Groq, Gemini, DeepSeek, Anthropic, OpenAI, OpenRouter, Mistral).
// All providers expose OpenAI-compatible APIs.
// =============================================================================

import type OpenAI from "openai";
import { createLLMClient } from "../client";
import type { ModelProvider } from "../models";
import type {
  CompletionOptions,
  CompletionResult,
  EmbeddingResult,
  StreamCompletionResult,
} from "./base";
import { processStream, toOpenAIMessages } from "./base";

export class LLMProvider {
  readonly provider: ModelProvider;
  private readonly client: OpenAI;

  constructor(provider: ModelProvider, apiKey?: string, baseURL?: string) {
    this.provider = provider;
    this.client = createLLMClient({ provider, apiKey, baseURL });
  }

  /**
   * Send a non-streaming chat completion request.
   */
  async complete(options: CompletionOptions): Promise<CompletionResult> {
    const startTime = Date.now();

    const response = await this.client.chat.completions.create({
      model: options.model,
      messages: toOpenAIMessages(options.messages),
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens,
      top_p: options.topP,
      stop: options.stop,
      stream: false,
      ...options.extra,
    });

    const choice = response.choices[0];

    return {
      content: choice?.message?.content ?? "",
      model: response.model,
      finishReason: choice?.finish_reason ?? null,
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
      latencyMs: Date.now() - startTime,
    };
  }

  /**
   * Send a streaming chat completion request.
   * Returns an async iterable of chunks + a promise that resolves when done.
   */
  async stream(options: CompletionOptions): Promise<StreamCompletionResult> {
    const startTime = Date.now();

    const stream = await this.client.chat.completions.create({
      model: options.model,
      messages: toOpenAIMessages(options.messages),
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens,
      top_p: options.topP,
      stop: options.stop,
      stream: true,
      stream_options: { include_usage: true },
      ...options.extra,
    });

    return processStream(stream, startTime);
  }

  /**
   * Generate embeddings for the given input texts.
   * Only works with providers that support the /embeddings endpoint
   * (Ollama, OpenAI, Mistral).
   */
  async embed(
    model: string,
    input: string | string[]
  ): Promise<EmbeddingResult> {
    const texts = Array.isArray(input) ? input : [input];

    const response = await this.client.embeddings.create({
      model,
      input: texts,
    });

    return {
      embeddings: response.data.map((d) => d.embedding),
      model: response.model,
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
    };
  }

  /**
   * Quick health check: sends a minimal request and checks for a valid response.
   * Returns true if the provider is responsive, false otherwise.
   */
  async healthCheck(model: string, timeoutMs = 10_000): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const response = await this.client.chat.completions.create(
        {
          model,
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 1,
          stream: false,
        },
        { signal: controller.signal }
      );

      clearTimeout(timer);
      return response.choices.length > 0;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Convenience factory functions for each provider
// ---------------------------------------------------------------------------

export function createOllamaProvider(baseURL?: string): LLMProvider {
  return new LLMProvider("ollama", undefined, baseURL);
}

export function createCerebrasProvider(apiKey?: string): LLMProvider {
  return new LLMProvider("cerebras", apiKey);
}

export function createGroqProvider(apiKey?: string): LLMProvider {
  return new LLMProvider("groq", apiKey);
}

export function createGeminiProvider(apiKey?: string): LLMProvider {
  return new LLMProvider("gemini", apiKey);
}

export function createDeepSeekProvider(apiKey?: string): LLMProvider {
  return new LLMProvider("deepseek", apiKey);
}

export function createAnthropicProvider(apiKey?: string): LLMProvider {
  return new LLMProvider("anthropic", apiKey);
}

export function createOpenAIProvider(apiKey?: string): LLMProvider {
  return new LLMProvider("openai", apiKey);
}

export function createOpenRouterProvider(apiKey?: string): LLMProvider {
  return new LLMProvider("openrouter", apiKey);
}

export function createMistralProvider(apiKey?: string): LLMProvider {
  return new LLMProvider("mistral", apiKey);
}

/** Create a provider instance for any ModelProvider string */
export function createProvider(
  provider: ModelProvider,
  apiKey?: string,
  baseURL?: string
): LLMProvider {
  return new LLMProvider(provider, apiKey, baseURL);
}
