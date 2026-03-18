import type { AgentExecutionResult } from "@prometheus/agent-sdk";
import { createLogger } from "@prometheus/logger";
import { EventPublisher, QueueEvents } from "@prometheus/queue";
import type { AgentLoop } from "../agent-loop";

const logger = createLogger("orchestrator:generator-evaluator");

export interface EvaluationResult {
  feedback: string;
  issues: string[];
  passesThreshold: boolean;
  score: number;
}

export interface GeneratorEvaluatorConfig {
  /** Agent role for generation. Default: "backend_coder" */
  generatorRole?: string;
  /** Maximum generation rounds. Default: 3 */
  maxRounds?: number;
  /** Whether to publish events. Default: true */
  publishEvents?: boolean;
  /** Minimum score to accept (0-1). Default: 0.8 */
  threshold?: number;
}

const SCORE_RE = /(?:SCORE|score|Score):\s*([\d.]+)/;
const FEEDBACK_RE = /FEEDBACK:\s*([\s\S]*?)(?=ISSUES:|$)/i;
const ISSUES_SECTION_RE = /ISSUES:\s*([\s\S]*?)$/i;
const ISSUE_LIST_ITEM_PREFIX_RE = /^\s*[-*]\s*/;

/**
 * GeneratorEvaluator implements a code generation loop where:
 * 1. Generator agent produces code using its assigned slot
 * 2. Evaluator (review slot) scores on correctness, completeness, conventions
 * 3. If score below threshold, feedback is fed back for another round
 * 4. Stops when threshold met or maxRounds reached
 */
export class GeneratorEvaluator {
  private readonly config: Required<GeneratorEvaluatorConfig>;
  private readonly eventPublisher = new EventPublisher();

  constructor(config: GeneratorEvaluatorConfig = {}) {
    this.config = {
      threshold: config.threshold ?? 0.8,
      maxRounds: config.maxRounds ?? 3,
      generatorRole: config.generatorRole ?? "backend_coder",
      publishEvents: config.publishEvents ?? true,
    };
  }

  /**
   * Run the generator-evaluator loop.
   */
  async execute(
    agentLoop: AgentLoop,
    taskDescription: string,
    blueprint: string
  ): Promise<{
    result: AgentExecutionResult;
    rounds: number;
    finalScore: number;
    evaluations: EvaluationResult[];
  }> {
    const evaluations: EvaluationResult[] = [];
    let lastResult: AgentExecutionResult | null = null;
    let lastScore = 0;

    for (let round = 1; round <= this.config.maxRounds; round++) {
      logger.info(
        {
          round,
          maxRounds: this.config.maxRounds,
          role: this.config.generatorRole,
        },
        "Generator round starting"
      );

      // Build prompt with feedback from previous round
      let prompt = taskDescription;
      if (round > 1 && evaluations.length > 0) {
        const lastEval = evaluations.at(-1);
        prompt += `\n\n--- Evaluator Feedback (Round ${round - 1}, Score: ${lastEval?.score.toFixed(2)}) ---\n`;
        prompt += `${lastEval?.feedback}\n`;
        if (lastEval && lastEval.issues.length > 0) {
          prompt += `\nIssues to fix:\n${lastEval.issues.map((i) => `- ${i}`).join("\n")}`;
        }
        prompt +=
          "\n\nPlease address all issues from the evaluation and improve your implementation.";
      }

      if (blueprint) {
        prompt += `\n\n--- Blueprint ---\n${blueprint}`;
      }

      // Generate
      const result = await agentLoop.executeTask(
        prompt,
        this.config.generatorRole
      );
      lastResult = result;

      if (!result.success) {
        logger.warn({ round, error: result.error }, "Generator failed");
        break;
      }

      // Evaluate
      const evaluation = await this.evaluate(
        agentLoop,
        taskDescription,
        result
      );
      evaluations.push(evaluation);
      lastScore = evaluation.score;

      if (this.config.publishEvents) {
        await this.eventPublisher.publishSessionEvent(
          agentLoop.getSessionId(),
          {
            type: QueueEvents.AGENT_OUTPUT,
            data: {
              type: "generator_evaluator",
              round,
              score: evaluation.score,
              passesThreshold: evaluation.passesThreshold,
              issues: evaluation.issues,
            },
            timestamp: new Date().toISOString(),
          }
        );
      }

      logger.info(
        {
          round,
          score: evaluation.score,
          threshold: this.config.threshold,
          issues: evaluation.issues.length,
        },
        "Evaluation complete"
      );

      if (evaluation.passesThreshold) {
        logger.info(
          { round, score: evaluation.score },
          "Generator-evaluator passed threshold"
        );
        break;
      }
    }

    return {
      result: lastResult ?? {
        success: false,
        output: "",
        filesChanged: [],
        tokensUsed: { input: 0, output: 0 },
        toolCalls: 0,
        steps: 0,
        creditsConsumed: 0,
        error: "No generation rounds completed",
      },
      rounds: evaluations.length,
      finalScore: lastScore,
      evaluations,
    };
  }

  /**
   * Evaluate generated code using the review slot.
   */
  private async evaluate(
    agentLoop: AgentLoop,
    originalTask: string,
    generationResult: AgentExecutionResult
  ): Promise<EvaluationResult> {
    const evalPrompt = `Evaluate the following code implementation against the original task requirements.

## Original Task
${originalTask}

## Implementation Summary
- Files changed: ${generationResult.filesChanged.join(", ") || "none reported"}
- Tool calls: ${generationResult.toolCalls}
- Output: ${generationResult.output.slice(0, 3000)}

## Evaluation Criteria
Score each criterion 0-1:
1. **Correctness**: Does the code correctly implement the requirements?
2. **Completeness**: Are all requirements addressed?
3. **Conventions**: Does it follow project conventions (naming, structure, patterns)?
4. **Error Handling**: Are edge cases and errors properly handled?
5. **Type Safety**: Are TypeScript types properly used?

Respond in this exact format:
SCORE: <overall score 0.0-1.0>
FEEDBACK: <summary of evaluation>
ISSUES:
- <issue 1>
- <issue 2>`;

    const evalResult = await agentLoop.executeTask(
      evalPrompt,
      "security_auditor"
    );

    return this.parseEvaluation(evalResult.output);
  }

  private parseEvaluation(output: string): EvaluationResult {
    // Extract score
    const scoreMatch = output.match(SCORE_RE);
    const score = scoreMatch
      ? Math.min(1, Math.max(0, Number.parseFloat(scoreMatch[1] ?? "0.5")))
      : 0.5;

    // Extract feedback
    const feedbackMatch = output.match(FEEDBACK_RE);
    const feedback = feedbackMatch?.[1]?.trim() ?? output.slice(0, 500);

    // Extract issues
    const issuesSection = output.match(ISSUES_SECTION_RE);
    const issues: string[] = [];
    if (issuesSection?.[1]) {
      const lines = issuesSection[1].split("\n");
      for (const line of lines) {
        const cleaned = line.replace(ISSUE_LIST_ITEM_PREFIX_RE, "").trim();
        if (cleaned.length > 0) {
          issues.push(cleaned);
        }
      }
    }

    return {
      score,
      feedback,
      issues,
      passesThreshold: score >= this.config.threshold,
    };
  }
}
