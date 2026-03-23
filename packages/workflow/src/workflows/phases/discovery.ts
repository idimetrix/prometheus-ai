import { createLogger } from "@prometheus/logger";

const logger = createLogger("workflow:phase:discovery");

export interface DiscoveryResult {
  codebaseContext: {
    entryPoints: string[];
    frameworks: string[];
    languages: string[];
    testRunner: string | null;
    packageManager: string | null;
  };
  relevantFiles: string[];
  taskId: string;
}

interface DiscoveryInput {
  orgId: string;
  projectBrainUrl: string;
  projectId: string;
  taskDescription: string;
  taskId: string;
}

export async function runDiscovery(
  input: DiscoveryInput
): Promise<DiscoveryResult> {
  const { taskId, taskDescription, projectId, projectBrainUrl } = input;

  logger.info({ taskId, projectId }, "Running discovery phase");

  let codebaseContext: DiscoveryResult["codebaseContext"] = {
    languages: [],
    frameworks: [],
    entryPoints: [],
    testRunner: null,
    packageManager: null,
  };

  let relevantFiles: string[] = [];

  try {
    // Call project-brain for semantic search of relevant files
    const searchResponse = await fetch(`${projectBrainUrl}/search/semantic`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        query: taskDescription,
        limit: 20,
      }),
    });

    if (searchResponse.ok) {
      const searchData = (await searchResponse.json()) as {
        results: Array<{ filePath: string; score: number }>;
      };
      relevantFiles = searchData.results.map((r) => r.filePath);
    }

    // Get project context from the knowledge graph
    const contextResponse = await fetch(`${projectBrainUrl}/context/assemble`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        taskDescription,
        agentRole: "coder",
        maxTokens: 4000,
      }),
    });

    if (contextResponse.ok) {
      const contextData = (await contextResponse.json()) as {
        context?: {
          languages?: string[];
          frameworks?: string[];
          entryPoints?: string[];
          testRunner?: string;
          packageManager?: string;
        };
      };

      if (contextData.context) {
        codebaseContext = {
          languages: contextData.context.languages ?? [],
          frameworks: contextData.context.frameworks ?? [],
          entryPoints: contextData.context.entryPoints ?? [],
          testRunner: contextData.context.testRunner ?? null,
          packageManager: contextData.context.packageManager ?? null,
        };
      }
    }
  } catch (error) {
    logger.warn(
      { taskId, error: String(error) },
      "Project-brain unavailable, using empty discovery"
    );
  }

  logger.info(
    {
      taskId,
      relevantFiles: relevantFiles.length,
      languages: codebaseContext.languages,
    },
    "Discovery phase complete"
  );

  return {
    codebaseContext,
    relevantFiles,
    taskId,
  };
}
