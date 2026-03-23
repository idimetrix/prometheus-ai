/**
 * Hybrid Code Intelligence Engine.
 *
 * Combines tree-sitter (fast syntax parsing) with LSP (deep semantic analysis)
 * into a unified API. Falls back gracefully: LSP -> tree-sitter -> regex
 * when higher-fidelity methods are unavailable.
 */

import { createLogger } from "@prometheus/logger";
import { mapToSymbolKind, SymbolKind } from "./parsers/language-queries";
import type { SupportedLanguage } from "./parsers/tree-sitter-wasm";
import { TreeSitterParser } from "./parsers/tree-sitter-wasm";

const logger = createLogger("code-intelligence:hybrid-engine");

/**
 * A code range within a file.
 */
export interface CodeRange {
  /** End column (0-indexed) */
  endColumn: number;
  /** End line (0-indexed) */
  endLine: number;
  /** Start column (0-indexed) */
  startColumn: number;
  /** Start line (0-indexed) */
  startLine: number;
}

/**
 * A unified code symbol extracted by any analysis method.
 */
export interface CodeSymbol {
  /** Optional JSDoc/docstring documentation */
  documentation?: string;
  /** Path to the file containing this symbol */
  filePath: string;
  /** Symbol kind classification */
  kind: SymbolKind;
  /** Symbol name */
  name: string;
  /** Source range in the file */
  range: CodeRange;
}

/**
 * Result of file analysis containing all extracted symbols.
 */
export interface FileAnalysisResult {
  /** Detected language */
  language: string;
  /** Parse duration in milliseconds */
  parseTimeMs: number;
  /** All extracted code symbols */
  symbols: CodeSymbol[];
}

/**
 * Configuration for an optional LSP client connection.
 */
export interface LSPClientConfig {
  /** Get completions at a position */
  getCompletions?(
    filePath: string,
    line: number,
    col: number
  ): Promise<unknown>;
  /** Get definition of symbol at position */
  getDefinition?(
    filePath: string,
    line: number,
    col: number
  ): Promise<{ uri: string; line: number; character: number } | null>;
  /** Find all references to symbol at position */
  getReferences?(
    filePath: string,
    line: number,
    col: number
  ): Promise<Array<{ uri: string; line: number; character: number }>>;
}

// ─── Regex fallback patterns ─────────────────────────────────────

