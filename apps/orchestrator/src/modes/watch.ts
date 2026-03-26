import type { AgentExecutionResult } from "@prometheus/agent-sdk";
import { createLogger } from "@prometheus/logger";
import { EventPublisher, QueueEvents } from "@prometheus/queue";
import { CILoopRunner } from "../ci-loop/ci-loop-runner";
import type { ModeHandler, ModeHandlerParams, ModeResult } from "./types";

const logger = createLogger("orchestrator:mode:watch");

const TEST_FILE_EXT_RE = /\.(ts|tsx|js|jsx)$/;

// ---------------------------------------------------------------------------
// Watch Trigger Configuration
// ---------------------------------------------------------------------------

export interface WatchTriggerConfig {
  /** Run lint check on file changes (default: true) */
  lint: boolean;
  /** Run tests for modified files on change (default: true) */
  tests: boolean;
  /** Run TypeScript type checking on change (default: true) */
  typeCheck: boolean;
}

const _DEFAULT_TRIGGERS: WatchTriggerConfig = {
  tests: true,
  lint: true,
  typeCheck: true,
};

/** Debounce interval: wait for file changes to settle before reacting. */
const DEBOUNCE_MS = 2000;

/** Polling interval between file change checks. */
const POLL_INTERVAL_MS = 5000;

/** Maximum watch iterations before auto-stopping to avoid runaway loops. */
const MAX_WATCH_CYCLES = 200;

// ---------------------------------------------------------------------------
// Watch Mode Handler
// ---------------------------------------------------------------------------

/**
 * Watch Mode (AE09): Monitors file changes in a sandbox and auto-runs tasks.
 *
 * Behavior:
 * 1. Polls the sandbox for file changes via `git diff --name-only HEAD`
 * 2. Debounces changes (waits DEBOUNCE_MS after last change)
 * 3. On change: runs configured triggers (tests, lint, type check)
 * 4. On test failure: auto-fixes with the CI loop agent
 * 5. On lint errors: auto-fixes with `pnpm unsafe`
 * 6. Reports results via streaming events throughout
 *
 * Implements the ModeHandler interface and is registered in the modes index.
 */
export class WatchModeHandler implements ModeHandler {
  readonly modeName = "watch";
  private readonly eventPublisher = new EventPublisher();

