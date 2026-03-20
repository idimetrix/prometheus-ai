/**
 * LSP Manager for sandboxed environments.
 *
 * Manages the lifecycle of Language Server Protocol servers within sandboxes,
 * supporting typescript-language-server, pyright, gopls, and rust-analyzer.
 * Communicates via JSON-RPC over stdin/stdout and handles graceful shutdown.
 */

import { createLogger } from "@prometheus/logger";
import { getLanguageForFile } from "./language-configs";
import { LspClient } from "./lsp-client";

const logger = createLogger("sandbox-manager:lsp-manager");

/** Idle timeout before automatically stopping an unused LSP server (ms). */
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Configuration for an LSP server process.
 */
export interface LSPServer {
  /** Additional command-line arguments */
  args: string[];
  /** Binary/command to execute */
  command: string;
  /** Language identifier (e.g., "typescript", "python") */
  language: string;
  /** Workspace root path for the server */
  rootPath: string;
}

/**
 * Typed definition result from an LSP server.
 */
export interface DefinitionResult {
  /** Column (0-indexed) */
  character: number;
  /** Line (0-indexed) */
  line: number;
  /** File URI */
  uri: string;
}

/**
 * Typed reference result from an LSP server.
 */
export interface ReferenceResult {
  /** Column (0-indexed) */
  character: number;
  /** Line (0-indexed) */
  line: number;
  /** File URI */
  uri: string;
}

/**
 * Diagnostic from an LSP server.
 */
export interface DiagnosticResult {
  /** End character (0-indexed) */
  endCharacter: number;
  /** End line (0-indexed) */
  endLine: number;
  /** Human-readable diagnostic message */
  message: string;
  /** Severity: 1=Error, 2=Warning, 3=Info, 4=Hint */
  severity: number;
  /** Diagnostic source (e.g., "typescript") */
  source: string;
  /** Start character (0-indexed) */
  startCharacter: number;
  /** Start line (0-indexed) */
  startLine: number;
}

/**
 * Completion item from an LSP server.
 */
export interface CompletionResult {
  /** Additional detail text */
  detail?: string;
  /** Completion item kind (1=Text, 2=Method, 3=Function, ...) */
  kind: number;
  /** Display label */
  label: string;
}

interface ManagedLsp {
  client: LspClient;
  idleTimer: ReturnType<typeof setTimeout> | null;
  language: string;
  lastUsed: number;
}

/**
 * LSP server configurations for supported languages.
 */
const LSP_CONFIGS: Record<string, Omit<LSPServer, "rootPath">> = {
  typescript: {
    language: "typescript",
    command: "typescript-language-server",
    args: ["--stdio"],
  },
  javascript: {
    language: "javascript",
    command: "typescript-language-server",
    args: ["--stdio"],
  },
  python: {
    language: "python",
    command: "pyright-langserver",
    args: ["--stdio"],
  },
  go: {
    language: "go",
    command: "gopls",
    args: ["serve"],
  },
  rust: {
    language: "rust",
    command: "rust-analyzer",
    args: [],
  },
};

/**
 * Manages LSP server lifecycle for sandboxed environments.
 *
 * Supports automatic start/stop, idle timeouts, and graceful shutdown.
 * Falls back to null results when no LSP server is available for a file type.
 */
export class LspManager {
  private readonly servers = new Map<string, ManagedLsp>();
  private readonly workDir: string;

  constructor(workDir: string) {
    this.workDir = workDir;
  }

  /**
   * Get or start an LSP server for a given file path.
   */
  async getOrStart(filePath: string): Promise<LspClient | null> {
    const config = getLanguageForFile(filePath);
    if (!config) {
      logger.debug({ filePath }, "No LSP server available for file");
      return null;
    }

    const existing = this.servers.get(config.language);
    if (existing?.client.isRunning) {
      existing.lastUsed = Date.now();
      this.resetIdleTimer(existing);
      return existing.client;
    }

    logger.info({ language: config.language }, "Starting LSP server");
    const client = new LspClient(config, this.workDir);
    await client.start();

    const managed: ManagedLsp = {
      client,
      language: config.language,
      lastUsed: Date.now(),
      idleTimer: null,
    };

    this.servers.set(config.language, managed);
    this.resetIdleTimer(managed);

    return client;
  }

  /**
   * Start an LSP server for a specific language and root path.
   */
  async startServer(language: string, rootPath: string): Promise<void> {
    const lspConfig = LSP_CONFIGS[language];
    if (!lspConfig) {
      throw new Error(`No LSP configuration for language: ${language}`);
    }

    const existing = this.servers.get(language);
    if (existing?.client.isRunning) {
      logger.debug({ language }, "LSP server already running");
      return;
    }

    const config = getLanguageForFile(
      `dummy.${language === "typescript" ? "ts" : language}`
    );
    if (!config) {
      throw new Error(`Cannot resolve language config for: ${language}`);
    }

    logger.info({ language, rootPath }, "Starting LSP server");
    const client = new LspClient(config, rootPath);
    await client.start();

    const managed: ManagedLsp = {
      client,
      language,
      lastUsed: Date.now(),
      idleTimer: null,
    };

    this.servers.set(language, managed);
    this.resetIdleTimer(managed);
  }

  /**
   * Stop an LSP server for a specific language.
   */
  async stopServer(language: string): Promise<void> {
    const managed = this.servers.get(language);
    if (!managed) {
      logger.debug({ language }, "No LSP server to stop");
      return;
    }

    if (managed.idleTimer) {
      clearTimeout(managed.idleTimer);
    }

    logger.info({ language }, "Stopping LSP server");
    await managed.client.stop();
    this.servers.delete(language);
  }

