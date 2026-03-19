import { createLogger } from "@prometheus/logger";
import type { AgentToolDefinition } from "../tools/types";

const logger = createLogger("agent-sdk:claude-agent");

interface ClaudeAgentConfig {
  apiKey?: string;
  enableExtendedThinking?: boolean;
  maxThinkingTokens?: number;
  maxTurns?: number;
  model?: string;
  systemPrompt: string;
  tools?: AgentToolDefinition[];
}

interface ClaudeAgentMessage {
  content: string;
  role: "user" | "assistant";
  toolCalls?: Array<{
    id: string;
    input: Record<string, unknown>;
    name: string;
  }>;
  toolResults?: Array<{
    content: string;
    toolCallId: string;
  }>;
}

interface ClaudeAgentResult {
  content: string;
  messages: ClaudeAgentMessage[];
  model: string;
  stopReason: string;
  thinkingTokens: number;
  tokensIn: number;
  tokensOut: number;
  toolCallCount: number;
  turns: number;
}

export class ClaudeAgentProvider {
  private readonly config: Required<
    Pick<
      ClaudeAgentConfig,
      | "systemPrompt"
      | "model"
      | "maxTurns"
      | "maxThinkingTokens"
      | "enableExtendedThinking"
    >
  > & { apiKey?: string; tools: AgentToolDefinition[] };

  constructor(config: ClaudeAgentConfig) {
    this.config = {
      systemPrompt: config.systemPrompt,
      model: config.model ?? "claude-sonnet-4-6-20250514",
      maxTurns: config.maxTurns ?? 10,
      maxThinkingTokens: config.maxThinkingTokens ?? 16_384,
      enableExtendedThinking: config.enableExtendedThinking ?? false,
      apiKey: config.apiKey ?? process.env.ANTHROPIC_API_KEY,
      tools: config.tools ?? [],
    };
  }

  async run(
    userMessage: string,
    onToolCall?: (
      name: string,
      input: Record<string, unknown>
    ) => Promise<string>
  ): Promise<ClaudeAgentResult> {
    const messages: ClaudeAgentMessage[] = [
      { role: "user", content: userMessage },
    ];

    let turns = 0;
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let totalThinkingTokens = 0;
    let toolCallCount = 0;
    let lastContent = "";
    let stopReason = "end_turn";

    const baseUrl = process.env.MODEL_ROUTER_URL ?? "http://localhost:4004";

    while (turns < this.config.maxTurns) {
      turns++;

      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: "system", content: this.config.systemPrompt },
            ...messages.map((m) => ({ role: m.role, content: m.content })),
          ],
          tools: this.config.tools.map((t) => ({
            type: "function",
            function: {
              name: t.name,
              description: t.description,
              parameters: t.inputSchema,
            },
          })),
          metadata: {
            extended_thinking: this.config.enableExtendedThinking,
            max_thinking_tokens: this.config.maxThinkingTokens,
            slot: "premium",
          },
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Claude API error: ${response.status} ${text}`);
      }

      const data = (await response.json()) as {
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
      };

      const choice = data.choices[0];
      if (!choice) {
        break;
      }

      totalTokensIn += data.usage.prompt_tokens;
      totalTokensOut += data.usage.completion_tokens;
      totalThinkingTokens += data.usage.thinking_tokens ?? 0;
      lastContent = choice.message.content ?? "";
      stopReason = choice.finish_reason;

      if (!choice.message.tool_calls?.length) {
        messages.push({ role: "assistant", content: lastContent });
        break;
      }

      const toolCalls = choice.message.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
      }));

      messages.push({
        role: "assistant",
        content: lastContent,
        toolCalls,
      });

      toolCallCount += toolCalls.length;

      if (onToolCall) {
        const toolResults: Array<{ toolCallId: string; content: string }> = [];
        for (const tc of toolCalls) {
          logger.debug({ tool: tc.name }, "Executing tool call");
          const result = await onToolCall(tc.name, tc.input);
          toolResults.push({ toolCallId: tc.id, content: result });
        }
        messages.push({
          role: "user",
          content: toolResults.map((r) => r.content).join("\n\n"),
          toolResults,
        });
      } else {
        break;
      }
    }

    return {
      content: lastContent,
      model: this.config.model,
      stopReason,
      tokensIn: totalTokensIn,
      tokensOut: totalTokensOut,
      thinkingTokens: totalThinkingTokens,
      toolCallCount,
      turns,
      messages,
    };
  }
}
