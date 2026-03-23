import { createLogger } from "@prometheus/logger";
import { EventPublisher, QueueEvents } from "@prometheus/queue";
import type { AgentLoop } from "../agent-loop";
import { CILoopRunner } from "../ci-loop/ci-loop-runner";

const logger = createLogger("orchestrator:watch-mode");

export interface WatchModeConfig {
  /** Debounce interval for file changes in ms */
  debounceMs?: number;
  /** Test command to run on changes */
  testCommand?: string;
}

/**
 * WatchMode monitors file changes in a sandbox and automatically
 * runs affected tests via CILoopRunner, publishing real-time feedback events.
 */
export class WatchMode {
  private readonly eventPublisher = new EventPublisher();
  private running = false;
  private paused = false;
  private readonly debounceMs: number;
  private readonly testCommand: string;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pendingFiles = new Set<string>();

  constructor(config: WatchModeConfig = {}) {
    this.debounceMs = config.debounceMs ?? 1000;
    this.testCommand = config.testCommand ?? "pnpm test";
  }

  async start(
    agentLoop: AgentLoop,
    sessionId: string,
    projectId: string
  ): Promise<void> {
    this.running = true;
    logger.info({ sessionId, projectId }, "Watch mode started");

    await this.eventPublisher.publishSessionEvent(sessionId, {
      type: QueueEvents.AGENT_STATUS,
      data: { status: "watching", projectId },
      timestamp: new Date().toISOString(),
    });

    // Poll for file changes (in production, this would use inotify/fswatch via sandbox)
    while (this.running) {
      if (this.paused) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }

      // Check for file changes via sandbox
      try {
        const result = await agentLoop.executeTask(
          "Check for recent file changes in the project using `git diff --name-only HEAD`. List any modified files.",
          "ci_loop"
        );

        if (result.success && result.output.trim()) {
          const changedFiles = result.output
            .trim()
            .split("\n")
            .filter((f) => f.trim());

          if (changedFiles.length > 0) {
            for (const file of changedFiles) {
              this.pendingFiles.add(file);
            }

            // Debounce: wait for changes to settle
            await this.runAffectedTests(agentLoop, sessionId);
          }
        }
      } catch (err) {
        logger.warn({ err }, "Watch mode file check failed");
      }

      // Wait before next poll
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  private async runAffectedTests(
    agentLoop: AgentLoop,
    sessionId: string
  ): Promise<void> {
    const files = Array.from(this.pendingFiles);
    this.pendingFiles.clear();

    if (files.length === 0) {
      return;
    }

    logger.info({ fileCount: files.length }, "Running affected tests");

    await this.eventPublisher.publishSessionEvent(sessionId, {
      type: QueueEvents.TASK_STATUS,
      data: {
        phase: "watch_test",
        status: "running",
        changedFiles: files,
      },
      timestamp: new Date().toISOString(),
    });

    const ciRunner = new CILoopRunner(5);
    const result = await ciRunner.run(
      agentLoop,
      `${this.testCommand} -- --changed`
    );

    await this.eventPublisher.publishSessionEvent(sessionId, {
      type: QueueEvents.TASK_STATUS,
      data: {
        phase: "watch_test",
        status: result.passed ? "passed" : "failed",
        passRate: result.passRate,
        totalTests: result.totalTests,
        failedTests: result.failedTests,
      },
      timestamp: new Date().toISOString(),
    });
  }

  pause(): void {
    this.paused = true;
    logger.info("Watch mode paused");
  }

  resume(): void {
    this.paused = false;
    logger.info("Watch mode resumed");
  }

  stop(): void {
    this.running = false;
    this.paused = false;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    logger.info("Watch mode stopped");
  }

  isRunning(): boolean {
    return this.running;
  }

  isPaused(): boolean {
    return this.paused;
  }
}
