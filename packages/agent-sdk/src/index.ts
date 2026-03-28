// Hooks
export type {
  HookContext,
  HookEvent,
  HookHandler,
  HookRegistration,
  HookResult,
} from "./hooks";
export {
  autoLintHook,
  blueprintGuardHook,
  costGuardHook,
  dependencyAuditHook,
  HookEngine,
  securityScanHook,
} from "./hooks";

// Base agent

export type {
  AgentContext,
  AgentExecutionResult,
  AgentMessage,
  EventPublisherInterface,
  ToolCall,
} from "./base-agent";
export { BaseAgent, resolveTools } from "./base-agent";
export type { CustomAgentSpec, ValidationResult } from "./custom-roles";
// Custom roles
export {
  getCustomRole,
  getCustomRoleSpec,
  listCustomRoles,
  parseAgentSpec,
  registerCustomRole,
  unregisterCustomRole,
  validateAgentSpec,
} from "./custom-roles";
export type { ReviewContext } from "./prompts/code-review";
// GAP-035: Code review prompts
export {
  buildReviewPrompt,
  CODE_REVIEW_SYSTEM_PROMPT,
  parseReviewResponse,
} from "./prompts/code-review";
// GAP-033: Language-specific prompts
export { detectProjectLanguage } from "./prompts/language-detector";
export {
  getLanguagePrompt,
  LANGUAGE_CONFIGS as LANGUAGE_PROMPT_CONFIGS,
} from "./prompts/language-specific";
// GAP-009: System prompts
export {
  AGENT_SYSTEM_PROMPTS,
  getAgentSystemPrompt,
  listPromptedRoles,
} from "./prompts/system-prompts";
// GAP-028: Test generation prompts
export {
  buildTestPrompt,
  detectTestFramework,
  TEST_GENERATION_PROMPT,
} from "./prompts/test-generation";
// GAP-009: Tool usage guidelines
export {
  buildToolUsagePrompt,
  TOOL_CATEGORY_GUIDELINES,
  TOOL_USAGE_GUIDELINES,
} from "./prompts/tool-usage";
export type { AgentRoleConfig, AiSdkAgentFullConfig } from "./roles";
// Roles
export {
  AGENT_ROLES,
  createAgent,
  createAiSdkAgentConfig,
  getAgentConfig,
} from "./roles";
export { ArchitectAgent } from "./roles/architect";
export { BackendCoderAgent } from "./roles/backend-coder";
export { CiLoopAgent } from "./roles/ci-loop";
export { DeployEngineerAgent } from "./roles/deploy-engineer";
export { DiscoveryAgent } from "./roles/discovery";
export { FrontendCoderAgent } from "./roles/frontend-coder";
export { IntegrationCoderAgent } from "./roles/integration-coder";
export { OrchestratorAgent } from "./roles/orchestrator";
export { PlannerAgent } from "./roles/planner";
export { SecurityAuditorAgent } from "./roles/security-auditor";
export { TestEngineerAgent } from "./roles/test-engineer";
export {
  agentMetaTools,
  askUserSchema,
  killAgentSchema,
  readBlueprintSchema,
  readBrainSchema,
  spawnAgentSchema,
} from "./tools/agent-tools";
// AI SDK 6 tool adapter
export {
  convertRegistryToAISDK,
  convertSingleTool,
  convertToolsToAISDK,
} from "./tools/ai-sdk-adapter";
export {
  browserOpenSchema,
  browserScreenshotSchema,
  browserTools,
} from "./tools/browser";
// GAP-034: Browser verification
export type {
  BrowserVerifyParams,
  VerificationResult,
} from "./tools/browser-verify";
export { browserVerifyTool } from "./tools/browser-verify";
// GAP-029: Dependency manager
export type {
  Conflict as DependencyConflict,
  PackageManagerType,
} from "./tools/dependency-manager";
export { DependencyManager } from "./tools/dependency-manager";
// Tool collections
// Zod schemas for external validation
export {
  fileDeleteSchema,
  fileEditSchema,
  fileListSchema,
  fileReadSchema,
  fileTools,
  fileWriteSchema,
} from "./tools/file";
export {
  gitAddSchema,
  gitBranchSchema,
  gitCheckoutSchema,
  gitCloneSchema,
  gitCommitSchema,
  gitCreatePrSchema,
  gitDiffSchema,
  gitLogSchema,
  gitPushSchema,
  gitStatusSchema,
  gitTools,
} from "./tools/git";
// MOON-015: Multi-language support
export type {
  LanguageConfig,
  SupportedLanguage,
} from "./tools/language-support";
export {
  detectLanguage,
  getBuildCommand,
  getLanguageConfig,
  getLintCommand,
  getTestCommand,
  LANGUAGE_CONFIGS,
} from "./tools/language-support";
// Tool registry
export { globalRegistry, TOOL_REGISTRY, ToolRegistry } from "./tools/registry";
// Sandbox execution
export { execInSandbox } from "./tools/sandbox";
export {
  searchContentSchema,
  searchFilesSchema,
  searchSemanticSchema,
  searchTools,
} from "./tools/search";
export {
  terminalBackgroundSchema,
  terminalExecSchema,
  terminalTools,
} from "./tools/terminal";
// Tool types & helpers
export type {
  AgentToolDefinition,
  ToolExecutionContext,
  ToolResult,
} from "./tools/types";
export { defineTool } from "./tools/types";
