import { blueprints, db } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { and, eq } from "drizzle-orm";
import type { EpisodicLayer, EpisodicMemory } from "../layers/episodic";
import type {
  GraphNode,
  GraphQueryResult,
  KnowledgeGraphLayer,
} from "../layers/knowledge-graph";
import type { ProceduralLayer, Procedure } from "../layers/procedural";
import type { RerankableResult, Reranker } from "../layers/reranker";
import type { SearchResult, SemanticLayer } from "../layers/semantic";
import type { WorkingMemoryLayer } from "../layers/working-memory";

const logger = createLogger("project-brain:context");

export interface AssembleRequest {
  agentRole: string;
  maxTokens: number;
  projectId: string;
  sessionId?: string;
  taskDescription: string;
}

export interface AssembledContext {
  /** Global context: blueprint, procedures, project conventions */
  global: string;
  /** Breakdown of tokens per layer */
  layerTokens: {
    semantic: number;
    episodic: number;
    procedural: number;
    working: number;
    knowledgeGraph: number;
    blueprint: number;
    tools: number;
  };
  /** Session context: working memory, recent decisions */
  session: string;
  /** Task-specific context: semantic search results, knowledge graph */
  taskSpecific: string;
  /** Tools context: agent role and capabilities */
  tools: string;
  totalTokensEstimate: number;
}

import { estimateTokens } from "./token-counter";

/**
 * Context Assembler: combines all 5 memory layers into a unified context
 * that fits within the ~14K token budget.
 *
 * Memory Layers:
 *  1. Semantic — vector search over code embeddings
 *  2. Episodic — past decisions with outcomes
 *  3. Procedural — learned how-to patterns
 *  4. Working — session-scoped scratch memory
 *  5. Knowledge Graph — dependency relationships
 *
 * Budget allocation (default ~14K tokens):
 *  - Blueprint/Global: ~10% (1400 tokens)
 *  - Semantic search:  ~40% (5600 tokens) — largest allocation for code context
 *  - Knowledge Graph:  ~15% (2100 tokens)
 *  - Episodic:         ~10% (1400 tokens)
 *  - Procedural:        ~5% (700 tokens)
 *  - Working memory:   ~10% (1400 tokens)
 *  - Tools/Role:       ~10% (1400 tokens)
 */
export class ContextAssembler {
  private readonly semantic: SemanticLayer;
  private readonly knowledgeGraph: KnowledgeGraphLayer;
  private readonly episodic: EpisodicLayer;
  private readonly procedural: ProceduralLayer;
  private readonly workingMemory: WorkingMemoryLayer;
  private readonly reranker: Reranker;

  constructor(
    semantic: SemanticLayer,
    knowledgeGraph: KnowledgeGraphLayer,
    episodic: EpisodicLayer,
    procedural: ProceduralLayer,
    workingMemory: WorkingMemoryLayer,
    reranker: Reranker
  ) {
    this.semantic = semantic;
    this.knowledgeGraph = knowledgeGraph;
    this.episodic = episodic;
    this.procedural = procedural;
    this.workingMemory = workingMemory;
    this.reranker = reranker;
  }

