import {
  type CancellationToken,
  InlineCompletionItem,
  type InlineCompletionItemProvider,
  type Position,
  Range,
  type TextDocument,
  workspace,
} from "vscode";
import type { ApiClient } from "../api-client";

/**
 * Provides inline (ghost-text) completions by sending the current file
 * context and cursor position to the Prometheus model-router.
 *
 * Debounces requests to avoid flooding the API on every keystroke,
 * and cancels pending requests when new keystrokes arrive.
 */
export class PrometheusInlineCompletionProvider
  implements InlineCompletionItemProvider
{
  private readonly apiClient: ApiClient;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingAbort: AbortController | undefined;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  provideInlineCompletionItems(
    document: TextDocument,
    position: Position,
    _context: unknown,
    token: CancellationToken
  ): Promise<InlineCompletionItem[] | null> | null {
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

    // Skip very short documents or if already cancelled
    if (token.isCancellationRequested) {
      return null;
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

        // Cancel on VS Code cancellation
        const disposable = token.onCancellationRequested(() => {
          abortController.abort();
        });

        try {
          const fileContent = document.getText();
          const cursorOffset = document.offsetAt(position);

          const result = await this.apiClient.getInlineCompletion(
            {
              fileContent,
              filePath: document.uri.fsPath,
              languageId: document.languageId,
              cursorOffset,
              maxTokens: 256,
            },
            abortController.signal
          );

          if (token.isCancellationRequested || abortController.signal.aborted) {
            resolve(null);
            return;
          }

          if (!result.text || result.text.trim().length === 0) {
            resolve(null);
            return;
          }

          const insertRange = new Range(position, position);
          const item = new InlineCompletionItem(result.text, insertRange);

          resolve([item]);
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

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    this.pendingAbort?.abort();
    this.pendingAbort = undefined;
  }
}
