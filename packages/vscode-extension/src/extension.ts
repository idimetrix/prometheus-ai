import {
  commands,
  type ExtensionContext,
  languages,
  window,
  workspace,
} from "vscode";
import { ApiClient } from "./api-client";
import { ChatPanel } from "./chat-panel";
import { submitTask } from "./commands/submit-task";
import { AutoPRGenerator } from "./git/auto-pr";
import { PRReviewer } from "./git/pr-reviewer";
import { ChatPanelProvider } from "./panels/chat-panel";
import { PrometheusClient } from "./prometheus-client";
import { AgentProvider } from "./providers/agent-provider";
import { PrometheusCodeActionProvider } from "./providers/code-action-provider";
import { PrometheusInlineCompletionProvider } from "./providers/inline-completion";
import { SessionProvider } from "./providers/session-provider";
import { StatusBarManager } from "./status-bar";
import { EnhancedStatusBarManager } from "./ui/status-bar";

let apiClient: ApiClient | undefined;
let prometheusClient: PrometheusClient | undefined;
let chatPanel: ChatPanel | undefined;
let chatPanelProvider: ChatPanelProvider | undefined;
let statusBar: StatusBarManager | undefined;
let enhancedStatusBar: EnhancedStatusBarManager | undefined;
let sessionProvider: SessionProvider | undefined;
let agentProvider: AgentProvider | undefined;
let inlineProvider: PrometheusInlineCompletionProvider | undefined;

