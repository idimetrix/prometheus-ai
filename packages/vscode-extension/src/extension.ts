import { commands, type ExtensionContext, window, workspace } from "vscode";
import { ApiClient } from "./api-client";
import { ChatPanel } from "./chat-panel";
import { StatusBarManager } from "./status-bar";

let apiClient: ApiClient | undefined;
let chatPanel: ChatPanel | undefined;
let statusBar: StatusBarManager | undefined;

export function activate(context: ExtensionContext): void {
  const config = workspace.getConfiguration("prometheus");
  const apiUrl = config.get<string>("apiUrl", "http://localhost:4000");
  const socketUrl = config.get<string>("socketUrl", "ws://localhost:4001");
  const apiToken = config.get<string>("apiToken", "");

  apiClient = new ApiClient(apiUrl, apiToken);
  statusBar = new StatusBarManager();
  statusBar.show();

  // Register commands
  context.subscriptions.push(
    commands.registerCommand("prometheus.startSession", async () => {
      if (!apiClient) {
        return;
      }
      try {
        statusBar?.setStatus("connecting");
        const session = await apiClient.startSession();
        commands.executeCommand("setContext", "prometheus.sessionActive", true);
        statusBar?.setStatus("active", session.id);
        window.showInformationMessage(
          `Prometheus session started: ${session.id}`
        );
      } catch (error) {
        statusBar?.setStatus("error");
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
        const result = await apiClient.assignTask(task);
        statusBar?.setStatus("active", result.sessionId);
        window.showInformationMessage(`Task assigned: ${result.taskId}`);
      } catch (error) {
        statusBar?.setStatus("error");
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
}

export function deactivate(): void {
  chatPanel?.dispose();
  chatPanel = undefined;
  statusBar?.dispose();
  statusBar = undefined;
  apiClient = undefined;
}
