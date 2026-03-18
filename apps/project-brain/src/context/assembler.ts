import { createLogger } from "@prometheus/logger";
import type { SemanticLayer } from "../layers/semantic";
import type { KnowledgeGraphLayer } from "../layers/knowledge-graph";
import type { EpisodicLayer } from "../layers/episodic";
import type { ProceduralLayer } from "../layers/procedural";
import type { WorkingMemoryLayer } from "../layers/working-memory";

const logger = createLogger("project-brain:context");

export interface AssembleRequest {
  projectId: string;
  taskDescription: string;
  agentRole: string;
  maxTokens: number;
}

export interface AssembledContext {
  global: string;
  taskSpecific: string;
  session: string;
  tools: string;
  totalTokensEstimate: number;
}

export class ContextAssembler {
  constructor(
    private readonly semantic: SemanticLayer,
    private readonly knowledgeGraph: KnowledgeGraphLayer,
    private readonly episodic: EpisodicLayer,
    private readonly procedural: ProceduralLayer,
    private readonly workingMemory: WorkingMemoryLayer,
  ) {}

  async assemble(request: AssembleRequest): Promise<AssembledContext> {
    const { projectId, taskDescription, agentRole, maxTokens } = request;

    // Budget: global ~2K, task-specific ~8K, session ~2K, tools ~2K
    const budgets = {
      global: Math.floor(maxTokens * 0.14),
      taskSpecific: Math.floor(maxTokens * 0.57),
      session: Math.floor(maxTokens * 0.14),
      tools: Math.floor(maxTokens * 0.14),
    };

    // 1. Global context: project architecture, conventions, procedures
    const procedures = await this.procedural.list(projectId);
    const globalContext = this.buildGlobalContext(procedures, budgets.global);

    // 2. Task-specific context: semantic search results relevant to current task
    const semanticResults = await this.semantic.search(projectId, taskDescription, 20);
    const graphResults = await this.knowledgeGraph.query(projectId, taskDescription);
    const taskContext = this.buildTaskContext(semanticResults, graphResults, budgets.taskSpecific);

    // 3. Session context: recent decisions, current state
    const recentDecisions = await this.episodic.getRecent(projectId, 5);
    const sessionContext = this.buildSessionContext(recentDecisions, budgets.session);

    // 4. Tools context: available tool descriptions for this agent role
    const toolsContext = `Agent role: ${agentRole}`;

    const totalEstimate = globalContext.length + taskContext.length + sessionContext.length + toolsContext.length;

    logger.info({
      projectId,
      agentRole,
      totalTokensEstimate: Math.ceil(totalEstimate / 4),
    }, "Context assembled");

    return {
      global: globalContext,
      taskSpecific: taskContext,
      session: sessionContext,
      tools: toolsContext,
      totalTokensEstimate: Math.ceil(totalEstimate / 4),
    };
  }

  private buildGlobalContext(procedures: Array<{ name: string; steps: string[] }>, budget: number): string {
    const parts: string[] = ["## Project Procedures"];
    for (const proc of procedures) {
      const entry = `- ${proc.name}: ${proc.steps.join(" -> ")}`;
      parts.push(entry);
    }
    return this.truncate(parts.join("\n"), budget * 4);
  }

  private buildTaskContext(
    semanticResults: Array<{ filePath: string; content: string; score: number }>,
    graphResults: { nodes: Array<{ name: string; filePath: string }>; edges: unknown[] },
    budget: number
  ): string {
    const parts: string[] = ["## Relevant Code"];

    for (const result of semanticResults.slice(0, 10)) {
      parts.push(`\n### ${result.filePath} (relevance: ${(result.score * 100).toFixed(0)}%)`);
      parts.push("```");
      parts.push(result.content);
      parts.push("```");
    }

    if (graphResults.nodes.length > 0) {
      parts.push("\n## Related Components");
      for (const node of graphResults.nodes.slice(0, 10)) {
        parts.push(`- ${node.name} (${node.filePath})`);
      }
    }

    return this.truncate(parts.join("\n"), budget * 4);
  }

  private buildSessionContext(
    decisions: Array<{ decision: string; reasoning: string; outcome: string | null }>,
    budget: number
  ): string {
    if (decisions.length === 0) return "";

    const parts: string[] = ["## Recent Decisions"];
    for (const d of decisions) {
      parts.push(`- Decision: ${d.decision}`);
      parts.push(`  Reasoning: ${d.reasoning}`);
      if (d.outcome) parts.push(`  Outcome: ${d.outcome}`);
    }

    return this.truncate(parts.join("\n"), budget * 4);
  }

  private truncate(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars - 3) + "...";
  }
}