  async assemble(request: AssembleRequest): Promise<AssembledContext> {
    const { projectId, sessionId, taskDescription, agentRole, maxTokens } =
      request;

    // Adaptive budget allocation based on agent role
    const budgets = this.getAdaptiveBudget(agentRole, maxTokens);

    // ─── PASS 1: Lightweight references (IDs + scores, ~50 tokens each) ───
    // Fetch all layers in parallel for maximum throughput
    const [
      blueprintContent,
      procedures,
      semanticResults,
      graphResults,
      recentDecisions,
      taskRelatedDecisions,
      workingMem,
    ] = await Promise.all([
      this.loadBlueprint(projectId),
      this.procedural.list(projectId),
      this.semantic.search(projectId, taskDescription, 40), // Fetch more candidates for pass 1
      this.knowledgeGraph.query(projectId, taskDescription),
      this.episodic.getRecent(projectId, 10),
      this.episodic.recall(projectId, taskDescription, 5),
      sessionId ? this.workingMemory.getAll(sessionId) : Promise.resolve({}),
    ]);

    // Rerank semantic results using role-based boost paths
    const boostPaths = this.getRoleBoostPaths(agentRole);
    const rerankedResults = this.reranker.rerank(
      semanticResults as RerankableResult[],
      taskDescription,
      { boostPaths }
    ) as SearchResult[];

    // ─── PASS 2: Load full content for top refs until budget reached ───
    // Only take top N results that fit within the semantic budget
    let semanticTokensUsed = 0;
    const semanticBudgetChars = budgets.semantic * 4;
    const selectedResults: SearchResult[] = [];
    for (const result of rerankedResults) {
      const entrySize = result.content.length + result.filePath.length + 50;
      if (semanticTokensUsed + entrySize > semanticBudgetChars) {
        break;
      }
      selectedResults.push(result);
      semanticTokensUsed += entrySize;
    }

    // Also look up dependency graph for top relevant files
    const topFiles = [
      ...new Set(selectedResults.slice(0, 5).map((r) => r.filePath)),
    ];
    const [dependencyNodes, dependentNodes] = await Promise.all([
      Promise.all(
        topFiles.map((fp) => this.knowledgeGraph.getDependencies(projectId, fp))
      ),
      Promise.all(
        topFiles.map((fp) => this.knowledgeGraph.getDependents(projectId, fp))
      ),
    ]);
    const allDependencies = dependencyNodes.flat();
    const allDependents = dependentNodes.flat();

    // 1. Global context: blueprint + procedures
    const globalContext = this.buildGlobalContext(
      blueprintContent,
      procedures,
      budgets.blueprint,
      budgets.procedural
    );

    // 2. Task-specific context: semantic search + knowledge graph
    const semanticContext = this.buildSemanticContext(
      selectedResults,
      budgets.semantic
    );
    const graphContext = this.buildGraphContext(
      graphResults,
      allDependencies,
      allDependents,
      budgets.knowledgeGraph
    );
    const taskContext = `${semanticContext}\n\n${graphContext}`;

    // 3. Session context: episodic memories + working memory
    const episodicContext = this.buildEpisodicContext(
      recentDecisions,
      taskRelatedDecisions,
      budgets.episodic
    );
    const workingContext = this.buildWorkingContext(
      workingMem,
      budgets.working
    );
    const sessionContext =
      episodicContext + (workingContext ? `\n\n${workingContext}` : "");

    // 4. Tools context: agent role description
    const toolsContext = this.buildToolsContext(agentRole, budgets.tools);

    // Track token usage per layer
    const layerTokens = {
      semantic: estimateTokens(semanticContext),
      episodic: estimateTokens(episodicContext),
      procedural: estimateTokens(globalContext), // procedures are in global
      working: estimateTokens(workingContext),
      knowledgeGraph: estimateTokens(graphContext),
      blueprint: estimateTokens(globalContext),
      tools: estimateTokens(toolsContext),
    };

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
        semanticHits: rerankedResults.length,
        graphNodes: graphResults.nodes.length,
        episodicMemories: recentDecisions.length,
        procedures: procedures.length,
        workingMemKeys: Object.keys(workingMem).length,
      },
      "Context assembled from all 5 memory layers"
    );

    return {
      global: globalContext,
      taskSpecific: taskContext,
      session: sessionContext,
      tools: toolsContext,
      layerTokens,
      totalTokensEstimate: totalEstimate,
    };
  }

  private async loadBlueprint(projectId: string): Promise<string | null> {
    try {
      const result = await db
        .select()
        .from(blueprints)
        .where(
          and(
            eq(blueprints.projectId, projectId),
            eq(blueprints.isActive, true)
          )
        )
        .limit(1);

      return result.length > 0 ? (result[0]?.content ?? null) : null;
    } catch (err) {
      logger.warn({ projectId, err }, "Failed to load blueprint");
      return null;
    }
  }

  private buildGlobalContext(
    blueprintContent: string | null,
    procedures: Procedure[],
    blueprintBudget: number,
    proceduralBudget: number
  ): string {
    const parts: string[] = [];

    if (blueprintContent) {
      parts.push("## Project Blueprint");
      parts.push(this.truncate(blueprintContent, blueprintBudget * 4));
      parts.push("");
    }

    if (procedures.length > 0) {
      parts.push("## Learned Procedures");
      const procParts: string[] = [];
      for (const proc of procedures) {
        const entry = `- **${proc.name}**: ${proc.steps.join(" -> ")}`;
        procParts.push(entry);
      }
      parts.push(this.truncate(procParts.join("\n"), proceduralBudget * 4));
    }

    return parts.join("\n");
  }

  private buildSemanticContext(
    semanticResults: SearchResult[],
    budgetTokens: number
  ): string {
    const parts: string[] = ["## Relevant Code (Semantic Search)"];
    let usedChars = 0;
    const maxChars = budgetTokens * 4;

    for (const result of semanticResults) {
      const entry = `\n### ${result.filePath} (relevance: ${(result.score * 100).toFixed(0)}%)\n\`\`\`\n${result.content}\n\`\`\``;
      if (usedChars + entry.length > maxChars) {
        break;
      }
      parts.push(entry);
      usedChars += entry.length;
    }

    return parts.join("\n");
  }
  private buildGraphContext(
    graphResults: GraphQueryResult,
    dependencies: GraphNode[],
    dependents: GraphNode[],
    budgetTokens: number
  ): string {
    const parts: string[] = [];
    let usedChars = 0;
    const maxChars = budgetTokens * 4;

    if (graphResults.nodes.length > 0) {
      parts.push("## Knowledge Graph: Related Components");
      for (const node of graphResults.nodes.slice(0, 15)) {
        const entry = `- ${node.name} (${node.filePath}) [${node.type}]`;
        if (usedChars + entry.length > maxChars) {
          break;
        }
        parts.push(entry);
        usedChars += entry.length;
      }
    }

    if (graphResults.edges.length > 0) {
      parts.push("\n### Relationships");
      for (const edge of graphResults.edges.slice(0, 15)) {
        const entry = `- ${edge.source} --[${edge.type}]--> ${edge.target}`;
        if (usedChars + entry.length > maxChars) {
          break;
        }
        parts.push(entry);
        usedChars += entry.length;
      }
    }

    if (dependencies.length > 0) {
      parts.push("\n### Dependencies (files these depend on)");
      const seen = new Set<string>();
      for (const dep of dependencies.slice(0, 10)) {
        if (seen.has(dep.filePath)) {
          continue;
        }
        seen.add(dep.filePath);
        const entry = `- ${dep.name} (${dep.filePath})`;
        if (usedChars + entry.length > maxChars) {
          break;
        }
        parts.push(entry);
        usedChars += entry.length;
      }
    }

    if (dependents.length > 0) {
      parts.push("\n### Dependents (files that depend on relevant code)");
      const seen = new Set<string>();
      for (const dep of dependents.slice(0, 10)) {
        if (seen.has(dep.filePath)) {
          continue;
        }
        seen.add(dep.filePath);
        const entry = `- ${dep.name} (${dep.filePath})`;
        if (usedChars + entry.length > maxChars) {
          break;
        }
        parts.push(entry);
        usedChars += entry.length;
      }
    }

    return parts.join("\n");
  }

  private buildEpisodicContext(
    recentDecisions: EpisodicMemory[],
    taskRelated: EpisodicMemory[],
    budgetTokens: number
  ): string {
    const parts: string[] = [];
    const maxChars = budgetTokens * 4;

    // Merge and deduplicate
    const seenIds = new Set<string>();
    const allDecisions: EpisodicMemory[] = [];

    // Task-related first (higher relevance)
    for (const d of taskRelated) {
      if (!seenIds.has(d.id)) {
        seenIds.add(d.id);
        allDecisions.push(d);
      }
    }
    // Then recent
    for (const d of recentDecisions) {
      if (!seenIds.has(d.id)) {
        seenIds.add(d.id);
        allDecisions.push(d);
      }
    }

    if (allDecisions.length > 0) {
      parts.push("## Past Decisions & Outcomes (Episodic Memory)");
      let usedChars = 0;
      for (const d of allDecisions) {
        const entry = [
          `- **[${d.eventType}]** ${d.decision}`,
          d.reasoning ? `  Reasoning: ${d.reasoning}` : null,
          d.outcome ? `  Outcome: ${d.outcome}` : "  Outcome: (pending)",
        ]
          .filter(Boolean)
          .join("\n");
        if (usedChars + entry.length > maxChars) {
          break;
        }
        parts.push(entry);
        usedChars += entry.length;
      }
    }

    return parts.join("\n");
  }

  private buildWorkingContext(
    workingMem: Record<string, unknown>,
    budgetTokens: number
  ): string {
    const memKeys = Object.keys(workingMem);
    if (memKeys.length === 0) {
      return "";
    }

    const parts: string[] = ["## Current Session State (Working Memory)"];
    let usedChars = 0;
    const maxChars = budgetTokens * 4;

    for (const key of memKeys) {
      const val = workingMem[key];
      const display = typeof val === "string" ? val : JSON.stringify(val);
      const entry = `- **${key}**: ${display}`;
      if (usedChars + entry.length > maxChars) {
        break;
      }
      parts.push(entry);
      usedChars += entry.length;
    }

    return parts.join("\n");
  }

  private buildToolsContext(agentRole: string, budgetTokens: number): string {
    const roleDescriptions: Record<string, string> = {
      architect:
        "You are the Architect agent. Focus on system design, file structure, and ensuring architectural consistency. You have access to the knowledge graph for dependency analysis.",
      coder:
        "You are the Coder agent. Write clean, tested, production-quality code following project conventions. Reference the semantic search results for code patterns.",
      reviewer:
        "You are the Code Reviewer agent. Look for bugs, security issues, performance problems, and convention violations. Use episodic memory to avoid repeating past mistakes.",
      tester:
        "You are the Tester agent. Write comprehensive tests covering edge cases and error scenarios. Use procedural memory for testing patterns.",
      devops:
        "You are the DevOps agent. Handle deployment, CI/CD, infrastructure, and monitoring configuration. Reference the blueprint for infrastructure conventions.",
      planner:
        "You are the Planner agent. Break down complex tasks into actionable steps and coordinate with other agents. Use episodic memory to inform planning decisions.",
      orchestrator:
        "You are the Orchestrator agent. Coordinate multi-agent workflows, delegate tasks, and ensure the overall plan is executed correctly.",
    };

    const description =
      roleDescriptions[agentRole] ?? `Agent role: ${agentRole}`;
    return this.truncate(description, budgetTokens * 4);
  }

  private getRoleBoostPaths(role: string): string[] {
    const roleBoostMap: Record<string, string[]> = {
      backend_coder: ["src/routers/", "src/services/", "packages/db/"],
      frontend_coder: ["src/components/", "src/app/", "src/hooks/"],
      test_engineer: ["__tests__/", ".test.", ".spec."],
      architect: ["packages/", "infra/"],
      security_auditor: ["src/middleware/", "src/auth/"],
    };
    return roleBoostMap[role] ?? [];
  }

  private getAdaptiveBudget(
    agentRole: string,
    requestedMaxTokens: number
  ): {
    semantic: number;
    knowledgeGraph: number;
    blueprint: number;
    episodic: number;
    procedural: number;
    working: number;
    tools: number;
  } {
    const maxTokens = Math.min(requestedMaxTokens, 50_000);

    interface BudgetProfile {
      blueprint: number;
      episodic: number;
      knowledgeGraph: number;
      procedural: number;
      semantic: number;
      tools: number;
      working: number;
    }

    // Dynamic role-adaptive budgets per the plan:
    // Coder: 60% semantic, 15% graph, 10% procedural, 10% conventions, 5% episodic
    // Architect: 25% semantic, 30% graph, 15% episodic, 15% blueprint, 10% conventions
    // Tester: 40% semantic, 20% procedural, 15% episodic, 15% conventions, 10% graph
    // Security: 50% semantic, 20% graph, 15% episodic, 10% conventions, 5% procedural
    const coderProfile: BudgetProfile = {
      semantic: 0.6,
      knowledgeGraph: 0.15,
      blueprint: 0.05,
      episodic: 0.05,
      procedural: 0.1,
      working: 0.02,
      tools: 0.03,
    };

    const roleProfiles: Record<string, BudgetProfile> = {
      frontend_coder: coderProfile,
      backend_coder: coderProfile,
      integration_coder: coderProfile,
      architect: {
        semantic: 0.25,
        knowledgeGraph: 0.3,
        blueprint: 0.15,
        episodic: 0.15,
        procedural: 0.05,
        working: 0.05,
        tools: 0.05,
      },
      test_engineer: {
        semantic: 0.4,
        knowledgeGraph: 0.1,
        blueprint: 0.05,
        episodic: 0.15,
        procedural: 0.2,
        working: 0.05,
        tools: 0.05,
      },
      security_auditor: {
        semantic: 0.5,
        knowledgeGraph: 0.2,
        blueprint: 0.05,
        episodic: 0.15,
        procedural: 0.05,
        working: 0.02,
        tools: 0.03,
      },
    };

    const profile: BudgetProfile = roleProfiles[agentRole] ?? {
      semantic: 0.4,
      knowledgeGraph: 0.15,
      blueprint: 0.1,
      episodic: 0.1,
      procedural: 0.05,
      working: 0.1,
      tools: 0.1,
    };

    return {
      semantic: Math.floor(maxTokens * profile.semantic),
      knowledgeGraph: Math.floor(maxTokens * profile.knowledgeGraph),
      blueprint: Math.floor(maxTokens * profile.blueprint),
      episodic: Math.floor(maxTokens * profile.episodic),
      procedural: Math.floor(maxTokens * profile.procedural),
      working: Math.floor(maxTokens * profile.working),
      tools: Math.floor(maxTokens * profile.tools),
    };
  }

  private truncate(text: string, maxChars: number): string {
    if (text.length <= maxChars) {
      return text;
    }
    return `${text.slice(0, maxChars - 3)}...`;
  }
}