export function activate(context: ExtensionContext): void {
  const config = workspace.getConfiguration("prometheus");
  const apiUrl = config.get<string>("apiUrl", "http://localhost:4000");
  const socketUrl = config.get<string>("socketUrl", "ws://localhost:4001");
  const apiKey = config.get<string>("apiKey", "");

  // Fall back to legacy apiToken if apiKey is not set
  const token = apiKey || config.get<string>("apiToken", "");

  apiClient = new ApiClient(apiUrl, token, context.secrets);
  prometheusClient = new PrometheusClient(apiUrl, socketUrl, token);

  // Load API key from secret storage if available
  apiClient.reloadConfig();

  statusBar = new StatusBarManager();
  statusBar.show();
  statusBar.startPolling(apiClient);

  enhancedStatusBar = new EnhancedStatusBarManager();
  enhancedStatusBar.startPolling(apiClient);

  // Register tree data providers for sidebar views
  sessionProvider = new SessionProvider(prometheusClient);
  agentProvider = new AgentProvider(prometheusClient);

  context.subscriptions.push(
    window.registerTreeDataProvider("prometheus.sessions", sessionProvider)
  );
  context.subscriptions.push(
    window.registerTreeDataProvider("prometheus.agents", agentProvider)
  );

  // Connect WebSocket for real-time updates
  prometheusClient.connectWebSocket();
  prometheusClient.onEvent((event, data) => {
    if (event === "agent_status") {
      const agents = Array.isArray(data) ? data : [data];
      agentProvider?.updateAgents(
        agents as Array<{
          id: string;
          role: string;
          status: "pending" | "running" | "completed" | "failed";
          progress: number;
          filesChanged: number;
          tokensUsed: number;
        }>
      );
    }
    if (event === "session:update") {
      sessionProvider?.refresh();
    }
  });

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

  // Register inline completion provider
  inlineProvider = new PrometheusInlineCompletionProvider(apiClient);
  context.subscriptions.push(
    languages.registerInlineCompletionItemProvider(
      { scheme: "file" },
      inlineProvider
    )
  );

  // -----------------------------------------------------------------------
  // Code action commands
  // -----------------------------------------------------------------------

  const registerCodeActionCommand = (
    commandId: string,
    actionKind: string
  ): void => {
    context.subscriptions.push(
      commands.registerCommand(
        commandId,
        async (args?: {
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

          let selectedText: string;
          let filePath: string;
          let languageId: string;
          let startLine: number;
          let endLine: number;

          if (args) {
            selectedText = args.selectedText;
            filePath = args.filePath;
            languageId = args.languageId;
            startLine = args.startLine;
            endLine = args.endLine;
          } else {
            // Fallback: use active editor selection
            const editor = window.activeTextEditor;
            if (!editor || editor.selection.isEmpty) {
              window.showWarningMessage(
                "Please select code to use this action."
              );
              return;
            }
            selectedText = editor.document.getText(editor.selection);
            filePath = editor.document.uri.fsPath;
            languageId = editor.document.languageId;
            startLine = editor.selection.start.line;
            endLine = editor.selection.end.line;
          }

          try {
            statusBar?.setStatus("busy");
            enhancedStatusBar?.setStatus("busy");
            const prompt = `${actionKind} the following ${languageId} code from ${filePath} (lines ${startLine}-${endLine}):\n\n${selectedText}`;

            // Open chat panel and stream the response
            if (!chatPanel) {
              chatPanel = new ChatPanel(
                context.extensionUri,
                apiClient,
                socketUrl
              );
            }
            chatPanel.reveal();

            const result = await apiClient.assignTask(prompt);
            window.showInformationMessage(
              `Action "${actionKind}" started: ${result.taskId}`
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
  };

  registerCodeActionCommand("prometheus.explainCode", "Explain");
  registerCodeActionCommand("prometheus.refactorCode", "Refactor");
  registerCodeActionCommand("prometheus.addTests", "Write tests for");
  registerCodeActionCommand("prometheus.fixCode", "Fix bugs in");
  registerCodeActionCommand("prometheus.optimizeCode", "Optimize");

  // Legacy code action command (backwards compatibility)
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

  // -----------------------------------------------------------------------
  // Session commands
  // -----------------------------------------------------------------------

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

  // Ask question command -- opens enhanced chat panel
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

  // Submit task command (enhanced version with priority picker)
  context.subscriptions.push(
    commands.registerCommand("prometheus.submitTask", async () => {
      if (!prometheusClient) {
        return;
      }
      try {
        statusBar?.setStatus("busy");
        enhancedStatusBar?.setStatus("busy");
        await submitTask(prometheusClient);
        statusBar?.setStatus("active");
        enhancedStatusBar?.setStatus("active");
        sessionProvider?.refresh();
        agentProvider?.refresh();
      } catch (error) {
        statusBar?.setStatus("error");
        enhancedStatusBar?.setStatus("error");
        const message =
          error instanceof Error ? error.message : "Unknown error";
        window.showErrorMessage(`Failed to submit task: ${message}`);
      }
    })
  );

  // Show dashboard command
  context.subscriptions.push(
    commands.registerCommand("prometheus.showDashboard", async () => {
      if (!prometheusClient) {
        return;
      }
      try {
        const status = await prometheusClient.getStatus();
        const sessionCount = status.sessions.length;
        const activeCount = status.sessions.filter(
          (s) => s.status === "active"
        ).length;

        window.showInformationMessage(
          `Prometheus Dashboard: ${sessionCount} sessions (${activeCount} active)`
        );

        // Refresh sidebar views
        sessionProvider?.refresh();
        agentProvider?.refresh();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        window.showErrorMessage(`Failed to load dashboard: ${message}`);
      }
    })
  );

  // Approve checkpoint command
  context.subscriptions.push(
    commands.registerCommand("prometheus.approveCheckpoint", async () => {
      if (!prometheusClient) {
        return;
      }
      try {
        const checkpoints = await prometheusClient.getPendingCheckpoints();
        if (checkpoints.length === 0) {
          window.showInformationMessage("No pending checkpoints to approve");
          return;
        }

        const items = checkpoints.map((cp) => ({
          label: cp.phase,
          description: cp.taskId.slice(0, 8),
          detail: cp.summary,
          taskId: cp.taskId,
        }));

        const selected = await window.showQuickPick(items, {
          placeHolder: "Select a checkpoint to approve",
          title: "Pending Checkpoints",
        });

        if (!selected) {
          return;
        }

        const action = await window.showQuickPick(
          [
            { label: "Approve", value: "approve" },
            { label: "Reject", value: "reject" },
          ],
          { placeHolder: "Choose action" }
        );

        if (!action) {
          return;
        }

        if (action.value === "approve") {
          await prometheusClient.approveCheckpoint(selected.taskId);
          window.showInformationMessage(
            `Checkpoint approved: ${selected.label}`
          );
        } else {
          const reason = await window.showInputBox({
            prompt: "Provide a reason for rejection",
            placeHolder: "e.g., Missing error handling",
          });
          if (reason) {
            await prometheusClient.rejectCheckpoint(selected.taskId, reason);
            window.showInformationMessage(
              `Checkpoint rejected: ${selected.label}`
            );
          }
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        window.showErrorMessage(`Checkpoint action failed: ${message}`);
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
        const newSocketUrl = updatedConfig.get<string>(
          "socketUrl",
          "ws://localhost:4001"
        );
        const newApiKey = updatedConfig.get<string>("apiKey", "");
        const newToken = newApiKey || updatedConfig.get<string>("apiToken", "");
        apiClient?.updateConfig(newApiUrl, newToken);
        prometheusClient?.updateCredentials(newApiUrl, newSocketUrl, newToken);
      }
    })
  );

  // Add disposables
  if (statusBar) {
    context.subscriptions.push({ dispose: () => statusBar?.dispose() });
  }
  if (enhancedStatusBar) {
    context.subscriptions.push({
      dispose: () => enhancedStatusBar?.dispose(),
    });
  }
  if (inlineProvider) {
    context.subscriptions.push({ dispose: () => inlineProvider?.dispose() });
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
  sessionProvider?.dispose();
  sessionProvider = undefined;
  agentProvider?.dispose();
  agentProvider = undefined;
  inlineProvider?.dispose();
  inlineProvider = undefined;
  prometheusClient?.dispose();
  prometheusClient = undefined;
  apiClient = undefined;
}
