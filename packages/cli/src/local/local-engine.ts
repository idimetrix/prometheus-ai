import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LOCAL_TOOLS } from "./tools";
import type { LocalTool, ToolResult } from "./tools/types";

type Provider = "anthropic" | "groq" | "ollama" | "openai";

interface Message {
  content: string;
  role: string;
}

interface ToolCall {
  arguments: Record<string, unknown>;
  id: string;
  name: string;
}

interface TaskResult {
  error?: string;
  iterations: number;
  messages: Message[];
  success: boolean;
  toolCalls: Array<{ name: string; result: ToolResult }>;
}

interface LocalEngineOptions {
  apiKey?: string;
  projectDir: string;
  provider?: string;
}

interface AnthropicToolDef {
  description: string;
  input_schema: {
    properties: Record<string, unknown>;
    required: string[];
    type: string;
  };
  name: string;
}

interface OpenAIToolDef {
  function: {
    description: string;
    name: string;
    parameters: {
      properties: Record<string, unknown>;
      required: string[];
      type: string;
    };
  };
  type: "function";
}

interface AnthropicContentBlock {
  id?: string;
  input?: Record<string, unknown>;
  name?: string;
  text?: string;
  type: string;
}

interface AnthropicResponse {
  content: AnthropicContentBlock[];
  stop_reason: string;
}

interface OpenAIChoice {
  finish_reason: string;
  message: {
    content: string | null;
    tool_calls?: Array<{
      function: { arguments: string; name: string };
      id: string;
      type: string;
    }>;
  };
}

interface OpenAIResponse {
  choices: OpenAIChoice[];
}

interface OllamaResponse {
  message: {
    content: string;
    tool_calls?: Array<{
      function: { arguments: Record<string, unknown>; name: string };
    }>;
  };
}

const MAX_ITERATIONS = 50;

/**
 * Local execution engine that calls LLM providers directly via HTTP
 * and executes local tools in an agent loop.
 */
export class LocalEngine {
  private readonly apiKey: string;
  private readonly messages: Message[];
  private readonly projectDir: string;
  private readonly provider: Provider;
  private readonly systemPrompt: string;
  private readonly tools: Map<string, LocalTool>;

  constructor(options: LocalEngineOptions) {
    this.projectDir = options.projectDir;
    this.provider = this.resolveProvider(options.provider);
    this.apiKey = this.resolveApiKey(options.apiKey);
    this.messages = [];
    this.tools = new Map();
    this.systemPrompt = this.buildSystemPrompt();

    for (const tool of LOCAL_TOOLS) {
      this.tools.set(tool.name, tool);
    }
  }

