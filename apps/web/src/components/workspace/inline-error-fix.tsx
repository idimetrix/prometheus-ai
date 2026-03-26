"use client";

/**
 * Inline Error Fix Extension for CodeMirror
 *
 * Parses terminal/build output for errors with file:line:message format,
 * shows gutter markers, error tooltips with "Fix with AI" buttons,
 * and inline ghost-text suggestions for fixes.
 */

import type { Extension, Range } from "@codemirror/state";
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

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface InlineError {
  column?: number;
  filePath: string;
  line: number;
  message: string;
  severity: "error" | "warning";
  source?: string;
}

export interface InlineErrorFixOptions {
  /** Current file path */
  filePath: string;
  /** Endpoint for AI fix suggestions */
  fixEndpoint: string;
  /** Additional request headers */
  headers?: Record<string, string>;
  /** Initial errors to display */
  initialErrors?: InlineError[];
  /** Language identifier */
  language: string;
  /** Called when a fix is accepted */
  onFixAccepted?: (line: number, fix: string) => void;
}

interface FixSuggestion {
  line: number;
  replacement: string;
}

/* -------------------------------------------------------------------------- */
/*  Error Parsing                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Parse terminal/build output to extract file:line:message errors.
 * Supports formats like:
 *   src/index.ts:10:5: error TS2345: ...
 *   src/index.ts(10,5): error ...
 *   ERROR in src/index.ts:10:5
 */
const ERROR_PATTERNS = [
  // TypeScript/ESLint: file:line:col: severity message
  /^(.+?):(\d+):(\d+):\s*(error|warning)\s+(.+)$/,
  // TypeScript: file(line,col): severity message
  /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(.+)$/,
  // Generic: file:line: message
  /^(.+?):(\d+):\s*(.+)$/,
];

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: nested pattern matching loops are inherently complex
export function parseTerminalErrors(
  output: string,
  currentFilePath: string
): InlineError[] {
  const errors: InlineError[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    for (const pattern of ERROR_PATTERNS) {
      const match = trimmed.match(pattern);
      if (!match) {
        continue;
      }

      const filePath = match[1] ?? "";
      const lineNum = Number.parseInt(match[2] ?? "0", 10);

      // Only include errors for the current file
      if (!filePath.endsWith(currentFilePath) && filePath !== currentFilePath) {
        continue;
      }

      if (match.length >= 6) {
        // Full format with severity
        const severity = (match[4] ?? "error") as "error" | "warning";
        errors.push({
          filePath,
          line: lineNum,
          column: Number.parseInt(match[3] ?? "0", 10),
          severity,
          message: match[5] ?? "",
        });
      } else if (match.length >= 4) {
        // Simple format
        errors.push({
          filePath,
          line: lineNum,
          severity: "error",
          message: match[3] ?? "",
        });
      }
      break;
    }
  }

  return errors;
}

/* -------------------------------------------------------------------------- */
/*  State Effects                                                              */
/* -------------------------------------------------------------------------- */

const setErrorsEffect = StateEffect.define<InlineError[]>();
const setFixSuggestionEffect = StateEffect.define<FixSuggestion | null>();

/* -------------------------------------------------------------------------- */
/*  State Fields                                                               */
/* -------------------------------------------------------------------------- */

const errorField = StateField.define<InlineError[]>({
  create: () => [],
  update: (value, tr) => {
    for (const effect of tr.effects) {
      if (effect.is(setErrorsEffect)) {
        return effect.value;
      }
    }
    return value;
  },
});

const fixSuggestionField = StateField.define<FixSuggestion | null>({
  create: () => null,
  update: (value, tr) => {
    for (const effect of tr.effects) {
      if (effect.is(setFixSuggestionEffect)) {
        return effect.value;
      }
    }
    return value;
  },
});

/* -------------------------------------------------------------------------- */
/*  Gutter Marker                                                              */
/* -------------------------------------------------------------------------- */

class ErrorGutterMarker extends GutterMarker {
  readonly severity: "error" | "warning";
  readonly message: string;

  constructor(severity: "error" | "warning", message: string) {
    super();
    this.severity = severity;
    this.message = message;
  }

  override toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = `cm-error-marker cm-error-marker-${this.severity}`;
    el.style.width = "8px";
    el.style.height = "8px";
    el.style.borderRadius = "50%";
    el.style.backgroundColor =
      this.severity === "error" ? "#ef4444" : "#f59e0b";
    el.style.cursor = "pointer";
    el.title = this.message;
    return el;
  }

  override eq(other: ErrorGutterMarker): boolean {
    return this.severity === other.severity && this.message === other.message;
  }
}

/* -------------------------------------------------------------------------- */
/*  Error Tooltip Widget                                                       */
/* -------------------------------------------------------------------------- */

export class ErrorTooltipWidget extends WidgetType {
  readonly error: InlineError;
  readonly onFixClick: (error: InlineError) => void;

