import { createLogger } from "@prometheus/logger";
import type { ModeHandler, ModeHandlerParams, ModeResult } from "./types";

const logger = createLogger("orchestrator:mode:watch");

/**
 * Watch Mode: Monitors file changes, runs lint/typecheck, provides feedback.
 * Background slot - lower priority.
 */
export class WatchModeHandler implements ModeHandler {
  readonly modeName = "watch";

  async execute(params: ModeHandlerParams): Promise<ModeResult> {
    logger.info(
      { sessionId: params.sessionId },
      "Watch mode: monitoring project"
    );

    const result = await params.agentLoop.executeTask(
      `Watch mode: Monitor this project and provide real-time suggestions.

Focus on:
${params.taskDescription}

Actions:
1. Run \`pnpm typecheck\` to check for type errors
2. Run \`pnpm lint\` to check for lint issues
3. Search for common anti-patterns and code smells
4. Identify missing tests for recently changed files
5. Report findings with file paths and line numbers

Operate as a pair programming assistant. Be concise and actionable.`,
      "ci_loop"
    );

    return {
      results: [result],
      totalCreditsConsumed: params.agentLoop.getCreditsConsumed(),
    };
  }
}
