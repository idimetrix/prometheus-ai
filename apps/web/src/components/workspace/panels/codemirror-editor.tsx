"use client";

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { lintGutter, setDiagnostics } from "@codemirror/lint";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import type { Extension } from "@codemirror/state";
import { EditorState, RangeSetBuilder, StateField } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  EditorView,
  GutterMarker,
  gutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { useEffect, useRef } from "react";

// --- Git Gutter Decorations ---

type GitLineStatus = "added" | "modified" | "deleted";

class GitGutterMarker extends GutterMarker {
  readonly status: GitLineStatus;

  constructor(status: GitLineStatus) {
    super();
    this.status = status;
  }

  override toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.style.width = "3px";
    el.style.height = "100%";
    el.style.borderRadius = "1px";

    switch (this.status) {
      case "added":
        el.style.backgroundColor = "#22c55e";
        break;
      case "deleted":
        el.style.backgroundColor = "#ef4444";
        break;
      case "modified":
        el.style.backgroundColor = "#3b82f6";
        break;
      default:
        break;
    }

    return el;
  }
}

const addedMarker = new GitGutterMarker("added");
const modifiedMarker = new GitGutterMarker("modified");
const deletedMarker = new GitGutterMarker("deleted");

interface GitChange {
  fromLine: number;
  status: GitLineStatus;
  toLine: number;
}

const gitChangesField = StateField.define<GitChange[]>({
  create: () => [],
  update: (value) => value,
});

function gitGutterExtension(changes: GitChange[]): Extension[] {
  return [
    gitChangesField.init(() => changes),
    gutter({
      class: "cm-git-gutter",
      markers: (view) => {
        const builder = new RangeSetBuilder<GutterMarker>();
        const gitChanges = view.state.field(gitChangesField);

        for (const change of gitChanges) {
          for (let line = change.fromLine; line <= change.toLine; line++) {
            if (line <= view.state.doc.lines) {
              const lineObj = view.state.doc.line(line);
              let marker: GitGutterMarker;
              if (change.status === "added") {
                marker = addedMarker;
              } else if (change.status === "deleted") {
                marker = deletedMarker;
              } else {
                marker = modifiedMarker;
              }
              builder.add(lineObj.from, lineObj.from, marker);
            }
          }
        }

        return builder.finish();
      },
      initialSpacer: () => addedMarker,
    }),
    EditorView.theme({
      ".cm-git-gutter": {
        width: "6px",
        marginLeft: "2px",
        marginRight: "2px",
      },
    }),
  ];
}

// --- Minimap (simplified scrollbar overview) ---

function minimapExtension(): Extension {
  return EditorView.theme({
    ".cm-scroller": {
      scrollbarWidth: "thin",
    },
    ".cm-scroller::-webkit-scrollbar": {
      width: "48px",
    },
    ".cm-scroller::-webkit-scrollbar-track": {
      backgroundColor: "rgb(15, 15, 18)",
      borderLeft: "1px solid rgb(39, 39, 42)",
    },
    ".cm-scroller::-webkit-scrollbar-thumb": {
      backgroundColor: "rgba(255, 255, 255, 0.12)",
      borderLeft: "1px solid rgb(39, 39, 42)",
      borderRadius: "0",
    },
    ".cm-scroller::-webkit-scrollbar-thumb:hover": {
      backgroundColor: "rgba(255, 255, 255, 0.2)",
    },
  });
}

// --- Diagnostics Panel ---

interface Diagnostic {
  from: number;
  message: string;
  severity: "error" | "warning" | "info" | "hint";
  to: number;
}

function createDiagnosticsExtension(_diagnostics: Diagnostic[]): Extension[] {
  return [
    lintGutter(),
    EditorView.theme({
      ".cm-lint-marker-error": { content: "''" },
      ".cm-lint-marker-warning": { content: "''" },
    }),
  ];
}

// --- Vim Mode ---

async function loadVimMode(): Promise<Extension | null> {
  try {
    const mod = await import("@replit/codemirror-vim");
    return mod.vim();
  } catch {
    // vim extension not available
    return null;
  }
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

// --- Editor Component ---

interface CodeMirrorEditorProps {
  diagnostics?: Diagnostic[];
  extension: string;
  gitChanges?: GitChange[];
  readOnly?: boolean;
  showMinimap?: boolean;
  value: string;
  vimMode?: boolean;
}

export function CodeMirrorEditor({
  value,
  extension,
  readOnly = false,
  vimMode = false,
  showMinimap = false,
  gitChanges = [],
  diagnostics = [],
}: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    let cancelled = false;

    const setup = async () => {
      const extensions: Extension[] = [
        lineNumbers(),
        foldGutter(),
        bracketMatching(),
        indentOnInput(),
        highlightSelectionMatches(),
        history(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        oneDark,
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        EditorView.theme({
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
        }),
      ];

      // Vim mode (dynamic import)
      if (vimMode) {
        const vimExt = await loadVimMode();
        if (vimExt && !cancelled) {
          extensions.unshift(vimExt);
        }
      }

      if (cancelled) {
        return;
      }

      // Minimap
      if (showMinimap) {
        extensions.push(minimapExtension());
      }

      // Git gutter
      if (gitChanges.length > 0) {
        extensions.push(...gitGutterExtension(gitChanges));
      }

      // Diagnostics / lint gutter
      extensions.push(...createDiagnosticsExtension(diagnostics));

      if (readOnly) {
        extensions.push(EditorState.readOnly.of(true));
        extensions.push(EditorView.editable.of(false));
      }

      const langPromise = getLanguageExtension(extension);
      if (langPromise) {
        try {
          const langExt = await langPromise;
          if (!cancelled) {
            extensions.push(langExt);
          }
        } catch {
          // Language extension failed to load, continue without it
        }
      }

      if (cancelled) {
        return;
      }

      const state = EditorState.create({
        doc: value,
        extensions,
      });

      if (containerRef.current) {
        const view = new EditorView({
          state,
          parent: containerRef.current,
        });
        viewRef.current = view;

        // Apply diagnostics if provided
        if (diagnostics.length > 0) {
          const cmDiagnostics = diagnostics.map((d) => ({
            from: d.from,
            to: d.to,
            message: d.message,
            severity: d.severity,
          }));
          view.dispatch(setDiagnostics(view.state, cmDiagnostics));
        }
      }
    };

    setup();

    return () => {
      cancelled = true;
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
  }, [
    value,
    extension,
    readOnly,
    vimMode,
    showMinimap,
    gitChanges,
    diagnostics,
  ]);

  return <div className="h-full w-full" ref={containerRef} />;
}

export type { CodeMirrorEditorProps, Diagnostic, GitChange, GitLineStatus };
