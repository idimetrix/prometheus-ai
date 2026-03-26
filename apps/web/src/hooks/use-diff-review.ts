"use client";

import { useCallback, useMemo, useState } from "react";

// ── Types ───────────────────────────────────────────────────────

export interface DiffHunkData {
  /** Lines added */
  additions: number;
  /** Lines removed */
  deletions: number;
  /** Unique ID for this hunk */
  id: string;
  /** Hunk content - the new text for this hunk */
  newContent: string;
  /** Start line number in the new file */
  newStart: number;
  /** Old content being replaced */
  oldContent: string;
  /** Start line number in the old file */
  oldStart: number;
  /** Status of this hunk */
  status: "pending" | "accepted" | "rejected";
}

export interface PendingFileChange {
  /** File path relative to project root */
  filePath: string;
  /** Hunks (individual changes) within this file */
  hunks: DiffHunkData[];
  /** Whether the file was deleted */
  isDeleted: boolean;
  /** Whether this is a new file */
  isNew: boolean;
  /** Language for syntax highlighting */
  language: string;
  /** Modified file content (all hunks applied) */
  modifiedContent: string;
  /** Original file content */
  originalContent: string;
  /** Timestamp when the change was created */
  timestamp: string;
}

export interface DiffReviewState {
  /** All pending file changes indexed by filePath */
  files: Map<string, PendingFileChange>;
  /** Currently selected file for detailed review */
  selectedFilePath: string | null;
}

export interface DiffReviewActions {
  /** Accept all pending changes across all files */
  acceptAll: () => void;
  /** Accept all hunks in a file */
  acceptFile: (filePath: string) => void;
  /** Accept a single hunk in a file */
  acceptHunk: (filePath: string, hunkId: string) => void;
  /** Add a new pending file change */
  addFileChange: (change: PendingFileChange) => void;
  /** Clear all reviewed (accepted/rejected) changes */
  clearReviewed: () => void;
  /** Commit all accepted changes via sandbox API */
  commitAccepted: (sessionId: string) => Promise<void>;
  /** Reject all pending changes */
  rejectAll: () => void;
  /** Reject all hunks in a file */
  rejectFile: (filePath: string) => void;
  /** Reject a single hunk in a file */
  rejectHunk: (filePath: string, hunkId: string) => void;
  /** Remove a file from pending changes */
  removeFile: (filePath: string) => void;
  /** Select a file for review */
  selectFile: (filePath: string | null) => void;
}

export interface DiffReviewSummary {
  acceptedHunks: number;
  pendingHunks: number;
  rejectedHunks: number;
  totalAdditions: number;
  totalDeletions: number;
  totalFiles: number;
}

// ── Helpers ─────────────────────────────────────────────────────

function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const langMap: Record<string, string> = {
    ts: "typescript",
    tsx: "typescriptreact",
    js: "javascript",
    jsx: "javascriptreact",
    json: "json",
    md: "markdown",
    css: "css",
    scss: "scss",
    html: "html",
    py: "python",
    rs: "rust",
    go: "go",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    sql: "sql",
    sh: "shell",
    bash: "shell",
    dockerfile: "dockerfile",
  };
  return langMap[ext] ?? "plaintext";
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: diff algorithm requires nested loops with multiple comparison paths
function computeHunksFromDiff(
  oldContent: string,
  newContent: string
): DiffHunkData[] {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  // Simple diff: find contiguous regions of change
  const hunks: DiffHunkData[] = [];
  let oldIdx = 0;
  let newIdx = 0;
  let hunkCounter = 0;

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    // Skip matching lines
    if (
      oldIdx < oldLines.length &&
      newIdx < newLines.length &&
      oldLines[oldIdx] === newLines[newIdx]
    ) {
      oldIdx++;
      newIdx++;
      continue;
    }

    // Found a difference - collect the hunk
    const hunkOldStart = oldIdx;
    const hunkNewStart = newIdx;
    const hunkOldLines: string[] = [];
    const hunkNewLines: string[] = [];

    // Collect differing lines (look ahead for re-sync)
    while (oldIdx < oldLines.length || newIdx < newLines.length) {
      if (
        oldIdx < oldLines.length &&
        newIdx < newLines.length &&
        oldLines[oldIdx] === newLines[newIdx]
      ) {
        // Check if we have enough matching context to end the hunk
        let matchCount = 0;
        let checkOld = oldIdx;
        let checkNew = newIdx;
        while (
          checkOld < oldLines.length &&
          checkNew < newLines.length &&
          oldLines[checkOld] === newLines[checkNew]
        ) {
          matchCount++;
          checkOld++;
          checkNew++;
          if (matchCount >= 3) {
            break;
          }
        }
        if (matchCount >= 3) {
          break;
        }

        // Include this matching line in the hunk
        hunkOldLines.push(oldLines[oldIdx] ?? "");
        hunkNewLines.push(newLines[newIdx] ?? "");
        oldIdx++;
        newIdx++;
      } else if (
        newIdx < newLines.length &&
        (oldIdx >= oldLines.length ||
          !oldLines.includes(newLines[newIdx] ?? ""))
      ) {
        hunkNewLines.push(newLines[newIdx] ?? "");
        newIdx++;
      } else if (oldIdx < oldLines.length) {
        hunkOldLines.push(oldLines[oldIdx] ?? "");
        oldIdx++;
      } else {
        break;
      }
    }

    if (hunkOldLines.length > 0 || hunkNewLines.length > 0) {
      hunkCounter++;
      hunks.push({
        id: `hunk-${hunkCounter}`,
        oldStart: hunkOldStart + 1,
        newStart: hunkNewStart + 1,
        oldContent: hunkOldLines.join("\n"),
        newContent: hunkNewLines.join("\n"),
        additions: hunkNewLines.filter((l) => !hunkOldLines.includes(l)).length,
        deletions: hunkOldLines.filter((l) => !hunkNewLines.includes(l)).length,
        status: "pending",
      });
    }
  }

  return hunks;
}

