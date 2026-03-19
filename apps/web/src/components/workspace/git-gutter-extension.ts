/**
 * Git Gutter Extension for CodeMirror
 *
 * Shows colored markers in the editor gutter to indicate git changes:
 * - Green: Added lines (new content)
 * - Yellow: Modified lines (changed content)
 * - Red: Deleted lines (content removed at this position)
 *
 * Accepts git diff data as input and renders gutter decorations accordingly.
 */

import type { Extension } from "@codemirror/state";
import { RangeSetBuilder, StateField } from "@codemirror/state";
import { EditorView, GutterMarker, gutter } from "@codemirror/view";

// --- Types ---

/** The type of change a line has undergone */
type GitLineStatus = "added" | "modified" | "deleted";

/** Represents a range of lines with a specific git change status */
interface GitDiffRange {
  /** 1-based start line number */
  fromLine: number;
  /** The type of change */
  status: GitLineStatus;
  /** 1-based end line number (inclusive) */
  toLine: number;
}

/** Raw unified diff hunk data that can be converted to GitDiffRange */
interface GitDiffHunk {
  /** New file line count */
  newCount: number;
  /** New file start line */
  newStart: number;
  /** Old file line count */
  oldCount: number;
  /** Old file start line */
  oldStart: number;
}

// --- Gutter Markers ---

class GitChangeMarker extends GutterMarker {
  readonly status: GitLineStatus;

  constructor(status: GitLineStatus) {
    super();
    this.status = status;
  }

  override toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = `cm-git-marker cm-git-marker-${this.status}`;
    el.style.width = "3px";
    el.style.height = "100%";
    el.style.borderRadius = "1px";

    switch (this.status) {
      case "added":
        el.style.backgroundColor = "#22c55e"; // green-500
        break;
      case "modified":
        el.style.backgroundColor = "#eab308"; // yellow-500
        break;
      case "deleted":
        el.style.backgroundColor = "#ef4444"; // red-500
        break;
      default:
        break;
    }

    return el;
  }

  override eq(other: GitChangeMarker): boolean {
    return this.status === other.status;
  }
}

// Singleton marker instances for performance
const markers: Record<GitLineStatus, GitChangeMarker> = {
  added: new GitChangeMarker("added"),
  modified: new GitChangeMarker("modified"),
  deleted: new GitChangeMarker("deleted"),
};

// --- State Field ---

const gitDiffField = StateField.define<GitDiffRange[]>({
  create: () => [],
  update: (value) => value,
});

// --- Theme ---

const gitGutterTheme = EditorView.theme({
  ".cm-git-gutter": {
    width: "6px",
    marginLeft: "2px",
    marginRight: "2px",
  },
  ".cm-git-gutter .cm-gutterElement": {
    padding: "0",
  },
});

// --- Gutter ---

function createGutter(): Extension {
  return gutter({
    class: "cm-git-gutter",
    markers: (view) => {
      const builder = new RangeSetBuilder<GutterMarker>();
      const ranges = view.state.field(gitDiffField);

      for (const range of ranges) {
        for (let line = range.fromLine; line <= range.toLine; line++) {
          if (line >= 1 && line <= view.state.doc.lines) {
            const lineObj = view.state.doc.line(line);
            const marker = markers[range.status];
            builder.add(lineObj.from, lineObj.from, marker);
          }
        }
      }

      return builder.finish();
    },
    initialSpacer: () => markers.added,
  });
}

// --- Public API ---

/**
 * Creates a CodeMirror extension that displays git change indicators in the gutter.
 *
 * @param changes - Array of git diff ranges indicating which lines were added,
 *   modified, or deleted. Line numbers are 1-based and inclusive.
 * @returns A CodeMirror Extension to include in editor setup
 *
 * @example
 * ```ts
 * const gitGutter = createGitGutterExtension([
 *   { fromLine: 5, toLine: 10, status: "added" },
 *   { fromLine: 15, toLine: 15, status: "modified" },
 *   { fromLine: 20, toLine: 20, status: "deleted" },
 * ]);
 *
 * // Include in editor extensions:
 * extensions: [gitGutter, ...]
 * ```
 */
export function createGitGutterExtension(changes: GitDiffRange[]): Extension {
  return [gitDiffField.init(() => changes), createGutter(), gitGutterTheme];
}

/**
 * Converts unified diff hunks into GitDiffRange entries.
 * Useful when you have raw diff output and need to convert it
 * to the format expected by createGitGutterExtension.
 *
 * @param hunks - Array of unified diff hunks
 * @returns Array of GitDiffRange entries
 */
export function hunksToGitDiffRanges(hunks: GitDiffHunk[]): GitDiffRange[] {
  const ranges: GitDiffRange[] = [];

  for (const hunk of hunks) {
    if (hunk.oldCount === 0 && hunk.newCount > 0) {
      // Pure addition
      ranges.push({
        fromLine: hunk.newStart,
        toLine: hunk.newStart + hunk.newCount - 1,
        status: "added",
      });
    } else if (hunk.newCount === 0 && hunk.oldCount > 0) {
      // Pure deletion — mark the line where content was removed
      ranges.push({
        fromLine: Math.max(1, hunk.newStart),
        toLine: Math.max(1, hunk.newStart),
        status: "deleted",
      });
    } else {
      // Modification — lines that exist in both old and new
      const modifiedLines = Math.min(hunk.oldCount, hunk.newCount);
      if (modifiedLines > 0) {
        ranges.push({
          fromLine: hunk.newStart,
          toLine: hunk.newStart + modifiedLines - 1,
          status: "modified",
        });
      }

      // Extra new lines are additions
      if (hunk.newCount > hunk.oldCount) {
        ranges.push({
          fromLine: hunk.newStart + modifiedLines,
          toLine: hunk.newStart + hunk.newCount - 1,
          status: "added",
        });
      }

      // Extra old lines indicate deleted content at the end of the hunk
      if (hunk.oldCount > hunk.newCount) {
        const deletionLine = hunk.newStart + hunk.newCount;
        ranges.push({
          fromLine: Math.max(1, deletionLine - 1),
          toLine: Math.max(1, deletionLine - 1),
          status: "deleted",
        });
      }
    }
  }

  return ranges;
}

export type { GitChangeMarker, GitDiffHunk, GitDiffRange, GitLineStatus };