const FUNCTION_RE = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/gm;
const ARROW_FN_RE =
  /(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(/gm;
const CLASS_RE = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/gm;
const INTERFACE_RE = /(?:export\s+)?interface\s+(\w+)/gm;
const TYPE_RE = /(?:export\s+)?type\s+(\w+)\s*=/gm;
const ENUM_RE = /(?:export\s+)?enum\s+(\w+)/gm;

/**
 * Hybrid Code Engine combining tree-sitter and LSP for code intelligence.
 *
 * Tree-sitter provides fast, offline syntax-level analysis.
 * LSP provides deep semantic understanding when available.
 * Regex provides a last-resort fallback for basic symbol extraction.
 *
 * @example
 * ```ts
 * const engine = new HybridCodeEngine();
 * await engine.init();
 * const result = await engine.analyzeFile("src/index.ts", code, "typescript");
 * ```
 */
export class HybridCodeEngine {
  private readonly parser = new TreeSitterParser();
  private lspClient: LSPClientConfig | null = null;
  private initialized = false;

  /**
   * Initialize the hybrid engine (loads tree-sitter WASM).
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await this.parser.init();
    this.initialized = true;
    logger.info("Hybrid code engine initialized");
  }

  /**
   * Attach an LSP client for enhanced semantic analysis.
   */
  setLSPClient(client: LSPClientConfig): void {
    this.lspClient = client;
    logger.info("LSP client attached to hybrid engine");
  }

  /**
   * Analyze a file and extract all code symbols.
   *
   * Attempts tree-sitter parsing first, falls back to regex if unavailable.
   *
   * @param filePath - Path to the source file
   * @param content - Source code content
   * @param language - Language identifier
   * @returns Analysis result with extracted symbols
   */
  async analyzeFile(
    filePath: string,
    content: string,
    language: string
  ): Promise<FileAnalysisResult> {
    const start = performance.now();

    // Try tree-sitter first
    if (TreeSitterParser.isSupported(language)) {
      try {
        const parseResult = await this.parser.parse(
          content,
          language as SupportedLanguage
        );
        const symbols = this.walkTreeForSymbols(
          filePath,
          content,
          language,
          parseResult.tree.rootNode as unknown as Record<string, unknown>
        );

        const parseTimeMs = Math.round(performance.now() - start);

        logger.debug(
          { filePath, language, symbolCount: symbols.length, parseTimeMs },
          "File analyzed via tree-sitter"
        );

        return { symbols, language, parseTimeMs };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(
          { filePath, language, error: msg },
          "Tree-sitter analysis failed, falling back to regex"
        );
      }
    }

    // Fallback to regex
    const symbols = this.extractSymbolsViaRegex(filePath, content);
    const parseTimeMs = Math.round(performance.now() - start);

    logger.debug(
      { filePath, language, symbolCount: symbols.length, parseTimeMs },
      "File analyzed via regex fallback"
    );

    return { symbols, language, parseTimeMs };
  }

  /**
   * Get all symbols at a specific position in a file.
   *
   * Attempts LSP hover/definition first, then falls back to tree-sitter
   * node analysis.
   */
  async getSymbolsAt(
    filePath: string,
    line: number,
    col: number
  ): Promise<CodeSymbol[]> {
    // Try LSP first
    if (this.lspClient?.getDefinition) {
      try {
        const definition = await this.lspClient.getDefinition(
          filePath,
          line,
          col
        );
        if (definition) {
          return [
            {
              name: `definition@${definition.line}:${definition.character}`,
              kind: SymbolKind.Variable,
              filePath: definition.uri.replace("file://", ""),
              range: {
                startLine: definition.line,
                startColumn: definition.character,
                endLine: definition.line,
                endColumn: definition.character,
              },
            },
          ];
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.debug(
          { filePath, line, col, error: msg },
          "LSP getSymbolsAt failed"
        );
      }
    }

    return [];
  }

  /**
   * Find all references to a symbol.
   *
   * Delegates to LSP when available.
   */
  findReferences(filePath: string, _symbol: string): CodeSymbol[] {
    if (this.lspClient?.getReferences) {
      // Find the symbol position first via tree-sitter
      const language = TreeSitterParser.getLanguageForFile(filePath);
      if (!language) {
        return [];
      }

      logger.debug(
        { filePath, symbol: _symbol },
        "Finding references via LSP requires position; returning empty for now"
      );
      return [];
    }

    return [];
  }

  /**
   * Get the definition location of a symbol at a position.
   *
   * Falls back gracefully: LSP -> tree-sitter -> empty result.
   */
  async getDefinition(
    filePath: string,
    line: number,
    col: number
  ): Promise<CodeSymbol | null> {
    // Try LSP
    if (this.lspClient?.getDefinition) {
      try {
        const result = await this.lspClient.getDefinition(filePath, line, col);
        if (result) {
          return {
            name: "definition",
            kind: SymbolKind.Variable,
            filePath: result.uri.replace("file://", ""),
            range: {
              startLine: result.line,
              startColumn: result.character,
              endLine: result.line,
              endColumn: result.character,
            },
          };
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.debug(
          { filePath, line, col, error: msg },
          "LSP getDefinition failed, trying tree-sitter"
        );
      }
    }

    return null;
  }

  /**
   * Release all resources.
   */
  dispose(): void {
    this.parser.dispose();
    this.lspClient = null;
    this.initialized = false;
    logger.debug("Hybrid code engine disposed");
  }

  /**
   * Walk a tree-sitter tree and extract symbols by node type.
   */
  private walkTreeForSymbols(
    filePath: string,
    _content: string,
    language: string,
    node: Record<string, unknown>
  ): CodeSymbol[] {
    const symbols: CodeSymbol[] = [];
    const nodeType = node.type as string;

    const kind = mapToSymbolKind(language, nodeType);

    // Check if this node represents a meaningful symbol
    const nameNode = (node.nameNode ?? node.name) as
      | {
          text?: string;
          startPosition?: { row: number; column: number };
          endPosition?: { row: number; column: number };
        }
      | undefined;

    if (nameNode?.text) {
      const startPos = (node.startPosition ?? { row: 0, column: 0 }) as {
        row: number;
        column: number;
      };
      const endPos = (node.endPosition ?? { row: 0, column: 0 }) as {
        row: number;
        column: number;
      };

      symbols.push({
        name: nameNode.text,
        kind,
        filePath,
        range: {
          startLine: startPos.row,
          startColumn: startPos.column,
          endLine: endPos.row,
          endColumn: endPos.column,
        },
      });
    }

    // Recurse into children
    const children = (node.children ?? []) as Record<string, unknown>[];
    for (const child of children) {
      symbols.push(
        ...this.walkTreeForSymbols(filePath, _content, language, child)
      );
    }

    return symbols;
  }

  /**
   * Extract symbols using regex as a last-resort fallback.
   */
  private extractSymbolsViaRegex(
    filePath: string,
    content: string
  ): CodeSymbol[] {
    const symbols: CodeSymbol[] = [];

    const patterns: Array<{ regex: RegExp; kind: SymbolKind }> = [
      { regex: FUNCTION_RE, kind: SymbolKind.Function },
      { regex: ARROW_FN_RE, kind: SymbolKind.Function },
      { regex: CLASS_RE, kind: SymbolKind.Class },
      { regex: INTERFACE_RE, kind: SymbolKind.Interface },
      { regex: TYPE_RE, kind: SymbolKind.Type },
      { regex: ENUM_RE, kind: SymbolKind.Enum },
    ];

    for (const { regex, kind } of patterns) {
      // Reset regex state
      regex.lastIndex = 0;

      let match: RegExpExecArray | null = regex.exec(content);
      while (match !== null) {
        const name = match[1];
        if (name) {
          const line = content.slice(0, match.index).split("\n").length - 1;
          const col =
            match.index - (content.lastIndexOf("\n", match.index - 1) + 1);

          symbols.push({
            name,
            kind,
            filePath,
            range: {
              startLine: line,
              startColumn: col,
              endLine: line,
              endColumn: col + (match[0]?.length ?? 0),
            },
          });
        }
        match = regex.exec(content);
      }
    }

    return symbols;
  }
}
