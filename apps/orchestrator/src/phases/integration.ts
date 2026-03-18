import type { AgentExecutionResult } from "@prometheus/agent-sdk";
import { createLogger } from "@prometheus/logger";
import { EventPublisher, QueueEvents } from "@prometheus/queue";
import type { AgentLoop } from "../agent-loop";

const logger = createLogger("orchestrator:phase:integration");

export interface IntegrationResult {
  buildPassed: boolean;
  conflictsDetected: number;
  conflictsResolved: number;
  filesIntegrated: string[];
  typecheckPassed: boolean;
}

/**
 * Integration Phase runs after parallel build, before CI loop.
 * Collects all changed files, detects conflicts, resolves them,
 * and verifies the combined build compiles.
 */
export class IntegrationPhase {
  private readonly eventPublisher = new EventPublisher();

  async execute(
    agentLoop: AgentLoop,
    parallelResults: AgentExecutionResult[]
  ): Promise<IntegrationResult> {
    logger.info(
      { parallelResultCount: parallelResults.length },
      "Starting Integration phase"
    );

    // Collect all changed files from parallel build
    const allChangedFiles = new Set<string>();
    for (const result of parallelResults) {
      for (const file of result.filesChanged) {
        allChangedFiles.add(file);
      }
    }

    // Detect files modified by multiple agents
    const fileModCounts = new Map<string, number>();
    for (const result of parallelResults) {
      for (const file of result.filesChanged) {
        fileModCounts.set(file, (fileModCounts.get(file) ?? 0) + 1);
      }
    }

    const conflictFiles = Array.from(fileModCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([file]) => file);

    let conflictsResolved = 0;

    if (conflictFiles.length > 0) {
      logger.warn(
        { conflictFiles, count: conflictFiles.length },
        "Merge conflicts detected"
      );

      // Dispatch integration_coder to resolve conflicts
      const resolveResult = await agentLoop.executeTask(
        `The following files were modified by multiple agents during parallel build and may have conflicts:

${conflictFiles.map((f) => `- ${f}`).join("\n")}

For each file:
1. Read the current state of the file
2. Check for syntax errors, duplicate code, or conflicting changes
3. Resolve any conflicts by merging the best parts of each change
4. Ensure the file is syntactically correct
5. Maintain all functionality from both changes

After resolving, run \`pnpm typecheck\` to verify.`,
        "integration_coder"
      );

      if (resolveResult.success) {
        conflictsResolved = conflictFiles.length;
      }
    }

    // Run typecheck on the combined build
    const typecheckResult = await agentLoop.executeTask(
      "Run `pnpm typecheck` to verify the combined build compiles correctly. Report any errors.",
      "ci_loop"
    );
    const typecheckPassed = typecheckResult.success;

    // Run build
    const buildResult = await agentLoop.executeTask(
      "Run `pnpm build` to verify the project builds correctly. Report any errors.",
      "ci_loop"
    );
    const buildPassed = buildResult.success;

    const result: IntegrationResult = {
      conflictsDetected: conflictFiles.length,
      conflictsResolved,
      typecheckPassed,
      buildPassed,
      filesIntegrated: Array.from(allChangedFiles),
    };

    await this.eventPublisher.publishSessionEvent(agentLoop.getSessionId(), {
      type: QueueEvents.PLAN_UPDATE,
      data: { phase: "integration", ...result },
      timestamp: new Date().toISOString(),
    });

    logger.info(result, "Integration phase complete");
    return result;
  }
}
