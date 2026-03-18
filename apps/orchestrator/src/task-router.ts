import { createLogger } from "@prometheus/logger";
import type { AgentRole } from "@prometheus/types";
import type { SessionManager } from "./session-manager";

interface TaskRoutingResult {
  agentRole: string;
  confidence: number;
  reasoning: string;
}

export class TaskRouter {
  private readonly logger = createLogger("orchestrator:router");
  private readonly sessionManager: SessionManager;

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
  }

  routeTask(taskDescription: string, projectContext?: string): TaskRoutingResult {
    const description = taskDescription.toLowerCase();

    // Rule-based routing (will be enhanced with LLM-based routing)
    if (this.matchesRequirements(description)) {
      return { agentRole: "discovery", confidence: 0.9, reasoning: "Task involves requirements gathering" };
    }
    if (this.matchesArchitecture(description)) {
      return { agentRole: "architect", confidence: 0.9, reasoning: "Task involves architecture design" };
    }
    if (this.matchesPlanning(description)) {
      return { agentRole: "planner", confidence: 0.85, reasoning: "Task involves planning or sprint creation" };
    }
    if (this.matchesFrontend(description)) {
      return { agentRole: "frontend_coder", confidence: 0.85, reasoning: "Task involves frontend/UI work" };
    }
    if (this.matchesBackend(description)) {
      return { agentRole: "backend_coder", confidence: 0.85, reasoning: "Task involves backend/API work" };
    }
    if (this.matchesTesting(description)) {
      return { agentRole: "test_engineer", confidence: 0.9, reasoning: "Task involves writing tests" };
    }
    if (this.matchesSecurity(description)) {
      return { agentRole: "security_auditor", confidence: 0.9, reasoning: "Task involves security audit" };
    }
    if (this.matchesDeployment(description)) {
      return { agentRole: "deploy_engineer", confidence: 0.9, reasoning: "Task involves deployment" };
    }
    if (this.matchesIntegration(description)) {
      return { agentRole: "integration_coder", confidence: 0.8, reasoning: "Task involves integration work" };
    }

    // Default to orchestrator for complex/ambiguous tasks
    return { agentRole: "orchestrator", confidence: 0.5, reasoning: "Task is complex or ambiguous, needs orchestration" };
  }

  private matchesRequirements(desc: string): boolean {
    return /\b(requirements?|user stor|acceptance criteria|scope|srs|discover|elicit|interview)\b/.test(desc);
  }

  private matchesArchitecture(desc: string): boolean {
    return /\b(architect|blueprint|schema|data model|tech stack|adr|system design|api contract)\b/.test(desc);
  }

  private matchesPlanning(desc: string): boolean {
    return /\b(plan|sprint|roadmap|milestone|timeline|schedule|backlog|epic)\b/.test(desc);
  }

  private matchesFrontend(desc: string): boolean {
    return /\b(component|page|ui|ux|frontend|react|next\.?js|tailwind|css|layout|form|button|modal|sidebar|dashboard)\b/.test(desc);
  }

  private matchesBackend(desc: string): boolean {
    return /\b(api|endpoint|route|controller|service|middleware|database|query|migration|trpc|crud|webhook)\b/.test(desc);
  }

  private matchesTesting(desc: string): boolean {
    return /\b(test|spec|coverage|vitest|playwright|e2e|unit test|integration test|assert|expect)\b/.test(desc);
  }

  private matchesSecurity(desc: string): boolean {
    return /\b(security|audit|vulnerabilit|owasp|injection|xss|csrf|auth.*bypass|penetration|cve)\b/.test(desc);
  }

  private matchesDeployment(desc: string): boolean {
    return /\b(deploy|docker|kubernetes|k8s|k3s|ci.?cd|github action|helm|traefik|nginx|ssl|tls)\b/.test(desc);
  }

  private matchesIntegration(desc: string): boolean {
    return /\b(integrat|connect|wire|hook up|link|bind|api call|fetch data|real.?time)\b/.test(desc);
  }
}
