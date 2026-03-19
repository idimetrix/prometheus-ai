import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:self-review");

/** Minimum number of changed lines to trigger a self-review */
const REVIEW_THRESHOLD_LINES = 5;

/** Tools that produce file modifications requiring verification */
const WRITE_TOOLS = new Set(["file_write", "file_edit"]);

/** Tools that read files (used for verification) */
const READ_TOOLS = new Set(["file_read"]);

export interface SelfReviewDecision {
  filePath: string;
  reason: string;
  shouldReview: boolean;
}

/**
 * SelfReview manages automatic verification after file modifications.
 * After every file_write or file_edit, it determines whether the output
 * should be re-read and reviewed by the agent for correctness.
 */
export class SelfReview {
  private readonly recentReads = new Set<string>();
  private readonly recentWrites = new Map<string, number>();

  /**
   * Record that a file was read by the agent (avoids re-reading
   * files the agent just read).
   */
  recordRead(filePath: string): void {
    this.recentReads.add(filePath);
  }

  /**
   * Record a file write/edit and determine if a verification read
   * should be injected.
   */
  shouldReview(
    toolName: string,
    args: Record<string, unknown>
  ): SelfReviewDecision {
    if (!WRITE_TOOLS.has(toolName)) {
      return { shouldReview: false, filePath: "", reason: "not a write tool" };
    }

    const filePath = (args.path as string) ?? (args.filePath as string) ?? "";
    if (!filePath) {
      return { shouldReview: false, filePath: "", reason: "no file path" };
    }

    // Estimate change size from content
    const content = (args.content as string) ?? "";
    const lineCount = content.split("\n").length;

    // Skip review for trivial changes
    if (lineCount < REVIEW_THRESHOLD_LINES) {
      logger.debug(
        { filePath, lineCount },
        "Skipping self-review for trivial change"
      );
      return {
        shouldReview: false,
        filePath,
        reason: `change too small (${lineCount} lines)`,
      };
    }

    // Track write count to avoid review loops
    const writeCount = (this.recentWrites.get(filePath) ?? 0) + 1;
    this.recentWrites.set(filePath, writeCount);

    // Don't review the same file more than 3 times to avoid loops
    if (writeCount > 3) {
      return {
        shouldReview: false,
        filePath,
        reason: "already reviewed 3 times",
      };
    }

    return {
      shouldReview: true,
      filePath,
      reason: `file modified (${lineCount} lines, write #${writeCount})`,
    };
  }

  /**
   * Build a review prompt that instructs the agent to re-read and verify
   * its own output.
   */
  getReviewPrompt(filePath: string): string {
    return (
      `[Self-Review] You just modified ${filePath}. ` +
      "Please re-read the file to verify your changes are correct. " +
      "Check for: syntax errors, missing imports, type mismatches, " +
      "logic bugs, and convention violations. " +
      "If you find issues, fix them immediately."
    );
  }

  /**
   * Check if the given tool name is a read operation (used for tracking).
   */
  isReadTool(toolName: string): boolean {
    return READ_TOOLS.has(toolName);
  }

  /** Reset state for a new agent execution. */
  reset(): void {
    this.recentReads.clear();
    this.recentWrites.clear();
  }
}
