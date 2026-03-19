import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { createLogger } from "@prometheus/logger";
import type { LanguageServerConfig } from "./language-configs";

const logger = createLogger("sandbox-manager:lsp-client");
const CONTENT_LENGTH_RE = /Content-Length:\s*(\d+)/i;

interface LspRequest {
  id: number;
  method: string;
  params: unknown;
}

interface LspResponse {
  error?: { code: number; message: string };
  id: number;
  result?: unknown;
}

export class LspClient {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private readonly pendingRequests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private buffer = "";
  private readonly config: LanguageServerConfig;
  private readonly workDir: string;

  constructor(config: LanguageServerConfig, workDir: string) {
    this.config = config;
    this.workDir = workDir;
  }

  async start(): Promise<void> {
    // spawn is used intentionally here - args are from static config, not user input
    this.process = spawn(this.config.command, this.config.args, {
      cwd: this.workDir,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.stdout?.on("data", (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      logger.debug({ stderr: data.toString() }, "LSP stderr");
    });

    this.process.on("exit", (code) => {
      logger.info(
        { code, language: this.config.language },
        "LSP server exited"
      );
      for (const [, pending] of this.pendingRequests) {
        pending.reject(new Error("LSP server exited"));
      }
      this.pendingRequests.clear();
    });

    await this.sendRequest("initialize", {
      processId: process.pid,
      capabilities: {
        textDocument: {
          completion: { completionItem: { snippetSupport: true } },
          hover: { contentFormat: ["markdown", "plaintext"] },
          definition: { linkSupport: true },
          references: {},
          publishDiagnostics: {},
        },
        workspace: { workspaceFolders: true },
      },
      rootUri: `file://${this.workDir}`,
      workspaceFolders: [{ uri: `file://${this.workDir}`, name: "workspace" }],
      initializationOptions: this.config.initializationOptions,
    });

    this.sendNotification("initialized", {});
  }

  sendRequest(method: string, params: unknown): Promise<unknown> {
    const id = ++this.requestId;
    const request: LspRequest = { id, method, params };
    const content = JSON.stringify({ jsonrpc: "2.0", ...request });
    const message = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n${content}`;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.process?.stdin?.write(message);

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`LSP request timeout: ${method}`));
        }
      }, 30_000);
    });
  }

  sendNotification(method: string, params: unknown): void {
    const content = JSON.stringify({ jsonrpc: "2.0", method, params });
    const message = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n${content}`;
    this.process?.stdin?.write(message);
  }

  private processBuffer(): void {
    const headerEnd = this.buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      return;
    }

    const header = this.buffer.slice(0, headerEnd);
    const match = CONTENT_LENGTH_RE.exec(header);
    if (!match?.[1]) {
      return;
    }

    const contentLength = Number.parseInt(match[1], 10);
    const contentStart = headerEnd + 4;
    if (this.buffer.length < contentStart + contentLength) {
      return;
    }

    const content = this.buffer.slice(
      contentStart,
      contentStart + contentLength
    );
    this.buffer = this.buffer.slice(contentStart + contentLength);

    try {
      const response = JSON.parse(content) as LspResponse;
      if (response.id !== undefined) {
        const pending = this.pendingRequests.get(response.id);
        if (pending) {
          this.pendingRequests.delete(response.id);
          if (response.error) {
            pending.reject(new Error(`LSP error: ${response.error.message}`));
          } else {
            pending.resolve(response.result);
          }
        }
      }
    } catch {
      logger.warn("Failed to parse LSP response");
    }

    if (this.buffer.includes("Content-Length:")) {
      this.processBuffer();
    }
  }

  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }
    try {
      await this.sendRequest("shutdown", null);
      this.sendNotification("exit", null);
    } catch {
      // best effort
    }
    this.process.kill();
    this.process = null;
  }

  get isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }
}
