"use client";

import {
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { MergeView } from "@codemirror/merge";
import type { Extension } from "@codemirror/state";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, lineNumbers } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";

// --- Types ---

type DiffViewMode = "split" | "unified";

interface DiffEditorProps {
  /** Initial view mode (default: "split") */
  defaultViewMode?: DiffViewMode;
  /** Language/file extension for syntax highlighting */
  language: string;
  /** The modified (new) content */
  modified: string;
  /** The original (old) content */
  original: string;
}

// --- Language Extensions ---

function getLanguageExtension(ext: string): Promise<Extension> | null {
  switch (ext) {
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return import("@codemirror/lang-javascript").then((mod) =>
        mod.javascript({ jsx: true })
      );
    case "ts":
    case "tsx":
    case "mts":
    case "cts":
      return import("@codemirror/lang-javascript").then((mod) =>
        mod.javascript({ jsx: true, typescript: true })
      );
    case "py":
    case "pyw":
      return import("@codemirror/lang-python").then((mod) => mod.python());
    case "json":
    case "jsonc":
      return import("@codemirror/lang-json").then((mod) => mod.json());
    case "html":
    case "htm":
    case "svg":
      return import("@codemirror/lang-html").then((mod) => mod.html());
    case "css":
    case "scss":
    case "less":
      return import("@codemirror/lang-css").then((mod) => mod.css());
    case "md":
    case "mdx":
    case "markdown":
      return import("@codemirror/lang-markdown").then((mod) => mod.markdown());
    default:
      return null;
  }
}

// --- Theme ---

const diffEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13px",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily:
      "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
  },
  ".cm-gutters": {
    backgroundColor: "rgb(9, 9, 11)",
    borderRight: "1px solid rgb(39, 39, 42)",
  },
  ".cm-mergeView": {
    height: "100%",
  },
  ".cm-mergeViewEditors": {
    height: "100%",
  },
  ".cm-mergeViewEditor": {
    height: "100%",
  },
  // Highlight additions (green) and deletions (red)
  ".cm-changedLine": {
    backgroundColor: "rgba(34, 197, 94, 0.08) !important",
  },
  ".cm-changedText": {
    backgroundColor: "rgba(34, 197, 94, 0.2) !important",
  },
  ".cm-deletedChunk": {
    backgroundColor: "rgba(239, 68, 68, 0.08) !important",
  },
});

const mergeViewTheme = EditorView.theme({
  // Style for the merge view separator
  ".cm-mergeViewGap": {
    backgroundColor: "rgb(24, 24, 27)",
    borderLeft: "1px solid rgb(39, 39, 42)",
    borderRight: "1px solid rgb(39, 39, 42)",
  },
});

// --- Diff Editor Component ---

export function DiffEditor({
  original,
  modified,
  language,
  defaultViewMode = "split",
}: DiffEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mergeViewRef = useRef<MergeView | null>(null);
  const [viewMode, setViewMode] = useState<DiffViewMode>(defaultViewMode);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    let cancelled = false;

    const setup = async () => {
      const baseExtensions: Extension[] = [
        lineNumbers(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        oneDark,
        diffEditorTheme,
        mergeViewTheme,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
      ];

      // Load language extension
      const langPromise = getLanguageExtension(language);
      if (langPromise) {
        try {
          const langExt = await langPromise;
          if (!cancelled) {
            baseExtensions.push(langExt);
          }
        } catch {
          // Language extension failed to load
        }
      }

      if (cancelled) {
        return;
      }

      // Clean up existing view
      if (mergeViewRef.current) {
        mergeViewRef.current.destroy();
      }

      if (!containerRef.current) {
        return;
      }

      const mergeView = new MergeView({
        a: {
          doc: original,
          extensions: baseExtensions,
        },
        b: {
          doc: modified,
          extensions: baseExtensions,
        },
        parent: containerRef.current,
        collapseUnchanged: { margin: 3, minSize: 4 },
        gutter: true,
      });

      mergeViewRef.current = mergeView;
    };

    setup();

    return () => {
      cancelled = true;
      if (mergeViewRef.current) {
        mergeViewRef.current.destroy();
        mergeViewRef.current = null;
      }
    };
  }, [original, modified, language]);

  // Compute basic stats
  const stats = computeDiffStats(original, modified);

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-zinc-800 border-b px-3 py-1.5">
        <div className="flex items-center gap-3">
          <span className="font-medium text-xs text-zinc-300">Diff View</span>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-green-400">+{stats.additions}</span>
            <span className="text-red-400">-{stats.deletions}</span>
          </div>
        </div>

        {/* View mode toggle */}
        <div className="flex items-center gap-0.5 rounded border border-zinc-800 p-0.5">
          <button
            className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
              viewMode === "split"
                ? "bg-violet-500/20 text-violet-400"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            onClick={() => setViewMode("split")}
            type="button"
          >
            Split
          </button>
          <button
            className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
              viewMode === "unified"
                ? "bg-violet-500/20 text-violet-400"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            onClick={() => setViewMode("unified")}
            type="button"
          >
            Unified
          </button>
        </div>
      </div>

      {/* Side labels for split mode */}
      {viewMode === "split" && (
        <div className="flex border-zinc-800 border-b">
          <div className="w-1/2 border-zinc-800 border-r bg-red-500/5 px-3 py-1">
            <span className="text-[10px] text-red-400">Original</span>
          </div>
          <div className="w-1/2 bg-green-500/5 px-3 py-1">
            <span className="text-[10px] text-green-400">Modified</span>
          </div>
        </div>
      )}

      {/* Merge view container */}
      <div className="flex-1 overflow-hidden" ref={containerRef} />
    </div>
  );
}

// --- Helpers ---

interface DiffStats {
  additions: number;
  deletions: number;
}

function computeDiffStats(original: string, modified: string): DiffStats {
  const oldLines = original.split("\n");
  const newLines = modified.split("\n");

  // Simple line-based counting
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);

  let additions = 0;
  let deletions = 0;

  for (const line of newLines) {
    if (!oldSet.has(line)) {
      additions++;
    }
  }

  for (const line of oldLines) {
    if (!newSet.has(line)) {
      deletions++;
    }
  }

  return { additions, deletions };
}

export type { DiffEditorProps, DiffViewMode };
