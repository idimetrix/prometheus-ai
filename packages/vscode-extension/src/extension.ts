import {
  commands,
  type ExtensionContext,
  languages,
  window,
  workspace,
} from "vscode";
import { ApiClient } from "./api-client";
import { ChatPanel } from "./chat-panel";
import { AutoPRGenerator } from "./git/auto-pr";
import { PRReviewer } from "./git/pr-reviewer";
import { ChatPanelProvider } from "./panels/chat-panel";
import { PrometheusCodeActionProvider } from "./providers/code-action-provider";
import { StatusBarManager } from "./status-bar";
import { EnhancedStatusBarManager } from "./ui/status-bar";

let apiClient: ApiClient | undefined;
let chatPanel: ChatPanel | undefined;
let chatPanelProvider: ChatPanelProvider | undefined;
let statusBar: StatusBarManager | undefined;
let enhancedStatusBar: EnhancedStatusBarManager | undefined;

export function activate(context: ExtensionContext): void {
  const config = workspace.getConfiguration("prometheus");
  const apiUrl = config.get<string>("apiUrl", "http://localhost:4000");
  const socketUrl = config.get<string>("socketUrl", "ws://localhost:4001");
  const apiToken = config.get<string>("apiToken", "");

  apiClient = new ApiClient(apiUrl, apiToken);
  statusBar = new StatusBarManager();
  statusBar.show();
  enhancedStatusBar = new EnhancedStatusBarManager();

  // Register code action provider for all languages
  context.subscriptions.push(
    languages.registerCodeActionsProvider(
      { scheme: "file" },
      new PrometheusCodeActionProvider(),
      {
        providedCodeActionKinds:
          PrometheusCodeActionProvider.providedCodeActionKinds,
      }
    )
  );

  // Register commands
  context.subscriptions.push(
    commands.registerCommand("prometheus.startSession", async () => {
      if (!apiClient) {
        return;
      }
      try {
        statusBar?.setStatus("connecting");
        enhancedStatusBar?.setStatus("connecting");
        const session = await apiClient.startSession();
        commands.executeCommand("setContext", "prometheus.sessionActive", true);
        statusBar?.setStatus("active", session.id);
        enhancedStatusBar?.setStatus("active", session.id);
        window.showInformationMessage(
          `Prometheus session started: ${session.id}`
        );
      } catch (error) {
        statusBar?.setStatus("error");
        enhancedStatusBar?.setStatus("error");
        const message =
          error instanceof Error ? error.message : "Unknown error";
        window.showErrorMessage(`Failed to start session: ${message}`);
      }
    })
  );

  context.subscriptions.push(
    commands.registerCommand("prometheus.openChat", () => {
      if (!apiClient) {
        return;
      }
      if (!chatPanel) {
        chatPanel = new ChatPanel(context.extensionUri, apiClient, socketUrl);
      }
      chatPanel.reveal();
    })
  );

  // Ask question command — opens enhanced chat panel
  context.subscriptions.push(
    commands.registerCommand("prometheus.askQuestion", () => {
      if (!apiClient) {
        return;
      }
      if (!chatPanelProvider) {
        chatPanelProvider = new ChatPanelProvider(
          context.extensionUri,
          apiClient,
          socketUrl
        );
      }
      chatPanelProvider.reveal();
    })
  );

  // Review code command
  context.subscriptions.push(
    commands.registerCommand("prometheus.reviewCode", async () => {
      if (!apiClient) {
        return;
      }
      const editor = window.activeTextEditor;
      if (!editor) {
        window.showWarningMessage("No active editor to review");
        return;
      }

      const reviewer = new PRReviewer(apiClient);
      try {
        statusBar?.setStatus("busy");
        enhancedStatusBar?.setStatus("busy");
        const prNumber = await window.showInputBox({
          prompt: "Enter PR number to review (or leave blank for current file)",
        });

        if (prNumber) {
          const result = await reviewer.reviewPR(Number(prNumber));
          window.showInformationMessage(result.summary);
        } else {
          window.showInformationMessage("Reviewing current file...");
        }

        statusBar?.setStatus("active");
        enhancedStatusBar?.setStatus("active");
      } catch (error) {
        statusBar?.setStatus("error");
        enhancedStatusBar?.setStatus("error");
        const message =
          error instanceof Error ? error.message : "Unknown error";
        window.showErrorMessage(`Review failed: ${message}`);
      }
    })
  );

  // Code action handler
  context.subscriptions.push(
    commands.registerCommand(
      "prometheus.codeAction",
      async (args: {
        kind: string;
        filePath: string;
        languageId: string;
        selectedText: string;
        startLine: number;
        endLine: number;
      }) => {
        if (!apiClient) {
          return;
        }
        try {
          statusBar?.setStatus("busy");
          enhancedStatusBar?.setStatus("busy");
          const prompt = `${args.kind} the following ${args.languageId} code from ${args.filePath} (lines ${args.startLine}-${args.endLine}):\n\n${args.selectedText}`;
          const result = await apiClient.assignTask(prompt);
          window.showInformationMessage(
            `Action "${args.kind}" started: ${result.taskId}`
          );
          statusBar?.setStatus("active");
          enhancedStatusBar?.setStatus("active");
        } catch (error) {
          statusBar?.setStatus("error");
          enhancedStatusBar?.setStatus("error");
          const message =
            error instanceof Error ? error.message : "Unknown error";
          window.showErrorMessage(`Code action failed: ${message}`);
        }
      }
    )
  );

  // Auto-PR command
  context.subscriptions.push(
    commands.registerCommand("prometheus.createPR", async () => {
      if (!apiClient) {
        return;
      }
      const prGen = new AutoPRGenerator(apiClient);
      const taskDesc = await window.showInputBox({
        prompt: "Describe the changes for the PR",
      });
      if (!taskDesc) {
        return;
      }

      try {
        const description = await prGen.generatePRDescription("", taskDesc);
        window.showInformationMessage(`PR ready: ${description.title}`);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        window.showErrorMessage(`PR creation failed: ${message}`);
      }
    })
  );

  context.subscriptions.push(
    commands.registerCommand("prometheus.assignTask", async () => {
      if (!apiClient) {
        return;
      }
      const task = await window.showInputBox({
        prompt: "Describe the task for the Prometheus agent",
        placeHolder: "e.g., Add input validation to the signup form",
      });

      if (!task) {
        return;
      }

      try {
        statusBar?.setStatus("busy");
        enhancedStatusBar?.setStatus("busy");
        const result = await apiClient.assignTask(task);
        statusBar?.setStatus("active", result.sessionId);
        enhancedStatusBar?.setStatus("active", result.sessionId);
        window.showInformationMessage(`Task assigned: ${result.taskId}`);
      } catch (error) {
        statusBar?.setStatus("error");
        enhancedStatusBar?.setStatus("error");
        const message =
          error instanceof Error ? error.message : "Unknown error";
        window.showErrorMessage(`Failed to assign task: ${message}`);
      }
    })
  );

  context.subscriptions.push(
    commands.registerCommand("prometheus.viewStatus", async () => {
      if (!apiClient) {
        return;
      }
      try {
        const status = await apiClient.getStatus();
        const items = status.sessions.map((s) => ({
          label: `Session ${s.id}`,
          description: s.status,
          detail: s.currentTask ?? "No active task",
        }));

        if (items.length === 0) {
          window.showInformationMessage("No active sessions");
          return;
        }

        window.showQuickPick(items, {
          placeHolder: "Active Prometheus sessions",
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        window.showErrorMessage(`Failed to get status: ${message}`);
      }
    })
  );

  context.subscriptions.push(
    commands.registerCommand("prometheus.stopSession", async () => {
      if (!apiClient) {
        return;
      }
      try {
        await apiClient.stopSession();
        commands.executeCommand(
          "setContext",
          "prometheus.sessionActive",
          false
        );
        statusBar?.setStatus("idle");
        enhancedStatusBar?.setStatus("idle");
        window.showInformationMessage("Prometheus session stopped");
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        window.showErrorMessage(`Failed to stop session: ${message}`);
      }
    })
  );

  context.subscriptions.push(
    commands.registerCommand("prometheus.configure", () => {
      commands.executeCommand("workbench.action.openSettings", "prometheus");
    })
  );

  // Listen for configuration changes
  context.subscriptions.push(
    workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("prometheus")) {
        const updatedConfig = workspace.getConfiguration("prometheus");
        const newApiUrl = updatedConfig.get<string>(
          "apiUrl",
          "http://localhost:4000"
        );
        const newToken = updatedConfig.get<string>("apiToken", "");
        apiClient = new ApiClient(newApiUrl, newToken);
      }
    })
  );

  // Add status bar to disposables
  if (statusBar) {
    context.subscriptions.push({ dispose: () => statusBar?.dispose() });
  }
  if (enhancedStatusBar) {
    context.subscriptions.push({
      dispose: () => enhancedStatusBar?.dispose(),
    });
  }
}

export function deactivate(): void {
  chatPanel?.dispose();
  chatPanel = undefined;
  chatPanelProvider?.dispose();
  chatPanelProvider = undefined;
  statusBar?.dispose();
  statusBar = undefined;
  enhancedStatusBar?.dispose();
  enhancedStatusBar = undefined;
  apiClient = undefined;
}
