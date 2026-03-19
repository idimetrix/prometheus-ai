// =============================================================================
// @prometheus/ai — Vercel AI SDK Adapter
// =============================================================================
// Bridges Prometheus slot configs and model registry to Vercel AI SDK provider
// instances. This adapter allows the platform to use the Vercel AI SDK's
// unified streaming and tool-calling interface instead of raw SSE parsing.
//
// Expected dependency: "ai" (Vercel AI SDK v4+)
//   pnpm add ai @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google @ai-sdk/mistral
//
// Until those packages are installed, this module uses dynamic imports with
// graceful fallback so it does not break the build.
// =============================================================================

import { MODEL_REGISTRY, type ModelConfig, PROVIDER_ENV_KEYS } from "./models";
import { type RoutingSlot, SLOT_CONFIGS } from "./slots";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration needed to create a Vercel AI SDK provider instance. */
export interface VercelProviderConfig {
  apiKey?: string;
  modelId: string;
  provider: string;
}

/**
 * A resolved Vercel AI SDK language model instance.
 * Typed as `unknown` because the concrete type comes from the `ai` package
 * which may not be installed yet. Consumers should cast to
 * `import('ai').LanguageModel` when using with `streamText()` / `generateText()`.
 */
export type VercelLanguageModel = unknown;

/** Result of resolving a slot name to its provider config. */
export interface SlotResolution {
  fallbacks: VercelProviderConfig[];
  primary: VercelProviderConfig;
  slotConfig: {
    defaultTemperature: number;
    preferStreaming: boolean;
    slot: RoutingSlot;
  };
}

// ---------------------------------------------------------------------------
// Provider factory map — each entry dynamically imports the Vercel AI SDK
// provider package and returns a language model instance.
// ---------------------------------------------------------------------------

type ProviderFactory = (
  modelId: string,
  apiKey?: string
) => Promise<VercelLanguageModel>;

