/**
 * Git Gutter Extension for CodeMirror
 *
 * Shows colored markers in the editor gutter to indicate git changes:
 * - Green: Added lines (new content)
 * - Yellow: Modified lines (changed content)
 * - Red: Deleted lines (content removed at this position)
 *
 * Also includes Git Blame support:
 * - Shows blame info for the focused line as an inline annotation
 * - Format: "Author Name . 3 days ago . commit message" (gray, italic)
 * - Click blame to see full commit details in a tooltip
 * - Toggle via command palette or keyboard shortcut
 * - Caches blame data per file
 */

import type { Extension } from "@codemirror/state";
import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  gutter,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

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

/** Blame info for a single line */
export interface GitBlameInfo {
  /** Author email */
  authorEmail?: string;
  /** Author name */
  authorName: string;
  /** Short commit hash */
  commitHash: string;
  /** Full commit message */
  commitMessage: string;
  /** ISO date string of the commit */
  date: string;
  /** 1-based line number */
  line: number;
}

export interface GitBlameOptions {
  /** API endpoint to fetch blame data */
  endpoint: string;
  /** File path to get blame for */
  filePath: string;
  /** Additional request headers */
  headers?: Record<string, string>;
  /** Whether blame is initially visible */
  initiallyVisible?: boolean;
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

/* ========================================================================== */
/*  Git Blame Extension                                                        */
/* ========================================================================== */

// --- Blame State ---

const setBlameDataEffect = StateEffect.define<GitBlameInfo[]>();
const toggleBlameVisibilityEffect = StateEffect.define<boolean>();

const blameDataField = StateField.define<GitBlameInfo[]>({
  create: () => [],
  update: (value, tr) => {
    for (const effect of tr.effects) {
      if (effect.is(setBlameDataEffect)) {
        return effect.value;
      }
    }
    return value;
  },
});

const blameVisibleField = StateField.define<boolean>({
  create: () => false,
  update: (value, tr) => {
    for (const effect of tr.effects) {
      if (effect.is(toggleBlameVisibilityEffect)) {
        return effect.value;
      }
    }
    return value;
  },
});

// --- Blame Widget ---

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  const diffMonth = Math.floor(diffDay / 30);
  const diffYear = Math.floor(diffDay / 365);

  if (diffYear > 0) {
    return `${diffYear}y ago`;
  }
  if (diffMonth > 0) {
    return `${diffMonth}mo ago`;
  }
  if (diffDay > 0) {
    return `${diffDay}d ago`;
  }
  if (diffHour > 0) {
    return `${diffHour}h ago`;
  }
  if (diffMin > 0) {
    return `${diffMin}m ago`;
  }
  return "just now";
}

class BlameAnnotationWidget extends WidgetType {
  readonly blame: GitBlameInfo;

  constructor(blame: GitBlameInfo) {
    super();
    this.blame = blame;
  }

  override toDOM(): HTMLElement {
    const container = document.createElement("span");
    container.className = "cm-blame-annotation";

    const relTime = formatRelativeTime(this.blame.date);
    const shortMsg =
      this.blame.commitMessage.length > 40
        ? `${this.blame.commitMessage.slice(0, 40)}...`
        : this.blame.commitMessage;

    container.textContent = `  ${this.blame.authorName} \u2022 ${relTime} \u2022 ${shortMsg}`;
    container.title = [
      `Commit: ${this.blame.commitHash}`,
      `Author: ${this.blame.authorName}${this.blame.authorEmail ? ` <${this.blame.authorEmail}>` : ""}`,
      `Date: ${new Date(this.blame.date).toLocaleString()}`,
      "",
      this.blame.commitMessage,
    ].join("\n");

    return container;
  }

