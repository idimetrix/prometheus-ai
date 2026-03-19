import { createLogger } from "@prometheus/logger";
import { getLanguageForFile } from "./language-configs";
import { LspClient } from "./lsp-client";

const logger = createLogger("sandbox-manager:lsp-manager");

interface ManagedLsp {
  client: LspClient;
  language: string;
  lastUsed: number;
}

export class LspManager {
  private readonly servers = new Map<string, ManagedLsp>();
  private readonly workDir: string;

  constructor(workDir: string) {
    this.workDir = workDir;
  }

  async getOrStart(filePath: string): Promise<LspClient | null> {
    const config = getLanguageForFile(filePath);
    if (!config) {
      logger.debug({ filePath }, "No LSP server available for file");
      return null;
    }

    const existing = this.servers.get(config.language);
    if (existing?.client.isRunning) {
      existing.lastUsed = Date.now();
      return existing.client;
    }

    logger.info({ language: config.language }, "Starting LSP server");
    const client = new LspClient(config, this.workDir);
    await client.start();

    this.servers.set(config.language, {
      client,
      language: config.language,
      lastUsed: Date.now(),
    });

    return client;
  }

  async gotoDefinition(
    filePath: string,
    line: number,
    character: number
  ): Promise<unknown> {
    const client = await this.getOrStart(filePath);
    if (!client) {
      return null;
    }
    return client.sendRequest("textDocument/definition", {
      textDocument: { uri: `file://${filePath}` },
      position: { line, character },
    });
  }

  async findReferences(
    filePath: string,
    line: number,
    character: number
  ): Promise<unknown> {
    const client = await this.getOrStart(filePath);
    if (!client) {
      return null;
    }
    return client.sendRequest("textDocument/references", {
      textDocument: { uri: `file://${filePath}` },
      position: { line, character },
      context: { includeDeclaration: true },
    });
  }

  async hover(
    filePath: string,
    line: number,
    character: number
  ): Promise<unknown> {
    const client = await this.getOrStart(filePath);
    if (!client) {
      return null;
    }
    return client.sendRequest("textDocument/hover", {
      textDocument: { uri: `file://${filePath}` },
      position: { line, character },
    });
  }

  async diagnostics(filePath: string): Promise<unknown> {
    const client = await this.getOrStart(filePath);
    if (!client) {
      return null;
    }
    return client.sendRequest("textDocument/diagnostic", {
      textDocument: { uri: `file://${filePath}` },
    });
  }

  async completions(
    filePath: string,
    line: number,
    character: number
  ): Promise<unknown> {
    const client = await this.getOrStart(filePath);
    if (!client) {
      return null;
    }
    return client.sendRequest("textDocument/completion", {
      textDocument: { uri: `file://${filePath}` },
      position: { line, character },
    });
  }

  async stopAll(): Promise<void> {
    for (const [language, managed] of this.servers) {
      logger.info({ language }, "Stopping LSP server");
      await managed.client.stop();
    }
    this.servers.clear();
  }

  getRunningServers(): string[] {
    return [...this.servers.entries()]
      .filter(([, m]) => m.client.isRunning)
      .map(([lang]) => lang);
  }
}

export function createLspManager(workDir: string): LspManager {
  return new LspManager(workDir);
}
