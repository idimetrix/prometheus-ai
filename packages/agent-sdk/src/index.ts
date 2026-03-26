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
