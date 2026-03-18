import { db } from "@prometheus/db";
import { blueprints } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { eq, and } from "drizzle-orm";
import type { SemanticLayer, SearchResult } from "../layers/semantic";
import type { KnowledgeGraphLayer, GraphQueryResult } from "../layers/knowledge-graph";
import type { EpisodicLayer, EpisodicMemory } from "../layers/episodic";
import type { ProceduralLayer, Procedure } from "../layers/procedural";
import type { WorkingMemoryLayer } from "../layers/working-memory";

const logger = createLogger("project-brain:context");

export interface AssembleRequest {
  projectId: string;
  sessionId?: string;
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

/** Rough token estimate: ~4 chars per token */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
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
    const { projectId, sessionId, taskDescription, agentRole, maxTokens } = request;

    // Budget allocation: global ~14%, task-specific ~57%, session ~14%, tools ~14%
    const budgets = {
      global: Math.floor(maxTokens * 0.14),
      taskSpecific: Math.floor(maxTokens * 0.57),
      session: Math.floor(maxTokens * 0.14),
      tools: Math.floor(maxTokens * 0.14),
    };

    // 1. Global context: blueprint + project procedures
    const [blueprintContent, procedures] = await Promise.all([
      this.loadBlueprint(projectId),
      this.procedural.list(projectId),
    ]);
    const globalContext = this.buildGlobalContext(blueprintContent, procedures, budgets.global);

    // 2. Task-specific context: semantic search + knowledge graph
    const [semanticResults, graphResults] = await Promise.all([
      this.semantic.search(projectId, taskDescription, 20),
      this.knowledgeGraph.query(projectId, taskDescription),
    ]);

    // Also look up dependency graph for top relevant files
    const topFiles = [...new Set(semanticResults.slice(0, 5).map((r) => r.filePath))];
    const dependencyNodes = await Promise.all(
      topFiles.map((fp) => this.knowledgeGraph.getDependents(projectId, fp)),
    );
    const allDependents = dependencyNodes.flat();

    const taskContext = this.buildTaskContext(
      semanticResults,
      graphResults,
      allDependents,
      budgets.taskSpecific,
    );

    // 3. Session context: recent episodic memories + working memory
    const [recentDecisions, workingMem] = await Promise.all([
      this.episodic.getRecent(projectId, 5),
      sessionId ? this.workingMemory.getAll(sessionId) : Promise.resolve({}),
    ]);
    const sessionContext = this.buildSessionContext(recentDecisions, workingMem, budgets.session);

    // 4. Tools context: agent role description
    const toolsContext = this.buildToolsContext(agentRole, budgets.tools);

    const totalEstimate =
      estimateTokens(globalContext) +
      estimateTokens(taskContext) +
      estimateTokens(sessionContext) +
      estimateTokens(toolsContext);

    logger.info(
      {
        projectId,
        agentRole,
        totalTokensEstimate: totalEstimate,
        semanticHits: semanticResults.length,
        graphNodes: graphResults.nodes.length,
      },
      "Context assembled",
    );

    return {
      global: globalContext,
      taskSpecific: taskContext,
      session: sessionContext,
      tools: toolsContext,
      totalTokensEstimate: totalEstimate,
    };
  }

  private async loadBlueprint(projectId: string): Promise<string | null> {
    try {
      const result = await db
        .select()
        .from(blueprints)
        .where(and(eq(blueprints.projectId, projectId), eq(blueprints.isActive, true)))
        .limit(1);

      return result.length > 0 ? result[0]!.content : null;
    } catch (err) {
      logger.warn({ projectId, err }, "Failed to load blueprint");
      return null;
    }
  }

  private buildGlobalContext(
    blueprintContent: string | null,
    procedures: Procedure[],
    budgetTokens: number,
  ): string {
    const parts: string[] = [];

    if (blueprintContent) {
      parts.push("## Project Blueprint");
      parts.push(blueprintContent);
      parts.push("");
    }

    if (procedures.length > 0) {
      parts.push("## Project Procedures");
      for (const proc of procedures) {
        const entry = `- ${proc.name}: ${proc.steps.join(" -> ")}`;
        parts.push(entry);
      }
    }

    return this.truncate(parts.join("\n"), budgetTokens * 4);
  }

  private buildTaskContext(
    semanticResults: SearchResult[],
    graphResults: GraphQueryResult,
    dependents: Array<{ name: string; filePath: string }>,
    budgetTokens: number,
  ): string {
    const parts: string[] = ["## Relevant Code"];

    for (const result of semanticResults.slice(0, 10)) {
      parts.push(
        `\n### ${result.filePath} (relevance: ${(result.score * 100).toFixed(0)}%)`,
      );
      parts.push("```");
      parts.push(result.content);
      parts.push("```");
    }

    if (graphResults.nodes.length > 0) {
      parts.push("\n## Related Components");
      for (const node of graphResults.nodes.slice(0, 10)) {
        parts.push(`- ${node.name} (${node.filePath}) [${node.type}]`);
      }
    }

    if (dependents.length > 0) {
      parts.push("\n## Files That Depend on Relevant Code");
      const seen = new Set<string>();
      for (const dep of dependents.slice(0, 10)) {
        if (seen.has(dep.filePath)) continue;
        seen.add(dep.filePath);
        parts.push(`- ${dep.name} (${dep.filePath})`);
      }
    }

    return this.truncate(parts.join("\n"), budgetTokens * 4);
  }

  private buildSessionContext(
    decisions: EpisodicMemory[],
    workingMem: Record<string, unknown>,
    budgetTokens: number,
  ): string {
    const parts: string[] = [];

    if (decisions.length > 0) {
      parts.push("## Recent Decisions");
      for (const d of decisions) {
        parts.push(`- Decision: ${d.decision}`);
        if (d.reasoning) parts.push(`  Reasoning: ${d.reasoning}`);
        if (d.outcome) parts.push(`  Outcome: ${d.outcome}`);
      }
    }

    const memKeys = Object.keys(workingMem);
    if (memKeys.length > 0) {
      parts.push("\n## Current Session State");
      for (const key of memKeys) {
        const val = workingMem[key];
        const display = typeof val === "string" ? val : JSON.stringify(val);
        parts.push(`- ${key}: ${display}`);
      }
    }

    return this.truncate(parts.join("\n"), budgetTokens * 4);
  }

  private buildToolsContext(agentRole: string, budgetTokens: number): string {
    const roleDescriptions: Record<string, string> = {
      architect:
        "You are the Architect agent. Focus on system design, file structure, and ensuring architectural consistency.",
      coder:
        "You are the Coder agent. Write clean, tested, production-quality code following project conventions.",
      reviewer:
        "You are the Code Reviewer agent. Look for bugs, security issues, performance problems, and convention violations.",
      tester:
        "You are the Tester agent. Write comprehensive tests covering edge cases and error scenarios.",
      devops:
        "You are the DevOps agent. Handle deployment, CI/CD, infrastructure, and monitoring configuration.",
      planner:
        "You are the Planner agent. Break down complex tasks into actionable steps and coordinate with other agents.",
    };

    const description =
      roleDescriptions[agentRole] ?? `Agent role: ${agentRole}`;
    return this.truncate(description, budgetTokens * 4);
  }

  private truncate(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars - 3) + "...";
  }
}
