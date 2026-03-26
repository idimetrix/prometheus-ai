import {
  type DecorationOptions,
  type ExtensionContext,
  Position,
  Range,
  type TextEditor,
  type TextEditorDecorationType,
  window,
} from "vscode";
import type { ApiClient } from "../api-client";

// ---------------------------------------------------------------------------
// Diff decoration types
// ---------------------------------------------------------------------------

function createAddedDecoration(): TextEditorDecorationType {
  return window.createTextEditorDecorationType({
    backgroundColor: "rgba(0, 180, 0, 0.15)",
    isWholeLine: true,
    overviewRulerColor: "rgba(0, 180, 0, 0.6)",
    gutterIconSize: "contain",
  });
}

function createRemovedDecoration(): TextEditorDecorationType {
  return window.createTextEditorDecorationType({
    backgroundColor: "rgba(220, 0, 0, 0.15)",
    isWholeLine: true,
    overviewRulerColor: "rgba(220, 0, 0, 0.6)",
    gutterIconSize: "contain",
  });
}

// ---------------------------------------------------------------------------
// Diff computation
// ---------------------------------------------------------------------------

interface DiffLine {
  lineNumber: number;
  text: string;
  type: "added" | "removed" | "unchanged";
}

function computeSimpleDiff(original: string, modified: string): DiffLine[] {
  const originalLines = original.split("\n");
  const modifiedLines = modified.split("\n");
  const result: DiffLine[] = [];

  // Simple LCS-based diff
  const lcs = computeLCS(originalLines, modifiedLines);
  let origIdx = 0;
  let modIdx = 0;
  let lineNum = 0;

  for (const match of lcs) {
    // Lines removed from original
    while (origIdx < match.origIndex) {
      result.push({
        lineNumber: lineNum,
        text: originalLines[origIdx] ?? "",
        type: "removed",
      });
      origIdx++;
      lineNum++;
    }
    // Lines added in modified
    while (modIdx < match.modIndex) {
      result.push({
        lineNumber: lineNum,
        text: modifiedLines[modIdx] ?? "",
        type: "added",
      });
      modIdx++;
      lineNum++;
    }
    // Matching line
    result.push({
      lineNumber: lineNum,
      text: originalLines[origIdx] ?? "",
      type: "unchanged",
    });
    origIdx++;
    modIdx++;
    lineNum++;
  }

  // Remaining removed lines
  while (origIdx < originalLines.length) {
    result.push({
      lineNumber: lineNum,
      text: originalLines[origIdx] ?? "",
      type: "removed",
    });
    origIdx++;
    lineNum++;
  }

  // Remaining added lines
  while (modIdx < modifiedLines.length) {
    result.push({
      lineNumber: lineNum,
      text: modifiedLines[modIdx] ?? "",
      type: "added",
    });
    modIdx++;
    lineNum++;
  }

  return result;
}

interface LCSMatch {
  modIndex: number;
  origIndex: number;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: LCS algorithm requires nested loops and backtracking
function computeLCS(a: string[], b: string[]): LCSMatch[] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => 0)
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        const row = dp[i];
        if (row) {
          row[j] = (dp[i - 1]?.[j - 1] ?? 0) + 1;
        }
      } else {
        const row = dp[i];
        if (row) {
          row[j] = Math.max(dp[i - 1]?.[j] ?? 0, dp[i]?.[j - 1] ?? 0);
        }
      }
    }
  }

  // Backtrack to find matches
  const matches: LCSMatch[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      matches.unshift({ origIndex: i - 1, modIndex: j - 1 });
      i--;
      j--;
    } else if ((dp[i - 1]?.[j] ?? 0) > (dp[i]?.[j - 1] ?? 0)) {
      i--;
    } else {
      j--;
    }
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Inline edit state
// ---------------------------------------------------------------------------

interface PendingEdit {
  addedDecoration: TextEditorDecorationType;
  editedCode: string;
  editor: TextEditor;
  originalCode: string;
  removedDecoration: TextEditorDecorationType;
  selection: Range;
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

/**
 * Handles the Cmd+K / Ctrl+K inline edit flow:
 * 1. User selects code and presses Cmd+K
 * 2. Quick input box appears for edit instruction
 * 3. API returns modified code
 * 4. Diff decorations shown in editor
 * 5. User accepts or rejects
 */
export class InlineEditProvider {
  private readonly apiClient: ApiClient;
  private pendingEdit: PendingEdit | undefined;
  private pendingAbort: AbortController | undefined;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  /**
   * Register the inline edit command and keybinding handlers.
   */
  registerCommands(context: ExtensionContext): void {
    context.subscriptions.push({
      dispose: () => {
        this.clearPendingEdit();
      },
    });
  }

