// =============================================================================
// @prometheus/ai — Package Entry Point
// =============================================================================

// ---------------------------------------------------------------------------
// AI SDK 6 Agent — Unified agent adapter with full role support
// ---------------------------------------------------------------------------
export type {
  AgentExecutionResult as AiSdkAgentResult,
  AgentStepInfo,
  AgentStreamCallbacks,
  AgentStreamEvent,
  AiSdkAgentConfig,
} from "./ai-sdk-agent";
export { AiSdkAgent, createAiSdkAgent } from "./ai-sdk-agent";
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
  VoyageEmbeddingResult,
  VoyageRerankResult,
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
  createVoyageClient,
  LLMProvider,
  VoyageClient,
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
// Token Optimizer
// ---------------------------------------------------------------------------
export type { Message as TokenOptimizerMessage } from "./token-optimizer";
export { TokenOptimizer } from "./token-optimizer";
// ---------------------------------------------------------------------------
// Token Utilities
// ---------------------------------------------------------------------------
export type { CostOptimization } from "./tokens";
export {
  analyzeCostEfficiency,
  estimateMessageTokens,
  estimateTextCost,
  estimateTokens,
  getContextWindowUtilization,
  getModelContextWindow,
  optimizeContextWindow,
  remainingContextTokens,
  truncateToTokens,
} from "./tokens";
// ---------------------------------------------------------------------------
// Tool Loop Agent (AI SDK 6) — Legacy wrapper
// ---------------------------------------------------------------------------
export type {
  GenerateResult,
  StreamEvent,
  ToolLoopAgentOptions,
} from "./tool-loop-agent";
export {
  createToolLoopAgent,
  ToolApprovalRejectedError,
  ToolLoopAgent,
} from "./tool-loop-agent";
// ---------------------------------------------------------------------------
// Vercel AI SDK 6 Adapter
// ---------------------------------------------------------------------------
export type {
  SlotResolution,
  VercelLanguageModel,
  VercelProviderConfig,
} from "./vercel-adapter";
export {
  createModelForSlot,
  createVercelProvider,
  slotToVercelModel,
} from "./vercel-adapter";