  /**
   * Interactive chat: send a message and yield streaming text tokens.
   */
  async *chat(userMessage: string): AsyncGenerator<string> {
    this.messages.push({ role: "user", content: userMessage });

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const { text, toolCalls, stopReason } = await this.callLLM();

      if (text) {
        this.messages.push({ role: "assistant", content: text });
        yield text;
      }

      if (toolCalls.length === 0 || stopReason !== "tool_use") {
        break;
      }

      for (const call of toolCalls) {
        const tool = this.tools.get(call.name);
        if (!tool) {
          const errorResult = `Tool "${call.name}" not found`;
          this.messages.push({
            role: "user",
            content: `[Tool result for ${call.name}]: ${errorResult}`,
          });
          yield `\n  [ERROR] ${errorResult}\n`;
          continue;
        }

        yield `\n  [TOOL] ${call.name}\n`;
        const result = await tool.execute(call.arguments, this.projectDir);
        const truncated = this.truncateOutput(result.output);
        this.messages.push({
          role: "user",
          content: `[Tool result for ${call.name}]: ${truncated}`,
        });

        const status = result.success ? "OK" : "FAIL";
        yield `  [${status}] ${call.name}: ${truncated.slice(0, 200)}\n`;
      }
    }
  }

  /**
   * Execute a full task: run agent loop until completion or max iterations.
   */
  async executeTask(description: string): Promise<TaskResult> {
    this.messages.push({ role: "user", content: description });
    const allToolCalls: Array<{ name: string; result: ToolResult }> = [];
    let iterations = 0;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      iterations++;
      const { text, toolCalls, stopReason } = await this.callLLM();

      if (text) {
        this.messages.push({ role: "assistant", content: text });
      }

      if (toolCalls.length === 0 || stopReason !== "tool_use") {
        break;
      }

      for (const call of toolCalls) {
        const tool = this.tools.get(call.name);
        if (!tool) {
          this.messages.push({
            role: "user",
            content: `[Tool result for ${call.name}]: Tool not found`,
          });
          continue;
        }

        const result = await tool.execute(call.arguments, this.projectDir);
        allToolCalls.push({ name: call.name, result });
        const truncated = this.truncateOutput(result.output);
        this.messages.push({
          role: "user",
          content: `[Tool result for ${call.name}]: ${truncated}`,
        });
      }
    }

    return {
      success: true,
      iterations,
      messages: [...this.messages],
      toolCalls: allToolCalls,
    };
  }

  private buildSystemPrompt(): string {
    let prompt = "You are Prometheus, an AI engineering assistant. ";
    prompt += "You help developers with code tasks using the available tools. ";
    prompt +=
      "Always use tools to read and write files rather than guessing content. ";
    prompt += "Be concise and focus on completing the task.\n\n";

    // Load .prometheus.md if it exists
    const prometheusPath = join(this.projectDir, ".prometheus.md");
    if (existsSync(prometheusPath)) {
      try {
        const content = readFileSync(prometheusPath, "utf-8");
        prompt += `## Project Context\n\n${content}\n\n`;
      } catch {
        // Skip unreadable file
      }
    }

    prompt += `## Working Directory\n\n${this.projectDir}\n`;

    return prompt;
  }

  private callLLM(): Promise<{
    stopReason: string;
    text: string;
    toolCalls: ToolCall[];
  }> {
    switch (this.provider) {
      case "anthropic":
        return this.callAnthropic();
      case "openai":
        return this.callOpenAI();
      case "groq":
        return this.callGroq();
      case "ollama":
        return this.callOllama();
      default:
        return this.callAnthropic();
    }
  }

  private async callAnthropic(): Promise<{
    stopReason: string;
    text: string;
    toolCalls: ToolCall[];
  }> {
    const tools: AnthropicToolDef[] = [];
    for (const tool of this.tools.values()) {
      tools.push({
        name: tool.name,
        description: tool.description,
        input_schema: {
          type: tool.parameters.type,
          properties: tool.parameters.properties,
          required: tool.parameters.required,
        },
      });
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: this.systemPrompt,
        messages: this.messages.map((m) => ({
          role: m.role === "user" ? "user" : "assistant",
          content: m.content,
        })),
        tools,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as AnthropicResponse;
    let text = "";
    const toolCalls: ToolCall[] = [];

    for (const block of data.content) {
      if (block.type === "text" && block.text) {
        text += block.text;
      } else if (
        block.type === "tool_use" &&
        block.id &&
        block.name &&
        block.input
      ) {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input,
        });
      }
    }

    return { text, toolCalls, stopReason: data.stop_reason };
  }

  private async callOpenAI(): Promise<{
    stopReason: string;
    text: string;
    toolCalls: ToolCall[];
  }> {
    const tools: OpenAIToolDef[] = [];
    for (const tool of this.tools.values()) {
      tools.push({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: {
            type: tool.parameters.type,
            properties: tool.parameters.properties,
            required: tool.parameters.required,
          },
        },
      });
    }

    const messages = [
      { role: "system", content: this.systemPrompt },
      ...this.messages.map((m) => ({
        role: m.role as "assistant" | "user",
        content: m.content,
      })),
    ];

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages,
        tools,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as OpenAIResponse;
    const choice = data.choices[0];
    if (!choice) {
      return { text: "", toolCalls: [], stopReason: "stop" };
    }

    const text = choice.message.content ?? "";
    const toolCalls: ToolCall[] = [];

    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        } catch {
          // Skip malformed arguments
        }
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          arguments: args,
        });
      }
    }

    const stopReason =
      choice.finish_reason === "tool_calls" ? "tool_use" : "stop";
    return { text, toolCalls, stopReason };
  }

  private async callGroq(): Promise<{
    stopReason: string;
    text: string;
    toolCalls: ToolCall[];
  }> {
    const tools: OpenAIToolDef[] = [];
    for (const tool of this.tools.values()) {
      tools.push({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: {
            type: tool.parameters.type,
            properties: tool.parameters.properties,
            required: tool.parameters.required,
          },
        },
      });
    }

    const messages = [
      { role: "system", content: this.systemPrompt },
      ...this.messages.map((m) => ({
        role: m.role as "assistant" | "user",
        content: m.content,
      })),
    ];

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages,
          tools,
          max_tokens: 4096,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Groq API error ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as OpenAIResponse;
    const choice = data.choices[0];
    if (!choice) {
      return { text: "", toolCalls: [], stopReason: "stop" };
    }

    const text = choice.message.content ?? "";
    const toolCalls: ToolCall[] = [];

    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        } catch {
          // Skip malformed arguments
        }
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          arguments: args,
        });
      }
    }

    const stopReason =
      choice.finish_reason === "tool_calls" ? "tool_use" : "stop";
    return { text, toolCalls, stopReason };
  }

  private async callOllama(): Promise<{
    stopReason: string;
    text: string;
    toolCalls: ToolCall[];
  }> {
    const ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";

    const tools: OpenAIToolDef[] = [];
    for (const tool of this.tools.values()) {
      tools.push({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: {
            type: tool.parameters.type,
            properties: tool.parameters.properties,
            required: tool.parameters.required,
          },
        },
      });
    }

    const messages = [
      { role: "system", content: this.systemPrompt },
      ...this.messages.map((m) => ({
        role: m.role as "assistant" | "user",
        content: m.content,
      })),
    ];

    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3.1",
        messages,
        tools,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as OllamaResponse;
    const text = data.message.content ?? "";
    const toolCalls: ToolCall[] = [];

    if (data.message.tool_calls) {
      for (const [idx, tc] of data.message.tool_calls.entries()) {
        toolCalls.push({
          id: `ollama_${idx.toString()}`,
          name: tc.function.name,
          arguments: tc.function.arguments,
        });
      }
    }

    const stopReason = toolCalls.length > 0 ? "tool_use" : "stop";
    return { text, toolCalls, stopReason };
  }

  private resolveApiKey(explicit?: string): string {
    if (explicit) {
      return explicit;
    }

    switch (this.provider) {
      case "anthropic":
        return process.env.ANTHROPIC_API_KEY ?? "";
      case "openai":
        return process.env.OPENAI_API_KEY ?? "";
      case "groq":
        return process.env.GROQ_API_KEY ?? "";
      case "ollama":
        return "";
      default:
        return "";
    }
  }

  private resolveProvider(explicit?: string): Provider {
    if (explicit) {
      const normalized = explicit.toLowerCase();
      if (
        normalized === "anthropic" ||
        normalized === "openai" ||
        normalized === "groq" ||
        normalized === "ollama"
      ) {
        return normalized;
      }
    }

    if (process.env.ANTHROPIC_API_KEY) {
      return "anthropic";
    }
    if (process.env.OPENAI_API_KEY) {
      return "openai";
    }
    if (process.env.GROQ_API_KEY) {
      return "groq";
    }
    if (process.env.OLLAMA_URL) {
      return "ollama";
    }

    return "anthropic";
  }

  private truncateOutput(output: string, maxLength = 10_000): string {
    if (output.length <= maxLength) {
      return output;
    }
    const half = Math.floor(maxLength / 2);
    return `${output.slice(0, half)}\n\n... [truncated ${output.length - maxLength} chars] ...\n\n${output.slice(-half)}`;
  }
}

export type { LocalEngineOptions, TaskResult };