/**
 * Apply only accepted hunks to the original content, producing a
 * partially-applied result.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: hunk application requires tracking multiple line indices with branching logic
function applyAcceptedHunks(
  originalContent: string,
  modifiedContent: string,
  hunks: DiffHunkData[]
): string {
  // If all accepted, return modified content
  if (hunks.every((h) => h.status === "accepted")) {
    return modifiedContent;
  }

  // If all rejected, return original content
  if (hunks.every((h) => h.status === "rejected")) {
    return originalContent;
  }

  // Partial application: reconstruct file with accepted hunks
  const oldLines = originalContent.split("\n");
  const _newLines = modifiedContent.split("\n");
  const result: string[] = [];

  let oldIdx = 0;
  let _newIdx = 0;

  for (const hunk of hunks) {
    // Copy unchanged lines up to this hunk
    const hunkOldStart = hunk.oldStart - 1;
    while (oldIdx < hunkOldStart && oldIdx < oldLines.length) {
      result.push(oldLines[oldIdx] ?? "");
      oldIdx++;
      _newIdx++;
    }

    const hunkOldLines = hunk.oldContent ? hunk.oldContent.split("\n") : [];
    const hunkNewLines = hunk.newContent ? hunk.newContent.split("\n") : [];

    if (hunk.status === "accepted") {
      // Use the new content
      for (const line of hunkNewLines) {
        result.push(line);
      }
    } else {
      // Use the old content
      for (const line of hunkOldLines) {
        result.push(line);
      }
    }

    oldIdx += hunkOldLines.length;
    _newIdx += hunkNewLines.length;
  }

  // Copy remaining unchanged lines
  while (oldIdx < oldLines.length) {
    result.push(oldLines[oldIdx] ?? "");
    oldIdx++;
  }

  return result.join("\n");
}

// ── Hook ────────────────────────────────────────────────────────

export function useDiffReview(): DiffReviewState &
  DiffReviewActions & { summary: DiffReviewSummary } {
  const [files, setFiles] = useState<Map<string, PendingFileChange>>(new Map());
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);

  const summary = useMemo<DiffReviewSummary>(() => {
    let totalAdditions = 0;
    let totalDeletions = 0;
    let pendingHunks = 0;
    let acceptedHunks = 0;
    let rejectedHunks = 0;

    for (const file of files.values()) {
      for (const hunk of file.hunks) {
        totalAdditions += hunk.additions;
        totalDeletions += hunk.deletions;
        if (hunk.status === "pending") {
          pendingHunks++;
        }
        if (hunk.status === "accepted") {
          acceptedHunks++;
        }
        if (hunk.status === "rejected") {
          rejectedHunks++;
        }
      }
    }

    return {
      totalFiles: files.size,
      totalAdditions,
      totalDeletions,
      pendingHunks,
      acceptedHunks,
      rejectedHunks,
    };
  }, [files]);

  const acceptHunk = useCallback((filePath: string, hunkId: string) => {
    setFiles((prev) => {
      const updated = new Map(prev);
      const file = updated.get(filePath);
      if (!file) {
        return prev;
      }
      updated.set(filePath, {
        ...file,
        hunks: file.hunks.map((h) =>
          h.id === hunkId ? { ...h, status: "accepted" } : h
        ),
      });
      return updated;
    });
  }, []);

  const rejectHunk = useCallback((filePath: string, hunkId: string) => {
    setFiles((prev) => {
      const updated = new Map(prev);
      const file = updated.get(filePath);
      if (!file) {
        return prev;
      }
      updated.set(filePath, {
        ...file,
        hunks: file.hunks.map((h) =>
          h.id === hunkId ? { ...h, status: "rejected" } : h
        ),
      });
      return updated;
    });
  }, []);

  const acceptFile = useCallback((filePath: string) => {
    setFiles((prev) => {
      const updated = new Map(prev);
      const file = updated.get(filePath);
      if (!file) {
        return prev;
      }
      updated.set(filePath, {
        ...file,
        hunks: file.hunks.map((h) => ({ ...h, status: "accepted" })),
      });
      return updated;
    });
  }, []);

  const rejectFile = useCallback((filePath: string) => {
    setFiles((prev) => {
      const updated = new Map(prev);
      const file = updated.get(filePath);
      if (!file) {
        return prev;
      }
      updated.set(filePath, {
        ...file,
        hunks: file.hunks.map((h) => ({ ...h, status: "rejected" })),
      });
      return updated;
    });
  }, []);

  const acceptAll = useCallback(() => {
    setFiles((prev) => {
      const updated = new Map(prev);
      for (const [path, file] of updated) {
        updated.set(path, {
          ...file,
          hunks: file.hunks.map((h) => ({ ...h, status: "accepted" })),
        });
      }
      return updated;
    });
  }, []);

  const rejectAll = useCallback(() => {
    setFiles((prev) => {
      const updated = new Map(prev);
      for (const [path, file] of updated) {
        updated.set(path, {
          ...file,
          hunks: file.hunks.map((h) => ({ ...h, status: "rejected" })),
        });
      }
      return updated;
    });
  }, []);

  const addFileChange = useCallback((change: PendingFileChange) => {
    const hunks =
      change.hunks.length > 0
        ? change.hunks
        : computeHunksFromDiff(change.originalContent, change.modifiedContent);

    const language = change.language || detectLanguage(change.filePath);

    setFiles((prev) => {
      const updated = new Map(prev);
      updated.set(change.filePath, {
        ...change,
        hunks,
        language,
      });
      return updated;
    });
  }, []);

  const removeFile = useCallback((filePath: string) => {
    setFiles((prev) => {
      const updated = new Map(prev);
      updated.delete(filePath);
      return updated;
    });
    setSelectedFilePath((prev) => (prev === filePath ? null : prev));
  }, []);

  const selectFile = useCallback((filePath: string | null) => {
    setSelectedFilePath(filePath);
  }, []);

  const clearReviewed = useCallback(() => {
    setFiles((prev) => {
      const updated = new Map(prev);
      for (const [path, file] of updated) {
        const hasPending = file.hunks.some((h) => h.status === "pending");
        if (!hasPending) {
          updated.delete(path);
        }
      }
      return updated;
    });
  }, []);

  const commitAccepted = useCallback(
    async (sessionId: string) => {
      const sandboxUrl =
        process.env.NEXT_PUBLIC_SANDBOX_URL ?? "http://localhost:4006";

      const acceptedFiles: Array<{
        filePath: string;
        content: string;
      }> = [];

      for (const [path, file] of files) {
        const hasAccepted = file.hunks.some((h) => h.status === "accepted");
        if (!hasAccepted) {
          continue;
        }

        if (file.isDeleted) {
          // For deletions, only act if all hunks are accepted
          if (file.hunks.every((h) => h.status === "accepted")) {
            acceptedFiles.push({ filePath: path, content: "" });
          }
          continue;
        }

        const resultContent = applyAcceptedHunks(
          file.originalContent,
          file.modifiedContent,
          file.hunks
        );

        acceptedFiles.push({ filePath: path, content: resultContent });
      }

      // Apply changes via sandbox API
      for (const { filePath, content } of acceptedFiles) {
        try {
          await fetch(
            `${sandboxUrl}/api/sandboxes/${sessionId}/files/${encodeURIComponent(filePath)}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ content }),
            }
          );
        } catch {
          // Log but continue with other files
          console.error(`Failed to commit ${filePath}`);
        }
      }

      // Clear committed files
      clearReviewed();
    },
    [files, clearReviewed]
  );

  return {
    files,
    selectedFilePath,
    summary,
    acceptHunk,
    rejectHunk,
    acceptFile,
    rejectFile,
    acceptAll,
    rejectAll,
    addFileChange,
    removeFile,
    selectFile,
    clearReviewed,
    commitAccepted,
  };
}
