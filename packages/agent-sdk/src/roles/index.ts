import type { AgentRole } from "@prometheus/types";
import type { AgentContext, BaseAgent } from "../base-agent";
import { TOOL_REGISTRY } from "../tools/registry";
import type { AgentToolDefinition } from "../tools/types";
import { ArchitectAgent } from "./architect";
import { BackendCoderAgent } from "./backend-coder";
import { CiLoopAgent } from "./ci-loop";
import { DeployEngineerAgent } from "./deploy-engineer";
import { DiscoveryAgent } from "./discovery";
import { DocumentationSpecialistAgent } from "./documentation-specialist";
import { FrontendCoderAgent } from "./frontend-coder";
import { IntegrationCoderAgent } from "./integration-coder";
import { OrchestratorAgent } from "./orchestrator";
import { PlannerAgent } from "./planner";
import { SecurityAuditorAgent } from "./security-auditor";
import { TestEngineerAgent } from "./test-engineer";

export interface AgentRoleConfig {
  create: () => BaseAgent;
  description: string;
  displayName: string;
  preferredModel: string;
  role: AgentRole;
  tools: string[];
}

export const AGENT_ROLES: Record<string, AgentRoleConfig> = {
  orchestrator: {
    role: "orchestrator",
    displayName: "Orchestrator",
    description: "Coordinates all agents, resolves conflicts, tracks velocity",
    preferredModel: "ollama/qwen3.5:27b",
    tools: [
      "spawn_agent",
      "kill_agent",
      "ask_user",
      "read_blueprint",
      "read_brain",
      "search_semantic",
      "search_content",
      "search_files",
      "file_read",
      "web_search",
      "web_fetch",
      "search_docs",
    ],
    create: () => new OrchestratorAgent(),
  },
  discovery: {
    role: "discovery",
    displayName: "Discovery",
    description:
      "Requirements elicitation via 5-question protocol, SRS generation, confidence scoring",
    preferredModel: "gemini/gemini-2.5-flash",
    tools: [
      "search_semantic",
      "file_read",
      "search_content",
      "ask_user",
      "read_blueprint",
      "read_brain",
    ],
    create: () => new DiscoveryAgent(),
  },
  architect: {
    role: "architect",
    displayName: "Architect",
    description:
      "Blueprint generation, tech stack design, DB schema, API contracts",
    preferredModel: "ollama/deepseek-r1:32b",
    tools: [
      "file_read",
      "file_write",
      "search_files",
      "search_content",
      "read_blueprint",
      "read_brain",
    ],
    create: () => new ArchitectAgent(),
  },
  planner: {
    role: "planner",
    displayName: "Planner",
    description: "Sprint planning, dependency mapping, task decomposition",
    preferredModel: "ollama/qwen3.5:27b",
    tools: ["file_read", "search_semantic", "read_blueprint", "read_brain"],
    create: () => new PlannerAgent(),
  },
  frontend_coder: {
    role: "frontend_coder",
    displayName: "Frontend Coder",
    description: "React/Next.js implementation, UI components, styling",
    preferredModel: "ollama/qwen3-coder-next",
    tools: [
      "file_read",
      "file_write",
      "file_edit",
      "file_list",
      "file_delete",
      "terminal_exec",
      "search_files",
      "search_content",
      "git_status",
      "git_diff",
      "read_blueprint",
      "read_brain",
      "browser_open",
      "web_search",
      "web_fetch",
      "search_docs",
    ],
    create: () => new FrontendCoderAgent(),
  },
  backend_coder: {
    role: "backend_coder",
    displayName: "Backend Coder",
    description: "APIs, services, database queries, business logic",
    preferredModel: "ollama/qwen3-coder-next",
    tools: [
      "file_read",
      "file_write",
      "file_edit",
      "file_list",
      "file_delete",
      "terminal_exec",
      "search_files",
      "search_content",
      "git_status",
      "git_diff",
      "read_blueprint",
      "read_brain",
      "web_search",
      "web_fetch",
      "search_docs",
    ],
    create: () => new BackendCoderAgent(),
  },
  integration_coder: {
    role: "integration_coder",
    displayName: "Integration Coder",
    description: "Frontend-backend wiring, API integration, data flow",
    preferredModel: "cerebras/qwen3-235b",
    tools: [
      "file_read",
      "file_write",
      "file_edit",
      "file_list",
      "terminal_exec",
      "search_files",
      "search_content",
      "read_blueprint",
      "read_brain",
      "web_search",
      "web_fetch",
      "search_docs",
    ],
    create: () => new IntegrationCoderAgent(),
  },
  test_engineer: {
    role: "test_engineer",
    displayName: "Test Engineer",
    description: "Unit, integration, and E2E test generation",
    preferredModel: "groq/llama-3.3-70b-versatile",
    tools: [
      "file_read",
      "file_write",
      "file_list",
      "terminal_exec",
      "search_files",
      "search_content",
      "read_blueprint",
      "read_brain",
      "web_search",
      "web_fetch",
      "search_docs",
    ],
    create: () => new TestEngineerAgent(),
  },
  ci_loop: {
    role: "ci_loop",
    displayName: "CI Loop",
    description: "Write-test-fail-analyze-fix cycle, up to 20 iterations",
    preferredModel: "cerebras/qwen3-235b",
    tools: [
      "terminal_exec",
      "file_read",
      "file_write",
      "file_edit",
      "search_content",
      "search_files",
    ],
    create: () => new CiLoopAgent(),
  },
  security_auditor: {
    role: "security_auditor",
    displayName: "Security Auditor",
    description: "OWASP scans, vulnerability detection, security review",
    preferredModel: "ollama/deepseek-r1:32b",
    tools: [
      "file_read",
      "search_files",
      "search_content",
      "terminal_exec",
      "read_blueprint",
      "read_brain",
    ],
    create: () => new SecurityAuditorAgent(),
  },
  deploy_engineer: {
    role: "deploy_engineer",
    displayName: "Deploy Engineer",
    description: "Docker, k8s manifests, CI/CD pipeline, deployment",
    preferredModel: "ollama/qwen3-coder-next",
    tools: [
      "file_read",
      "file_write",
      "file_edit",
      "terminal_exec",
      "search_files",
      "read_blueprint",
      "read_brain",
    ],
    create: () => new DeployEngineerAgent(),
  },
  documentation_specialist: {
    role: "documentation_specialist",
    displayName: "Documentation Specialist",
    description: "Documentation generation, API references, guides, changelogs",
    preferredModel: "gemini/gemini-2.5-flash",
    tools: [
      "file_read",
      "file_write",
      "file_list",
      "search_files",
      "search_content",
      "read_blueprint",
      "read_brain",
      "terminal_exec",
    ],
    create: () => new DocumentationSpecialistAgent(),
  },
};

