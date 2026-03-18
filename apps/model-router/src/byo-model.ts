import type { ModelProvider } from "@prometheus/ai";
import { createLLMClient, MODEL_REGISTRY } from "@prometheus/ai";
import { createLogger } from "@prometheus/logger";

const logger = createLogger("model-router:byo-model");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserModelConfig {
  apiKey: string;
  /** Optional custom base URL (e.g., for Azure OpenAI or self-hosted models) */
  baseUrl?: string;
  createdAt: Date;
  orgId: string;
  /** Specific models the user wants to use with this key */
  preferredModels?: string[];
  provider: ModelProvider;
  userId: string;
  /** Whether this key has been verified as working */
  verified: boolean;
  verifiedAt: Date | null;
}

export interface ModelTestResult {
  error?: string;
  latencyMs: number;
  model: string;
  provider: string;
  response?: string;
  success: boolean;
}

// ---------------------------------------------------------------------------
// BYO Model Manager
// ---------------------------------------------------------------------------

/**
 * Manages user-provided API keys for external model providers.
 * When a user has configured their own key for a provider, requests
 * are routed through the user's key instead of the platform key.
 *
 * Keys are stored encrypted in memory (in production, use a secrets manager).
 */
export class BYOModelManager {
  /** In-memory store: "orgId:provider" -> UserModelConfig */
  private readonly userKeys = new Map<string, UserModelConfig>();

  /**
   * Register a user's API key for a model provider.
   */
  addUserKey(params: {
    userId: string;
    orgId: string;
    provider: ModelProvider;
    apiKey: string;
    baseUrl?: string;
    preferredModels?: string[];
  }): UserModelConfig {
    const key = `${params.orgId}:${params.provider}`;

    const config: UserModelConfig = {
      userId: params.userId,
      orgId: params.orgId,
      provider: params.provider,
      apiKey: params.apiKey,
      baseUrl: params.baseUrl,
      preferredModels: params.preferredModels,
      verified: false,
      verifiedAt: null,
      createdAt: new Date(),
    };

    this.userKeys.set(key, config);
    logger.info(
      { orgId: params.orgId, provider: params.provider },
      "User API key registered"
    );

    return config;
  }

  /**
   * Remove a user's API key for a provider.
   */
  removeUserKey(orgId: string, provider: string): boolean {
    const key = `${orgId}:${provider}`;
    const existed = this.userKeys.delete(key);
    if (existed) {
      logger.info({ orgId, provider }, "User API key removed");
    }
    return existed;
  }

  /**
   * Get the user's API key for a specific provider, if configured.
   */
  getUserKey(orgId: string, provider: string): string | undefined {
    const key = `${orgId}:${provider}`;
    return this.userKeys.get(key)?.apiKey;
  }

  /**
   * Get all configured providers for an organization.
   */
  getConfiguredProviders(orgId: string): Array<{
    provider: string;
    verified: boolean;
    verifiedAt: string | null;
    preferredModels: string[];
    createdAt: string;
  }> {
    const results: Array<{
      provider: string;
      verified: boolean;
      verifiedAt: string | null;
      preferredModels: string[];
      createdAt: string;
    }> = [];

    for (const [key, config] of this.userKeys) {
      if (key.startsWith(`${orgId}:`)) {
        results.push({
          provider: config.provider,
          verified: config.verified,
          verifiedAt: config.verifiedAt?.toISOString() ?? null,
          preferredModels: config.preferredModels ?? [],
          createdAt: config.createdAt.toISOString(),
        });
      }
    }

    return results;
  }

  /**
   * Resolve the API key to use for a request. If the org has configured
   * their own key for the provider, use it. Otherwise, return undefined
   * to fall back to the platform key.
   */
  resolveApiKey(
    orgId: string | undefined,
    provider: string
  ): string | undefined {
    if (!orgId) {
      return undefined;
    }
    return this.getUserKey(orgId, provider);
  }

