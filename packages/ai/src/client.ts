import OpenAI from "openai";

export interface LLMClientOptions {
  provider: string;
  apiKey?: string;
  baseURL?: string;
}

const PROVIDER_URLS: Record<string, string> = {
  ollama: "http://localhost:11434/v1",
  cerebras: "https://api.cerebras.ai/v1",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  mistral: "https://api.mistral.ai/v1",
  deepseek: "https://api.deepseek.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
};

export function createLLMClient(options: LLMClientOptions): OpenAI {
  const baseURL = options.baseURL ?? PROVIDER_URLS[options.provider];
  if (!baseURL) {
    throw new Error(`Unknown provider: ${options.provider}`);
  }

  return new OpenAI({
    apiKey: options.apiKey ?? getProviderKey(options.provider),
    baseURL,
  });
}

function getProviderKey(provider: string): string {
  const envMap: Record<string, string> = {
    ollama: "ollama",
    cerebras: "CEREBRAS_API_KEY",
    groq: "GROQ_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    mistral: "MISTRAL_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    gemini: "GEMINI_API_KEY",
  };

  const envVar = envMap[provider];
  if (!envVar) return "not-needed";
  if (envVar === "ollama") return "ollama";

  const key = process.env[envVar];
  if (!key) {
    throw new Error(`Missing API key: ${envVar}`);
  }
  return key;
}