export function getAgentConfig(role: string): AgentRoleConfig | undefined {
  return AGENT_ROLES[role];
}

export function createAgent(role: string): BaseAgent {
  const config = AGENT_ROLES[role];
  if (!config) {
    throw new Error(
      `Unknown agent role: ${role}. Available: ${Object.keys(AGENT_ROLES).join(", ")}`
    );
  }
  return config.create();
}

/**
 * Configuration object compatible with AiSdkAgent from @prometheus/ai.
 * Contains the fully-resolved system prompt, filtered tools, model identifier,
 * and role metadata needed to construct an AiSdkAgent instance.
 */
export interface AiSdkAgentFullConfig {
  /** The maximum number of tool-use steps. */
  maxSteps: number;
  /** The preferred model identifier for this role. */
  model: string;
  /** The agent role identifier. */
  role: string;
  /** The full system prompt (reasoning protocol + role-specific prompt). */
  systemPrompt: string;
  /** Filtered tool definitions allowed for this role (from TOOL_REGISTRY). */
  tools: Record<string, AgentToolDefinition>;
}

/**
 * Create the full configuration needed for an AiSdkAgent from a role config
 * and agent context. Resolves the system prompt (including reasoning protocol),
 * filters the tool registry to only the role's allowed tools, and bundles
 * the preferred model identifier.
 *
 * Usage:
 * ```ts
 * const config = createAiSdkAgentConfig("backend_coder", agentContext);
 * const { model } = createModelForSlot(slotMap[config.role]);
 * const agent = new AiSdkAgent({
 *   model,
 *   tools: convertToolsToAISDK(config.tools, executionContext),
 *   systemPrompt: config.systemPrompt,
 *   role: config.role,
 *   maxSteps: config.maxSteps,
 * });
 * ```
 */
export function createAiSdkAgentConfig(
  role: string,
  context: AgentContext,
  options?: { maxSteps?: number }
): AiSdkAgentFullConfig {
  const roleConfig = AGENT_ROLES[role];
  if (!roleConfig) {
    throw new Error(
      `Unknown agent role: ${role}. Available: ${Object.keys(AGENT_ROLES).join(", ")}`
    );
  }

  // Create the BaseAgent instance to access system prompt and reasoning protocol
  const agent = roleConfig.create();
  agent.initialize(context);

  const systemPrompt = `${agent.getReasoningProtocol()}\n\n${agent.getSystemPrompt(context)}`;

  // Filter TOOL_REGISTRY to only include tools allowed for this role
  const allowedToolNames = new Set(roleConfig.tools);
  const filteredTools: Record<string, AgentToolDefinition> = {};
  for (const [name, toolDef] of Object.entries(TOOL_REGISTRY)) {
    if (allowedToolNames.has(name)) {
      filteredTools[name] = toolDef;
    }
  }

  return {
    role: roleConfig.role,
    model: roleConfig.preferredModel,
    systemPrompt,
    tools: filteredTools,
    maxSteps: options?.maxSteps ?? 50,
  };
}
