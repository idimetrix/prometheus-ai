/**
 * Phase 2.2: Diff Optimizer
 *
 * Intercepts file_write operations for existing files and converts them
 * to minimal diff-based edits when the change is less than 40% of the file.
 * This reduces token usage and improves reliability of code modifications.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:diff-optimizer");

const CHANGE_THRESHOLD = 0.4;

export interface DiffResult {
  changedLines: number;
  changeRatio: number;
  diffInstructions?: string;
  originalLines: number;
  shouldUseDiff: boolean;
}

interface LineDiff {
  newLine?: string;
  oldLine?: string;
  type: "add" | "remove" | "unchanged";
}

/**
 * Compute the longest common subsequence table for two string arrays.
 */
function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const table: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => 0)
  );

  for (let i = 1; i <= m; i++) {
    const row = table[i];
    const prevRow = table[i - 1];
    if (!(row && prevRow)) {
      continue;
    }
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        row[j] = (prevRow[j - 1] ?? 0) + 1;
      } else {
        row[j] = Math.max(prevRow[j] ?? 0, row[j - 1] ?? 0);
      }
    }
  }

  return table;
}

/**
 * Compute a line-level diff using LCS backtracking.
 */
function computeLineDiff(oldLines: string[], newLines: string[]): LineDiff[] {
  const table = lcsTable(oldLines, newLines);
  const diffs: LineDiff[] = [];

  let i = oldLines.length;
  let j = newLines.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      diffs.unshift({
        type: "unchanged",
        oldLine: oldLines[i - 1],
        newLine: newLines[j - 1],
      });
      i--;
      j--;
    } else if (
      j > 0 &&
      (i === 0 || (table[i]?.[j - 1] ?? 0) >= (table[i - 1]?.[j] ?? 0))
    ) {
      diffs.unshift({ type: "add", newLine: newLines[j - 1] });
      j--;
    } else {
      diffs.unshift({ type: "remove", oldLine: oldLines[i - 1] });
      i--;
    }
  }

  return diffs;
}

/**
 * Group consecutive diff operations into hunks with surrounding context.
 */
interface Hunk {
  changes: LineDiff[];
  contextAfter: string[];
  contextBefore: string[];
  startLineNew: number;
  startLineOld: number;
}

function groupIntoHunks(diffs: LineDiff[], contextLines = 3): Hunk[] {
  const hunks: Hunk[] = [];
  let currentHunk: Hunk | null = null;
  let oldLineNum = 0;
  let newLineNum = 0;
  let unchangedSinceLastChange = 0;

  for (const diff of diffs) {
    const isChange = diff.type !== "unchanged";

    if (diff.type === "unchanged") {
      oldLineNum++;
      newLineNum++;
    } else if (diff.type === "remove") {
      oldLineNum++;
    } else {
      newLineNum++;
    }

    if (isChange) {
      if (!currentHunk) {
        // Start a new hunk, collecting context before
        const _contextStart = Math.max(
          0,
          (diff.type === "remove" ? oldLineNum : newLineNum) - contextLines - 1
        );
        currentHunk = {
          startLineOld: Math.max(1, oldLineNum - contextLines),
          startLineNew: Math.max(1, newLineNum - contextLines),
          contextBefore: [],
          changes: [],
          contextAfter: [],
        };
      }
      currentHunk.changes.push(diff);
      unchangedSinceLastChange = 0;
    } else if (currentHunk) {
      unchangedSinceLastChange++;
      if (unchangedSinceLastChange <= contextLines) {
        currentHunk.changes.push(diff);
      } else {
        // End the hunk, capturing trailing context
        hunks.push(currentHunk);
        currentHunk = null;
        unchangedSinceLastChange = 0;
      }
    }
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }

  return hunks;
}

