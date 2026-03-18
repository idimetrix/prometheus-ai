// =============================================================================
// @prometheus/ai — Base Provider Interface
// =============================================================================

import type OpenAI from "openai";
import type { Stream } from "openai/streaming";

/** Standard chat message format (OpenAI-compatible) */
export interface ChatMessage {
  content: string;
  /** Optional image URLs for vision models */
  images?: string[];
  role: "system" | "user" | "assistant";
}

/** Options for a completion request */
export interface CompletionOptions {
  /** Provider-specific extra fields */
  extra?: Record<string, unknown>;
  maxTokens?: number;
  messages: ChatMessage[];
  model: string;
  stop?: string[];
  stream?: boolean;
  temperature?: number;
  topP?: number;
}

/** Non-streaming completion result */
export interface CompletionResult {
  content: string;
  finishReason: string | null;
  /** Latency in milliseconds */
  latencyMs: number;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/** Streaming chunk */
export interface StreamChunk {
  content: string;
  finishReason: string | null;
  model: string;
}

/** Streaming completion result (async iterable) */
export interface StreamCompletionResult {
  /** Resolves when the stream ends with final usage info */
  done: Promise<{
    finishReason: string | null;
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
    latencyMs: number;
  }>;
  stream: AsyncIterable<StreamChunk>;
}

/** Embedding result */
export interface EmbeddingResult {
  embeddings: number[][];
  model: string;
  usage: {
    promptTokens: number;
    totalTokens: number;
  };
}

/**
 * Convert ChatMessage[] to OpenAI-compatible message format.
 * Handles vision (image_url) content when images are present.
 */
export function toOpenAIMessages(
  messages: ChatMessage[]
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((msg) => {
    if (msg.images && msg.images.length > 0) {
      const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
        { type: "text", text: msg.content },
        ...msg.images.map(
          (url): OpenAI.Chat.Completions.ChatCompletionContentPart => ({
            type: "image_url",
            image_url: { url },
          })
        ),
      ];
      return { role: msg.role as "user", content };
    }
    return { role: msg.role, content: msg.content };
  });
}

/**
 * Process an OpenAI streaming response into our StreamCompletionResult format.
 */
export function processStream(
  stream: Stream<OpenAI.Chat.Completions.ChatCompletionChunk>,
  startTime: number
): StreamCompletionResult {
  let finishReason: string | null = null;
  let promptTokens = 0;
  let completionTokens = 0;

  let resolveDone: (
    value: StreamCompletionResult["done"] extends Promise<infer T> ? T : never
  ) => void;
  const done = new Promise<
    StreamCompletionResult["done"] extends Promise<infer T> ? T : never
  >((resolve) => {
    resolveDone = resolve;
  });

  async function* iterate(): AsyncIterable<StreamChunk> {
    try {
      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) {
          continue;
        }

        const content = choice.delta?.content ?? "";
        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }

        if (chunk.usage) {
          promptTokens = chunk.usage.prompt_tokens ?? 0;
          completionTokens = chunk.usage.completion_tokens ?? 0;
        }

        if (content) {
          completionTokens += 1; // Rough estimate if usage not reported per chunk
          yield {
            content,
            finishReason: choice.finish_reason ?? null,
            model: chunk.model,
          };
        }
      }
    } finally {
      resolveDone?.({
        finishReason,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
        latencyMs: Date.now() - startTime,
      });
    }
  }

  return { stream: iterate(), done };
}
