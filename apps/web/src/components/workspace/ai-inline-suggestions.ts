/**
 * AI Inline Suggestions Extension for CodeMirror
 *
 * Provides ghost-text inline suggestions (similar to GitHub Copilot).
 * Shows grayed-out suggestion text after the cursor position.
 * - Tab to accept the suggestion
 * - Escape to dismiss
 * - Debounced fetching (300ms default) after typing stops
 */

import type { Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

// --- Types ---

interface AiInlineSuggestionOptions {
  /** Debounce delay in milliseconds (default: 300) */
  debounceMs?: number;
  /** API endpoint to fetch suggestions from */
  endpoint: string;
  /** File path for context */
  filePath: string;
  /** Additional headers to include in API requests */
  headers?: Record<string, string>;
  /** Language identifier (e.g., "typescript", "python") */
  language: string;
}

interface SuggestionResponse {
  suggestion: string | null;
}

// --- Ghost Text Widget ---

class GhostTextWidget extends WidgetType {
  readonly text: string;

  constructor(text: string) {
    super();
    this.text = text;
  }

  override toDOM(): HTMLElement {
    const container = document.createElement("span");
    container.className = "cm-ai-ghost-text";

    // Split by newlines and render each line
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

  override eq(other: GhostTextWidget): boolean {
    return this.text === other.text;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

// --- Ghost Text Theme ---

const ghostTextTheme = EditorView.theme({
  ".cm-ai-ghost-text": {
    color: "rgba(255, 255, 255, 0.25)",
    fontStyle: "italic",
    pointerEvents: "none",
  },
});

// --- Plugin ---

class AiSuggestionPlugin {
  decorations: DecorationSet;
  private readonly view: EditorView;
  private suggestion: string | null = null;
  private suggestionPos: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;
  private readonly options: Required<
    Pick<
      AiInlineSuggestionOptions,
      "endpoint" | "filePath" | "language" | "debounceMs"
    >
  > & { headers: Record<string, string> };

  constructor(view: EditorView, options: AiInlineSuggestionOptions) {
    this.view = view;
    this.decorations = Decoration.none;
    this.options = {
      endpoint: options.endpoint,
      filePath: options.filePath,
      language: options.language,
      debounceMs: options.debounceMs ?? 300,
      headers: options.headers ?? {},
    };
  }

  update(update: ViewUpdate): void {
    if (!(update.docChanged || update.selectionSet)) {
      return;
    }

    // Clear suggestion on any doc change or cursor movement
    if (update.docChanged) {
      this.clearSuggestion();
      this.scheduleFetch();
    } else if (update.selectionSet) {
      // Cursor moved without editing — dismiss suggestion
      this.clearSuggestion();
    }
  }

  destroy(): void {
    this.cancelPending();
  }

  acceptSuggestion(): boolean {
    if (!this.suggestion || this.suggestionPos === null) {
      return false;
    }

    const pos = this.suggestionPos;
    const text = this.suggestion;

    this.suggestion = null;
    this.suggestionPos = null;
    this.decorations = Decoration.none;

    this.view.dispatch({
      changes: { from: pos, insert: text },
      selection: { anchor: pos + text.length },
    });

    return true;
  }

  dismissSuggestion(): boolean {
    if (!this.suggestion) {
      return false;
    }

    this.clearSuggestion();
    return true;
  }

  private clearSuggestion(): void {
    this.suggestion = null;
    this.suggestionPos = null;
    this.decorations = Decoration.none;
  }

  private cancelPending(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private scheduleFetch(): void {
    this.cancelPending();

    this.timer = setTimeout(() => {
      this.fetchSuggestion();
    }, this.options.debounceMs);
  }

  private async fetchSuggestion(): Promise<void> {
    const pos = this.view.state.selection.main.head;
    const doc = this.view.state.doc;
    const line = doc.lineAt(pos);

    this.abortController = new AbortController();

    try {
      const response = await fetch(this.options.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.options.headers,
        },
        body: JSON.stringify({
          filePath: this.options.filePath,
          language: this.options.language,
          content: doc.toString(),
          position: {
            line: line.number - 1,
            character: pos - line.from,
          },
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as SuggestionResponse;

      // Verify the cursor hasn't moved since we started the request
      if (data.suggestion && this.view.state.selection.main.head === pos) {
        this.suggestion = data.suggestion;
        this.suggestionPos = pos;

        // Create ghost text decoration
        const widget = new GhostTextWidget(data.suggestion);
        this.decorations = Decoration.set([
          Decoration.widget({
            widget,
            side: 1,
          }).range(pos),
        ]);

        // Force a re-render of decorations
        this.view.dispatch({ effects: [] });
      }
    } catch {
      // Request was aborted or network error, ignore
    }
  }
}

// --- Extension Factory ---

/**
 * Creates a CodeMirror extension that shows AI-powered inline suggestions
 * as ghost text after the cursor. Users can press Tab to accept or Escape
 * to dismiss.
 *
 * @param options - Configuration for the suggestion endpoint and behavior
 * @returns A CodeMirror Extension to include in editor setup
 *
 * @example
 * ```ts
 * const aiSuggestions = createAiInlineSuggestions({
 *   endpoint: "/api/ai/completions",
 *   filePath: "src/index.ts",
 *   language: "typescript",
 * });
 *
 * // Include in editor extensions:
 * extensions: [aiSuggestions, ...]
 * ```
 */
export function createAiInlineSuggestions(
  options: AiInlineSuggestionOptions
): Extension {
  const plugin = ViewPlugin.define(
    (view) => new AiSuggestionPlugin(view, options),
    {
      decorations: (v) => v.decorations,
    }
  );

  const suggestionKeymap = keymap.of([
    {
      key: "Tab",
      run: (view) => {
        const pluginInstance = view.plugin(plugin);
        return pluginInstance ? pluginInstance.acceptSuggestion() : false;
      },
    },
    {
      key: "Escape",
      run: (view) => {
        const pluginInstance = view.plugin(plugin);
        return pluginInstance ? pluginInstance.dismissSuggestion() : false;
      },
    },
  ]);

  return [plugin, suggestionKeymap, ghostTextTheme];
}

export type { AiInlineSuggestionOptions, SuggestionResponse };
