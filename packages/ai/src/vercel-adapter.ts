// =============================================================================
// @prometheus/ai — Vercel AI SDK 6 Adapter
// =============================================================================
// Bridges Prometheus slot configs and model registry to AI SDK 6 provider
// instances. Uses the native AI SDK 6 provider packages for type-safe,
// unified streaming and tool-calling across all providers.
// =============================================================================

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { MODEL_REGISTRY, type ModelConfig, PROVIDER_ENV_KEYS } from "./models";
import { type RoutingSlot, SLOT_CONFIGS } from "./slots";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration needed to create an AI SDK 6 provider instance. */
export interface VercelProviderConfig {
  apiKey?: string;
  baseURL?: string;
  modelId: string;
  provider: string;
}

/** A resolved AI SDK 6 language model instance. */
export type VercelLanguageModel = LanguageModel;

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
// Provider factory map — AI SDK 6 native providers
// ---------------------------------------------------------------------------

type ProviderFactory = (
  modelId: string,
  apiKey?: string,
  baseURL?: string
) => LanguageModel;

const PROVIDER_FACTORIES: Record<string, ProviderFactory> = {
  openai: (modelId, apiKey) => {
    const provider = createOpenAI({
      apiKey: apiKey ?? process.env[PROVIDER_ENV_KEYS.openai],
    });
    return provider(modelId);
  },

  anthropic: (modelId, apiKey) => {
    const provider = createAnthropic({
      apiKey: apiKey ?? process.env[PROVIDER_ENV_KEYS.anthropic],
    });
    return provider(modelId);
  },

  google: (modelId, apiKey) => {
    const provider = createGoogleGenerativeAI({
      apiKey: apiKey ?? process.env[PROVIDER_ENV_KEYS.gemini],
    });
    return provider(modelId);
  },

  gemini: (modelId, apiKey) => {
    const provider = createGoogleGenerativeAI({
      apiKey: apiKey ?? process.env[PROVIDER_ENV_KEYS.gemini],
    });
    return provider(modelId);
  },

  groq: (modelId, apiKey) => {
    const provider = createGroq({
      apiKey: apiKey ?? process.env[PROVIDER_ENV_KEYS.groq],
    });
    return provider(modelId);
  },

  mistral: (modelId, apiKey) => {
    const provider = createMistral({
      apiKey: apiKey ?? process.env[PROVIDER_ENV_KEYS.mistral],
    });
    return provider(modelId);
  },

  deepseek: (modelId, apiKey) => {
    const provider = createOpenAI({
      apiKey: apiKey ?? process.env[PROVIDER_ENV_KEYS.deepseek],
      baseURL: "https://api.deepseek.com/v1",
    });
    return provider(modelId);
  },

  cerebras: (modelId, apiKey) => {
    const provider = createOpenAI({
      apiKey: apiKey ?? process.env[PROVIDER_ENV_KEYS.cerebras],
      baseURL: "https://api.cerebras.ai/v1",
    });
    return provider(modelId);
  },

  openrouter: (modelId, apiKey) => {
    const provider = createOpenAI({
      apiKey: apiKey ?? process.env[PROVIDER_ENV_KEYS.openrouter],
      baseURL: "https://openrouter.ai/api/v1",
    });
    return provider(modelId);
  },

  ollama: (modelId) => {
    const provider = createOpenAI({
      apiKey: "ollama",
      baseURL: process.env.OLLAMA_URL ?? "http://localhost:11434/v1",
    });
    return provider(modelId);
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create an AI SDK 6 language model from a provider config.
 * Returns a LanguageModel that can be passed to `generateText()`,
 * `streamText()`, or `generateObject()`.
 */
export function createVercelProvider(
  config: VercelProviderConfig
): VercelLanguageModel {
  const factory = PROVIDER_FACTORIES[config.provider];

  if (!factory) {
    throw new Error(
      `Unsupported AI SDK provider: "${config.provider}". ` +
        `Supported: ${Object.keys(PROVIDER_FACTORIES).join(", ")}`
    );
  }

  return factory(config.modelId, config.apiKey, config.baseURL);
}

/**
 * Parse a MODEL_REGISTRY key into a VercelProviderConfig.
 */
function registryKeyToProviderConfig(
  _registryKey: string,
  modelConfig: ModelConfig
): VercelProviderConfig {
  return {
    provider: modelConfig.provider,
    modelId: modelConfig.id,
    apiKey: undefined,
  };
}

/**
 * Resolve a Prometheus routing slot to AI SDK 6 provider configs.
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
 * Resolve a slot and create the primary AI SDK 6 model.
 * Falls back through the chain if the primary provider fails.
 */
export function createModelForSlot(
  slotName: string,
  apiKeys?: Record<string, string>
): {
  model: VercelLanguageModel;
  providerConfig: VercelProviderConfig;
} {
  const resolution = slotToVercelModel(slotName);
  const allConfigs = [resolution.primary, ...resolution.fallbacks];
  const errors: string[] = [];

  for (const config of allConfigs) {
    try {
      const configWithKey: VercelProviderConfig = {
        ...config,
        apiKey: apiKeys?.[config.provider] ?? config.apiKey,
      };
      const model = createVercelProvider(configWithKey);
      return { model, providerConfig: configWithKey };
    } catch (err) {
      errors.push(
        `${config.provider}/${config.modelId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  throw new Error(
    `All providers failed for slot "${slotName}". ` +
      `Tried: ${allConfigs.map((c) => `${c.provider}/${c.modelId}`).join(", ")}. ` +
      `Errors: ${errors.join("; ")}`
  );
}
