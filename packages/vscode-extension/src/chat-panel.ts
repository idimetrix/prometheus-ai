import { type Uri, ViewColumn, type WebviewPanel, window } from "vscode";
import type { ApiClient } from "./api-client";

export class ChatPanel {
  private readonly extensionUri: Uri;
  private readonly apiClient: ApiClient;
  private readonly socketUrl: string;
  private panel: WebviewPanel | undefined;
  private sseController: AbortController | undefined;

  constructor(extensionUri: Uri, apiClient: ApiClient, socketUrl: string) {
    this.extensionUri = extensionUri;
    this.apiClient = apiClient;
    this.socketUrl = socketUrl;
  }

  reveal(): void {
    if (this.panel) {
      this.panel.reveal(ViewColumn.Beside);
      return;
    }

    this.panel = window.createWebviewPanel(
      "prometheus.chat",
      "Prometheus Chat",
      ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri],
      }
    );

    this.panel.webview.html = this.getWebviewContent();

    this.panel.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case "sendMessage": {
          await this.handleSendMessage(message.text);
          break;
        }
        case "assignTask": {
          await this.handleAssignTask(message.description);
          break;
        }
        case "ready": {
          this.panel?.webview.postMessage({
            type: "connected",
            socketUrl: this.socketUrl,
          });
          break;
        }
        default:
          break;
      }
    });

    this.panel.onDidDispose(() => {
      this.sseController?.abort();
      this.sseController = undefined;
      this.panel = undefined;
    });
  }

  private async handleSendMessage(text: string): Promise<void> {
    try {
      const result = await this.apiClient.assignTask(text);
      this.panel?.webview.postMessage({
        type: "taskCreated",
        taskId: result.taskId,
        sessionId: result.sessionId,
      });

      // Subscribe to SSE events for this session
      this.sseController?.abort();
      this.sseController = this.apiClient.subscribeToEvents(
        result.sessionId,
        (msg) => {
          this.panel?.webview.postMessage({
            type: "agentEvent",
            event: msg.event,
            data: msg.data,
          });
        },
        (error) => {
          this.panel?.webview.postMessage({
            type: "error",
            message: error.message,
          });
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.panel?.webview.postMessage({
        type: "error",
        message,
      });
    }
  }

  private async handleAssignTask(description: string): Promise<void> {
    await this.handleSendMessage(description);
  }

  private getWebviewContent(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Prometheus Chat</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    .header {
      padding: 12px 16px;
      border-bottom: 1px solid var(--vscode-panel-border);
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--vscode-testing-iconPassed);
    }
    .status-dot.disconnected {
      background: var(--vscode-testing-iconFailed);
    }
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .message {
      padding: 8px 12px;
      border-radius: 8px;
      max-width: 85%;
      line-height: 1.4;
    }
    .message.user {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      align-self: flex-end;
    }
    .message.agent {
      background: var(--vscode-editor-inactiveSelectionBackground);
      align-self: flex-start;
    }
    .message.system {
      background: transparent;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
      align-self: center;
      font-size: 0.9em;
    }
    .input-area {
      padding: 12px 16px;
      border-top: 1px solid var(--vscode-panel-border);
      display: flex;
      gap: 8px;
    }
    .input-area input {
      flex: 1;
      padding: 8px 12px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      outline: none;
      font-family: inherit;
      font-size: inherit;
    }
    .input-area input:focus {
      border-color: var(--vscode-focusBorder);
    }
    .input-area button {
      padding: 8px 16px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-family: inherit;
      font-size: inherit;
    }
    .input-area button:hover {
      background: var(--vscode-button-hoverBackground);
    }
  </style>
</head>
<body>
  <div class="header">
    <span class="status-dot disconnected" id="statusDot"></span>
    Prometheus Agent
  </div>
  <div class="messages" id="messages">
    <div class="message system">Send a message to start working with the Prometheus agent.</div>
  </div>
  <div class="input-area">
    <input type="text" id="input" placeholder="Describe a task or ask a question..." />
    <button id="send">Send</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('send');
    const statusDot = document.getElementById('statusDot');

    function addMessage(text, type) {
      const div = document.createElement('div');
      div.className = 'message ' + type;
      div.textContent = text;
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function send() {
      const text = inputEl.value.trim();
      if (!text) return;
      addMessage(text, 'user');
      vscode.postMessage({ type: 'sendMessage', text });
      inputEl.value = '';
    }

    sendBtn.addEventListener('click', send);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') send();
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'connected':
          statusDot.classList.remove('disconnected');
          addMessage('Connected to Prometheus', 'system');
          break;
        case 'taskCreated':
          addMessage('Task ' + msg.taskId + ' assigned. Agent is working...', 'system');
          break;
        case 'agentEvent':
          try {
            const data = JSON.parse(msg.data);
            if (data.message) {
              addMessage(data.message, 'agent');
            } else if (data.type) {
              addMessage('[' + msg.event + '] ' + data.type, 'system');
            }
          } catch {
            addMessage(msg.data, 'agent');
          }
          break;
        case 'error':
          addMessage('Error: ' + msg.message, 'system');
          break;
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }

  dispose(): void {
    this.sseController?.abort();
    this.sseController = undefined;
    this.panel?.dispose();
    this.panel = undefined;
  }
}
