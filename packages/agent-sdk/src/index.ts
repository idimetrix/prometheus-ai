// Base agent
export { BaseAgent, resolveTools } from "./base-agent";
export type {
  AgentContext,
  AgentExecutionResult,
  AgentMessage,
  ToolCall,
  EventPublisherInterface,
} from "./base-agent";

// Roles
export { AGENT_ROLES, getAgentConfig, createAgent } from "./roles";
export type { AgentRoleConfig } from "./roles";
export { OrchestratorAgent } from "./roles/orchestrator";
export { DiscoveryAgent } from "./roles/discovery";
export { ArchitectAgent } from "./roles/architect";
export { PlannerAgent } from "./roles/planner";
export { FrontendCoderAgent } from "./roles/frontend-coder";
export { BackendCoderAgent } from "./roles/backend-coder";
export { IntegrationCoderAgent } from "./roles/integration-coder";
export { TestEngineerAgent } from "./roles/test-engineer";
export { CiLoopAgent } from "./roles/ci-loop";
export { SecurityAuditorAgent } from "./roles/security-auditor";
export { DeployEngineerAgent } from "./roles/deploy-engineer";

// Tools
export type { AgentToolDefinition, ToolExecutionContext, ToolResult } from "./tools/types";
export { TOOL_REGISTRY, ToolRegistry, globalRegistry } from "./tools/registry";
export { fileTools } from "./tools/file";
export { terminalTools } from "./tools/terminal";
export { gitTools } from "./tools/git";
export { searchTools } from "./tools/search";
export { browserTools } from "./tools/browser";
export { agentMetaTools } from "./tools/agent-tools";
export { execInSandbox } from "./tools/sandbox";