  /**
   * Go to definition at a position in a file.
   */
  async getDefinition(
    filePath: string,
    line: number,
    col: number
  ): Promise<DefinitionResult | null> {
    const client = await this.getOrStart(filePath);
    if (!client) {
      return null;
    }

    const result = await client.sendRequest("textDocument/definition", {
      textDocument: { uri: `file://${filePath}` },
      position: { line, character: col },
    });

    if (!result) {
      return null;
    }

    // LSP may return a single location or an array
    const loc = Array.isArray(result) ? result[0] : result;
    if (!loc || typeof loc !== "object") {
      return null;
    }

    const location = loc as {
      uri?: string;
      range?: { start?: { line?: number; character?: number } };
    };

    return {
      uri: location.uri ?? "",
      line: location.range?.start?.line ?? 0,
      character: location.range?.start?.character ?? 0,
    };
  }

  /**
   * Find all references to a symbol at a position.
   */
  async getReferences(
    filePath: string,
    line: number,
    col: number
  ): Promise<ReferenceResult[]> {
    const client = await this.getOrStart(filePath);
    if (!client) {
      return [];
    }

    const result = await client.sendRequest("textDocument/references", {
      textDocument: { uri: `file://${filePath}` },
      position: { line, character: col },
      context: { includeDeclaration: true },
    });

    if (!Array.isArray(result)) {
      return [];
    }

    return result.map((loc: unknown) => {
      const location = loc as {
        uri?: string;
        range?: { start?: { line?: number; character?: number } };
      };
      return {
        uri: location.uri ?? "",
        line: location.range?.start?.line ?? 0,
        character: location.range?.start?.character ?? 0,
      };
    });
  }

  /**
   * Get diagnostics for a file.
   */
  async getDiagnostics(filePath: string): Promise<DiagnosticResult[]> {
    const client = await this.getOrStart(filePath);
    if (!client) {
      return [];
    }

    const result = await client.sendRequest("textDocument/diagnostic", {
      textDocument: { uri: `file://${filePath}` },
    });

    if (!result || typeof result !== "object") {
      return [];
    }

    const response = result as {
      items?: Array<{
        message?: string;
        severity?: number;
        source?: string;
        range?: {
          start?: { line?: number; character?: number };
          end?: { line?: number; character?: number };
        };
      }>;
    };

    return (response.items ?? []).map((item) => ({
      message: item.message ?? "",
      severity: item.severity ?? 1,
      source: item.source ?? "",
      startLine: item.range?.start?.line ?? 0,
      startCharacter: item.range?.start?.character ?? 0,
      endLine: item.range?.end?.line ?? 0,
      endCharacter: item.range?.end?.character ?? 0,
    }));
  }

  /**
   * Get completions at a position.
   */
  async getCompletions(
    filePath: string,
    line: number,
    col: number
  ): Promise<CompletionResult[]> {
    const client = await this.getOrStart(filePath);
    if (!client) {
      return [];
    }

    const result = await client.sendRequest("textDocument/completion", {
      textDocument: { uri: `file://${filePath}` },
      position: { line, character: col },
    });

    if (!result) {
      return [];
    }

    // LSP may return CompletionList or CompletionItem[]
    const items = Array.isArray(result)
      ? result
      : ((result as { items?: unknown[] }).items ?? []);

    return items.map((item: unknown) => {
      const completion = item as {
        label?: string;
        kind?: number;
        detail?: string;
      };
      return {
        label: completion.label ?? "",
        kind: completion.kind ?? 1,
        detail: completion.detail,
      };
    });
  }

  /**
   * Hover information at a position.
   */
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

  /**
   * Stop all running LSP servers gracefully.
   */
  async stopAll(): Promise<void> {
    const stopPromises: Promise<void>[] = [];

    for (const [language, managed] of this.servers) {
      logger.info({ language }, "Stopping LSP server");
      if (managed.idleTimer) {
        clearTimeout(managed.idleTimer);
      }
      stopPromises.push(managed.client.stop());
    }

    await Promise.allSettled(stopPromises);
    this.servers.clear();
  }

  /**
   * Get a list of currently running LSP server languages.
   */
  getRunningServers(): string[] {
    return [...this.servers.entries()]
      .filter(([, m]) => m.client.isRunning)
      .map(([lang]) => lang);
  }

  /**
   * Get available LSP server configurations.
   */
  static getAvailableServers(): LSPServer[] {
    return Object.values(LSP_CONFIGS).map((config) => ({
      ...config,
      rootPath: "",
    }));
  }

  /**
   * Reset the idle timer for a managed LSP server.
   * Server is stopped automatically after IDLE_TIMEOUT_MS of inactivity.
   */
  private resetIdleTimer(managed: ManagedLsp): void {
    if (managed.idleTimer) {
      clearTimeout(managed.idleTimer);
    }

    managed.idleTimer = setTimeout(() => {
      logger.info({ language: managed.language }, "Stopping idle LSP server");
      managed.client.stop().catch((error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(
          { language: managed.language, error: msg },
          "Error stopping idle LSP server"
        );
      });
      this.servers.delete(managed.language);
    }, IDLE_TIMEOUT_MS);
  }
}

/**
 * Factory function to create an LSP manager for a workspace directory.
 */
export function createLspManager(workDir: string): LspManager {
  return new LspManager(workDir);
}
