import { env, type Uri, ViewColumn, type WebviewPanel, window } from "vscode";
import type { ApiClient, ChatMessage } from "../api-client";

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
  private streamController: AbortController | undefined;
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
          this.handleSendMessage(message.text);
          break;
        }
        case "insertAtCursor": {
          await this.handleInsertAtCursor(message.code);
          break;
        }
        case "applyToFile": {
          await this.handleApplyToFile(message.code);
          break;
        }
        case "copyCode": {
          await env.clipboard.writeText(message.code);
          window.showInformationMessage("Code copied to clipboard.");
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
              role: msg.role === "assistant" ? "agent" : msg.role,
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
      this.streamController?.abort();
      this.streamController = undefined;
      this.panel = undefined;
    });
  }

  private async handleInsertAtCursor(code: string): Promise<void> {
    const editor = window.activeTextEditor;
    if (!editor) {
      window.showWarningMessage("No active editor to insert code into.");
      return;
    }
    await editor.edit((editBuilder) => {
      editBuilder.insert(editor.selection.active, code);
    });
    window.showInformationMessage("Code inserted at cursor.");
  }

  private async handleApplyToFile(code: string): Promise<void> {
    const editor = window.activeTextEditor;
    if (!editor) {
      window.showWarningMessage("No active editor to apply changes to.");
      return;
    }
    const action = await window.showInformationMessage(
      "Apply code changes?",
      "Replace Selection",
      "Cancel"
    );
    if (action === "Replace Selection") {
      await editor.edit((editBuilder) => {
        editBuilder.replace(editor.selection, code);
      });
    }
  }

  private handleSendMessage(text: string): void {
    this.messages.push({ role: "user", content: text });

    // Cancel any ongoing stream
    this.streamController?.abort();

    let fullResponse = "";
    this.streamController = this.apiClient.streamChat(
      this.messages,
      (chunk) => {
        if (chunk.error) {
          this.panel?.webview.postMessage({
            type: "error",
            message: chunk.error,
          });
          return;
        }
        if (chunk.content) {
          fullResponse += chunk.content;
          this.panel?.webview.postMessage({
            type: "streamChunk",
            content: chunk.content,
          });
        }
        if (chunk.done) {
          this.panel?.webview.postMessage({ type: "streamEnd" });
          if (fullResponse) {
            this.messages.push({ role: "assistant", content: fullResponse });
          }
        }
      },
      (error) => {
        this.panel?.webview.postMessage({
          type: "error",
          message: error.message,
        });
      }
    );
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
    body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); display: flex; flex-direction: column; height: 100vh; }
    .messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
    .message { padding: 8px 12px; border-radius: 8px; max-width: 85%; line-height: 1.4; overflow-wrap: break-word; }
    .message.user { background: var(--vscode-button-background); color: var(--vscode-button-foreground); align-self: flex-end; }
    .message.agent { background: var(--vscode-editor-inactiveSelectionBackground); align-self: flex-start; }
    .message.system { color: var(--vscode-descriptionForeground); font-style: italic; align-self: center; font-size: 0.9em; }
    .message.tool { background: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-textLink-foreground); padding-left: 12px; align-self: flex-start; font-size: 0.85em; }
    .message.agent code { font-family: var(--vscode-editor-font-family); font-size: 0.9em; padding: 1px 4px; background: var(--vscode-textCodeBlock-background); border-radius: 3px; }
    .code-block-wrapper { position: relative; margin: 8px 0; }
    .code-block-header { display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-bottom: none; border-radius: 4px 4px 0 0; font-size: 0.8em; color: var(--vscode-descriptionForeground); }
    .code-block-actions { display: flex; gap: 4px; }
    .code-block-actions button { padding: 2px 8px; font-size: 0.85em; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; border-radius: 3px; cursor: pointer; }
    .code-block-actions button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    pre.code-block { background: var(--vscode-textCodeBlock-background); padding: 12px; border-radius: 0 0 4px 4px; border: 1px solid var(--vscode-panel-border); overflow-x: auto; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); line-height: 1.4; white-space: pre; }
    .input-area { padding: 12px 16px; border-top: 1px solid var(--vscode-panel-border); display: flex; gap: 8px; }
    .input-area textarea { flex: 1; padding: 8px 12px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; outline: none; font-family: inherit; resize: none; min-height: 36px; max-height: 120px; }
    .input-area button { padding: 8px 16px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; cursor: pointer; align-self: flex-end; }
    .typing-indicator { display: none; padding: 4px 16px; color: var(--vscode-descriptionForeground); font-style: italic; font-size: 0.9em; }
    .typing-indicator.visible { display: block; }
  </style>