const PROVIDER_FACTORIES: Record<string, ProviderFactory> = {
  openai: async (modelId: string, apiKey?: string) => {
    // Requires: @ai-sdk/openai
    const { createOpenAI } = (await import("@ai-sdk/openai" as string)) as {
      createOpenAI: (opts: { apiKey?: string }) => (id: string) => unknown;
    };
    const provider = createOpenAI({
      apiKey: apiKey ?? process.env[PROVIDER_ENV_KEYS.openai],
    });
    return provider(modelId);
  },

  anthropic: async (modelId: string, apiKey?: string) => {
    // Requires: @ai-sdk/anthropic
    const { createAnthropic } = (await import(
      "@ai-sdk/anthropic" as string
    )) as {
      createAnthropic: (opts: { apiKey?: string }) => (id: string) => unknown;
    };
    const provider = createAnthropic({
      apiKey: apiKey ?? process.env[PROVIDER_ENV_KEYS.anthropic],
    });
    return provider(modelId);
  },

  google: async (modelId: string, apiKey?: string) => {
    // Requires: @ai-sdk/google
    const { createGoogleGenerativeAI } = (await import(
      "@ai-sdk/google" as string
    )) as {
      createGoogleGenerativeAI: (opts: {
        apiKey?: string;
      }) => (id: string) => unknown;
    };
    const provider = createGoogleGenerativeAI({
      apiKey: apiKey ?? process.env[PROVIDER_ENV_KEYS.gemini],
    });
    return provider(modelId);
  },

  gemini: async (modelId: string, apiKey?: string) => {
    // Alias for google — Prometheus uses "gemini" as the provider name
    const googleFactory = PROVIDER_FACTORIES.google as ProviderFactory;
    const model = await googleFactory(modelId, apiKey);
    return model;
  },

  groq: async (modelId: string, apiKey?: string) => {
    // Requires: @ai-sdk/groq (or use OpenAI-compatible adapter)
    // Groq exposes an OpenAI-compatible API, so we use the OpenAI adapter
    // with a custom base URL.
    const { createOpenAI } = (await import("@ai-sdk/openai" as string)) as {
      createOpenAI: (opts: {
        apiKey?: string;
        baseURL?: string;
      }) => (id: string) => unknown;
    };
    const provider = createOpenAI({
      apiKey: apiKey ?? process.env[PROVIDER_ENV_KEYS.groq],
      baseURL: "https://api.groq.com/openai/v1",
    });
    return provider(modelId);
  },

  mistral: async (modelId: string, apiKey?: string) => {
    // Requires: @ai-sdk/mistral
    const { createMistral } = (await import("@ai-sdk/mistral" as string)) as {
      createMistral: (opts: { apiKey?: string }) => (id: string) => unknown;
    };
    const provider = createMistral({
      apiKey: apiKey ?? process.env[PROVIDER_ENV_KEYS.mistral],
    });
    return provider(modelId);
  },

  deepseek: async (modelId: string, apiKey?: string) => {
    // DeepSeek is OpenAI-compatible — use OpenAI adapter with custom base URL
    const { createOpenAI } = (await import("@ai-sdk/openai" as string)) as {
      createOpenAI: (opts: {
        apiKey?: string;
        baseURL?: string;
      }) => (id: string) => unknown;
    };
    const provider = createOpenAI({
      apiKey: apiKey ?? process.env[PROVIDER_ENV_KEYS.deepseek],
      baseURL: "https://api.deepseek.com/v1",
    });
    return provider(modelId);
  },

  cerebras: async (modelId: string, apiKey?: string) => {
    // Cerebras is OpenAI-compatible
    const { createOpenAI } = (await import("@ai-sdk/openai" as string)) as {
      createOpenAI: (opts: {
        apiKey?: string;
        baseURL?: string;
      }) => (id: string) => unknown;
    };
    const provider = createOpenAI({
      apiKey: apiKey ?? process.env[PROVIDER_ENV_KEYS.cerebras],
      baseURL: "https://api.cerebras.ai/v1",
    });
    return provider(modelId);
  },

  openrouter: async (modelId: string, apiKey?: string) => {
    // OpenRouter is OpenAI-compatible
    const { createOpenAI } = (await import("@ai-sdk/openai" as string)) as {
      createOpenAI: (opts: {
        apiKey?: string;
        baseURL?: string;
      }) => (id: string) => unknown;
    };
    const provider = createOpenAI({
      apiKey: apiKey ?? process.env[PROVIDER_ENV_KEYS.openrouter],
      baseURL: "https://openrouter.ai/api/v1",
    });
    return provider(modelId);
  },

  ollama: async (modelId: string, _apiKey?: string) => {
    // Ollama is OpenAI-compatible on localhost
    const { createOpenAI } = (await import("@ai-sdk/openai" as string)) as {
      createOpenAI: (opts: {
        apiKey?: string;
        baseURL?: string;
      }) => (id: string) => unknown;
    };
    const provider = createOpenAI({
      apiKey: "ollama", // Ollama doesn't require a real key
      baseURL: process.env.OLLAMA_URL ?? "http://localhost:11434/v1",
    });
    return provider(modelId);
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a Vercel AI SDK provider instance from a provider config.
 *
 * Returns a language model that can be passed to `streamText()`, `generateText()`,
 * or `generateObject()` from the Vercel AI SDK.
 *
 * @example
 * ```ts
 * import { streamText } from 'ai';
 * import { createVercelProvider } from '@prometheus/ai';
 *
 * const model = await createVercelProvider({
 *   provider: 'anthropic',
 *   modelId: 'claude-sonnet-4-6',
 * });
 *
 * const result = await streamText({ model, prompt: 'Hello' });
 * ```
 */
export async function createVercelProvider(
  config: VercelProviderConfig
): Promise<VercelLanguageModel> {
  const factory = PROVIDER_FACTORIES[config.provider];

  if (!factory) {
    throw new Error(
      `Unsupported Vercel AI SDK provider: "${config.provider}". ` +
        `Supported: ${Object.keys(PROVIDER_FACTORIES).join(", ")}`
    );
  }

  try {
    return await factory(config.modelId, config.apiKey);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);

    // If the import fails because the package isn't installed, give a clear message
    if (
      msg.includes("Cannot find module") ||
      msg.includes("MODULE_NOT_FOUND")
    ) {
      throw new Error(
        `Vercel AI SDK provider package not installed for "${config.provider}". ` +
          "Install with: pnpm add @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google @ai-sdk/mistral"
      );
    }

    throw error;
  }
}

/**
 * Parse a MODEL_REGISTRY key (e.g. "anthropic/claude-sonnet-4-6") into a
 * VercelProviderConfig.
 */
function registryKeyToProviderConfig(
  _registryKey: string,
  modelConfig: ModelConfig
): VercelProviderConfig {
  return {
    provider: modelConfig.provider,
    modelId: modelConfig.id,
    apiKey: undefined, // Resolved from env at creation time
  };
}

/**
 * Resolve a Prometheus routing slot name to a Vercel AI SDK provider config.
 *
 * Looks up the slot in SLOT_CONFIGS, then resolves the primary model and
 * fallbacks from MODEL_REGISTRY into VercelProviderConfig objects.
 *
 * @example
 * ```ts
 * const resolution = slotToVercelModel('think');
 * const model = await createVercelProvider(resolution.primary);
 * ```
 */
export function slotToVercelModel(slotName: string): SlotResolution {
  const slot = slotName as RoutingSlot;
  const slotConfig = SLOT_CONFIGS[slot];

  if (!slotConfig) {
    throw new Error(
      `Unknown routing slot: "${slotName}". ` +
        `Available slots: ${Object.keys(SLOT_CONFIGS).join(", ")}`
    );
  }

  const chain = slotConfig.chain;
  if (chain.length === 0) {
    throw new Error(`Slot "${slotName}" has an empty model chain`);
  }

  const primaryKey = chain[0] as string;
  const primaryConfig = MODEL_REGISTRY[primaryKey];
  if (!primaryConfig) {
    throw new Error(
      `Primary model "${primaryKey}" for slot "${slotName}" not found in MODEL_REGISTRY`
    );
  }

  const fallbacks: VercelProviderConfig[] = [];
  for (let i = 1; i < chain.length; i++) {
    const key = chain[i] as string;
    const config = MODEL_REGISTRY[key];
    if (config) {
      fallbacks.push(registryKeyToProviderConfig(key, config));
    }
  }

  return {
    primary: registryKeyToProviderConfig(primaryKey, primaryConfig),
    fallbacks,
    slotConfig: {
      slot: slotConfig.slot,
      defaultTemperature: slotConfig.defaultTemperature,
      preferStreaming: slotConfig.preferStreaming,
    },
  };
}

/**
 * Convenience: resolve a slot and create the primary Vercel AI SDK model.
 * Falls back through the chain if the primary provider fails.
 */
export async function createModelForSlot(
  slotName: string,
  apiKeys?: Record<string, string>
): Promise<{
  model: VercelLanguageModel;
  providerConfig: VercelProviderConfig;
}> {
  const resolution = slotToVercelModel(slotName);
  const allConfigs = [resolution.primary, ...resolution.fallbacks];

  for (const config of allConfigs) {
    try {
      const configWithKey: VercelProviderConfig = {
        ...config,
        apiKey: apiKeys?.[config.provider] ?? config.apiKey,
      };
      const model = await createVercelProvider(configWithKey);
      return { model, providerConfig: configWithKey };
    } catch {
      // Provider failed, try next fallback
    }
  }

  throw new Error(
    `All providers failed for slot "${slotName}". ` +
      `Tried: ${allConfigs.map((c) => `${c.provider}/${c.modelId}`).join(", ")}`
  );
}
