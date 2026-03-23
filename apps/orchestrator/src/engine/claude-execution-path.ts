import { createLogger } from "@prometheus/logger";
import { modelRouterClient } from "@prometheus/utils";

const logger = createLogger("orchestrator:claude-execution-path");

interface ClaudeExecutionOptions {
  enableExtendedThinking: boolean;
  maxThinkingTokens: number;
  model: string;
  systemPrompt: string;
  temperature?: number;
  tools?: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
}

interface ClaudeExecutionResult {
  content: string;
  model: string;
  reasoning?: string;
  stopReason: string;
  thinkingTokens: number;
  tokensIn: number;
  tokensOut: number;
  toolCalls: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
}

const PREMIUM_MODELS = [
  "anthropic/claude-opus-4-6",
  "anthropic/claude-sonnet-4-6",
] as const;

export class ClaudeExecutionPath {
  async executeWithExtendedThinking(
    messages: Array<{ role: string; content: string }>,
    options: ClaudeExecutionOptions
  ): Promise<ClaudeExecutionResult> {
    logger.info(
      {
        model: options.model,
        extendedThinking: options.enableExtendedThinking,
        maxThinkingTokens: options.maxThinkingTokens,
      },
      "Executing via Claude execution path"
    );

    const response = await modelRouterClient.post<{
      choices: Array<{
        message: {
          content: string;
          tool_calls?: Array<{
            id: string;
            function: { name: string; arguments: string };
          }>;
        };
        finish_reason: string;
      }>;
      usage: {
        prompt_tokens: number;
        completion_tokens: number;
        thinking_tokens?: number;
      };
      model: string;
      reasoning?: string;
    }>("/v1/chat/completions", {
      model: options.model,
      messages: [
        { role: "system", content: options.systemPrompt },
        ...messages,
      ],
      temperature: options.temperature ?? 0,
      tools: options.tools?.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      })),
      metadata: {
        extended_thinking: options.enableExtendedThinking,
        max_thinking_tokens: options.maxThinkingTokens,
        slot: "premium",
      },
    });

    const { data } = response;
    const choice = data.choices[0];
    const toolCalls =
      choice?.message.tool_calls?.map(
        (tc: {
          id: string;
          function: { name: string; arguments: string };
        }) => ({
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
        })
      ) ?? [];

    return {
      content: choice?.message.content ?? "",
      model: data.model,
      reasoning: data.reasoning,
      stopReason: choice?.finish_reason ?? "stop",
      tokensIn: data.usage.prompt_tokens,
      tokensOut: data.usage.completion_tokens,
      thinkingTokens: data.usage.thinking_tokens ?? 0,
      toolCalls,
    };
  }

  shouldUsePremiumPath(taskComplexity: string, role: string): boolean {
    const complexRoles = ["architect", "security_auditor", "orchestrator"];
    const complexTasks = ["architecture", "security-audit", "complex-debug"];

    return complexRoles.includes(role) || complexTasks.includes(taskComplexity);
  }

  getRecommendedModel(taskComplexity: string): string {
    if (
      taskComplexity === "architecture" ||
      taskComplexity === "complex-debug"
    ) {
      return PREMIUM_MODELS[0];
    }
    return PREMIUM_MODELS[1];
  }
}
