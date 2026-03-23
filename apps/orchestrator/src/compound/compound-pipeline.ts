/**
 * Compound Agent Pipeline
 *
 * Orchestrates a 4-agent loop for complex tasks:
 *   Task → Planner → Plan with file changes
 *     → Coder → Implements each step
 *       → Critic → Reviews each file, suggests fixes
 *         → If fixes needed → Coder re-implements
 *     → Reviewer → Final review
 *       → If approved → PR
 *       → If rejected → Back to Planner with feedback
 */

import type { AgentExecutionResult } from "@prometheus/agent-sdk";
import { createLogger } from "@prometheus/logger";
import type { AgentLoop } from "../agent-loop";

const logger = createLogger("orchestrator:compound");

export interface CompoundPipelineConfig {
  /** Quality threshold for critic approval (0-1) */
  criticThreshold: number;
  /** Maximum critic-coder iterations before forcing ahead */
  maxCriticRounds: number;
  /** Maximum planner-reviewer loops */
  maxReviewerRejections: number;
}

const DEFAULT_CONFIG: CompoundPipelineConfig = {
  maxCriticRounds: 3,
  maxReviewerRejections: 2,
  criticThreshold: 0.75,
};

export interface CompoundResult {
  approved: boolean;
  coderResults: AgentExecutionResult[];
  criticFeedback: string[];
  plannerOutput: string;
  reviewerVerdict: string;
  totalRounds: number;
}

export class CompoundPipeline {
  private readonly config: CompoundPipelineConfig;

  constructor(config?: Partial<CompoundPipelineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async execute(
    agentLoop: AgentLoop,
    taskDescription: string,
    blueprint: string
  ): Promise<CompoundResult> {
    let plannerOutput = "";
    const coderResults: AgentExecutionResult[] = [];
    const criticFeedback: string[] = [];
    let reviewerVerdict = "";
    let approved = false;
    let totalRounds = 0;

    for (
      let reviewRound = 0;
      reviewRound <= this.config.maxReviewerRejections;
      reviewRound++
    ) {
      totalRounds++;

      // Step 1: Planner decomposes the task
      logger.info({ round: reviewRound }, "Compound pipeline: planner phase");
      const plannerPrompt =
        reviewRound === 0
          ? `You are the Planner agent. Decompose this task into specific file-level implementation steps.\n\nTask: ${taskDescription}\n\nBlueprint:\n${blueprint}\n\nOutput a numbered list of steps, each specifying:\n- File path to create/modify\n- What changes to make\n- Dependencies on other steps`
          : `You are the Planner agent. The reviewer rejected the previous implementation with this feedback:\n\n${reviewerVerdict}\n\nOriginal task: ${taskDescription}\n\nRevise your plan to address the reviewer's feedback. Output updated file-level steps.`;

      const planResult = await agentLoop.executeTask(plannerPrompt, "planner");
      plannerOutput = planResult.output;

      // Step 2: Coder implements with critic loop
      logger.info(
        { round: reviewRound },
        "Compound pipeline: coder-critic loop"
      );
      for (
        let criticRound = 0;
        criticRound < this.config.maxCriticRounds;
        criticRound++
      ) {
        // Coder implements
        const coderPrompt =
          criticRound === 0
            ? `Implement the following plan. Write production-quality code following project conventions.\n\nPlan:\n${plannerOutput}\n\nBlueprint:\n${blueprint}`
            : `The critic found issues with your implementation. Fix them:\n\n${criticFeedback.at(-1)}\n\nOriginal plan:\n${plannerOutput}`;

        const coderResult = await agentLoop.executeTask(
          coderPrompt,
          "backend_coder"
        );
        coderResults.push(coderResult);

        // Critic reviews
        const criticPrompt = `You are a Code Critic. Review the implementation for quality, correctness, and convention compliance.\n\nScore each dimension 1-5:\n1. Correctness: Does it fulfill the requirements?\n2. Code quality: Clean, readable, maintainable?\n3. Convention compliance: Follows project patterns?\n4. Error handling: Proper error handling?\n5. Security: No vulnerabilities?\n\nIf average score >= 4, respond with "APPROVED".\nOtherwise, list specific issues to fix.\n\nImplementation output:\n${coderResult.output}\n\nFiles changed: ${coderResult.filesChanged.join(", ")}`;

        const criticResult = await agentLoop.executeTask(
          criticPrompt,
          "security_auditor"
        );
        criticFeedback.push(criticResult.output);

        if (
          criticResult.output.includes("APPROVED") ||
          criticResult.output.toLowerCase().includes("all checks pass")
        ) {
          logger.info({ criticRound }, "Critic approved implementation");
          break;
        }

        logger.info({ criticRound }, "Critic requested fixes");
      }

      // Step 3: Reviewer final gate
      logger.info({ round: reviewRound }, "Compound pipeline: reviewer phase");
      const reviewerPrompt = `You are the Final Reviewer. This is a quality gate before merging.\n\nOriginal task: ${taskDescription}\n\nPlanner output:\n${plannerOutput}\n\nCritic feedback history:\n${criticFeedback.join("\n---\n")}\n\nFiles changed: ${coderResults.flatMap((r) => r.filesChanged).join(", ")}\n\nReview checklist:\n- [ ] All requirements met\n- [ ] Code quality acceptable\n- [ ] No security issues\n- [ ] Tests adequate\n- [ ] No breaking changes\n\nRespond with either "APPROVED: <summary>" or "REJECTED: <specific issues to address>"`;

      const reviewResult = await agentLoop.executeTask(
        reviewerPrompt,
        "security_auditor"
      );
      reviewerVerdict = reviewResult.output;

      if (
        reviewResult.output.startsWith("APPROVED") ||
        reviewResult.output.includes("APPROVED:")
      ) {
        approved = true;
        logger.info("Compound pipeline: reviewer approved");
        break;
      }

      logger.info(
        { round: reviewRound },
        "Reviewer rejected, looping back to planner"
      );
    }

    return {
      approved,
      plannerOutput,
      coderResults,
      criticFeedback,
      reviewerVerdict,
      totalRounds,
    };
  }
}
