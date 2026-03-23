// =============================================================================
// @prometheus/ai — Complete Model Registry
// =============================================================================
// All models across all 9 providers with context windows, costs, rate limits,
// capabilities, and provider-specific endpoints.
// =============================================================================

export type ModelProvider =
  | "ollama"
  | "cerebras"
  | "groq"
  | "gemini"
  | "openrouter"
  | "mistral"
  | "deepseek"
  | "anthropic"
  | "openai"
  | "voyage"
  | "litellm";

export type ModelTier = 0 | 1 | 2 | 3 | 4;

export type ModelCapability =
  | "chat"
  | "code"
  | "vision"
  | "embeddings"
  | "reasoning"
  | "long-context"
  | "speed"
  | "review"
  | "architecture"
  | "background"
  | "planning"
  | "complex";

export interface ModelConfig {
  /** Model capabilities */
  capabilities: ModelCapability[];
  /** Maximum context window in tokens */
  contextWindow: number;
  /** Cost per input token in USD (0 = free) */
  costPerInputToken: number;
  /** Cost per output token in USD (0 = free) */
  costPerOutputToken: number;
  displayName: string;
  /** The model ID as sent to the provider API */
  id: string;
  /** Maximum output tokens (null = provider default) */
  maxOutputTokens: number | null;
  provider: ModelProvider;
  /** Full registry key: provider/model-id */
  registryKey: string;
  /** Requests per minute limit (null = unlimited) */
  rpmLimit: number | null;
  /** Whether the model supports streaming */
  supportsStreaming: boolean;
  tier: ModelTier;
  /** Tokens per minute limit (null = unlimited) */
  tpmLimit: number | null;
}

// ---------------------------------------------------------------------------
// Provider base URLs (OpenAI-compatible endpoints)
// ---------------------------------------------------------------------------
export const PROVIDER_ENDPOINTS: Record<ModelProvider, string> = {
  ollama: "http://localhost:11434/v1",
  cerebras: "https://api.cerebras.ai/v1",
  groq: "https://api.groq.com/openai/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  openrouter: "https://openrouter.ai/api/v1",
  mistral: "https://api.mistral.ai/v1",
  deepseek: "https://api.deepseek.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
  voyage: "https://api.voyageai.com/v1",
  litellm: process.env.LITELLM_URL ?? "http://localhost:4010",
};

// ---------------------------------------------------------------------------
// Environment variable names for API keys
// ---------------------------------------------------------------------------
export const PROVIDER_ENV_KEYS: Record<ModelProvider, string> = {
  ollama: "OLLAMA_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  groq: "GROQ_API_KEY",
  gemini: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  mistral: "MISTRAL_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  voyage: "VOYAGE_API_KEY",
  litellm: "LITELLM_API_KEY",
};

// ---------------------------------------------------------------------------
// Helper to build a model config
// ---------------------------------------------------------------------------
function m(
  provider: ModelProvider,
  id: string,
  displayName: string,
  tier: ModelTier,
  contextWindow: number,
  costIn: number,
  costOut: number,
  capabilities: ModelCapability[],
  rpmLimit: number | null,
  tpmLimit: number | null,
  maxOutputTokens: number | null = null,
  supportsStreaming = true
): ModelConfig {
  return {
    id,
    registryKey: `${provider}/${id}`,
    provider,
    displayName,
    tier,
    contextWindow,
    costPerInputToken: costIn,
    costPerOutputToken: costOut,
    capabilities,
    rpmLimit,
    tpmLimit,
    supportsStreaming,
    maxOutputTokens,
  };
}

