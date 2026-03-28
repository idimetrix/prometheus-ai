/**
 * Local execution command — run tasks directly via LLM API calls
 * without a Prometheus server. Competitive with Claude Code's local mode.
 *
 * Usage:
 *   prometheus local "Create an Express API with auth"
 *   prometheus local "Fix the TypeScript errors" --model claude-sonnet-4-20250514
 *   prometheus local "Add unit tests for utils" --provider openai
 */

import { Command } from "commander";
import { LocalExecutor } from "../local-executor";
import { StreamRenderer } from "../renderer/stream-renderer";

interface LocalOpts {
  apiKey?: string;
  model?: string;
  provider?: string;
}

export const localCommand = new Command("local")
  .description("Execute a task locally using direct LLM API calls")
  .argument("<prompt>", "Task description to execute")
  .option(
    "--model <model>",
    "LLM model to use (e.g. claude-sonnet-4-20250514, gpt-4o)"
  )
  .option(
    "--provider <provider>",
    "LLM provider (anthropic, openai, groq, ollama)"
  )
  .option("--api-key <key>", "API key for the LLM provider")
  .action(async (prompt: string, opts: LocalOpts) => {
    const renderer = new StreamRenderer();

    const provider = opts.provider ?? detectProviderFromEnv();
    const apiKey = opts.apiKey ?? resolveApiKeyFromEnv(provider ?? "anthropic");

    if (!apiKey && provider !== "ollama") {
      console.error(
        "Error: No API key found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or use --api-key"
      );
      process.exit(1);
    }

    const executor = new LocalExecutor({
      provider,
      apiKey,
      model: opts.model,
    });

    console.log("Prometheus Local Execution");
    console.log(`Provider: ${provider ?? "anthropic"}`);
    if (opts.model) {
      console.log(`Model: ${opts.model}`);
    }
    console.log(`Task: ${prompt}`);
    console.log(`Working directory: ${process.cwd()}`);
    console.log("---\n");

    try {
      process.stdout.write("agent> ");
      const stream = executor.chat(prompt);
      for await (const chunk of stream) {
        renderer.renderTextDelta(chunk);
      }
      renderer.clear();
      console.log("\nTask complete.");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      renderer.renderError(msg);
      process.exit(1);
    }
  });

function detectProviderFromEnv(): string | undefined {
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
  return undefined;
}

function resolveApiKeyFromEnv(provider: string): string | undefined {
  switch (provider) {
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY;
    case "openai":
      return process.env.OPENAI_API_KEY;
    case "groq":
      return process.env.GROQ_API_KEY;
    case "ollama":
      return "";
    default:
      return process.env.ANTHROPIC_API_KEY;
  }
}
