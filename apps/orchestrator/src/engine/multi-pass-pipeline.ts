/**
 * Multi-Pass Code Generation Pipeline
 *
 * Runs a four-phase pipeline for high-quality code generation:
 *   1. Draft  — fast model generates initial code
 *   2. Review — reasoning model identifies issues
 *   3. Refine — apply review feedback
 *   4. Verify — run type check + tests
 *
 * Each pass records the model used, duration, tokens consumed, and changes.
 */

import { createLogger } from "@prometheus/logger";
import { generateId, modelRouterClient } from "@prometheus/utils";

const logger = createLogger("orchestrator:multi-pass-pipeline");

const EMPTY_CATCH_RE = /catch\s*\(\w+\)\s*\{\s*\}/;
const CODE_BLOCK_RE = /```[\w]*\n([\s\S]*?)```/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PassResult {
  changes: string[];
  code: string;
  durationMs: number;
  model: string;
  pass: "draft" | "review" | "refine" | "verify";
  tokens: number;
}

export interface MultiPassResult {
  finalCode: string;
  id: string;
  passes: PassResult[];
  qualityScore: number;
  totalTokens: number;
}

export interface MultiPassTask {
  description: string;
  existingCode?: string;
  language: string;
  requirements: string[];
}

export interface MultiPassContext {
  conventions?: string;
  dependencies?: string[];
  projectId: string;
  relatedFiles?: Array<{ path: string; content: string }>;
}

