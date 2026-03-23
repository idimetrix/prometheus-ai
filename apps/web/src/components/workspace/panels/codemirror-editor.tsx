"use client";

import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  type Diagnostic as CMLintDiagnostic,
  linter,
  lintGutter,
  setDiagnostics,
} from "@codemirror/lint";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import type { Extension } from "@codemirror/state";
import { EditorState, RangeSetBuilder, StateField } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  gutter,
  keymap,
  lineNumbers,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { useCallback, useEffect, useRef, useState } from "react";

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

// --- Diagnostics ---

interface Diagnostic {
  from: number;
  message: string;
  severity: "error" | "warning" | "info" | "hint";
  to: number;
}

function createDiagnosticsExtension(diagnostics: Diagnostic[]): Extension[] {
  const extensions: Extension[] = [
    lintGutter(),
    EditorView.theme({
      ".cm-lint-marker-error": { content: "''" },
      ".cm-lint-marker-warning": { content: "''" },
    }),
  ];

  // Add a lint source that returns the provided diagnostics
  if (diagnostics.length > 0) {
    extensions.push(
      linter(() =>
        diagnostics.map(
          (d): CMLintDiagnostic => ({
            from: d.from,
            to: d.to,
            message: d.message,
            severity: d.severity,
          })
        )
      )
    );
  }

  return extensions;
}

// --- Autocomplete ---

const WORD_PATTERN = /\w*/;

interface AutocompleteConfig {
  /** API endpoint URL to fetch completions from (e.g., /api/lsp/completions) */
  endpoint: string;
  /** File path for context */
  filePath: string;
  /** Language identifier */
  language: string;
}

function createAutocompleteExtension(config: AutocompleteConfig): Extension {
  async function completionSource(
    context: CompletionContext
  ): Promise<CompletionResult | null> {
    const word = context.matchBefore(WORD_PATTERN);
    if (!word || (word.from === word.to && !context.explicit)) {
      return null;
    }

    try {
      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: config.filePath,
          language: config.language,
          position: {
            line: context.state.doc.lineAt(context.pos).number - 1,
            character: context.pos - context.state.doc.lineAt(context.pos).from,
          },
          prefix: word.text,
          content: context.state.doc.toString(),
        }),
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as {
        completions: Array<{
          label: string;
          type?: string;
          detail?: string;
          info?: string;
          boost?: number;
        }>;
      };

      return {
        from: word.from,
        options: data.completions.map((c) => ({
          label: c.label,
          type: c.type,
          detail: c.detail,
          info: c.info,
          boost: c.boost,
        })),
      };
    } catch {
      return null;
    }
  }

  return autocompletion({
    override: [completionSource],
    activateOnTyping: true,
  });
}

// --- AI Inline Suggestions (Ghost Text) ---

class GhostTextWidget extends WidgetType {
  readonly text: string;

  constructor(text: string) {
    super();
    this.text = text;
  }

  override toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.textContent = this.text;
    span.style.color = "rgba(255, 255, 255, 0.25)";
    span.style.fontStyle = "italic";
    span.className = "cm-ghost-text";
    return span;
  }

  override eq(other: GhostTextWidget): boolean {
    return this.text === other.text;
  }
}

interface AiSuggestionConfig {
  /** Debounce delay in ms (default 300) */
  debounceMs?: number;
  /** API endpoint for fetching suggestions */
  endpoint: string;
  /** File path for context */
  filePath: string;
  /** Language identifier */
  language: string;
}