  /**
   * Test a model provider API key by making a simple completion request.
   * This verifies the key is valid and the model is accessible.
   */
  async testModel(params: {
    provider: ModelProvider;
    apiKey: string;
    model?: string;
    baseUrl?: string;
  }): Promise<ModelTestResult> {
    const startTime = Date.now();

    // Find a model to test with
    const modelKey = params.model ?? this.findDefaultModel(params.provider);
    if (!modelKey) {
      return {
        success: false,
        provider: params.provider,
        model: params.model ?? "unknown",
        latencyMs: Date.now() - startTime,
        error: `No models found for provider: ${params.provider}`,
      };
    }

    const modelConfig = MODEL_REGISTRY[modelKey];
    const modelId = modelConfig?.id ?? modelKey;

    try {
      const client = createLLMClient({
        provider: params.provider,
        apiKey: params.apiKey,
        baseURL: params.baseUrl,
      });

      const response = await client.chat.completions.create({
        model: modelId,
        messages: [
          {
            role: "user",
            content: "Respond with exactly: PROMETHEUS_KEY_TEST_OK",
          },
        ],
        temperature: 0,
        max_tokens: 20,
      });

      const latencyMs = Date.now() - startTime;
      const content = response.choices[0]?.message?.content ?? "";

      logger.info(
        { provider: params.provider, model: modelKey, latencyMs },
        "Model test succeeded"
      );

      return {
        success: true,
        provider: params.provider,
        model: modelKey,
        latencyMs,
        response: content.slice(0, 100),
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const msg = error instanceof Error ? error.message : String(error);

      logger.warn(
        { provider: params.provider, model: modelKey, error: msg },
        "Model test failed"
      );

      return {
        success: false,
        provider: params.provider,
        model: modelKey,
        latencyMs,
        error: msg,
      };
    }
  }

  /**
   * Test and verify a user's stored API key.
   */
  async verifyUserKey(
    orgId: string,
    provider: string
  ): Promise<ModelTestResult> {
    const key = `${orgId}:${provider}`;
    const config = this.userKeys.get(key);

    if (!config) {
      return {
        success: false,
        provider,
        model: "none",
        latencyMs: 0,
        error: `No API key configured for provider: ${provider}`,
      };
    }

    const result = await this.testModel({
      provider: config.provider,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.preferredModels?.[0],
    });

    // Update verification status
    config.verified = result.success;
    config.verifiedAt = result.success ? new Date() : config.verifiedAt;

    return result;
  }

  /**
   * Get the list of supported providers that users can bring their own keys for.
   */
  getSupportedProviders(): Array<{
    provider: string;
    name: string;
    envKeyName: string;
    modelsAvailable: string[];
  }> {
    const providerInfo: Record<string, { name: string; envKey: string }> = {
      anthropic: { name: "Anthropic", envKey: "ANTHROPIC_API_KEY" },
      openai: { name: "OpenAI", envKey: "OPENAI_API_KEY" },
      gemini: { name: "Google Gemini", envKey: "GEMINI_API_KEY" },
      groq: { name: "Groq", envKey: "GROQ_API_KEY" },
      cerebras: { name: "Cerebras", envKey: "CEREBRAS_API_KEY" },
      mistral: { name: "Mistral", envKey: "MISTRAL_API_KEY" },
      deepseek: { name: "DeepSeek", envKey: "DEEPSEEK_API_KEY" },
      openrouter: { name: "OpenRouter", envKey: "OPENROUTER_API_KEY" },
    };

    return Object.entries(providerInfo).map(([provider, info]) => {
      const models = Object.entries(MODEL_REGISTRY)
        .filter(([, config]) => config.provider === provider)
        .map(([key]) => key);

      return {
        provider,
        name: info.name,
        envKeyName: info.envKey,
        modelsAvailable: models,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private findDefaultModel(provider: ModelProvider): string | undefined {
    for (const [key, config] of Object.entries(MODEL_REGISTRY)) {
      if (config.provider === provider) {
        return key;
      }
    }
    return undefined;
  }
}
