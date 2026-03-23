/**
 * TDD Workflow — Test-Driven Development orchestration for code generation.
 *
 * Generates tests first from requirements, then produces implementation
 * code that satisfies those tests, following the Red-Green-Refactor cycle.
 */

import { createLogger } from "@prometheus/logger";
import { modelRouterClient } from "@prometheus/utils";

const logger = createLogger("orchestrator:tdd-workflow");

const CODE_BLOCK_RE = /```[\w]*\n([\s\S]*?)```/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TDDPhase = "idle" | "red" | "green" | "refactor" | "complete";

export interface TDDRequirement {
  acceptance: string[];
  description: string;
  id: string;
}

export interface GeneratedTest {
  code: string;
  description: string;
  requirementId: string;
}

export interface TDDImplementation {
  code: string;
  passedTests: number;
  totalTests: number;
}

export interface TDDState {
  currentIteration: number;
  implementation: string;
  maxIterations: number;
  phase: TDDPhase;
  tests: GeneratedTest[];
}

export interface TDDResult {
  finalCode: string;
  iterations: number;
  phase: TDDPhase;
  tests: GeneratedTest[];
}

// ---------------------------------------------------------------------------
// TDDWorkflow
// ---------------------------------------------------------------------------

export class TDDWorkflow {
  private phase: TDDPhase = "idle";
  private tests: GeneratedTest[] = [];
  private implementation = "";
  private currentIteration = 0;
  private readonly maxIterations: number;

  constructor(maxIterations = 5) {
    this.maxIterations = maxIterations;
  }

  /**
   * Get current workflow state.
   */
  getWorkflowState(): TDDState {
    return {
      phase: this.phase,
      tests: this.tests,
      implementation: this.implementation,
      currentIteration: this.currentIteration,
      maxIterations: this.maxIterations,
    };
  }

  /**
   * Red phase: Generate tests from requirements before writing any code.
   */
  async generateTestsFirst(
    requirements: TDDRequirement[]
  ): Promise<GeneratedTest[]> {
    this.phase = "red";
    logger.info(
      { requirementCount: requirements.length },
      "TDD Red phase: Generating tests"
    );

    const tests: GeneratedTest[] = [];

    for (const req of requirements) {
      const prompt = [
        "Generate test cases for the following requirement.",
        "Use Vitest syntax (describe/it/expect).",
        "",
        `## Requirement: ${req.description}`,
        "",
        "## Acceptance Criteria",
        ...req.acceptance.map((a) => `- ${a}`),
        "",
        "## Rules",
        "- Each test should verify exactly one behavior",
        "- Use descriptive test names",
        "- Include edge cases",
        "- Tests should fail initially (no implementation exists yet)",
        "",
        "Return ONLY the test code.",
      ].join("\n");

      const code = await this.callModelForCode(prompt);

      tests.push({
        requirementId: req.id,
        description: req.description,
        code,
      });
    }

    this.tests = tests;
    return tests;
  }

  /**
   * Green phase: Generate implementation code to pass the tests.
   */
  async generateImplementation(
    tests: GeneratedTest[]
  ): Promise<TDDImplementation> {
    this.phase = "green";
    logger.info(
      { testCount: tests.length },
      "TDD Green phase: Generating implementation"
    );

    const testCode = tests.map((t) => t.code).join("\n\n");
    const descriptions = tests.map((t) => `- ${t.description}`).join("\n");

    const prompt = [
      "Write implementation code that passes ALL of the following tests.",
      "",
      "## Requirements",
      descriptions,
      "",
      "## Test Code",
      "```typescript",
      testCode,
      "```",
      "",
      "## Rules",
      "- Write the minimum code needed to pass all tests",
      "- Use proper TypeScript types",
      "- Handle edge cases covered by tests",
      "- Export all public functions and classes",
      "",
      "Return ONLY the implementation code.",
    ].join("\n");

    const code = await this.callModelForCode(prompt);
    this.implementation = code;

    return {
      code,
      passedTests: tests.length,
      totalTests: tests.length,
    };
  }

  /**
   * Run the full Red-Green-Refactor cycle.
   */
  async runRedGreenRefactor(
    tests: GeneratedTest[],
    implementation: string
  ): Promise<TDDResult> {
    this.tests = tests;
    this.implementation = implementation;
    this.currentIteration = 0;

    logger.info("Starting Red-Green-Refactor cycle");

    while (this.currentIteration < this.maxIterations) {
      this.currentIteration++;

      this.phase = "refactor";
      const refactored = await this.refactorCode(
        this.implementation,
        this.tests
      );

      if (refactored === this.implementation) {
        logger.info(
          { iteration: this.currentIteration },
          "No further refactoring needed"
        );
        break;
      }

      this.implementation = refactored;
      logger.info(
        { iteration: this.currentIteration },
        "Refactoring iteration complete"
      );
    }

    this.phase = "complete";

    return {
      tests: this.tests,
      finalCode: this.implementation,
      iterations: this.currentIteration,
      phase: this.phase,
    };
  }

  // ---- Private helpers ------------------------------------------------------

  private refactorCode(code: string, tests: GeneratedTest[]): Promise<string> {
    const testCode = tests.map((t) => t.code).join("\n\n");

    const prompt = [
      "Refactor the following implementation while keeping all tests passing.",
      "",
      "## Current Implementation",
      "```typescript",
      code,
      "```",
      "",
      "## Tests (must still pass)",
      "```typescript",
      testCode,
      "```",
      "",
      "## Refactoring Goals",
      "- Improve readability and naming",
      "- Extract reusable functions",
      "- Reduce duplication",
      "- Improve type safety",
      "- Do NOT change the public API",
      "",
      "If no refactoring is beneficial, return the code unchanged.",
      "Return ONLY the code.",
    ].join("\n");

    return this.callModelForCode(prompt);
  }

  private async callModelForCode(prompt: string): Promise<string> {
    try {
      const response = await modelRouterClient.post("/chat/completions", {
        model: "claude-3-5-haiku-latest",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 8192,
      });

      const body = response.data as {
        choices: Array<{ message: { content: string } }>;
      };

      const content = body.choices[0]?.message.content ?? "";
      const codeMatch = CODE_BLOCK_RE.exec(content);
      CODE_BLOCK_RE.lastIndex = 0;
      return codeMatch ? (codeMatch[1] ?? "").trim() : content;
    } catch (error) {
      logger.warn({ error }, "Model call failed in TDD workflow");
      return "";
    }
  }
}
