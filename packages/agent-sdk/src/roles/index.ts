import type { AgentRole } from "@prometheus/types";
import { OrchestratorAgent } from "./orchestrator";
import { DiscoveryAgent } from "./discovery";
import { ArchitectAgent } from "./architect";
import { PlannerAgent } from "./planner";
import { FrontendCoderAgent } from "./frontend-coder";
import { BackendCoderAgent } from "./backend-coder";
import { IntegrationCoderAgent } from "./integration-coder";
import { TestEngineerAgent } from "./test-engineer";
import { CiLoopAgent } from "./ci-loop";
import { SecurityAuditorAgent } from "./security-auditor";
import { DeployEngineerAgent } from "./deploy-engineer";
import type { BaseAgent } from "../base-agent";

export interface AgentRoleConfig {
  role: AgentRole;
  displayName: string;
  description: string;
  preferredModel: string;
  tools: string[];
  create: () => BaseAgent;
}

export const AGENT_ROLES: Record<string, AgentRoleConfig> = {
  orchestrator: {
    role: "orchestrator",
    displayName: "Orchestrator",
    description: "Coordinates all agents, resolves conflicts, tracks velocity",
    preferredModel: "ollama/qwen3.5:27b",
    tools: [],
    create: () => new OrchestratorAgent(),
  },
  discovery: {
    role: "discovery",
    displayName: "Discovery",
    description: "Requirements elicitation, SRS generation, confidence scoring",
    preferredModel: "gemini/gemini-2.5-flash",
    tools: ["search_semantic", "file_read", "search_content"],
    create: () => new DiscoveryAgent(),
  },
  architect: {
    role: "architect",
    displayName: "Architect",
    description: "Blueprint generation, tech stack design, DB schema, API contracts",
    preferredModel: "ollama/deepseek-r1:32b",
    tools: ["file_read", "file_write", "search_files", "search_content"],
    create: () => new ArchitectAgent(),
  },
  planner: {
    role: "planner",
    displayName: "Planner",
    description: "Sprint planning, dependency mapping, task decomposition",
    preferredModel: "ollama/qwen3.5:27b",
    tools: ["file_read", "search_semantic"],
    create: () => new PlannerAgent(),
  },
  frontend_coder: {
    role: "frontend_coder",
    displayName: "Frontend Coder",
    description: "React/Next.js implementation, UI components, styling",
    preferredModel: "ollama/qwen3-coder-next",
    tools: ["file_read", "file_write", "file_edit", "file_list", "terminal_exec", "search_files", "search_content", "git_status", "git_diff"],
    create: () => new FrontendCoderAgent(),
  },
  backend_coder: {
    role: "backend_coder",
    displayName: "Backend Coder",
    description: "APIs, services, database queries, business logic",
    preferredModel: "ollama/qwen3-coder-next",
    tools: ["file_read", "file_write", "file_edit", "file_list", "terminal_exec", "search_files", "search_content", "git_status", "git_diff"],
    create: () => new BackendCoderAgent(),
  },
  integration_coder: {
    role: "integration_coder",
    displayName: "Integration Coder",
    description: "Frontend-backend wiring, API integration, data flow",
    preferredModel: "cerebras/qwen3-235b",
    tools: ["file_read", "file_write", "file_edit", "file_list", "terminal_exec", "search_files", "search_content"],
    create: () => new IntegrationCoderAgent(),
  },
  test_engineer: {
    role: "test_engineer",
    displayName: "Test Engineer",
    description: "Unit, integration, and E2E test generation",
    preferredModel: "groq/llama-3.3-70b-versatile",
    tools: ["file_read", "file_write", "file_list", "terminal_exec", "search_files", "search_content"],
    create: () => new TestEngineerAgent(),
  },
  ci_loop: {
    role: "ci_loop",
    displayName: "CI Loop",
    description: "Test-failure analysis-fix cycle, up to 20 iterations",
    preferredModel: "cerebras/qwen3-235b",
    tools: ["terminal_exec", "file_read", "search_content"],
    create: () => new CiLoopAgent(),
  },
  security_auditor: {
    role: "security_auditor",
    displayName: "Security Auditor",
    description: "OWASP scans, vulnerability detection, security review",
    preferredModel: "ollama/deepseek-r1:32b",
    tools: ["file_read", "search_files", "search_content", "terminal_exec"],
    create: () => new SecurityAuditorAgent(),
  },
  deploy_engineer: {
    role: "deploy_engineer",
    displayName: "Deploy Engineer",
    description: "Docker, k8s manifests, CI/CD pipeline, deployment",
    preferredModel: "ollama/qwen3-coder-next",
    tools: ["file_read", "file_write", "file_edit", "terminal_exec", "search_files"],
    create: () => new DeployEngineerAgent(),
  },
};

export function getAgentConfig(role: string): AgentRoleConfig | undefined {
  return AGENT_ROLES[role];
}