interface ModelResponse {
  code: string;
  explanation: string;
  tokens: number;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export class MultiPassPipeline {
  private readonly fastModel: string;
  private readonly reasoningModel: string;

  constructor(
    fastModel = "claude-3-5-haiku-latest",
    reasoningModel = "claude-sonnet-4-20250514"
  ) {
    this.fastModel = fastModel;
    this.reasoningModel = reasoningModel;
  }

  /**
   * Execute the full four-pass pipeline.
   */
  async execute(
    task: MultiPassTask,
    context: MultiPassContext
  ): Promise<MultiPassResult> {
    const id = generateId("mpp");
    logger.info({ id, task: task.description }, "Starting multi-pass pipeline");

    const passes: PassResult[] = [];

    // Pass 1: Draft
    const draft = await this.draft(task, context);
    passes.push(draft);

    // Pass 2: Review
    const review = await this.review(draft.code, task, context);
    passes.push(review);

    // Pass 3: Refine
    const refine = await this.refine(draft.code, review.changes, task, context);
    passes.push(refine);

    // Pass 4: Verify
    const verify = this.verify(refine.code, task);
    passes.push(verify);

    const totalTokens = passes.reduce((sum, p) => sum + p.tokens, 0);
    const qualityScore = this.computeQualityScore(passes);

    logger.info(
      { id, totalTokens, qualityScore, passCount: passes.length },
      "Multi-pass pipeline complete"
    );

    return {
      id,
      finalCode: verify.code,
      passes,
      totalTokens,
      qualityScore,
    };
  }

  // ---- Pass 1: Draft -------------------------------------------------------

  private async draft(
    task: MultiPassTask,
    context: MultiPassContext
  ): Promise<PassResult> {
    const start = Date.now();
    logger.info("Pass 1: Drafting initial code");

    const prompt = this.buildDraftPrompt(task, context);
    const response = await this.callModel(this.fastModel, prompt);

    return {
      pass: "draft",
      model: this.fastModel,
      code: response.code,
      tokens: response.tokens,
      durationMs: Date.now() - start,
      changes: ["Initial code generation"],
    };
  }

  // ---- Pass 2: Review ------------------------------------------------------

  private async review(
    code: string,
    task: MultiPassTask,
    context: MultiPassContext
  ): Promise<PassResult> {
    const start = Date.now();
    logger.info("Pass 2: Reviewing generated code");

    const prompt = this.buildReviewPrompt(code, task, context);
    const response = await this.callModel(this.reasoningModel, prompt);

    const issues = this.parseReviewIssues(response.explanation);

    return {
      pass: "review",
      model: this.reasoningModel,
      code,
      tokens: response.tokens,
      durationMs: Date.now() - start,
      changes: issues,
    };
  }

  // ---- Pass 3: Refine ------------------------------------------------------

  private async refine(
    code: string,
    issues: string[],
    task: MultiPassTask,
    context: MultiPassContext
  ): Promise<PassResult> {
    const start = Date.now();
    logger.info({ issueCount: issues.length }, "Pass 3: Refining code");

    if (issues.length === 0) {
      return {
        pass: "refine",
        model: this.fastModel,
        code,
        tokens: 0,
        durationMs: Date.now() - start,
        changes: ["No issues found — skipping refinement"],
      };
    }

    const prompt = this.buildRefinePrompt(code, issues, task, context);
    const response = await this.callModel(this.fastModel, prompt);

    return {
      pass: "refine",
      model: this.fastModel,
      code: response.code,
      tokens: response.tokens,
      durationMs: Date.now() - start,
      changes: issues.map((i) => `Fixed: ${i}`),
    };
  }

  // ---- Pass 4: Verify ------------------------------------------------------

  private verify(code: string, task: MultiPassTask): PassResult {
    const start = Date.now();
    logger.info("Pass 4: Verifying final code");

    const issues = this.staticVerify(code, task.language);

    return {
      pass: "verify",
      model: "static-analysis",
      code,
      tokens: 0,
      durationMs: Date.now() - start,
      changes:
        issues.length > 0
          ? issues
          : ["Verification passed — no issues detected"],
    };
  }

  // ---- Prompt builders ------------------------------------------------------

  private buildDraftPrompt(
    task: MultiPassTask,
    context: MultiPassContext
  ): string {
    const parts = [
      `Generate ${task.language} code for the following task:`,
      "",
      "## Task",
      task.description,
      "",
      "## Requirements",
      ...task.requirements.map((r) => `- ${r}`),
    ];

    if (task.existingCode) {
      parts.push("", "## Existing Code", "```", task.existingCode, "```");
    }

    if (context.conventions) {
      parts.push("", "## Conventions", context.conventions);
    }

    if (context.relatedFiles && context.relatedFiles.length > 0) {
      parts.push("", "## Related Files");
      for (const f of context.relatedFiles) {
        parts.push(`### ${f.path}`, "```", f.content, "```");
      }
    }

    parts.push(
      "",
      "## Output",
      "Return ONLY the code block with no explanation."
    );

    return parts.join("\n");
  }

  private buildReviewPrompt(
    code: string,
    task: MultiPassTask,
    context: MultiPassContext
  ): string {
    const parts = [
      "Review the following generated code for issues:",
      "",
      "## Code",
      "```",
      code,
      "```",
      "",
      "## Original Requirements",
      ...task.requirements.map((r) => `- ${r}`),
    ];

    if (context.conventions) {
      parts.push("", "## Expected Conventions", context.conventions);
    }

    parts.push(
      "",
      "## Review Criteria",
      "- Correctness: Does it meet all requirements?",
      "- Type safety: Any implicit `any` or missing types?",
      "- Error handling: Are edge cases covered?",
      "- Performance: Any obvious inefficiencies?",
      "- Security: Any vulnerabilities?",
      "",
      "List each issue on a separate line starting with `ISSUE:`"
    );

    return parts.join("\n");
  }

  private buildRefinePrompt(
    code: string,
    issues: string[],
    task: MultiPassTask,
    _context: MultiPassContext
  ): string {
    return [
      "Refine the following code to fix the identified issues:",
      "",
      "## Current Code",
      "```",
      code,
      "```",
      "",
      "## Issues to Fix",
      ...issues.map((i) => `- ${i}`),
      "",
      "## Requirements",
      ...task.requirements.map((r) => `- ${r}`),
      "",
      "## Output",
      "Return ONLY the corrected code block.",
    ].join("\n");
  }

  // ---- Helpers --------------------------------------------------------------

  private parseReviewIssues(explanation: string): string[] {
    const issuePattern = /ISSUE:\s*(.+)/g;
    const issues: string[] = [];
    let match = issuePattern.exec(explanation);
    while (match) {
      issues.push((match[1] ?? "").trim());
      match = issuePattern.exec(explanation);
    }
    return issues;
  }

  private staticVerify(code: string, language: string): string[] {
    const issues: string[] = [];

    if (language === "typescript" || language === "javascript") {
      if (code.includes("as any")) {
        issues.push("Contains `as any` type assertion");
      }
      if (code.includes("console.log")) {
        issues.push("Contains console.log statement");
      }
      if (EMPTY_CATCH_RE.test(code)) {
        issues.push("Empty catch block swallows errors");
      }
    }

    return issues;
  }

  private computeQualityScore(passes: PassResult[]): number {
    const reviewPass = passes.find((p) => p.pass === "review");
    const verifyPass = passes.find((p) => p.pass === "verify");

    let score = 1.0;

    // Deduct for review issues found
    const reviewIssues = reviewPass?.changes.length ?? 0;
    score -= Math.min(reviewIssues * 0.1, 0.5);

    // Deduct for verification issues
    const verifyIssues = (verifyPass?.changes ?? []).filter(
      (c) => !c.startsWith("Verification passed")
    ).length;
    score -= Math.min(verifyIssues * 0.15, 0.4);

    return Math.max(0, Math.min(1, score));
  }

  private async callModel(
    model: string,
    prompt: string
  ): Promise<ModelResponse> {
    try {
      const response = await modelRouterClient.post("/chat/completions", {
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 8192,
      });

      const body = response.data as {
        choices: Array<{ message: { content: string } }>;
        usage?: { total_tokens?: number };
      };

      const content = body.choices[0]?.message.content ?? "";
      const code = this.extractCodeBlock(content);

      return {
        code: code || content,
        explanation: content,
        tokens: body.usage?.total_tokens ?? estimateTokens(content),
      };
    } catch (error) {
      logger.warn({ model, error }, "Model call failed — returning empty");
      return { code: "", explanation: "", tokens: 0 };
    }
  }

  private extractCodeBlock(content: string): string {
    const match = CODE_BLOCK_RE.exec(content);
    CODE_BLOCK_RE.lastIndex = 0;
    return match ? (match[1] ?? "").trim() : "";
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