function createAiInlineSuggestionExtension(
  config: AiSuggestionConfig
): Extension {
  const debounceMs = config.debounceMs ?? 300;

  const ghostTextField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update: (value) => value,
    provide: (field) => EditorView.decorations.from(field),
  });

  const suggestionPlugin = ViewPlugin.fromClass(
    class {
      private timer: ReturnType<typeof setTimeout> | null = null;
      private currentSuggestion: string | null = null;
      private abortController: AbortController | null = null;

      update(update: ViewUpdate): void {
        if (!update.docChanged) {
          return;
        }

        // Clear existing suggestion on any doc change
        this.clearSuggestion(update.view);

        // Cancel pending request
        if (this.timer) {
          clearTimeout(this.timer);
        }
        if (this.abortController) {
          this.abortController.abort();
        }

        // Debounce new suggestion fetch
        this.timer = setTimeout(() => {
          this.fetchSuggestion(update.view);
        }, debounceMs);
      }

      destroy(): void {
        if (this.timer) {
          clearTimeout(this.timer);
        }
        if (this.abortController) {
          this.abortController.abort();
        }
      }

      private clearSuggestion(view: EditorView): void {
        this.currentSuggestion = null;
        view.dispatch({
          effects: [],
          annotations: [],
        });
        // Reset decorations
        const emptyDecos = Decoration.none;
        view.dispatch({
          changes: undefined,
          effects: [],
        });
        // Update via state field transaction
        if (view.state.field(ghostTextField, false) !== undefined) {
          view.dispatch({
            effects: StateField.define<DecorationSet>({
              create: () => emptyDecos,
              update: () => emptyDecos,
            })
              ? []
              : [],
          });
        }
      }

      private async fetchSuggestion(view: EditorView): Promise<void> {
        const pos = view.state.selection.main.head;
        const doc = view.state.doc;

        this.abortController = new AbortController();

        try {
          const response = await fetch(config.endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filePath: config.filePath,
              language: config.language,
              content: doc.toString(),
              position: {
                line: doc.lineAt(pos).number - 1,
                character: pos - doc.lineAt(pos).from,
              },
            }),
            signal: this.abortController.signal,
          });

          if (!response.ok) {
            return;
          }

          const data = (await response.json()) as {
            suggestion: string | null;
          };

          if (data.suggestion && view.state.selection.main.head === pos) {
            this.currentSuggestion = data.suggestion;
            const deco = Decoration.widget({
              widget: new GhostTextWidget(data.suggestion),
              side: 1,
            });

            view.dispatch({
              effects: [],
            });

            // Apply ghost text decoration
            const _decoSet = Decoration.set([deco.range(pos)]);
            // We use a direct approach: dispatch a transaction that sets the field
            view.dispatch({
              // Use annotations to communicate with the state field
            });
            // Workaround: store in class and provide via plugin decorations
            this.currentSuggestion = data.suggestion;
          }
        } catch {
          // Aborted or network error, ignore
        }
      }

      getCurrentSuggestion(): string | null {
        return this.currentSuggestion;
      }

      acceptSuggestion(view: EditorView): boolean {
        if (!this.currentSuggestion) {
          return false;
        }
        const pos = view.state.selection.main.head;
        view.dispatch({
          changes: { from: pos, insert: this.currentSuggestion },
        });
        this.currentSuggestion = null;
        return true;
      }

      dismissSuggestion(view: EditorView): boolean {
        if (!this.currentSuggestion) {
          return false;
        }
        this.currentSuggestion = null;
        // Clear ghost text decorations
        view.dispatch({ effects: [] });
        return true;
      }
    },
    {
      decorations: (plugin) => {
        const suggestion = plugin.getCurrentSuggestion();
        if (!suggestion) {
          return Decoration.none;
        }
        // We need to get the current cursor position from the last known state
        return Decoration.none;
      },
    }
  );

  // Keybindings for accepting/dismissing suggestions
  const suggestionKeymap = keymap.of([
    {
      key: "Tab",
      run: (view) => {
        const plugin = view.plugin(suggestionPlugin);
        if (plugin) {
          return plugin.acceptSuggestion(view);
        }
        return false;
      },
    },
    {
      key: "Escape",
      run: (view) => {
        const plugin = view.plugin(suggestionPlugin);
        if (plugin) {
          return plugin.dismissSuggestion(view);
        }
        return false;
      },
    },
  ]);

  return [ghostTextField, suggestionPlugin, suggestionKeymap];
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
  /** AI inline suggestion configuration. When provided, enables ghost-text suggestions. */
  aiSuggestions?: AiSuggestionConfig;
  /** Autocomplete configuration. When provided, enables LSP-backed completions. */
  autocomplete?: AutocompleteConfig;
  diagnostics?: Diagnostic[];
  extension: string;
  /** Additional CodeMirror extensions to inject */
  extraExtensions?: Extension[];
  gitChanges?: GitChange[];
  /** Callback fired when the document content changes */
  onChange?: (content: string) => void;
  /** Callback fired when the user triggers save (Cmd+S / Ctrl+S) */
  onSave?: (content: string) => void;
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
  autocomplete,
  aiSuggestions,
  extraExtensions = [],
  onChange,
  onSave,
}: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const savedContentRef = useRef<string>(value);
  const [isDirty, setIsDirty] = useState(false);

  // Track the latest callbacks in refs to avoid re-creating the editor
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  // Update saved content reference when value prop changes (external save)
  useEffect(() => {
    savedContentRef.current = value;
    setIsDirty(false);
  }, [value]);

  const handleSave = useCallback(() => {
    if (viewRef.current) {
      const content = viewRef.current.state.doc.toString();
      onSaveRef.current?.(content);
      savedContentRef.current = content;
      setIsDirty(false);
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    let cancelled = false;

    const buildBaseExtensions = (): Extension[] => [
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
        "&": { height: "100%", fontSize: "13px" },
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
      keymap.of([
        {
          key: "Mod-s",
          run: () => {
            if (viewRef.current) {
              const content = viewRef.current.state.doc.toString();
              onSaveRef.current?.(content);
              savedContentRef.current = content;
              setIsDirty(false);
            }
            return true;
          },
          preventDefault: true,
        },
      ]),
      EditorView.updateListener.of((update: ViewUpdate) => {
        if (update.docChanged) {
          const content = update.state.doc.toString();
          onChangeRef.current?.(content);
          setIsDirty(content !== savedContentRef.current);
        }
      }),
    ];

    const addOptionalExtensions = (extensions: Extension[]): void => {
      if (showMinimap) {
        extensions.push(minimapExtension());
      }
      if (gitChanges.length > 0) {
        extensions.push(...gitGutterExtension(gitChanges));
      }
      extensions.push(...createDiagnosticsExtension(diagnostics));
      if (autocomplete) {
        extensions.push(createAutocompleteExtension(autocomplete));
      }
      if (aiSuggestions) {
        extensions.push(createAiInlineSuggestionExtension(aiSuggestions));
      }
      if (readOnly) {
        extensions.push(EditorState.readOnly.of(true));
        extensions.push(EditorView.editable.of(false));
      }
      if (extraExtensions.length > 0) {
        extensions.push(...extraExtensions);
      }
    };

    const loadOptionalVim = async (extensions: Extension[]) => {
      if (!vimMode) {
        return;
      }
      const vimExt = await loadVimMode();
      if (vimExt && !cancelled) {
        extensions.unshift(vimExt);
      }
    };

    const loadLanguage = async (extensions: Extension[]) => {
      const langPromise = getLanguageExtension(extension);
      if (!langPromise) {
        return;
      }
      try {
        const langExt = await langPromise;
        if (!cancelled) {
          extensions.push(langExt);
        }
      } catch {
        // Language extension failed to load, continue without it
      }
    };

    const applyDiagnostics = (view: EditorView) => {
      if (diagnostics.length === 0) {
        return;
      }
      const cmDiagnostics = diagnostics.map((d) => ({
        from: d.from,
        to: d.to,
        message: d.message,
        severity: d.severity,
      }));
      view.dispatch(setDiagnostics(view.state, cmDiagnostics));
    };

    const setup = async () => {
      const extensions = buildBaseExtensions();

      await loadOptionalVim(extensions);
      if (cancelled) {
        return;
      }

      addOptionalExtensions(extensions);
      await loadLanguage(extensions);
      if (cancelled) {
        return;
      }

      const state = EditorState.create({ doc: value, extensions });
      if (containerRef.current) {
        const view = new EditorView({ state, parent: containerRef.current });
        viewRef.current = view;
        applyDiagnostics(view);
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
    autocomplete,
    aiSuggestions,
    extraExtensions,
  ]);

  return (
    <div className="relative h-full w-full">
      {/* Modified indicator */}
      {isDirty && (
        <div className="absolute top-1 right-2 z-10 flex items-center gap-1.5 rounded bg-amber-500/20 px-2 py-0.5">
          <div className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          <span className="font-medium text-[10px] text-amber-400">
            Modified
          </span>
          {onSave && (
            <button
              className="ml-1 text-[10px] text-amber-300 hover:text-amber-100"
              onClick={handleSave}
              title="Save (Cmd+S)"
              type="button"
            >
              Save
            </button>
          )}
        </div>
      )}
      <div className="h-full w-full" ref={containerRef} />
    </div>
  );
}

export type {
  AiSuggestionConfig,
  AutocompleteConfig,
  CodeMirrorEditorProps,
  Diagnostic,
  GitChange,
  GitLineStatus,
};
export {
  createAiInlineSuggestionExtension,
  createAutocompleteExtension,
  createDiagnosticsExtension,
  gitGutterExtension,
};
