// =============================================================================
// @prometheus/ai — Package Entry Point
// =============================================================================

export type { LLMClientOptions } from "./client";
// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------
export { clearClientCache, createLLMClient } from "./client";
export type {
  ModelCapability,
  ModelConfig,
  ModelProvider,
  ModelTier,
} from "./models";
// ---------------------------------------------------------------------------
// Model Registry
// ---------------------------------------------------------------------------
export {
  estimateCost,
  getAllModelKeys,
  getModelConfig,
  getModelsByProvider,
  getModelsByTier,
  getModelsWithCapability,
  MODEL_REGISTRY,
  PROVIDER_ENDPOINTS,
  PROVIDER_ENV_KEYS,
} from "./models";
export type {
  ChatMessage,
  CompletionOptions,
  CompletionResult,
  EmbeddingResult,
  StreamChunk,
  StreamCompletionResult,
} from "./providers";
// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------
export {
  createAnthropicProvider,
  createCerebrasProvider,
  createDeepSeekProvider,
  createGeminiProvider,
  createGroqProvider,
  createMistralProvider,
  createOllamaProvider,
  createOpenAIProvider,
  createOpenRouterProvider,
  createProvider,
  LLMProvider,
} from "./providers";
export type { ResolvedRoute, RouteRequest } from "./routing";
// ---------------------------------------------------------------------------
// Intelligent Router
// ---------------------------------------------------------------------------
export {
  getHealthStatus,
  isProviderHealthy,
  isWithinRateLimit,
  recordRequest,
  reportFailure,
  reportSuccess,
  resetRoutingState,
  resolveRoute,
  routeAndComplete,
  routeAndStream,
  runHealthChecks,
  setProviderHealth,
} from "./routing";
export type { RoutingSlot, SlotConfig } from "./slots";
// ---------------------------------------------------------------------------
// Routing Slots
// ---------------------------------------------------------------------------
export {
  autoDetectSlot,
  getAllSlots,
  getSlotConfig,
  SLOT_CONFIGS,
} from "./slots";

// ---------------------------------------------------------------------------
// Token Utilities
// ---------------------------------------------------------------------------
export {
  estimateMessageTokens,
  estimateTextCost,
  estimateTokens,
  remainingContextTokens,
  truncateToTokens,
} from "./tokens";
