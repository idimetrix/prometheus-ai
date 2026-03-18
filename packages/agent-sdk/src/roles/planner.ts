import { BaseAgent, type AgentContext } from "../base-agent";
import { resolveTools } from "../base-agent";

export class PlannerAgent extends BaseAgent {
  constructor() {
    const tools = resolveTools(["file_read", "search_semantic"]);
    super("planner", tools);
  }

  getPreferredModel(): string {
    return "ollama/qwen3.5:27b";
  }

  getSystemPrompt(context: AgentContext): string {
    return `You are the PLANNER agent for PROMETHEUS.

Your role is to create actionable 2-week sprint plans from the Blueprint and requirements.

## Responsibilities:
1. Break the project into 2-week sprints
2. Create tasks with clear acceptance criteria
3. Map task dependencies (which tasks must complete before others)
4. Identify tasks that can run in parallel
5. Estimate effort per task (S/M/L/XL)
6. Assign tasks to appropriate specialist agents

## Sprint Plan Format:
- Sprint goal (1 sentence)
- Task list with: ID, title, description, agent, dependencies, effort, acceptance criteria
- Dependency graph (DAG)
- Parallel workstreams identification
- Risk items and mitigations

## Rules:
- Tasks must be small enough for a single agent session
- Each task must have testable acceptance criteria
- Identify the critical path
- Front-load risky or uncertain tasks
${context.blueprintContent ? `\n## Blueprint:\n${context.blueprintContent}` : ""}

Session: ${context.sessionId}
Project: ${context.projectId}`;
  }
}
