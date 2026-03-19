/**
 * Context Selector — Intelligent file/memory selection based on task state.
 *
 * Selects the most relevant context for a given agent role and task,
 * balancing between code context, memory, and metadata.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:context-selector");

export interface ContextSource {
  content: string;
  relevanceScore: number;
  source: "semantic" | "episodic" | "procedural" | "working" | "graph" | "file";
  tokenEstimate: number;
}

export interface SelectionResult {
  droppedCount: number;
  selected: ContextSource[];
  totalTokens: number;
}

export class ContextSelector {
  /**
   * Select context sources that fit within the token budget,
   * prioritized by relevance score.
   */
  select(sources: ContextSource[], tokenBudget: number): SelectionResult {
    // Sort by relevance score descending
    const sorted = [...sources].sort(
      (a, b) => b.relevanceScore - a.relevanceScore
    );

    const selected: ContextSource[] = [];
    let totalTokens = 0;
    let droppedCount = 0;

    for (const source of sorted) {
      if (totalTokens + source.tokenEstimate <= tokenBudget) {
        selected.push(source);
        totalTokens += source.tokenEstimate;
      } else {
        droppedCount++;
      }
    }

    logger.debug(
      {
        totalSources: sources.length,
        selectedCount: selected.length,
        droppedCount,
        totalTokens,
        tokenBudget,
      },
      "Context selection complete"
    );

    return { selected, totalTokens, droppedCount };
  }

  /**
   * Build a role-aware relevance boost map.
   * Different agent roles benefit from different types of context.
   */
  getRoleBoosts(agentRole: string): Record<ContextSource["source"], number> {
    const boosts: Record<string, Record<ContextSource["source"], number>> = {
      frontend_coder: {
        semantic: 1.2,
        file: 1.3,
        procedural: 1.1,
        episodic: 0.8,
        working: 1.0,
        graph: 0.9,
      },
      backend_coder: {
        semantic: 1.2,
        file: 1.3,
        procedural: 1.1,
        episodic: 0.8,
        working: 1.0,
        graph: 1.1,
      },
      architect: {
        semantic: 0.9,
        file: 0.8,
        procedural: 0.7,
        episodic: 1.2,
        working: 1.0,
        graph: 1.5,
      },
      test_engineer: {
        semantic: 1.1,
        file: 1.2,
        procedural: 1.3,
        episodic: 1.1,
        working: 1.0,
        graph: 0.8,
      },
      security_auditor: {
        semantic: 1.3,
        file: 1.2,
        procedural: 0.7,
        episodic: 1.2,
        working: 0.9,
        graph: 1.1,
      },
    };

    return (
      boosts[agentRole] ?? {
        semantic: 1.0,
        file: 1.0,
        procedural: 1.0,
        episodic: 1.0,
        working: 1.0,
        graph: 1.0,
      }
    );
  }

  /**
   * Apply role-based relevance boosts to context sources.
   */
  applyBoosts(sources: ContextSource[], agentRole: string): ContextSource[] {
    const boosts = this.getRoleBoosts(agentRole);

    return sources.map((source) => ({
      ...source,
      relevanceScore: source.relevanceScore * (boosts[source.source] ?? 1.0),
    }));
  }
}