export class DiffOptimizer {
  /**
   * Analyze an existing file against proposed new content.
   * Returns whether a diff-based approach is preferable over a full rewrite.
   */
  async analyze(
    filePath: string,
    newContent: string,
    workDir: string
  ): Promise<DiffResult> {
    const fullPath = resolve(workDir, filePath);

    let existingContent: string;
    try {
      existingContent = await readFile(fullPath, "utf-8");
    } catch {
      // File doesn't exist yet; must use full write
      logger.debug({ filePath }, "File does not exist, full write required");
      return {
        shouldUseDiff: false,
        originalLines: 0,
        changedLines: 0,
        changeRatio: 1.0,
      };
    }

    const oldLines = existingContent.split("\n");
    const newLines = newContent.split("\n");

    // For very small files, always use full write
    if (oldLines.length < 10) {
      return {
        shouldUseDiff: false,
        originalLines: oldLines.length,
        changedLines: newLines.length,
        changeRatio: 1.0,
      };
    }

    const diffs = computeLineDiff(oldLines, newLines);
    const changedCount = diffs.filter((d) => d.type !== "unchanged").length;
    const totalLines = Math.max(oldLines.length, newLines.length);
    const changeRatio = totalLines > 0 ? changedCount / totalLines : 1.0;

    const shouldUseDiff = changeRatio < CHANGE_THRESHOLD;

    let diffInstructions: string | undefined;
    if (shouldUseDiff) {
      diffInstructions = this.buildDiffInstructions(
        filePath,
        oldLines,
        newLines,
        diffs
      );
    }

    logger.info(
      {
        filePath,
        originalLines: oldLines.length,
        changedLines: changedCount,
        changeRatio: changeRatio.toFixed(3),
        shouldUseDiff,
      },
      "Diff analysis complete"
    );

    return {
      shouldUseDiff,
      originalLines: oldLines.length,
      changedLines: changedCount,
      changeRatio,
      diffInstructions,
    };
  }

  /**
   * Generate a prompt instructing the agent to use file_edit instead
   * of file_write, based on the computed diff.
   */
  generateDiffPrompt(filePath: string, diffResult: DiffResult): string {
    if (!(diffResult.shouldUseDiff && diffResult.diffInstructions)) {
      return `Write the complete file to ${filePath}.`;
    }

    return [
      `OPTIMIZATION: Use file_edit instead of file_write for ${filePath}.`,
      `The file has ${diffResult.originalLines} lines and only ${diffResult.changedLines} lines (${(diffResult.changeRatio * 100).toFixed(1)}%) need to change.`,
      "",
      "Apply these specific edits:",
      "",
      diffResult.diffInstructions,
    ].join("\n");
  }

  private buildDiffInstructions(
    filePath: string,
    _oldLines: string[],
    _newLines: string[],
    diffs: LineDiff[]
  ): string {
    const hunks = groupIntoHunks(diffs);
    const instructions: string[] = [];

    for (const [idx, hunk] of hunks.entries()) {
      const editParts: string[] = [`### Edit ${idx + 1} in ${filePath}`];

      // Build old_string (what to find) and new_string (what to replace with)
      const oldStr: string[] = [];
      const newStr: string[] = [];

      for (const change of hunk.changes) {
        if (change.type === "unchanged") {
          oldStr.push(change.oldLine ?? "");
          newStr.push(change.newLine ?? "");
        } else if (change.type === "remove") {
          oldStr.push(change.oldLine ?? "");
        } else {
          newStr.push(change.newLine ?? "");
        }
      }

      editParts.push("Find (old_string):");
      editParts.push("```");
      editParts.push(oldStr.join("\n"));
      editParts.push("```");
      editParts.push("");
      editParts.push("Replace with (new_string):");
      editParts.push("```");
      editParts.push(newStr.join("\n"));
      editParts.push("```");

      instructions.push(editParts.join("\n"));
    }

    if (instructions.length === 0) {
      return "No changes needed.";
    }

    return instructions.join("\n\n");
  }
}
