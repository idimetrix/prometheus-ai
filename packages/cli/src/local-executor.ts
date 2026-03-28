/**
 * Local execution mode that calls LLM providers directly.
 * Provides a high-level interface for one-shot task execution
 * with streaming output, file diffs, and tool-use support.
 */

import type { TaskResult } from "./local/local-engine";
import { LocalEngine } from "./local/local-engine";

interface LocalExecutorOptions {
  /** API key for the LLM provider */
  apiKey?: string;
  /** Override the default model for the provider */
  model?: string;
  /** LLM provider to use */
  provider?: string;
  /** Whether to stream output (default true) */
  stream?: boolean;
}

/**
 * LocalExecutor wraps LocalEngine with a simplified interface
 * for direct CLI usage — one-shot tasks and streaming chat.
 */
export class LocalExecutor {
  private readonly engine: LocalEngine;
  private readonly model: string | undefined;

  constructor(options: LocalExecutorOptions) {
    const projectDir = process.cwd();

    this.engine = new LocalEngine({
      provider: options.provider,
      apiKey: options.apiKey,
      projectDir,
    });
    this.model = options.model;
  }

  /**
   * Execute a one-shot task and return the result.
   * Yields streaming text chunks as they arrive.
   */
  executeTask(prompt: string): Promise<TaskResult> {
    return this.engine.executeTask(prompt);
  }

  /**
   * Stream a chat response as an async iterable of text chunks.
   */
  async *chat(message: string): AsyncGenerator<string> {
    yield* this.engine.chat(message);
  }

  /**
   * Get the model name in use (for display).
   */
  getModelName(): string {
    return this.model ?? "default";
  }
}

export type { LocalExecutorOptions };
