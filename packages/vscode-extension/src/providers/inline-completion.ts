import {
  type CancellationToken,
  InlineCompletionItem,
  type InlineCompletionItemProvider,
  type Position,
  Range,
  type TextDocument,
  window,
  workspace,
} from "vscode";
import type { ApiClient } from "../api-client";

// ---------------------------------------------------------------------------
// LRU Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  completions: InlineCompletionItem[];
  timestamp: number;
}

class LRUCache {
  private readonly maxSize: number;
  private readonly cache = new Map<string, CacheEntry>();
  private static readonly TTL_MS = 60_000; // 1 minute TTL

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: string): InlineCompletionItem[] | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }
    if (Date.now() - entry.timestamp > LRUCache.TTL_MS) {
      this.cache.delete(key);
      return undefined;
    }
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.completions;
  }

  set(key: string, completions: InlineCompletionItem[]): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove least recently used (first entry)
      const firstKey = this.cache.keys().next().value as string;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, { completions, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }
}

// ---------------------------------------------------------------------------
// Context extraction helpers
// ---------------------------------------------------------------------------

const CONTEXT_LINES_BEFORE = 500;
const CONTEXT_LINES_AFTER = 100;

function extractSurroundingContext(
  document: TextDocument,
  position: Position
): { prefix: string; suffix: string } {
  const startLine = Math.max(0, position.line - CONTEXT_LINES_BEFORE);
  const endLine = Math.min(
    document.lineCount - 1,
    position.line + CONTEXT_LINES_AFTER
  );

  const prefixRange = new Range(
    startLine,
    0,
    position.line,
    position.character
  );
  const suffixRange = new Range(
    position.line,
    position.character,
    endLine,
    document.lineAt(endLine).text.length
  );

  return {
    prefix: document.getText(prefixRange),
    suffix: document.getText(suffixRange),
  };
}

function getOpenFileNames(): string[] {
  const names: string[] = [];
  for (const group of window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input as { uri?: { fsPath?: string } } | undefined;
      if (input?.uri?.fsPath) {
        names.push(input.uri.fsPath);
      }
    }
  }
  return names;
}

function buildCacheKey(
  filePath: string,
  line: number,
  character: number,
  prefixHash: string
): string {
  return `${filePath}:${line}:${character}:${prefixHash}`;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash.toString(36);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Provides inline (ghost-text) completions by sending the current file
 * context and cursor position to the Prometheus model-router.
 *
 * Features:
 * - Debounced requests (configurable, default 300ms)
 * - Cancels pending requests on new keystrokes
 * - LRU cache (50 entries) to avoid duplicate API calls
 * - Sends only surrounding context (500 lines above, 100 below)
 * - Includes open file names for additional context
 * - Pre-fetches completions when cursor is idle for 1s
 */
export class PrometheusInlineCompletionProvider
  implements InlineCompletionItemProvider
{
  private readonly apiClient: ApiClient;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingAbort: AbortController | undefined;
  private prefetchTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly cache = new LRUCache(50);

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
    this.startPrefetchListener();
  }

  // biome-ignore lint/suspicious/useAwait: async required for VS Code provider interface; await is used inside nested Promise callback
  async provideInlineCompletionItems(
    document: TextDocument,
    position: Position,
    _context: unknown,
    token: CancellationToken
  ): Promise<InlineCompletionItem[] | null> {
    // Check if inline completions are enabled
    const config = workspace.getConfiguration("prometheus");
    if (!config.get<boolean>("inlineCompletions.enabled", true)) {
      return null;
    }

    const debounceMs = config.get<number>("inlineCompletions.debounceMs", 300);

    // Cancel any pending request
    this.pendingAbort?.abort();
    this.pendingAbort = undefined;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }

    if (token.isCancellationRequested) {
      return null;
    }

    // Check cache first
    const { prefix, suffix } = extractSurroundingContext(document, position);
    const prefixTail = prefix.slice(-200);
    const cacheKey = buildCacheKey(
      document.uri.fsPath,
      position.line,
      position.character,
      simpleHash(prefixTail)
    );

    const cached = this.cache.get(cacheKey);
    if (cached) {
      return Promise.resolve(cached);
    }

    // Debounce
    return new Promise<InlineCompletionItem[] | null>((resolve) => {
      this.debounceTimer = setTimeout(async () => {
        if (token.isCancellationRequested) {
          resolve(null);
          return;
        }

        const abortController = new AbortController();
        this.pendingAbort = abortController;

        const disposable = token.onCancellationRequested(() => {
          abortController.abort();
        });

        try {
          const openFiles = getOpenFileNames();

          const result = await this.apiClient.getInlineCompletion(
            {
              prefix,
              suffix,
              language: document.languageId,
              filePath: document.uri.fsPath,
              openFiles,
            },
            abortController.signal
          );

          if (token.isCancellationRequested || abortController.signal.aborted) {
            resolve(null);
            return;
          }

          if (!result.completion || result.completion.trim().length === 0) {
            resolve(null);
            return;
          }

          const insertRange = new Range(position, position);
          const item = new InlineCompletionItem(result.completion, insertRange);

          const items = [item];
          this.cache.set(cacheKey, items);
          resolve(items);
        } catch {
          // Silently ignore errors for inline completions
          resolve(null);
        } finally {
          disposable.dispose();
          if (this.pendingAbort === abortController) {
            this.pendingAbort = undefined;
          }
        }
      }, debounceMs);
    });
  }

  /**
   * Start listening for cursor idle events to pre-fetch completions.
   * When the cursor is idle for 1 second, trigger a prefetch.
   */
  private startPrefetchListener(): void {
    const disposable = window.onDidChangeTextEditorSelection(() => {
      if (this.prefetchTimer) {
        clearTimeout(this.prefetchTimer);
      }

      this.prefetchTimer = setTimeout(() => {
        this.prefetchCompletion();
      }, 1000);
    });

    // Store disposable reference for cleanup
    this._selectionDisposable = disposable;
  }

  private _selectionDisposable: { dispose(): unknown } | undefined;

  private async prefetchCompletion(): Promise<void> {
    const config = workspace.getConfiguration("prometheus");
    if (!config.get<boolean>("inlineCompletions.enabled", true)) {
      return;
    }

    const editor = window.activeTextEditor;
    if (!editor) {
      return;
    }

    const document = editor.document;
    const position = editor.selection.active;

    const { prefix, suffix } = extractSurroundingContext(document, position);
    const prefixTail = prefix.slice(-200);
    const cacheKey = buildCacheKey(
      document.uri.fsPath,
      position.line,
      position.character,
      simpleHash(prefixTail)
    );

    // Skip if already cached
    if (this.cache.get(cacheKey)) {
      return;
    }

    const abortController = new AbortController();

    try {
      const openFiles = getOpenFileNames();

      const result = await this.apiClient.getInlineCompletion(
        {
          prefix,
          suffix,
          language: document.languageId,
          filePath: document.uri.fsPath,
          openFiles,
        },
        abortController.signal
      );

      if (!result.completion || result.completion.trim().length === 0) {
        return;
      }

      const insertRange = new Range(position, position);
      const item = new InlineCompletionItem(result.completion, insertRange);
      this.cache.set(cacheKey, [item]);
    } catch {
      // Silently ignore prefetch errors
    }
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    if (this.prefetchTimer) {
      clearTimeout(this.prefetchTimer);
      this.prefetchTimer = undefined;
    }
    this.pendingAbort?.abort();
    this.pendingAbort = undefined;
    this._selectionDisposable?.dispose();
    this._selectionDisposable = undefined;
    this.cache.clear();
  }
}
