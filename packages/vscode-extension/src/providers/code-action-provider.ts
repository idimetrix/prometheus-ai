import {
  CodeAction,
  CodeActionKind,
  type CodeActionProvider,
  type Command,
  type Range,
  type Selection,
  type TextDocument,
} from "vscode";

type ActionKind = "explain" | "refactor" | "test" | "fix" | "optimize";

interface PrometheusAction {
  kind: ActionKind;
  title: string;
}

const ACTIONS: PrometheusAction[] = [
  { kind: "explain", title: "Prometheus: Explain This Code" },
  { kind: "refactor", title: "Prometheus: Refactor Selection" },
  { kind: "test", title: "Prometheus: Write Tests" },
  { kind: "fix", title: "Prometheus: Fix Bug" },
  { kind: "optimize", title: "Prometheus: Optimize Performance" },
];

/**
 * VS Code code action provider that offers Prometheus AI actions on
 * selected code. Each action sends the selection to the appropriate
 * Prometheus agent endpoint.
 */
export class PrometheusCodeActionProvider implements CodeActionProvider {
  static readonly providedCodeActionKinds = [
    CodeActionKind.QuickFix,
    CodeActionKind.Refactor,
  ];

  provideCodeActions(
    document: TextDocument,
    range: Range | Selection
  ): CodeAction[] {
    // Only provide actions when there is a non-empty selection
    if (range.isEmpty) {
      return [];
    }

    const selectedText = document.getText(range);
    if (!selectedText.trim()) {
      return [];
    }

    return ACTIONS.map((action) => {
      const codeAction = new CodeAction(action.title, CodeActionKind.Refactor);
      codeAction.command = {
        command: "prometheus.codeAction",
        title: action.title,
        arguments: [
          {
            kind: action.kind,
            filePath: document.uri.fsPath,
            languageId: document.languageId,
            selectedText,
            startLine: range.start.line,
            endLine: range.end.line,
          },
        ],
      } satisfies Command;
      return codeAction;
    });
  }
}

export type { ActionKind, PrometheusAction };