// ---------------------------------------------------------------------------
// Complete Model Registry
// ---------------------------------------------------------------------------
export const MODEL_REGISTRY: Record<string, ModelConfig> = {
  // =========================================================================
  // Tier 0: Local Ollama (FREE, UNLIMITED)
  // =========================================================================
  "ollama/qwen3-coder-next": m(
    "ollama",
    "qwen3-coder-next",
    "Qwen3 Coder Next 80B",
    0,
    32_768,
    0,
    0,
    ["chat", "code", "reasoning"],
    null,
    null,
    8192
  ),
  "ollama/deepseek-r1:32b": m(
    "ollama",
    "deepseek-r1:32b",
    "DeepSeek R1 32B (Local)",
    0,
    32_768,
    0,
    0,
    ["chat", "code", "reasoning", "architecture", "review"],
    null,
    null,
    8192
  ),
  "ollama/qwen3.5:27b": m(
    "ollama",
    "qwen3.5:27b",
    "Qwen 3.5 27B",
    0,
    32_768,
    0,
    0,
    ["chat", "code", "planning", "architecture", "reasoning"],
    null,
    null,
    8192
  ),
  "ollama/qwen2.5-coder:14b": m(
    "ollama",
    "qwen2.5-coder:14b",
    "Qwen 2.5 Coder 14B",
    0,
    32_768,
    0,
    0,
    ["chat", "code", "background"],
    null,
    null,
    8192
  ),
  "ollama/qwen2.5-coder:7b": m(
    "ollama",
    "qwen2.5-coder:7b",
    "Qwen 2.5 Coder 7B",
    0,
    32_768,
    0,
    0,
    ["chat", "code", "background"],
    null,
    null,
    4096
  ),
  "ollama/nomic-embed-text": m(
    "ollama",
    "nomic-embed-text",
    "Nomic Embed Text",
    0,
    8192,
    0,
    0,
    ["embeddings"],
    null,
    null,
    null,
    false
  ),

  // =========================================================================
  // Tier 1: Free Cloud APIs
  // =========================================================================
  "cerebras/qwen3-235b": m(
    "cerebras",
    "qwen3-235b",
    "Qwen3 235B (Cerebras)",
    1,
    8192,
    0,
    0,
    ["chat", "code", "speed"],
    30,
    1_000_000,
    8192
  ),
  "groq/llama-3.3-70b-versatile": m(
    "groq",
    "llama-3.3-70b-versatile",
    "Llama 3.3 70B (Groq)",
    1,
    131_072,
    0,
    0,
    ["chat", "code", "speed"],
    30,
    131_000,
    32_768
  ),
  "gemini/gemini-2.5-flash": m(
    "gemini",
    "gemini-2.5-flash",
    "Gemini 2.5 Flash",
    1,
    1_048_576,
    0,
    0,
    ["chat", "code", "long-context", "vision"],
    15,
    4_000_000,
    65_536
  ),

  // =========================================================================
  // Tier 2: Low-cost APIs
  // =========================================================================
  "deepseek/deepseek-chat": m(
    "deepseek",
    "deepseek-chat",
    "DeepSeek V3 (Chat)",
    2,
    131_072,
    0.000_000_27,
    0.000_001_1,
    ["chat", "code"],
    60,
    null,
    8192
  ),
  "deepseek/deepseek-coder": m(
    "deepseek",
    "deepseek-coder",
    "DeepSeek Coder",
    2,
    131_072,
    0.000_000_14,
    0.000_000_28,
    ["chat", "code"],
    60,
    null,
    8192
  ),
  "deepseek/deepseek-reasoner": m(
    "deepseek",
    "deepseek-reasoner",
    "DeepSeek R1 (API)",
    2,
    131_072,
    0.000_000_55,
    0.000_002_19,
    ["chat", "code", "reasoning"],
    60,
    null,
    8192
  ),
  "mistral/mistral-small-latest": m(
    "mistral",
    "mistral-small-latest",
    "Mistral Small",
    2,
    32_768,
    0.000_000_1,
    0.000_000_3,
    ["chat", "code"],
    2,
    null,
    8192
  ),
  "mistral/mistral-large-latest": m(
    "mistral",
    "mistral-large-latest",
    "Mistral Large",
    2,
    131_072,
    0.000_002,
    0.000_006,
    ["chat", "code", "reasoning"],
    2,
    null,
    8192
  ),

  // =========================================================================
  // Tier 2: OpenAI
  // =========================================================================
  "openai/gpt-4o-mini": m(
    "openai",
    "gpt-4o-mini",
    "GPT-4o Mini",
    2,
    128_000,
    0.000_000_15,
    0.000_000_6,
    ["chat", "code", "vision"],
    500,
    200_000,
    16_384
  ),
  "openai/gpt-4o": m(
    "openai",
    "gpt-4o",
    "GPT-4o",
    3,
    128_000,
    0.000_002_5,
    0.000_01,
    ["chat", "code", "vision", "reasoning"],
    500,
    30_000,
    16_384
  ),
  "openai/gpt-4.1": m(
    "openai",
    "gpt-4.1",
    "GPT-4.1",
    3,
    1_048_576,
    0.000_002,
    0.000_008,
    ["chat", "code", "vision", "long-context", "reasoning"],
    500,
    30_000,
    32_768
  ),
  "openai/gpt-4.1-mini": m(
    "openai",
    "gpt-4.1-mini",
    "GPT-4.1 Mini",
    2,
    1_048_576,
    0.000_000_4,
    0.000_001_6,
    ["chat", "code", "vision", "long-context"],
    500,
    200_000,
    32_768
  ),
  "openai/o3-mini": m(
    "openai",
    "o3-mini",
    "o3-mini",
    3,
    200_000,
    0.000_001_1,
    0.000_004_4,
    ["chat", "code", "reasoning"],
    500,
    200_000,
    100_000
  ),

  // =========================================================================
  // Tier 2: OpenRouter (pass-through to many models)
  // =========================================================================
  "openrouter/google/gemini-2.5-flash": m(
    "openrouter",
    "google/gemini-2.5-flash",
    "Gemini 2.5 Flash (OpenRouter)",
    2,
    1_048_576,
    0.000_000_1,
    0.000_000_4,
    ["chat", "code", "long-context", "vision"],
    20,
    200_000,
    65_536
  ),
  "openrouter/deepseek/deepseek-chat-v3": m(
    "openrouter",
    "deepseek/deepseek-chat-v3",
    "DeepSeek V3 (OpenRouter)",
    2,
    131_072,
    0.000_000_3,
    0.000_000_88,
    ["chat", "code"],
    20,
    200_000,
    8192
  ),
  "openrouter/anthropic/claude-sonnet-4": m(
    "openrouter",
    "anthropic/claude-sonnet-4",
    "Claude Sonnet 4 (OpenRouter)",
    3,
    200_000,
    0.000_003,
    0.000_015,
    ["chat", "code", "vision", "reasoning", "review"],
    20,
    200_000,
    8192
  ),
  "openrouter/meta-llama/llama-3.3-70b": m(
    "openrouter",
    "meta-llama/llama-3.3-70b",
    "Llama 3.3 70B (OpenRouter)",
    2,
    131_072,
    0.000_000_39,
    0.000_000_39,
    ["chat", "code"],
    20,
    200_000,
    8192
  ),

  // =========================================================================
  // Tier 3: Mid-tier
  // =========================================================================
  "anthropic/claude-sonnet-4-6": m(
    "anthropic",
    "claude-sonnet-4-6",
    "Claude Sonnet 4.6",
    3,
    200_000,
    0.000_003,
    0.000_015,
    ["chat", "code", "vision", "reasoning", "review", "architecture"],
    50,
    80_000,
    8192
  ),

  // =========================================================================
  // Voyage AI: Embeddings & Reranking
  // =========================================================================
  "voyage/voyage-code-3": m(
    "voyage",
    "voyage-code-3",
    "Voyage Code 3 (1024d, 32K ctx)",
    2,
    32_000,
    0.000_000_06,
    0,
    ["embeddings", "code"],
    300,
    null,
    null,
    false
  ),
  "voyage/rerank-2.5": m(
    "voyage",
    "rerank-2.5",
    "Voyage Rerank 2.5",
    2,
    32_000,
    0.000_000_05,
    0,
    ["code"],
    100,
    null,
    null,
    false
  ),

  // =========================================================================
  // Tier 4: Premium
  // =========================================================================
  "anthropic/claude-opus-4-6": m(
    "anthropic",
    "claude-opus-4-6",
    "Claude Opus 4.6",
    4,
    200_000,
    0.000_015,
    0.000_075,
    [
      "chat",
      "code",
      "vision",
      "reasoning",
      "architecture",
      "complex",
      "review",
    ],
    20,
    80_000,
    4096
  ),
};

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** Get a model config by registry key (e.g. "ollama/qwen3-coder-next") */
export function getModelConfig(modelKey: string): ModelConfig | undefined {
  return MODEL_REGISTRY[modelKey];
}

/** Get all models for a given provider */
export function getModelsByProvider(provider: ModelProvider): ModelConfig[] {
  return Object.values(MODEL_REGISTRY).filter((m) => m.provider === provider);
}

/** Get all models for a given tier */
export function getModelsByTier(tier: ModelTier): ModelConfig[] {
  return Object.values(MODEL_REGISTRY).filter((m) => m.tier === tier);
}

/** Get all models with a specific capability */
export function getModelsWithCapability(cap: ModelCapability): ModelConfig[] {
  return Object.values(MODEL_REGISTRY).filter((m) =>
    m.capabilities.includes(cap)
  );
}

/** Get all model registry keys */
export function getAllModelKeys(): string[] {
  return Object.keys(MODEL_REGISTRY);
}

/** Estimate cost in USD for a given number of input/output tokens */
export function estimateCost(
  modelKey: string,
  inputTokens: number,
  outputTokens: number
): number {
  const config = MODEL_REGISTRY[modelKey];
  if (!config) {
    return 0;
  }
  return (
    config.costPerInputToken * inputTokens +
    config.costPerOutputToken * outputTokens
  );
}
