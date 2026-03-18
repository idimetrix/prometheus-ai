export type ModelProvider =
  | "ollama"
  | "cerebras"
  | "groq"
  | "gemini"
  | "openrouter"
  | "mistral"
  | "deepseek"
  | "anthropic"
  | "openai";

export type ModelTier = 0 | 1 | 2 | 3 | 4;

export interface ModelConfig {
  id: string;
  provider: ModelProvider;
  displayName: string;
  tier: ModelTier;
  contextWindow: number;
  costPerInputToken: number;
  costPerOutputToken: number;
  capabilities: string[];
  rpmLimit: number | null;
  tpmLimit: number | null;
}

export const MODEL_REGISTRY: Record<string, ModelConfig> = {
  // Tier 0: Local Ollama (FREE, UNLIMITED)
  "ollama/qwen3-coder-next": {
    id: "qwen3-coder-next",
    provider: "ollama",
    displayName: "Qwen3 Coder Next 80B",
    tier: 0,
    contextWindow: 131072,
    costPerInputToken: 0,
    costPerOutputToken: 0,
    capabilities: ["coding", "analysis", "debugging"],
    rpmLimit: null,
    tpmLimit: null,
  },
  "ollama/deepseek-r1:32b": {
    id: "deepseek-r1:32b",
    provider: "ollama",
    displayName: "DeepSeek R1 32B",
    tier: 0,
    contextWindow: 131072,
    costPerInputToken: 0,
    costPerOutputToken: 0,
    capabilities: ["reasoning", "architecture", "security"],
    rpmLimit: null,
    tpmLimit: null,
  },
  "ollama/qwen3.5:27b": {
    id: "qwen3.5:27b",
    provider: "ollama",
    displayName: "Qwen 3.5 27B",
    tier: 0,
    contextWindow: 131072,
    costPerInputToken: 0,
    costPerOutputToken: 0,
    capabilities: ["planning", "architecture", "orchestration"],
    rpmLimit: null,
    tpmLimit: null,
  },
  "ollama/qwen2.5-coder:14b": {
    id: "qwen2.5-coder:14b",
    provider: "ollama",
    displayName: "Qwen 2.5 Coder 14B",
    tier: 0,
    contextWindow: 131072,
    costPerInputToken: 0,
    costPerOutputToken: 0,
    capabilities: ["coding", "background"],
    rpmLimit: null,
    tpmLimit: null,
  },
  "ollama/nomic-embed-text": {
    id: "nomic-embed-text",
    provider: "ollama",
    displayName: "Nomic Embed Text",
    tier: 0,
    contextWindow: 8192,
    costPerInputToken: 0,
    costPerOutputToken: 0,
    capabilities: ["embedding"],
    rpmLimit: null,
    tpmLimit: null,
  },

  // Tier 1: Free APIs
  "cerebras/qwen3-235b": {
    id: "qwen3-235b",
    provider: "cerebras",
    displayName: "Qwen3 235B (Cerebras)",
    tier: 1,
    contextWindow: 8192,
    costPerInputToken: 0,
    costPerOutputToken: 0,
    capabilities: ["coding", "iteration", "speed"],
    rpmLimit: 30,
    tpmLimit: 1000000,
  },
  "groq/llama-3.3-70b-versatile": {
    id: "llama-3.3-70b-versatile",
    provider: "groq",
    displayName: "Llama 3.3 70B (Groq)",
    tier: 1,
    contextWindow: 131072,
    costPerInputToken: 0,
    costPerOutputToken: 0,
    capabilities: ["testing", "streaming", "speed"],
    rpmLimit: 30,
    tpmLimit: 131072,
  },
  "gemini/gemini-2.5-flash": {
    id: "gemini-2.5-flash",
    provider: "gemini",
    displayName: "Gemini 2.5 Flash",
    tier: 1,
    contextWindow: 1048576,
    costPerInputToken: 0,
    costPerOutputToken: 0,
    capabilities: ["long-context", "analysis", "codebase-scan"],
    rpmLimit: 15,
    tpmLimit: 4000000,
  },

  // Tier 2: Low-cost APIs
  "deepseek/deepseek-coder": {
    id: "deepseek-coder",
    provider: "deepseek",
    displayName: "DeepSeek Coder",
    tier: 2,
    contextWindow: 131072,
    costPerInputToken: 0.00000014,
    costPerOutputToken: 0.00000028,
    capabilities: ["coding", "debugging"],
    rpmLimit: 60,
    tpmLimit: null,
  },

  // Tier 3: Mid-tier
  "anthropic/claude-sonnet-4-6": {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    displayName: "Claude Sonnet 4.6",
    tier: 3,
    contextWindow: 200000,
    costPerInputToken: 0.000003,
    costPerOutputToken: 0.000015,
    capabilities: ["coding", "vision", "review", "reasoning"],
    rpmLimit: 50,
    tpmLimit: 80000,
  },

  // Tier 4: Premium
  "anthropic/claude-opus-4-6": {
    id: "claude-opus-4-6",
    provider: "anthropic",
    displayName: "Claude Opus 4.6",
    tier: 4,
    contextWindow: 200000,
    costPerInputToken: 0.000015,
    costPerOutputToken: 0.000075,
    capabilities: ["coding", "reasoning", "architecture", "complex"],
    rpmLimit: 20,
    tpmLimit: 80000,
  },
};

export function getModelConfig(modelKey: string): ModelConfig | undefined {
  return MODEL_REGISTRY[modelKey];
}
