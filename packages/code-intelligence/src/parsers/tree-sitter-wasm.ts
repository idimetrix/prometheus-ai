/**
 * Tree-sitter WASM parser for multi-language code parsing.
 *
 * Provides a unified interface for parsing source code across 25+ languages
 * using Tree-sitter compiled to WebAssembly.
 */

import { createLogger } from "@prometheus/logger";
import type { Language, Parser, Tree } from "web-tree-sitter";
import { FILE_EXTENSION_MAP, LANGUAGE_GRAMMAR_URLS } from "./language-grammars";

const logger = createLogger("code-intelligence:tree-sitter");

/**
 * All languages supported by the Tree-sitter parser.
 */
export type SupportedLanguage =
  | "typescript"
  | "tsx"
  | "javascript"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "c"
  | "cpp"
  | "ruby"
  | "php"
  | "swift"
  | "kotlin"
  | "scala"
  | "haskell"
  | "lua"
  | "bash"
  | "css"
  | "html"
  | "json"
  | "yaml"
  | "toml"
  | "sql"
  | "graphql"
  | "protobuf"
  | "dockerfile"
  | "markdown";

/**
 * Parsed tree result with metadata.
 */
export interface ParseResult {
  /** Whether the parse encountered errors (partial parse) */
  hasErrors: boolean;
  /** Language that was used for parsing */
  language: SupportedLanguage;
  /** Duration of the parse in milliseconds */
  parseTimeMs: number;
  /** The root tree-sitter tree node */
  tree: Tree;
}

/**
 * Multi-language parser backed by Tree-sitter WASM grammars.
 *
 * Lazily loads language grammars on first use and caches them for reuse.
 * Must call `init()` before parsing.
 *
 * @example
 * ```ts
 * const parser = new TreeSitterParser();
 * await parser.init();
 * const result = await parser.parse("const x = 1;", "typescript");
 * console.log(result.tree.rootNode.toString());
 * ```
 */
export class TreeSitterParser {
  private parser: Parser | null = null;
  private readonly languageCache = new Map<string, Language>();
  private initialized = false;
  private treeSitter: {
    Parser: new () => Parser;
    Language: typeof Language;
    init: () => Promise<void>;
  } | null = null;

  /**
   * Initialize the Tree-sitter WASM runtime.
   * Must be called once before any parsing operations.
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      const TreeSitter = await import("web-tree-sitter");
      const Module = TreeSitter.default ?? TreeSitter;

      await (Module as unknown as { init: () => Promise<void> }).init();

      const TSModule = Module as unknown as typeof TreeSitter;
      this.treeSitter = {
        Parser: TSModule.Parser as unknown as new () => Parser,
        Language: TSModule.Language as unknown as typeof Language,
        init: () => Promise.resolve(),
      };
      this.parser = new this.treeSitter.Parser();
      this.initialized = true;

      logger.info("Tree-sitter WASM runtime initialized");
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Unknown initialization error";
      logger.error({ error }, `Failed to initialize Tree-sitter: ${message}`);
      throw new Error(`Tree-sitter initialization failed: ${message}`);
    }
  }

  /**
   * Parse source code using the specified language grammar.
   *
   * @param code - The source code string to parse
   * @param language - The language to parse as
   * @returns Parsed tree result with metadata
   */
  async parse(code: string, language: SupportedLanguage): Promise<ParseResult> {
    if (!(this.parser && this.initialized)) {
      throw new Error(
        "TreeSitterParser not initialized. Call init() before parsing."
      );
    }

    const lang = await this.loadLanguage(language);
    this.parser.setLanguage(lang);

    const start = performance.now();
    const tree = this.parser.parse(code);
    const parseTimeMs = Math.round(performance.now() - start);

    if (!tree) {
      throw new Error(`Failed to parse ${language}: parser returned null`);
    }

    const hasErrors = tree.rootNode.hasError;

    if (hasErrors) {
      logger.warn(
        { language, parseTimeMs },
        `Parse completed with errors for ${language}`
      );
    } else {
      logger.debug(
        { language, parseTimeMs, nodeCount: tree.rootNode.descendantCount },
        `Parsed ${language} in ${parseTimeMs}ms`
      );
    }

    return { tree, language, hasErrors, parseTimeMs };
  }

  /**
   * Determine the appropriate language for a given file path based on its extension.
   *
   * @param filePath - The file path to inspect
   * @returns The detected language, or undefined if not recognized
   */
  static getLanguageForFile(filePath: string): SupportedLanguage | undefined {
    const fileName = filePath.split("/").pop() ?? filePath;

    // Handle special filenames without extensions
    const lowerName = fileName.toLowerCase();
    if (lowerName === "dockerfile" || lowerName.startsWith("dockerfile.")) {
      return "dockerfile";
    }

    const ext = fileName.includes(".")
      ? fileName.split(".").pop()?.toLowerCase()
      : undefined;

    if (!ext) {
      return undefined;
    }

    const language = FILE_EXTENSION_MAP[ext];
    return language as SupportedLanguage | undefined;
  }

  /**
   * Check whether a language is supported.
   */
  static isSupported(language: string): language is SupportedLanguage {
    return language in LANGUAGE_GRAMMAR_URLS;
  }

  /**
   * Release all loaded languages and the parser instance.
   */
  dispose(): void {
    if (this.parser) {
      this.parser.delete();
      this.parser = null;
    }
    this.languageCache.clear();
    this.initialized = false;
    logger.debug("Tree-sitter parser disposed");
  }

  /**
   * Load a language grammar, using cached version if available.
   */
  private async loadLanguage(language: SupportedLanguage): Promise<Language> {
    const cached = this.languageCache.get(language);
    if (cached) {
      return cached;
    }

    if (!this.treeSitter) {
      throw new Error("Tree-sitter module not loaded");
    }

    const grammarUrl = LANGUAGE_GRAMMAR_URLS[language];
    if (!grammarUrl) {
      throw new Error(`No grammar available for language: ${language}`);
    }

    try {
      logger.debug({ language, grammarUrl }, `Loading grammar for ${language}`);
      const Module = this.treeSitter;
      const lang = await Module.Language.load(grammarUrl);
      this.languageCache.set(language, lang);
      logger.info({ language }, `Grammar loaded for ${language}`);
      return lang;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Unknown grammar load error";
      logger.error(
        { language, error },
        `Failed to load grammar for ${language}: ${message}`
      );
      throw new Error(`Failed to load grammar for ${language}: ${message}`);
    }
  }
}
