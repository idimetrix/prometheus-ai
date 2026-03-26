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
  command: string;
  kind: ActionKind;
  title: string;
}

const ACTIONS: PrometheusAction[] = [
  {
    kind: "explain",
    title: "Prometheus: Explain this code",
    command: "prometheus.explainCode",
  },
  {
    kind: "refactor",
    title: "Prometheus: Refactor this",
    command: "prometheus.refactorCode",
  },
  {
    kind: "test",
    title: "Prometheus: Add tests",
    command: "prometheus.addTests",
  },
  {
    kind: "fix",
    title: "Prometheus: Fix this",
    command: "prometheus.fixCode",
  },
  {
    kind: "optimize",
    title: "Prometheus: Optimize",
    command: "prometheus.optimizeCode",
  },
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
      const codeAction = new CodeAction(
        action.title,
        action.kind === "fix"
          ? CodeActionKind.QuickFix
          : CodeActionKind.Refactor
      );
      codeAction.command = {
        command: action.command,
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
