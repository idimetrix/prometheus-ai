import {
  commands,
  type TextEditor,
  type Uri,
  ViewColumn,
  type WebviewPanel,
  window,
  workspace,
} from "vscode";
import type { ApiClient, ChatMessage } from "./api-client";

export class ChatPanel {
  private readonly extensionUri: Uri;
  private readonly apiClient: ApiClient;
  private readonly socketUrl: string;
  private panel: WebviewPanel | undefined;
  private sseController: AbortController | undefined;
  private streamController: AbortController | undefined;
  private readonly chatHistory: ChatMessage[] = [];

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
        case "insertAtCursor": {
          await this.handleInsertAtCursor(message.code);
          break;
        }
        case "applyToFile": {
          await this.handleApplyToFile(message.code, message.filePath);
          break;
        }
        case "copyCode": {
          await this.handleCopyCode(message.code);
          break;
        }
        case "assignTask": {
          await this.handleSendMessage(message.description);
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
      this.streamController?.abort();
      this.streamController = undefined;
      this.panel = undefined;
    });
  }

  private async handleSendMessage(text: string): Promise<void> {
    this.chatHistory.push({ role: "user", content: text });

    // Cancel any ongoing stream
    this.streamController?.abort();

    try {
      // Stream the chat response
      let fullResponse = "";
      this.streamController = this.apiClient.streamChat(
        this.chatHistory,
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
              this.chatHistory.push({
                role: "assistant",
                content: fullResponse,
              });
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
    } catch (_error) {
      // Fallback to task-based API if streaming is not available
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
          (sseError) => {
            this.panel?.webview.postMessage({
              type: "error",
              message: sseError.message,
            });
          }
        );
      } catch (fallbackError) {
        const message =
          fallbackError instanceof Error
            ? fallbackError.message
            : "Unknown error";
        this.panel?.webview.postMessage({
          type: "error",
          message,
        });
      }
    }
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

  private async handleApplyToFile(
    code: string,
    filePath?: string
  ): Promise<void> {
    let editor: TextEditor | undefined;

    if (filePath) {
      const doc = await workspace.openTextDocument(filePath);
      editor = await window.showTextDocument(doc);
    } else {
      editor = window.activeTextEditor;
    }

    if (!editor) {
      window.showWarningMessage("No active editor to apply changes to.");
      return;
    }

    // Show a diff and let the user decide
    const action = await window.showInformationMessage(
      "Apply code changes to the current file?",
      "Replace Selection",
      "Replace All",
      "Cancel"
    );

    if (action === "Replace Selection") {
      await editor.edit((editBuilder) => {
        editBuilder.replace(editor.selection, code);
      });
    } else if (action === "Replace All") {
      const fullRange = editor.document.validateRange(
        new (await import("vscode")).Range(0, 0, Number.MAX_SAFE_INTEGER, 0)
      );
      await editor.edit((editBuilder) => {
        editBuilder.replace(fullRange, code);
      });
    }
  }

  private async handleCopyCode(code: string): Promise<void> {
    await commands.executeCommand("editor.action.clipboardCopyAction");
    // Use the env clipboard API directly
    const { env } = await import("vscode");
    await env.clipboard.writeText(code);
    window.showInformationMessage("Code copied to clipboard.");
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
      line-height: 1.5;
      overflow-wrap: break-word;
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
    .message.agent h1, .message.agent h2, .message.agent h3 {
      margin-top: 8px;
      margin-bottom: 4px;
    }
    .message.agent h1 { font-size: 1.3em; }
    .message.agent h2 { font-size: 1.15em; }
    .message.agent h3 { font-size: 1.05em; }
    .message.agent p { margin: 4px 0; }
    .message.agent ul, .message.agent ol { margin: 4px 0 4px 20px; }
    .message.agent strong { font-weight: 600; }
    .message.agent em { font-style: italic; }
    .message.agent code {
      font-family: var(--vscode-editor-font-family);
      font-size: 0.9em;
      padding: 1px 4px;
      background: var(--vscode-textCodeBlock-background);
      border-radius: 3px;
    }
    .code-block-wrapper {
      position: relative;
      margin: 8px 0;
    }
    .code-block-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 8px;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-bottom: none;
      border-radius: 4px 4px 0 0;
      font-size: 0.8em;
      color: var(--vscode-descriptionForeground);
    }
    .code-block-actions {
      display: flex;
      gap: 4px;
    }
    .code-block-actions button {
      padding: 2px 8px;
      font-size: 0.85em;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      border-radius: 3px;
      cursor: pointer;
    }
    .code-block-actions button:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    pre.code-block {
      background: var(--vscode-textCodeBlock-background);
      padding: 12px;
      border-radius: 0 0 4px 4px;
      border: 1px solid var(--vscode-panel-border);
      overflow-x: auto;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      line-height: 1.4;
      white-space: pre;
      tab-size: 2;
    }
    .keyword { color: var(--vscode-symbolIcon-keywordForeground, #c586c0); }
    .string { color: var(--vscode-symbolIcon-stringForeground, #ce9178); }
    .comment { color: var(--vscode-symbolIcon-commentForeground, #6a9955); font-style: italic; }
    .number { color: var(--vscode-symbolIcon-numberForeground, #b5cea8); }
    .function-name { color: var(--vscode-symbolIcon-functionForeground, #dcdcaa); }
    .type-name { color: var(--vscode-symbolIcon-typeParameterForeground, #4ec9b0); }
    .input-area {
      padding: 12px 16px;
      border-top: 1px solid var(--vscode-panel-border);
      display: flex;
      gap: 8px;
    }
    .input-area textarea {
      flex: 1;
      padding: 8px 12px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      outline: none;
      font-family: inherit;
      font-size: inherit;
      resize: none;
      min-height: 36px;
      max-height: 120px;
    }
    .input-area textarea:focus {
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
      align-self: flex-end;
    }
    .input-area button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .typing-indicator {
      display: none;
      align-self: flex-start;
      padding: 8px 12px;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
    .typing-indicator.visible { display: block; }
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
  <div class="typing-indicator" id="typing">Agent is thinking...</div>
  <div class="input-area">
    <textarea id="input" rows="1" placeholder="Describe a task or ask a question..."></textarea>
    <button id="send">Send</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('send');
    const statusDot = document.getElementById('statusDot');
    const typingEl = document.getElementById('typing');
    let currentStreamDiv = null;
    let currentStreamContent = '';

    // Auto-resize textarea
    inputEl.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });

    function escapeHtml(text) {
      var d = document.createElement('div');
      d.textContent = text;
      return d.innerHTML;
    }

    function highlightCode(code, lang) {
      var escaped = escapeHtml(code);
      // Basic syntax highlighting
      var keywords = /\\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|this|class|extends|import|export|from|default|async|await|try|catch|throw|typeof|instanceof|in|of|yield|interface|type|enum|implements|abstract|public|private|protected|static|readonly|override|declare|module|namespace|require)\\b/g;
      var strings = /(["'\`])(?:(?!\\1)[^\\\\]|\\\\.)*?\\1/g;
      var comments = /(^|\\s)\\/\\/.*$/gm;
      var multilineComments = /\\/\\*[\\s\\S]*?\\*\\//g;
      var numbers = /\\b(\\d+\\.?\\d*)\\b/g;
      var funcNames = /\\b([a-zA-Z_$][\\w$]*)(?=\\s*\\()/g;
      var typeNames = /\\b([A-Z][a-zA-Z0-9]*)\\b/g;

      // Apply highlighting in safe order
      var tokens = [];
      var tokenId = 0;

      function addToken(cls, match) {
        var key = '%%TOKEN_' + tokenId + '%%';
        tokenId++;
        tokens.push({ key: key, val: '<span class="' + cls + '">' + match + '</span>' });
        return key;
      }

      // Comments first (highest priority)
      escaped = escaped.replace(multilineComments, function(m) { return addToken('comment', m); });
      escaped = escaped.replace(comments, function(m) { return addToken('comment', m); });
      // Strings next
      escaped = escaped.replace(strings, function(m) { return addToken('string', m); });
      // Keywords
      escaped = escaped.replace(keywords, function(m) { return addToken('keyword', m); });
      // Numbers
      escaped = escaped.replace(numbers, function(m) { return addToken('number', m); });

      // Restore tokens
      for (var i = tokens.length - 1; i >= 0; i--) {
        escaped = escaped.split(tokens[i].key).join(tokens[i].val);
      }

      return escaped;
    }

    function renderMarkdown(text) {
      var html = '';
      var parts = text.split(/(\\x60\\x60\\x60[\\s\\S]*?\\x60\\x60\\x60)/g);

      // Split by code blocks (triple backtick)
      var codeBlockRegex = /\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g;
      var lastIndex = 0;
      var match;
      var result = '';

      while ((match = codeBlockRegex.exec(text)) !== null) {
        // Process text before code block
        var before = text.slice(lastIndex, match.index);
        result += renderInlineMarkdown(before);

        // Process code block
        var lang = match[1] || 'text';
        var code = match[2];
        var codeId = 'code-' + Math.random().toString(36).slice(2, 9);
        result += '<div class="code-block-wrapper">';
        result += '<div class="code-block-header">';
        result += '<span>' + escapeHtml(lang) + '</span>';
        result += '<div class="code-block-actions">';
        result += '<button onclick="copyCode(\\'' + codeId + '\\')">Copy</button>';
        result += '<button onclick="insertAtCursor(\\'' + codeId + '\\')">Insert</button>';
        result += '<button onclick="applyToFile(\\'' + codeId + '\\')">Apply</button>';
        result += '</div></div>';
        result += '<pre class="code-block" id="' + codeId + '" data-code="' + btoa(encodeURIComponent(code)) + '">';
        result += highlightCode(code, lang);
        result += '</pre></div>';

        lastIndex = match.index + match[0].length;
      }

      // Process remaining text
      result += renderInlineMarkdown(text.slice(lastIndex));
      return result;
    }

    function renderInlineMarkdown(text) {
      if (!text) return '';
      var escaped = escapeHtml(text);
      // Bold
      escaped = escaped.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
      // Italic
      escaped = escaped.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
      // Inline code
      escaped = escaped.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
      // Headers
      escaped = escaped.replace(/^### (.+)$/gm, '<h3>$1</h3>');
      escaped = escaped.replace(/^## (.+)$/gm, '<h2>$1</h2>');
      escaped = escaped.replace(/^# (.+)$/gm, '<h1>$1</h1>');
      // Unordered lists
      escaped = escaped.replace(/^[\\-\\*] (.+)$/gm, '<li>$1</li>');
      // Line breaks
      escaped = escaped.replace(/\\n\\n/g, '</p><p>');
      escaped = escaped.replace(/\\n/g, '<br>');
      return '<p>' + escaped + '</p>';
    }

    window.copyCode = function(id) {
      var el = document.getElementById(id);
      if (!el) return;
      var code = decodeURIComponent(atob(el.getAttribute('data-code')));
      vscode.postMessage({ type: 'copyCode', code: code });
    };

    window.insertAtCursor = function(id) {
      var el = document.getElementById(id);
      if (!el) return;
      var code = decodeURIComponent(atob(el.getAttribute('data-code')));
      vscode.postMessage({ type: 'insertAtCursor', code: code });
    };

    window.applyToFile = function(id) {
      var el = document.getElementById(id);
      if (!el) return;
      var code = decodeURIComponent(atob(el.getAttribute('data-code')));
      vscode.postMessage({ type: 'applyToFile', code: code });
    };

    function addMessage(text, type) {
      var div = document.createElement('div');
      div.className = 'message ' + type;
      if (type === 'agent') {
        div.innerHTML = renderMarkdown(text);
      } else {
        div.textContent = text;
      }
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
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });

    window.addEventListener('message', function(event) {
      var msg = event.data;
      switch (msg.type) {
        case 'connected':
          statusDot.classList.remove('disconnected');
          addMessage('Connected to Prometheus', 'system');
          break;
        case 'taskCreated':
          addMessage('Task ' + msg.taskId + ' assigned. Agent is working...', 'system');
          break;
        case 'streamChunk':
          if (!currentStreamDiv) startStream();
          appendStream(msg.content);
          break;
        case 'streamEnd':
          endStream();
          break;
        case 'agentEvent':
          try {
            var data = JSON.parse(msg.data);
            if (data.message) {
              addMessage(data.message, 'agent');
            } else if (data.type) {
              addMessage('[' + msg.event + '] ' + data.type, 'system');
            }
          } catch (e) {
            addMessage(msg.data, 'agent');
          }
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
