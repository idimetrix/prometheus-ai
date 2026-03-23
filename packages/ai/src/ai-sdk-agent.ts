// =============================================================================
// AI SDK 6 Agent Adapter — Bridges BaseAgent role system with AI SDK 6
// =============================================================================

import {
  generateText,
  type LanguageModel,
  type LanguageModelUsage,
  type StepResult,
  stepCountIs,
  streamText,
  type ToolSet,
} from "ai";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface AiSdkAgentConfig {
  /** Signal to abort the generation. */
  abortSignal?: AbortSignal;
  /** Maximum tool-use steps before stopping. Defaults to 50. */
  maxSteps?: number;
  /** Maximum tokens per generation step. */
  maxTokens?: number;
  /** The AI SDK 6 language model to use. */
  model: LanguageModel;
  /** Agent role identifier (e.g., "backend_coder"). */
  role: string;
  /** Full system prompt (reasoning protocol + role prompt). */
  systemPrompt: string;
  /** Sampling temperature for the model. */
  temperature?: number;
  /** The AI SDK 6 tool set (converted from agent-sdk tools). */
  tools: ToolSet;
}

export interface AgentStepInfo {
  stepIndex: number;
  text: string;
  toolCalls: Array<{
    toolName: string;
    input: unknown;
    output: unknown;
  }>;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export interface AgentExecutionResult {
  filesChanged: string[];
  steps: AgentStepInfo[];
  text: string;
  totalToolCalls: number;
  totalUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export type AgentStreamEvent =
  | { type: "text-delta"; textDelta: string }
  | {
      type: "tool-call";
      toolName: string;
      toolCallId: string;
      args: unknown;
    }
  | {
      type: "tool-result";
      toolName: string;
      toolCallId: string;
      result: unknown;
    }
  | { type: "step-start"; stepIndex: number }
  | { type: "step-finish"; step: AgentStepInfo }
  | {
      type: "finish";
      text: string;
      usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };
      totalToolCalls: number;
      filesChanged: string[];
    };

export interface AgentStreamCallbacks {
  /** Called when a file write/edit tool is executed. */
  onFileChange?: (filePath: string, toolName: string) => void;
  /** Called after each step completes. Return false to abort. */
  onStepFinish?: (step: AgentStepInfo) => void | Promise<void>;
  /** Called when a tool call needs approval. Return true to proceed. */
  onToolApproval?: (toolName: string, input: unknown) => Promise<boolean>;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function normalizeUsage(usage: LanguageModelUsage) {
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + output,
  };
}

function extractFilePaths(
  toolCalls: Array<{ toolName: string; input: unknown }> | undefined
): string[] {
  if (!toolCalls) {
    return [];
  }
  const paths: string[] = [];
  for (const tc of toolCalls) {
    if (tc.toolName === "file_write" || tc.toolName === "file_edit") {
      const input = tc.input as Record<string, unknown>;
      const filePath = (input.path ?? input.filePath) as string | undefined;
      if (filePath) {
        paths.push(filePath);
      }
    }
  }
  return paths;
}

// -----------------------------------------------------------------------------
// AiSdkAgent — Unified agent execution using AI SDK 6
// -----------------------------------------------------------------------------

export class AiSdkAgent {
  private readonly config: Required<
    Pick<
      AiSdkAgentConfig,
      "model" | "tools" | "systemPrompt" | "role" | "maxSteps"
    >
  > &
    Pick<AiSdkAgentConfig, "temperature" | "maxTokens" | "abortSignal">;

  constructor(config: AiSdkAgentConfig) {
    this.config = {
      ...config,
      maxSteps: config.maxSteps ?? 50,
    };
  }

