/**
 * Agentic RAG — Agent-driven iterative retrieval.
 *
 * Instead of fixed search based on task description, the agent
 * decides what to retrieve iteratively:
 * 1. Sees initial context → identifies gaps
 * 2. Issues targeted queries → refines understanding
 * 3. Repeats until confident before coding
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:agentic-retriever");

export interface RetrievalStep {
  query: string;
  reasoning: string;
  resultsCount: number;
}

export interface AgenticRetrievalResult {
  assembledContext: string;
  steps: RetrievalStep[];
  totalQueries: number;
  totalResults: number;
}

export class AgenticRetriever {
  private readonly maxSteps: number;
  private readonly projectBrainUrl: string;

  constructor(maxSteps = 5) {
    this.maxSteps = maxSteps;
    this.projectBrainUrl =
      process.env.PROJECT_BRAIN_URL ?? "http://localhost:4003";
  }

  async retrieve(
    projectId: string,
    taskDescription: string,
    agentRole: string,
    initialContext?: string
  ): Promise<AgenticRetrievalResult> {
    const steps: RetrievalStep[] = [];
    const contextParts: string[] = [];
    let totalResults = 0;

    if (initialContext) {
      contextParts.push(initialContext);
    }

    // Generate initial queries from the task description
    const queries = this.extractQueries(taskDescription, agentRole);

    for (const query of queries.slice(0, this.maxSteps)) {
      try {
        const response = await fetch(`${this.projectBrainUrl}/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            query,
            maxResults: 10,
            hybridSearch: true,
          }),
          signal: AbortSignal.timeout(15_000),
        });

        if (!response.ok) {
          continue;
        }

        const data = (await response.json()) as {
          results: Array<{ filePath: string; content: string; score: number }>;
        };

        const results = data.results ?? [];
        totalResults += results.length;

        if (results.length > 0) {
          const contextChunk = results
            .slice(0, 5)
            .map(
              (r) =>
                `### ${r.filePath} (score: ${(r.score * 100).toFixed(0)}%)\n\`\`\`\n${r.content.slice(0, 500)}\n\`\`\``
            )
            .join("\n\n");
          contextParts.push(contextChunk);
        }

        steps.push({
          query,
          resultsCount: results.length,
          reasoning: `Searched for: ${query}`,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn({ query, error: msg }, "Agentic retrieval query failed");
      }
    }

    logger.info(
      {
        projectId,
        agentRole,
        totalSteps: steps.length,
        totalResults,
      },
      "Agentic retrieval completed"
    );

    return {
      assembledContext: contextParts.join("\n\n---\n\n"),
      steps,
      totalQueries: steps.length,
      totalResults,
    };
  }

  private extractQueries(taskDescription: string, agentRole: string): string[] {
    const queries: string[] = [];

    // The task description itself
    queries.push(taskDescription.slice(0, 200));

    // Extract file paths mentioned
    const fileRefs = taskDescription.match(
      /(?:[\w/-]+\.(?:ts|tsx|js|jsx|py|go|rs|css|html))/g
    );
    if (fileRefs) {
      for (const ref of fileRefs.slice(0, 3)) {
        queries.push(`file: ${ref}`);
      }
    }

    // Extract function/class names
    const identifiers = taskDescription.match(
      /\b[A-Z]\w+(?:Service|Component|Router|Handler|Manager|Client)\b/g
    );
    if (identifiers) {
      for (const id of identifiers.slice(0, 3)) {
        queries.push(`definition of ${id}`);
      }
    }

    // Role-specific queries
    switch (agentRole) {
      case "frontend_coder":
        queries.push("React component patterns and hooks");
        break;
      case "backend_coder":
        queries.push("tRPC router and Drizzle query patterns");
        break;
      case "test_engineer":
        queries.push("test patterns and testing utilities");
        break;
      case "security_auditor":
        queries.push("authentication middleware and security patterns");
        break;
      default:
        break;
    }

    return queries;
  }
}