  /**
   * Execute the inline edit flow.
   */
  async executeInlineEdit(): Promise<void> {
    const editor = window.activeTextEditor;
    if (!editor) {
      window.showWarningMessage("No active editor.");
      return;
    }

    if (editor.selection.isEmpty) {
      window.showWarningMessage(
        "Please select code to edit with Cmd+K / Ctrl+K."
      );
      return;
    }

    const selectedText = editor.document.getText(editor.selection);
    if (!selectedText.trim()) {
      window.showWarningMessage("Selection is empty.");
      return;
    }

    // Show instruction input
    const instruction = await window.showInputBox({
      prompt: "Describe the change...",
      placeHolder:
        "e.g., convert to async/await, add error handling, make it TypeScript",
      ignoreFocusOut: true,
    });

    if (!instruction) {
      return; // User cancelled
    }

    // Cancel any pending request
    this.clearPendingEdit();
    this.pendingAbort?.abort();

    const abortController = new AbortController();
    this.pendingAbort = abortController;

    // Show progress
    await window.withProgress(
      {
        location: { viewId: "prometheus.chatPanel" },
        title: "Prometheus: Editing code...",
      },
      async () => {
        try {
          // Get surrounding context for better edits
          const contextLines = 50;
          const startLine = Math.max(
            0,
            editor.selection.start.line - contextLines
          );
          const endLine = Math.min(
            editor.document.lineCount - 1,
            editor.selection.end.line + contextLines
          );
          const contextRange = new Range(
            startLine,
            0,
            endLine,
            editor.document.lineAt(endLine).text.length
          );
          const surroundingContext = editor.document.getText(contextRange);

          const result = await this.apiClient.getInlineEdit(
            {
              code: selectedText,
              instruction,
              language: editor.document.languageId,
              filePath: editor.document.uri.fsPath,
              context: surroundingContext,
            },
            abortController.signal
          );

          if (abortController.signal.aborted) {
            return;
          }

          if (!result.editedCode || result.editedCode.trim().length === 0) {
            window.showWarningMessage("No edit suggestions returned.");
            return;
          }

          // Show diff decorations
          this.showDiffDecorations(
            editor,
            editor.selection,
            selectedText,
            result.editedCode
          );

          // Show accept/reject buttons
          const action = await window.showInformationMessage(
            "Prometheus: Apply edit?",
            { modal: false },
            "Accept",
            "Reject"
          );

          if (action === "Accept") {
            await this.acceptEdit();
          } else {
            this.rejectEdit();
          }
        } catch (error) {
          if (abortController.signal.aborted) {
            return;
          }
          const message =
            error instanceof Error ? error.message : "Unknown error";
          window.showErrorMessage(`Inline edit failed: ${message}`);
        } finally {
          if (this.pendingAbort === abortController) {
            this.pendingAbort = undefined;
          }
        }
      }
    );
  }

  private showDiffDecorations(
    editor: TextEditor,
    selection: Range,
    originalCode: string,
    editedCode: string
  ): void {
    this.clearPendingEdit();

    const addedDecoration = createAddedDecoration();
    const removedDecoration = createRemovedDecoration();

    const diffLines = computeSimpleDiff(originalCode, editedCode);

    const addedRanges: DecorationOptions[] = [];
    const removedRanges: DecorationOptions[] = [];

    const baseLineNumber = selection.start.line;

    for (const diffLine of diffLines) {
      const lineNum = baseLineNumber + diffLine.lineNumber;
      if (lineNum >= editor.document.lineCount) {
        break;
      }
      const lineRange = new Range(
        new Position(lineNum, 0),
        new Position(
          lineNum,
          editor.document.lineAt(
            Math.min(lineNum, editor.document.lineCount - 1)
          ).text.length
        )
      );

      if (diffLine.type === "added") {
        addedRanges.push({ range: lineRange });
      } else if (diffLine.type === "removed") {
        removedRanges.push({ range: lineRange });
      }
    }

    editor.setDecorations(addedDecoration, addedRanges);
    editor.setDecorations(removedDecoration, removedRanges);

    this.pendingEdit = {
      editor,
      selection,
      originalCode,
      editedCode,
      addedDecoration,
      removedDecoration,
    };
  }

  private async acceptEdit(): Promise<void> {
    if (!this.pendingEdit) {
      return;
    }

    const { editor, selection, editedCode } = this.pendingEdit;

    try {
      await editor.edit((editBuilder) => {
        editBuilder.replace(selection, editedCode);
      });
      window.showInformationMessage("Prometheus: Edit applied.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      window.showErrorMessage(`Failed to apply edit: ${message}`);
    } finally {
      this.clearPendingEdit();
    }
  }

  private rejectEdit(): void {
    this.clearPendingEdit();
    window.showInformationMessage("Prometheus: Edit rejected.");
  }

  private clearPendingEdit(): void {
    if (this.pendingEdit) {
      this.pendingEdit.addedDecoration.dispose();
      this.pendingEdit.removedDecoration.dispose();
      this.pendingEdit = undefined;
    }
  }

  dispose(): void {
    this.pendingAbort?.abort();
    this.pendingAbort = undefined;
    this.clearPendingEdit();
  }
}