  override eq(other: BlameAnnotationWidget): boolean {
    return (
      this.blame.commitHash === other.blame.commitHash &&
      this.blame.line === other.blame.line
    );
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

// --- Blame Theme ---

const blameTheme = EditorView.theme({
  ".cm-blame-annotation": {
    color: "rgba(161, 161, 170, 0.5)",
    fontStyle: "italic",
    fontSize: "11px",
    paddingLeft: "16px",
    cursor: "pointer",
    whiteSpace: "nowrap",
    "&:hover": {
      color: "rgba(161, 161, 170, 0.8)",
    },
  },
  ".cm-blame-tooltip": {
    position: "absolute",
    zIndex: "50",
    backgroundColor: "#18181b",
    border: "1px solid #3f3f46",
    borderRadius: "6px",
    padding: "8px 12px",
    maxWidth: "350px",
    fontSize: "12px",
    lineHeight: "1.5",
    color: "#a1a1aa",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
    whiteSpace: "pre-wrap",
  },
});

// --- Blame Plugin ---

class GitBlamePlugin {
  decorations: DecorationSet;
  private readonly view: EditorView;
  private readonly options: GitBlameOptions;
  private readonly blameCache: Map<string, GitBlameInfo[]> = new Map();
  private lastFocusedLine = -1;

  constructor(view: EditorView, options: GitBlameOptions) {
    this.view = view;
    this.options = options;
    this.decorations = Decoration.none;

    if (options.initiallyVisible) {
      this.fetchBlame();
    }
  }

  update(update: ViewUpdate): void {
    const isVisible = update.state.field(blameVisibleField);
    if (!isVisible) {
      this.decorations = Decoration.none;
      return;
    }

    const blameData = update.state.field(blameDataField);
    if (blameData.length === 0) {
      this.decorations = Decoration.none;
      return;
    }

    // Only show blame for the focused/cursor line
    const cursorLine = update.state.doc.lineAt(
      update.state.selection.main.head
    ).number;

    if (cursorLine !== this.lastFocusedLine || update.selectionSet) {
      this.lastFocusedLine = cursorLine;
      this.decorations = this.buildDecorations(blameData, cursorLine);
    }
  }

  destroy(): void {
    // Cleanup
  }

  private buildDecorations(
    blameData: GitBlameInfo[],
    focusedLine: number
  ): DecorationSet {
    const blame = blameData.find((b) => b.line === focusedLine);
    if (!blame) {
      return Decoration.none;
    }

    if (focusedLine < 1 || focusedLine > this.view.state.doc.lines) {
      return Decoration.none;
    }

    const lineObj = this.view.state.doc.line(focusedLine);
    const widget = new BlameAnnotationWidget(blame);

    return Decoration.set([
      Decoration.widget({ widget, side: 1 }).range(lineObj.to),
    ]);
  }

  async fetchBlame(): Promise<void> {
    const cached = this.blameCache.get(this.options.filePath);
    if (cached) {
      this.view.dispatch({
        effects: [
          setBlameDataEffect.of(cached),
          toggleBlameVisibilityEffect.of(true),
        ],
      });
      return;
    }

    try {
      const response = await fetch(this.options.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.options.headers,
        },
        body: JSON.stringify({ filePath: this.options.filePath }),
      });

      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as { blame: GitBlameInfo[] };
      this.blameCache.set(this.options.filePath, data.blame);

      this.view.dispatch({
        effects: [
          setBlameDataEffect.of(data.blame),
          toggleBlameVisibilityEffect.of(true),
        ],
      });
    } catch {
      // Network error, ignore
    }
  }

  toggleVisibility(): void {
    const currentlyVisible = this.view.state.field(blameVisibleField);

    if (!currentlyVisible) {
      // If we don't have data yet, fetch it
      const blameData = this.view.state.field(blameDataField);
      if (blameData.length === 0) {
        this.fetchBlame();
        return;
      }
    }

    this.view.dispatch({
      effects: toggleBlameVisibilityEffect.of(!currentlyVisible),
    });
  }
}

// --- Git Blame Extension Factory ---

/**
 * Creates a CodeMirror extension for inline git blame annotations.
 *
 * Shows blame info (author, relative time, commit message) for the
 * currently focused line. Only fetches and displays for one line at
 * a time for performance.
 *
 * @param options - Configuration for blame endpoint and display
 * @returns A CodeMirror Extension
 *
 * @example
 * ```ts
 * const blame = createGitBlameExtension({
 *   endpoint: "/api/git/blame",
 *   filePath: "src/index.ts",
 * });
 * ```
 */
export function createGitBlameExtension(options: GitBlameOptions): Extension {
  const plugin = ViewPlugin.define(
    (view) => new GitBlamePlugin(view, options),
    {
      decorations: (v) => v.decorations,
    }
  );

  const blameKeymap = keymap.of([
    {
      // Ctrl+Shift+B to toggle blame
      key: "Ctrl-Shift-b",
      mac: "Cmd-Shift-b",
      run: (view) => {
        const inst = view.plugin(plugin);
        if (inst) {
          inst.toggleVisibility();
          return true;
        }
        return false;
      },
    },
  ]);

  return [
    blameDataField,
    blameVisibleField.init(() => options.initiallyVisible ?? false),
    plugin,
    blameKeymap,
    blameTheme,
  ];
}

/**
 * Toggle blame visibility from outside the extension.
 */
export function toggleGitBlame(view: EditorView): void {
  const currentlyVisible = view.state.field(blameVisibleField);
  view.dispatch({
    effects: toggleBlameVisibilityEffect.of(!currentlyVisible),
  });
}

export type { GitChangeMarker, GitDiffHunk, GitDiffRange, GitLineStatus };