  async execute(params: ModeHandlerParams): Promise<ModeResult> {
    logger.info(
      { sessionId: params.sessionId, projectId: params.projectId },
      "Watch mode: starting file change monitor"
    );

    const triggers = this.parseTriggerConfig(params.taskDescription);
    const results: AgentExecutionResult[] = [];
    let totalCredits = 0;

    // Track files that have been seen/processed to avoid re-running on the
    // same diff when no new changes have been introduced.
    const processedFiles = new Set<string>();
    let watchCycles = 0;
    let running = true;

    await this.publishStatus(params.sessionId, "watching", {
      triggers,
      message: "Watch mode active. Monitoring for file changes...",
    });

    while (running && watchCycles < MAX_WATCH_CYCLES) {
      watchCycles++;

      // Poll for changed files
      const changedFiles = await this.detectChangedFiles(params);

      // Filter out files we already processed in a previous cycle
      const newChanges = changedFiles.filter((f) => !processedFiles.has(f));

      if (newChanges.length === 0) {
        // No new changes: sleep and re-poll
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      logger.info(
        { fileCount: newChanges.length, files: newChanges.slice(0, 10) },
        "Watch mode detected file changes"
      );

      // Debounce: wait to allow rapid-fire saves to settle
      await sleep(DEBOUNCE_MS);

      // Re-check to see if more files changed during the debounce window
      const postDebounceFiles = await this.detectChangedFiles(params);
      const allNewFiles = new Set([
        ...newChanges,
        ...postDebounceFiles.filter((f) => !processedFiles.has(f)),
      ]);
      const filesToProcess = Array.from(allNewFiles);

      await this.publishStatus(params.sessionId, "processing", {
        changedFiles: filesToProcess,
        message: `Processing ${filesToProcess.length} changed file(s)...`,
      });

      // Run configured triggers
      const cycleResult = await this.runTriggers(
        params,
        filesToProcess,
        triggers
      );
      results.push(...cycleResult.results);
      totalCredits += cycleResult.creditsConsumed;

      // Mark files as processed
      for (const file of filesToProcess) {
        processedFiles.add(file);
      }

      await this.publishStatus(params.sessionId, "watching", {
        triggers,
        lastCycle: {
          filesProcessed: filesToProcess.length,
          passed: cycleResult.allPassed,
          autoFixed: cycleResult.autoFixed,
        },
        message: cycleResult.allPassed
          ? "All checks passed. Watching for more changes..."
          : "Some checks failed. Watching for more changes...",
      });

      // Brief cooldown before next poll cycle
      await sleep(POLL_INTERVAL_MS);

      // If the initial task description was a one-shot request (not a
      // continuous watch), stop after the first cycle completes.
      if (this.isOneShotRequest(params.taskDescription)) {
        running = false;
      }
    }

    logger.info(
      {
        sessionId: params.sessionId,
        watchCycles,
        totalResults: results.length,
      },
      "Watch mode completed"
    );

    return {
      results,
      totalCreditsConsumed:
        totalCredits || params.agentLoop.getCreditsConsumed(),
      metadata: {
        watchCycles,
        triggers,
      },
    };
  }

  // -------------------------------------------------------------------------
  // File change detection
  // -------------------------------------------------------------------------

  private async detectChangedFiles(
    params: ModeHandlerParams
  ): Promise<string[]> {
    try {
      const result = await params.agentLoop.executeTask(
        "Run `git diff --name-only HEAD` and `git diff --name-only --cached` to list all modified and staged files. Output ONLY the file paths, one per line. No explanations.",
        "ci_loop"
      );

      if (!(result.success && result.output.trim())) {
        return [];
      }

      return result.output
        .trim()
        .split("\n")
        .map((f) => f.trim())
        .filter((f) => f.length > 0 && !f.startsWith("fatal:"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ error: msg }, "Watch mode: failed to detect file changes");
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Trigger execution
  // -------------------------------------------------------------------------

  private async runTriggers(
    params: ModeHandlerParams,
    changedFiles: string[],
    triggers: WatchTriggerConfig
  ): Promise<{
    allPassed: boolean;
    autoFixed: number;
    creditsConsumed: number;
    results: AgentExecutionResult[];
  }> {
    const results: AgentExecutionResult[] = [];
    let allPassed = true;
    let autoFixed = 0;

    // 1. Lint check & auto-fix
    if (triggers.lint) {
      const lintResult = await this.runLintCheck(params, changedFiles);
      results.push(lintResult.result);

      if (!lintResult.passed) {
        allPassed = false;
        // Attempt auto-fix
        const fixResult = await this.autoFixLint(params);
        results.push(fixResult.result);
        if (fixResult.fixed) {
          autoFixed++;
        }
      }
    }

    // 2. Type check
    if (triggers.typeCheck) {
      const typeResult = await this.runTypeCheck(params);
      results.push(typeResult.result);

      if (!typeResult.passed) {
        allPassed = false;
        // Attempt auto-fix for type errors
        const fixResult = await this.autoFixTypeErrors(params, changedFiles);
        results.push(fixResult.result);
        if (fixResult.fixed) {
          autoFixed++;
        }
      }
    }

    // 3. Run tests for affected files
    if (triggers.tests) {
      const testResult = await this.runAffectedTests(params, changedFiles);
      results.push(testResult.result);

      if (!testResult.passed) {
        allPassed = false;
        // Auto-fix failing tests with CI loop
        const fixResult = await this.autoFixTests(params);
        results.push(...fixResult.results);
        if (fixResult.resolved > 0) {
          autoFixed += fixResult.resolved;
        }
      }
    }

    return {
      results,
      allPassed,
      autoFixed,
      creditsConsumed: params.agentLoop.getCreditsConsumed(),
    };
  }

  private async runLintCheck(
    params: ModeHandlerParams,
    changedFiles: string[]
  ): Promise<{ passed: boolean; result: AgentExecutionResult }> {
    await this.publishStatus(params.sessionId, "lint_check", {
      status: "running",
    });

    const result = await params.agentLoop.executeTask(
      `Run the lint checker on the project. Execute: pnpm check
Report any lint errors found. List the file paths and error descriptions.
Changed files to focus on: ${changedFiles.join(", ")}`,
      "ci_loop"
    );

    const passed =
      result.success && !result.output.toLowerCase().includes("error");

    await this.publishStatus(params.sessionId, "lint_check", {
      status: passed ? "passed" : "failed",
    });

    return { passed, result };
  }

  private async autoFixLint(
    params: ModeHandlerParams
  ): Promise<{ fixed: boolean; result: AgentExecutionResult }> {
    await this.publishStatus(params.sessionId, "lint_fix", {
      status: "running",
    });

    const result = await params.agentLoop.executeTask(
      "Run `pnpm unsafe` to auto-fix all lint and formatting errors. Report what was fixed.",
      "ci_loop"
    );

    const fixed = result.success;
    await this.publishStatus(params.sessionId, "lint_fix", {
      status: fixed ? "fixed" : "failed",
    });

    return { fixed, result };
  }

  private async runTypeCheck(
    params: ModeHandlerParams
  ): Promise<{ passed: boolean; result: AgentExecutionResult }> {
    await this.publishStatus(params.sessionId, "type_check", {
      status: "running",
    });

    const result = await params.agentLoop.executeTask(
      "Run `pnpm typecheck` to check for TypeScript errors. Report any type errors found with file paths and line numbers.",
      "ci_loop"
    );

    const passed =
      result.success &&
      !result.output.toLowerCase().includes("error") &&
      !result.output.includes("TS");

    await this.publishStatus(params.sessionId, "type_check", {
      status: passed ? "passed" : "failed",
    });

    return { passed, result };
  }

  private async autoFixTypeErrors(
    params: ModeHandlerParams,
    changedFiles: string[]
  ): Promise<{ fixed: boolean; result: AgentExecutionResult }> {
    await this.publishStatus(params.sessionId, "type_fix", {
      status: "running",
    });

    const result = await params.agentLoop.executeTask(
      `Fix the TypeScript type errors found in the changed files.
Changed files: ${changedFiles.join(", ")}

Steps:
1. Read each file with type errors
2. Understand the type mismatch
3. Apply the minimal fix needed (update types, add missing properties, fix imports)
4. Do NOT change business logic unless necessary for type safety`,
      "backend_coder"
    );

    const fixed = result.success;
    await this.publishStatus(params.sessionId, "type_fix", {
      status: fixed ? "fixed" : "failed",
    });

    return { fixed, result };
  }

  private async runAffectedTests(
    params: ModeHandlerParams,
    changedFiles: string[]
  ): Promise<{ passed: boolean; result: AgentExecutionResult }> {
    await this.publishStatus(params.sessionId, "test_run", {
      status: "running",
      changedFiles,
    });

    // Identify test files related to changed source files
    const testFileHint = changedFiles
      .filter((f) => !(f.includes(".test.") || f.includes(".spec.")))
      .map((f) => f.replace(TEST_FILE_EXT_RE, ".test.$1"))
      .join(", ");

    const result = await params.agentLoop.executeTask(
      `Run the test suite for files related to recent changes.
Changed files: ${changedFiles.join(", ")}
Likely test files: ${testFileHint || "(determine from changed files)"}

Run: pnpm test -- --changed
If that does not work, run: pnpm test
Report the full test output including pass/fail counts.`,
      "ci_loop"
    );

    const passed =
      result.success &&
      !result.output.toLowerCase().includes("failed") &&
      !result.output.toLowerCase().includes("fail");

    await this.publishStatus(params.sessionId, "test_run", {
      status: passed ? "passed" : "failed",
    });

    return { passed, result };
  }

  private async autoFixTests(
    params: ModeHandlerParams
  ): Promise<{ resolved: number; results: AgentExecutionResult[] }> {
    await this.publishStatus(params.sessionId, "test_fix", {
      status: "running",
    });

    const ciRunner = new CILoopRunner(5);
    const ciResult = await ciRunner.run(params.agentLoop, "pnpm test");

    const result: AgentExecutionResult = {
      success: ciResult.passed,
      output: `CI auto-fix: ${ciResult.passed ? "PASSED" : "FAILED"} after ${ciResult.iterations} iteration(s). Auto-resolved: ${ciResult.autoResolved}. Pass rate: ${ciResult.passRate}%`,
      filesChanged: [],
      tokensUsed: { input: 0, output: 0 },
      toolCalls: 0,
      steps: ciResult.iterations,
      creditsConsumed: 0,
    };

    await this.publishStatus(params.sessionId, "test_fix", {
      status: ciResult.passed ? "fixed" : "failed",
      autoResolved: ciResult.autoResolved,
      passRate: ciResult.passRate,
    });

    return { resolved: ciResult.autoResolved, results: [result] };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private parseTriggerConfig(taskDescription: string): WatchTriggerConfig {
    const desc = taskDescription.toLowerCase();
    return {
      tests: !(desc.includes("no tests") || desc.includes("skip tests")),
      lint: !(desc.includes("no lint") || desc.includes("skip lint")),
      typeCheck: !(
        desc.includes("no typecheck") ||
        desc.includes("skip typecheck") ||
        desc.includes("no type check") ||
        desc.includes("skip type check")
      ),
    };
  }

  private isOneShotRequest(taskDescription: string): boolean {
    const desc = taskDescription.toLowerCase();
    return (
      desc.includes("once") ||
      desc.includes("one-shot") ||
      desc.includes("single pass") ||
      desc.includes("run once")
    );
  }

  private async publishStatus(
    sessionId: string,
    phase: string,
    data: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.eventPublisher.publishSessionEvent(sessionId, {
        type: QueueEvents.TASK_STATUS,
        data: { phase: `watch:${phase}`, ...data },
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Non-critical: don't fail the watch loop on event publish errors
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