  /**
   * Run the agent to completion, returning the final text and all step results.
   */
  async generate(
    userMessage: string,
    callbacks?: AgentStreamCallbacks
  ): Promise<AgentExecutionResult> {
    const allFilesChanged = new Set<string>();
    let stepIndex = 0;
    const agentSteps: AgentStepInfo[] = [];

    const result = await generateText({
      model: this.config.model,
      tools: this.config.tools,
      system: this.config.systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      stopWhen: stepCountIs(this.config.maxSteps),
      temperature: this.config.temperature,
      maxOutputTokens: this.config.maxTokens,
      abortSignal: this.config.abortSignal,
      onStepFinish: async (step: StepResult<ToolSet>) => {
        const filePaths = extractFilePaths(step.toolCalls);
        for (const fp of filePaths) {
          allFilesChanged.add(fp);
          callbacks?.onFileChange?.(fp, "file_write");
        }

        const stepInfo: AgentStepInfo = {
          stepIndex: stepIndex++,
          toolCalls:
            step.toolCalls?.map((tc) => ({
              toolName: tc.toolName,
              input: tc.input,
              output: undefined,
            })) ?? [],
          text: step.text ?? "",
          usage: normalizeUsage(step.usage),
        };

        agentSteps.push(stepInfo);
        await callbacks?.onStepFinish?.(stepInfo);
      },
    });

    const totalToolCalls = result.steps.reduce(
      (count, step) => count + (step.toolCalls?.length ?? 0),
      0
    );

    return {
      text: result.text,
      steps: agentSteps,
      totalUsage: normalizeUsage(result.usage),
      totalToolCalls,
      filesChanged: Array.from(allFilesChanged),
    };
  }

  /**
   * Stream the agent execution, yielding events for real-time consumption.
   * This is the primary method for production use with SSE/WebSocket streaming.
   */
  async *stream(
    userMessage: string,
    callbacks?: AgentStreamCallbacks
  ): AsyncGenerator<AgentStreamEvent> {
    const allFilesChanged = new Set<string>();
    let totalToolCalls = 0;
    let stepIndex = 0;

    // Buffer for events generated inside onStepFinish callback
    const pendingEvents: AgentStreamEvent[] = [];

    const result = streamText({
      model: this.config.model,
      tools: this.config.tools,
      system: this.config.systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      stopWhen: stepCountIs(this.config.maxSteps),
      temperature: this.config.temperature,
      maxOutputTokens: this.config.maxTokens,
      abortSignal: this.config.abortSignal,
      onStepFinish: async (step: StepResult<ToolSet>) => {
        const stepToolCalls = step.toolCalls?.length ?? 0;
        totalToolCalls += stepToolCalls;

        const filePaths = extractFilePaths(step.toolCalls);
        for (const fp of filePaths) {
          allFilesChanged.add(fp);
          callbacks?.onFileChange?.(fp, "file_write");
        }

        const stepInfo: AgentStepInfo = {
          stepIndex: stepIndex++,
          toolCalls:
            step.toolCalls?.map((tc) => ({
              toolName: tc.toolName,
              input: tc.input,
              output: undefined,
            })) ?? [],
          text: step.text ?? "",
          usage: normalizeUsage(step.usage),
        };

        pendingEvents.push({ type: "step-finish", step: stepInfo });
        await callbacks?.onStepFinish?.(stepInfo);
      },
    });

    let fullText = "";

    for await (const part of result.fullStream) {
      // Drain buffered step-finish events first
      while (pendingEvents.length > 0) {
        const buffered = pendingEvents.shift();
        if (buffered) {
          yield buffered;
        }
      }

      switch (part.type) {
        case "text-delta": {
          fullText += part.text;
          yield { type: "text-delta", textDelta: part.text };
          break;
        }
        case "tool-call": {
          const toolCallId = `tc_${totalToolCalls}_${part.toolName}`;
          yield {
            type: "tool-call",
            toolName: part.toolName,
            toolCallId,
            args: part.input,
          };
          break;
        }
        case "tool-result": {
          const resultCallId = `tc_${totalToolCalls}_${part.toolName}`;
          yield {
            type: "tool-result",
            toolName: part.toolName,
            toolCallId: resultCallId,
            result: part.output,
          };
          break;
        }
        case "start-step": {
          yield { type: "step-start", stepIndex };
          break;
        }
        case "finish": {
          // Drain any remaining events
          while (pendingEvents.length > 0) {
            const buffered = pendingEvents.shift();
            if (buffered) {
              yield buffered;
            }
          }

          yield {
            type: "finish",
            text: fullText,
            usage: normalizeUsage(part.totalUsage),
            totalToolCalls,
            filesChanged: Array.from(allFilesChanged),
          };
          break;
        }
        default:
          break;
      }
    }
  }
}

// -----------------------------------------------------------------------------
// Factory helpers
// -----------------------------------------------------------------------------

export function createAiSdkAgent(config: AiSdkAgentConfig): AiSdkAgent {
  return new AiSdkAgent(config);
}
