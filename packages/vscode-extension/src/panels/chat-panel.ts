import { type Uri, ViewColumn, type WebviewPanel, window } from "vscode";
import type { ApiClient } from "../api-client";

interface ChatMessage {
  content: string;
  role: "user" | "agent" | "system";
  timestamp: string;
}

/**
 * Chat panel implemented as a VS Code webview. Manages chat history,
 * sends messages to the Prometheus API, and renders streaming responses
 * with inline tool call results.
 */
export class ChatPanelProvider {
  private readonly extensionUri: Uri;
  private readonly apiClient: ApiClient;
  private readonly socketUrl: string;
  private panel: WebviewPanel | undefined;
  private sseController: AbortController | undefined;
  private readonly messages: ChatMessage[] = [];

  constructor(extensionUri: Uri, apiClient: ApiClient, socketUrl: string) {
    this.extensionUri = extensionUri;
    this.apiClient = apiClient;
    this.socketUrl = socketUrl;
  }

  /**
   * Get chat message history.
   */
  getMessages(): readonly ChatMessage[] {
    return this.messages;
  }

  /**
   * Clear chat history.
   */
  clearHistory(): void {
    this.messages.length = 0;
    this.panel?.webview.postMessage({ type: "clearMessages" });
  }

  /**
   * Reveal or create the chat panel.
   */
  reveal(): void {
    if (this.panel) {
      this.panel.reveal(ViewColumn.Beside);
      return;
    }

    this.panel = window.createWebviewPanel(
      "prometheus.chatPanel",
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
        case "ready": {
          this.panel?.webview.postMessage({
            type: "connected",
            socketUrl: this.socketUrl,
          });
          // Replay message history
          for (const msg of this.messages) {
            this.panel?.webview.postMessage({
              type: "replayMessage",
              role: msg.role,
              content: msg.content,
            });
          }
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
    this.messages.push({
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await this.apiClient.assignTask(text);

      this.panel?.webview.postMessage({
        type: "taskCreated",
        taskId: result.taskId,
        sessionId: result.sessionId,
      });

      this.sseController?.abort();
      this.sseController = this.apiClient.subscribeToEvents(
        result.sessionId,
        (msg) => {
          this.panel?.webview.postMessage({
            type: "agentEvent",
            event: msg.event,
            data: msg.data,
          });

          // Store agent messages in history
          try {
            const parsed = JSON.parse(msg.data) as { message?: string };
            if (parsed.message) {
              this.messages.push({
                role: "agent",
                content: parsed.message,
                timestamp: new Date().toISOString(),
              });
            }
          } catch {
            this.messages.push({
              role: "agent",
              content: msg.data,
              timestamp: new Date().toISOString(),
            });
          }
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

  private getWebviewContent(): string {
    // The webview HTML uses textContent for all dynamic content
    // to avoid XSS. Messages are inserted via DOM API textContent,
    // not innerHTML.
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Prometheus Chat</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); display: flex; flex-direction: column; height: 100vh; }
    .messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
    .message { padding: 8px 12px; border-radius: 8px; max-width: 85%; line-height: 1.4; white-space: pre-wrap; }
    .message.user { background: var(--vscode-button-background); color: var(--vscode-button-foreground); align-self: flex-end; }
    .message.agent { background: var(--vscode-editor-inactiveSelectionBackground); align-self: flex-start; }
    .message.system { color: var(--vscode-descriptionForeground); font-style: italic; align-self: center; font-size: 0.9em; }
    .message.tool { background: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-textLink-foreground); padding-left: 12px; align-self: flex-start; font-size: 0.85em; }
    .input-area { padding: 12px 16px; border-top: 1px solid var(--vscode-panel-border); display: flex; gap: 8px; }
    .input-area input { flex: 1; padding: 8px 12px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; outline: none; font-family: inherit; }
    .input-area button { padding: 8px 16px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; cursor: pointer; }
  </style>
</head>
<body>
  <div class="messages" id="messages"></div>
  <div class="input-area">
    <input type="text" id="input" placeholder="Ask a question or describe a task..." />
    <button id="send">Send</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('send');

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
      vscode.postMessage({ type: 'sendMessage', text: text });
      inputEl.value = '';
    }

    sendBtn.addEventListener('click', send);
    inputEl.addEventListener('keydown', function(e) { if (e.key === 'Enter') send(); });

    window.addEventListener('message', function(event) {
      var msg = event.data;
      switch (msg.type) {
        case 'connected': addMessage('Connected to Prometheus', 'system'); break;
        case 'taskCreated': addMessage('Task ' + msg.taskId + ' assigned', 'system'); break;
        case 'replayMessage': addMessage(msg.content, msg.role); break;
        case 'clearMessages':
          while (messagesEl.firstChild) { messagesEl.removeChild(messagesEl.firstChild); }
          break;
        case 'agentEvent':
          try {
            var data = JSON.parse(msg.data);
            if (data.toolName) addMessage('[Tool] ' + data.toolName + ': ' + (data.result || '...'), 'tool');
            else if (data.message) addMessage(data.message, 'agent');
            else addMessage(msg.data, 'agent');
          } catch (e) { addMessage(msg.data, 'agent'); }
          break;
        case 'error': addMessage('Error: ' + msg.message, 'system'); break;
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