  constructor(error: InlineError, onFixClick: (error: InlineError) => void) {
    super();
    this.error = error;
    this.onFixClick = onFixClick;
  }

  override toDOM(): HTMLElement {
    const container = document.createElement("div");
    container.className = "cm-error-tooltip";

    const messageEl = document.createElement("div");
    messageEl.className = "cm-error-tooltip-message";
    messageEl.textContent = this.error.message;

    const sourceEl = document.createElement("div");
    sourceEl.className = "cm-error-tooltip-source";
    sourceEl.textContent = this.error.source ?? this.error.severity;

    const fixBtn = document.createElement("button");
    fixBtn.className = "cm-error-fix-button";
    fixBtn.textContent = "Fix with AI";
    fixBtn.type = "button";
    fixBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onFixClick(this.error);
    });

    container.appendChild(messageEl);
    container.appendChild(sourceEl);
    container.appendChild(fixBtn);

    return container;
  }

  override eq(other: ErrorTooltipWidget): boolean {
    return (
      this.error.line === other.error.line &&
      this.error.message === other.error.message
    );
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/*  Fix Ghost Text Widget                                                      */
/* -------------------------------------------------------------------------- */

class FixGhostTextWidget extends WidgetType {
  readonly text: string;

  constructor(text: string) {
    super();
    this.text = text;
  }

  override toDOM(): HTMLElement {
    const container = document.createElement("span");
    container.className = "cm-fix-ghost-text";

    const lines = this.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line !== undefined) {
        const span = document.createElement("span");
        span.textContent = line;
        container.appendChild(span);
      }
      if (i < lines.length - 1) {
        container.appendChild(document.createElement("br"));
      }
    }

    return container;
  }

  override eq(other: FixGhostTextWidget): boolean {
    return this.text === other.text;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

/* -------------------------------------------------------------------------- */
/*  Theme                                                                      */
/* -------------------------------------------------------------------------- */

const errorFixTheme = EditorView.theme({
  ".cm-error-gutter": {
    width: "12px",
    marginLeft: "2px",
    marginRight: "2px",
  },
  ".cm-error-gutter .cm-gutterElement": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0",
  },
  ".cm-error-line-error": {
    backgroundColor: "rgba(239, 68, 68, 0.08)",
  },
  ".cm-error-line-warning": {
    backgroundColor: "rgba(245, 158, 11, 0.08)",
  },
  ".cm-error-tooltip": {
    position: "absolute",
    zIndex: "50",
    backgroundColor: "#18181b",
    border: "1px solid #3f3f46",
    borderRadius: "6px",
    padding: "8px 12px",
    maxWidth: "400px",
    fontSize: "12px",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
  },
  ".cm-error-tooltip-message": {
    color: "#fafafa",
    marginBottom: "4px",
    lineHeight: "1.4",
  },
  ".cm-error-tooltip-source": {
    color: "#71717a",
    fontSize: "10px",
    marginBottom: "6px",
    textTransform: "uppercase",
  },
  ".cm-error-fix-button": {
    backgroundColor: "#7c3aed",
    color: "white",
    border: "none",
    borderRadius: "4px",
    padding: "4px 10px",
    fontSize: "11px",
    cursor: "pointer",
    transition: "background-color 0.15s",
    "&:hover": {
      backgroundColor: "#6d28d9",
    },
  },
  ".cm-fix-ghost-text": {
    color: "rgba(124, 58, 237, 0.5)",
    fontStyle: "italic",
    pointerEvents: "none",
  },
});

/* -------------------------------------------------------------------------- */
/*  Error Gutter                                                               */
/* -------------------------------------------------------------------------- */

function createErrorGutter(): Extension {
  return gutter({
    class: "cm-error-gutter",
    markers: (view) => {
      const builder = new RangeSetBuilder<GutterMarker>();
      const errors = view.state.field(errorField);

      for (const error of errors) {
        if (error.line >= 1 && error.line <= view.state.doc.lines) {
          const lineObj = view.state.doc.line(error.line);
          builder.add(
            lineObj.from,
            lineObj.from,
            new ErrorGutterMarker(error.severity, error.message)
          );
        }
      }

      return builder.finish();
    },
  });
}

/* -------------------------------------------------------------------------- */
/*  Line Highlight Decorations                                                 */
/* -------------------------------------------------------------------------- */

function createLineHighlights(view: EditorView): DecorationSet {
  const errors = view.state.field(errorField);
  const decorations: Range<Decoration>[] = [];

  for (const error of errors) {
    if (error.line >= 1 && error.line <= view.state.doc.lines) {
      const lineObj = view.state.doc.line(error.line);
      decorations.push(
        Decoration.line({
          class: `cm-error-line-${error.severity}`,
        }).range(lineObj.from)
      );
    }
  }

  return Decoration.set(decorations, true);
}

