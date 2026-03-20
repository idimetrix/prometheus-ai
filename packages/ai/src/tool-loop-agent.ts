// =============================================================================
// Tool Loop Agent — Wraps AI SDK 6 generateText/streamText with tool loops
// =============================================================================

import {
  generateText,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  type StepResult,
  stepCountIs,
  streamText,
  type ToolSet,
} from "ai";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface ToolLoopAgentOptions {
  /** Signal to abort the generation. */
  abortSignal?: AbortSignal;
  /** Callback invoked when a tool call requires approval. Must return true to proceed. */
  approvalCallback?: (toolName: string, input: unknown) => Promise<boolean>;
  /** Maximum number of tool-use steps before stopping. Defaults to 50. */
  maxSteps?: number;
  /** Maximum tokens per generation step. */
  maxTokens?: number;
  /** Predicate that determines whether a tool call needs human approval before execution. */
  needsApproval?: (toolName: string, input: unknown) => boolean;
  /** Callback invoked after each step completes. */
  onStepFinish?: (step: StepResult<ToolSet>) => void | Promise<void>;
  /** System prompt prepended to the conversation. */
  system?: string;
  /** Sampling temperature for the model. */
  temperature?: number;
}

export interface GenerateResult {
  steps: StepResult<ToolSet>[];
  text: string;
  toolCalls: number;
  toolResults: unknown[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export type StreamEvent =
  | { type: "text-delta"; textDelta: string }
  | { type: "tool-call"; toolName: string; args: unknown }
  | { type: "tool-result"; toolName: string; result: unknown }
  | { type: "tool-approval-requested"; toolName: string; input: unknown }
  | { type: "tool-approval-granted"; toolName: string }
  | { type: "tool-approval-rejected"; toolName: string }
  | { type: "start-step" }
  | {
      type: "finish";
      text: string;
      usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };
    };

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

export class ToolApprovalRejectedError extends Error {
  readonly toolName: string;
  readonly input: unknown;

  constructor(toolName: string, input: unknown) {
    super(`Tool call "${toolName}" was rejected by approval callback`);
    this.name = "ToolApprovalRejectedError";
    this.toolName = toolName;
    this.input = input;
  }
}

// -----------------------------------------------------------------------------
// Helper to normalize usage
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

// -----------------------------------------------------------------------------
// ToolLoopAgent
// -----------------------------------------------------------------------------

export class ToolLoopAgent {
  private readonly model: LanguageModel;
  private readonly tools: ToolSet;
  private readonly maxSteps: number;
  private readonly temperature: number | undefined;
  private readonly maxTokens: number | undefined;
  private readonly onStepFinish:
    | ((step: StepResult<ToolSet>) => void | Promise<void>)
    | undefined;
  private readonly abortSignal: AbortSignal | undefined;
  private readonly system: string | undefined;
  private readonly needsApproval:
    | ((toolName: string, input: unknown) => boolean)
    | undefined;
  private readonly approvalCallback:
    | ((toolName: string, input: unknown) => Promise<boolean>)
    | undefined;

  constructor(
    model: LanguageModel,
    tools: ToolSet,
    options?: ToolLoopAgentOptions
  ) {
    this.model = model;
    this.tools = tools;
    this.maxSteps = options?.maxSteps ?? 50;
    this.temperature = options?.temperature;
    this.maxTokens = options?.maxTokens;
    this.onStepFinish = options?.onStepFinish;
    this.abortSignal = options?.abortSignal;
    this.system = options?.system;
    this.needsApproval = options?.needsApproval;
    this.approvalCallback = options?.approvalCallback;
  }

  /**
   * Run the tool loop to completion, returning the final text and all
   * intermediate step results.
   */
  async generate(messages: ModelMessage[]): Promise<GenerateResult> {
    const result = await generateText({
      model: this.model,
      tools: this.tools,
      messages,
      stopWhen: stepCountIs(this.maxSteps),
      temperature: this.temperature,
      maxOutputTokens: this.maxTokens,
      onStepFinish: this.onStepFinish,
      abortSignal: this.abortSignal,
      system: this.system,
    });

    const toolCalls = result.steps.reduce(
      (count, step) => count + (step.toolCalls?.length ?? 0),
      0
    );

    const toolResults = result.steps.flatMap(
      (step) => step.toolResults?.map((tr) => tr.output) ?? []
    );

    return {
      text: result.text,
      steps: result.steps,
      usage: normalizeUsage(result.usage),
      toolCalls,
      toolResults,
    };
  }

  /**
   * Stream the tool loop, yielding events for text deltas, tool calls,
   * tool results, step completions, and the final finish event.
   */
  async *stream(messages: ModelMessage[]): AsyncGenerator<StreamEvent> {
    const result = streamText({
      model: this.model,
      tools: this.tools,
      messages,
      stopWhen: stepCountIs(this.maxSteps),
      temperature: this.temperature,
      maxOutputTokens: this.maxTokens,
      onStepFinish: this.onStepFinish,
      abortSignal: this.abortSignal,
      system: this.system,
    });

    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta": {
          yield { type: "text-delta", textDelta: part.text };
          break;
        }
        case "tool-call": {
          // Check if this tool call needs approval
          if (this.needsApproval?.(part.toolName, part.input)) {
            yield {
              type: "tool-approval-requested",
              toolName: part.toolName,
              input: part.input,
            };

            if (this.approvalCallback) {
              const approved = await this.approvalCallback(
                part.toolName,
                part.input
              );
              if (approved) {
                yield {
                  type: "tool-approval-granted",
                  toolName: part.toolName,
                };
              } else {
                yield {
                  type: "tool-approval-rejected",
                  toolName: part.toolName,
                };
                throw new ToolApprovalRejectedError(part.toolName, part.input);
              }
            }
          }

          yield {
            type: "tool-call",
            toolName: part.toolName,
            args: part.input,
          };
          break;
        }
        case "tool-result": {
          yield {
            type: "tool-result",
            toolName: part.toolName,
            result: part.output,
          };
          break;
        }
        case "start-step": {
          yield { type: "start-step" };
          break;
        }
        case "finish": {
          yield {
            type: "finish",
            text: "",
            usage: normalizeUsage(part.totalUsage),
          };
          break;
        }
        default: {
          // Ignore other stream part types
          break;
        }
      }
    }
  }
}

// -----------------------------------------------------------------------------
// Factory helper
// -----------------------------------------------------------------------------

export const createToolLoopAgent = (
  model: LanguageModel,
  tools: ToolSet,
  options?: ToolLoopAgentOptions
): ToolLoopAgent => new ToolLoopAgent(model, tools, options);
