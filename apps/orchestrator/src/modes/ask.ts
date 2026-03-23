import { createLogger } from "@prometheus/logger";
import type { ModeHandler, ModeHandlerParams, ModeResult } from "./types";

const logger = createLogger("orchestrator:mode:ask");

/**
 * Ask Mode: Single LLM call with context search, no tool execution.
 * Low credit cost (2 credits), returns immediately.
 */
export class AskModeHandler implements ModeHandler {
  readonly modeName = "ask";

  async execute(params: ModeHandlerParams): Promise<ModeResult> {
    logger.info(
      { sessionId: params.sessionId },
      "Ask mode: answering question"
    );

    const prompt = `Answer the following question about the project. Use your available tools to search the codebase, read relevant files, and provide a comprehensive answer.

Question:
${params.taskDescription}

Instructions:
- Search the codebase for relevant code, documentation, and configuration
- Read files that are relevant to the question
- Provide a clear, accurate answer based on the actual codebase
- Include file paths and code snippets where relevant
- If you cannot find the answer, say so clearly`;

    const result = await params.agentLoop.executeTask(prompt, "discovery");

    return {
      results: [result],
      totalCreditsConsumed: params.agentLoop.getCreditsConsumed(),
    };
  }
}