/* -------------------------------------------------------------------------- */
/*  Fix Suggestion Decorations                                                 */
/* -------------------------------------------------------------------------- */

function createFixDecorations(view: EditorView): DecorationSet {
  const fix = view.state.field(fixSuggestionField);
  if (!fix) {
    return Decoration.none;
  }

  if (fix.line < 1 || fix.line > view.state.doc.lines) {
    return Decoration.none;
  }

  const lineObj = view.state.doc.line(fix.line);
  const widget = new FixGhostTextWidget(fix.replacement);

  return Decoration.set([
    Decoration.widget({ widget, side: 1 }).range(lineObj.to),
  ]);
}

/* -------------------------------------------------------------------------- */
/*  Plugin                                                                     */
/* -------------------------------------------------------------------------- */

class InlineErrorFixPlugin {
  lineDecorations: DecorationSet;
  fixDecorations: DecorationSet;
  private readonly view: EditorView;
  private readonly options: InlineErrorFixOptions;
  private abortController: AbortController | null = null;

  constructor(view: EditorView, options: InlineErrorFixOptions) {
    this.view = view;
    this.options = options;
    this.lineDecorations = createLineHighlights(view);
    this.fixDecorations = createFixDecorations(view);
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.state.field(errorField) !== update.startState.field(errorField)
    ) {
      this.lineDecorations = createLineHighlights(update.view);
    }

    if (
      update.state.field(fixSuggestionField) !==
      update.startState.field(fixSuggestionField)
    ) {
      this.fixDecorations = createFixDecorations(update.view);
    }
  }

  destroy(): void {
    this.abortController?.abort();
  }

  async requestFix(error: InlineError): Promise<void> {
    this.abortController?.abort();
    this.abortController = new AbortController();

    try {
      const doc = this.view.state.doc;
      const response = await fetch(this.options.fixEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.options.headers,
        },
        body: JSON.stringify({
          filePath: this.options.filePath,
          language: this.options.language,
          content: doc.toString(),
          error: {
            line: error.line,
            column: error.column,
            message: error.message,
            severity: error.severity,
          },
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as { fix?: string };
      if (data.fix) {
        this.view.dispatch({
          effects: setFixSuggestionEffect.of({
            line: error.line,
            replacement: data.fix,
          }),
        });
      }
    } catch {
      // Aborted or network error
    }
  }

  acceptFix(): boolean {
    const fix = this.view.state.field(fixSuggestionField);
    if (!fix) {
      return false;
    }

    if (fix.line < 1 || fix.line > this.view.state.doc.lines) {
      return false;
    }

    const lineObj = this.view.state.doc.line(fix.line);

    this.view.dispatch({
      changes: { from: lineObj.from, to: lineObj.to, insert: fix.replacement },
      effects: setFixSuggestionEffect.of(null),
    });

    this.options.onFixAccepted?.(fix.line, fix.replacement);
    return true;
  }

  dismissFix(): boolean {
    const fix = this.view.state.field(fixSuggestionField);
    if (!fix) {
      return false;
    }

    this.view.dispatch({
      effects: setFixSuggestionEffect.of(null),
    });

    return true;
  }
}

/* -------------------------------------------------------------------------- */
/*  Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Creates a CodeMirror extension that displays inline error markers,
 * tooltips, and AI-powered fix suggestions.
 *
 * @param options - Configuration for error display and fix endpoint
 * @returns A CodeMirror Extension
 *
 * @example
 * ```ts
 * const errorFix = createInlineErrorFixExtension({
 *   filePath: "src/index.ts",
 *   language: "typescript",
 *   fixEndpoint: "/api/ai/fix",
 *   initialErrors: parsedErrors,
 * });
 * ```
 */
export function createInlineErrorFixExtension(
  options: InlineErrorFixOptions
): Extension {
  const plugin = ViewPlugin.define(
    (view) => new InlineErrorFixPlugin(view, options),
    {
      decorations: (v) => v.lineDecorations,
    }
  );

  const fixKeymap = keymap.of([
    {
      key: "Tab",
      run: (view) => {
        const inst = view.plugin(plugin);
        return inst ? inst.acceptFix() : false;
      },
    },
    {
      key: "Escape",
      run: (view) => {
        const inst = view.plugin(plugin);
        return inst ? inst.dismissFix() : false;
      },
    },
  ]);

  return [
    errorField.init(() => options.initialErrors ?? []),
    fixSuggestionField,
    createErrorGutter(),
    plugin,
    fixKeymap,
    errorFixTheme,
  ];
}

/**
 * Dispatches new errors to the editor view.
 * Call this when terminal output changes to refresh error markers.
 */
export function updateInlineErrors(
  view: EditorView,
  errors: InlineError[]
): void {
  view.dispatch({ effects: setErrorsEffect.of(errors) });
}

export type { FixSuggestion };