</head>
<body>
  <div class="messages" id="messages"></div>
  <div class="typing-indicator" id="typing">Agent is thinking...</div>
  <div class="input-area">
    <textarea id="input" rows="1" placeholder="Ask a question or describe a task..."></textarea>
    <button id="send">Send</button>
  </div>
  <script>
    var vscode = acquireVsCodeApi();
    var messagesEl = document.getElementById('messages');
    var inputEl = document.getElementById('input');
    var sendBtn = document.getElementById('send');
    var typingEl = document.getElementById('typing');
    var currentStreamDiv = null;
    var currentStreamContent = '';

    inputEl.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });

    function escapeHtml(text) {
      var d = document.createElement('div');
      d.textContent = text;
      return d.innerHTML;
    }

    function renderMarkdown(text) {
      var codeBlockRegex = /\\\`\\\`\\\`(\\w*)\\n([\\s\\S]*?)\\\`\\\`\\\`/g;
      var lastIndex = 0;
      var match;
      var result = '';

      while ((match = codeBlockRegex.exec(text)) !== null) {
        var before = text.slice(lastIndex, match.index);
        result += renderInline(before);
        var lang = match[1] || 'text';
        var code = match[2];
        var codeId = 'code-' + Math.random().toString(36).slice(2, 9);
        result += '<div class="code-block-wrapper">';
        result += '<div class="code-block-header"><span>' + escapeHtml(lang) + '</span>';
        result += '<div class="code-block-actions">';
        result += '<button onclick="copyCode(\\'' + codeId + '\\')">Copy</button>';
        result += '<button onclick="insertAtCursor(\\'' + codeId + '\\')">Insert</button>';
        result += '<button onclick="applyToFile(\\'' + codeId + '\\')">Apply</button>';
        result += '</div></div>';
        result += '<pre class="code-block" id="' + codeId + '" data-code="' + btoa(encodeURIComponent(code)) + '">';
        result += escapeHtml(code);
        result += '</pre></div>';
        lastIndex = match.index + match[0].length;
      }
      result += renderInline(text.slice(lastIndex));
      return result;
    }

    function renderInline(text) {
      if (!text) return '';
      var s = escapeHtml(text);
      s = s.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
      s = s.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
      s = s.replace(/\\\`([^\\\`]+)\\\`/g, '<code>$1</code>');
      s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
      s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>');
      s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>');
      s = s.replace(/\\n/g, '<br>');
      return s;
    }

    window.copyCode = function(id) {
      var el = document.getElementById(id);
      if (!el) return;
      vscode.postMessage({ type: 'copyCode', code: decodeURIComponent(atob(el.getAttribute('data-code'))) });
    };
    window.insertAtCursor = function(id) {
      var el = document.getElementById(id);
      if (!el) return;
      vscode.postMessage({ type: 'insertAtCursor', code: decodeURIComponent(atob(el.getAttribute('data-code'))) });
    };
    window.applyToFile = function(id) {
      var el = document.getElementById(id);
      if (!el) return;
      vscode.postMessage({ type: 'applyToFile', code: decodeURIComponent(atob(el.getAttribute('data-code'))) });
    };

    function addMessage(text, type) {
      var div = document.createElement('div');
      div.className = 'message ' + type;
      if (type === 'agent') { div.innerHTML = renderMarkdown(text); }
      else { div.textContent = text; }
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return div;
    }

    function startStream() {
      currentStreamContent = '';
      currentStreamDiv = document.createElement('div');
      currentStreamDiv.className = 'message agent';
      messagesEl.appendChild(currentStreamDiv);
      typingEl.classList.add('visible');
    }

    function appendStream(content) {
      currentStreamContent += content;
      if (currentStreamDiv) {
        currentStreamDiv.innerHTML = renderMarkdown(currentStreamContent);
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    }

    function endStream() {
      currentStreamDiv = null;
      currentStreamContent = '';
      typingEl.classList.remove('visible');
    }

    function send() {
      var text = inputEl.value.trim();
      if (!text) return;
      addMessage(text, 'user');
      startStream();
      vscode.postMessage({ type: 'sendMessage', text: text });
      inputEl.value = '';
      inputEl.style.height = 'auto';
    }

    sendBtn.addEventListener('click', send);
    inputEl.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });

    window.addEventListener('message', function(event) {
      var msg = event.data;
      switch (msg.type) {
        case 'connected': addMessage('Connected to Prometheus', 'system'); break;
        case 'taskCreated': addMessage('Task ' + msg.taskId + ' assigned', 'system'); break;
        case 'replayMessage': addMessage(msg.content, msg.role); break;
        case 'clearMessages':
          while (messagesEl.firstChild) { messagesEl.removeChild(messagesEl.firstChild); }
          break;
        case 'streamChunk':
          if (!currentStreamDiv) startStream();
          appendStream(msg.content);
          break;
        case 'streamEnd': endStream(); break;
        case 'agentEvent':
          try {
            var data = JSON.parse(msg.data);
            if (data.toolName) addMessage('[Tool] ' + data.toolName + ': ' + (data.result || '...'), 'tool');
            else if (data.message) addMessage(data.message, 'agent');
            else addMessage(msg.data, 'agent');
          } catch (e) { addMessage(msg.data, 'agent'); }
          break;
        case 'error':
          endStream();
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
    this.streamController?.abort();
    this.streamController = undefined;
    this.panel?.dispose();
    this.panel = undefined;
  }
}
