/**
 * Code context selector for intelligent context retrieval.
 *
 * Given a file path and symbol name, retrieves relevant context
 * including callers, callees, tests, and related definitions
 * by integrating with the cross-file resolver.
 */

import { createLogger } from "@prometheus/logger";
import type {
  CrossFileResolver,
  ExportedSymbol,
  ImportedSymbol,
} from "../extractors/cross-file-resolver";

const logger = createLogger("code-intelligence:context-selector");

// Top-level regex patterns for file path parsing
const EXT_REGEX = /\.[^.]+$/;
const DIR_REGEX = /\/[^/]+$/;
const BASENAME_REGEX = /^.*\//;

/**
 * A prioritized chunk of context to provide to an AI model.
 */
export interface ContextChunk {
  /** Source code content */
  content: string;
  /** The file this context comes from */
  filePath: string;
  /** Priority score (higher = more relevant, 0-100) */
  priority: number;
  /** Why this context is relevant */
  reason: string;
  /** Approximate token count (words / 0.75) */
  tokenEstimate: number;
}

/**
 * Result of a context selection operation.
 */
export interface ContextSelectionResult {
  /** Ordered list of context chunks, highest priority first */
  chunks: ContextChunk[];
  /** Total estimated tokens across all chunks */
  totalTokens: number;
  /** Whether the result was truncated to fit maxTokens */
  truncated: boolean;
}

/**
 * Estimate token count for a string (rough approximation: 1 token ~ 4 chars).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Code context selector that assembles relevant context for a given symbol.
 *
 * Integrates with the CrossFileResolver to find:
 * - The symbol's own definition
 * - Files that import/consume the symbol (callers)
 * - Symbols imported by the defining file (callees/dependencies)
 * - Related test files
 *
 * @example
 * ```ts
 * const resolver = new CrossFileResolver();
 * // ... register imports/exports ...
 *
 * const selector = new CodeContextSelector(resolver);
 *
 * const readFile = async (path: string) => fs.readFileSync(path, "utf-8");
 *
 * const result = await selector.getRelevantContext(
 *   "src/utils.ts",
 *   "formatDate",
 *   4000,
 *   readFile,
 * );
 *
 * for (const chunk of result.chunks) {
 *   console.log(`[${chunk.priority}] ${chunk.filePath}: ${chunk.reason}`);
 * }
 * ```
 */
export class CodeContextSelector {
  private readonly resolver: CrossFileResolver;

  constructor(resolver: CrossFileResolver) {
    this.resolver = resolver;
  }

  /**
   * Get relevant context for a symbol in a file.
   *
   * Gathers context from multiple sources and returns prioritized chunks
   * that fit within the specified token budget.
   *
   * @param filePath - The file containing or referencing the symbol
   * @param symbolName - The symbol to gather context for
   * @param maxTokens - Maximum total tokens across all context chunks
   * @param readFile - Function to read file content by path
   * @returns Prioritized context chunks fitting within the token budget
   */
  async getRelevantContext(
    filePath: string,
    symbolName: string,
    maxTokens: number,
    readFile: (path: string) => Promise<string> | string
  ): Promise<ContextSelectionResult> {
    const chunks: ContextChunk[] = [];

    // 1. Find the symbol's definition
    const resolved = this.resolver.resolveSymbol(symbolName, filePath);
    if (resolved) {
      const defContent = await this.safeReadFile(
        resolved.definition.filePath,
        readFile
      );
      if (defContent) {
        chunks.push({
          filePath: resolved.definition.filePath,
          content: defContent,
          priority: 100,
          reason: `Definition of "${symbolName}"`,
          tokenEstimate: estimateTokens(defContent),
        });
      }
    }

    // 2. Get exports from the current file (callees / dependencies)
    const fileExports = this.resolver.getExportsForFile(filePath);
    const fileImports = this.resolver.getImportsForFile(filePath);

    // 3. Add imported dependencies context
    await this.addDependencyContext(chunks, fileImports, symbolName, readFile);

    // 4. Find consumers (callers)
    const consumers = this.resolver.findConsumers(symbolName);
    await this.addConsumerContext(chunks, consumers, symbolName, readFile);

    // 5. Find related test files
    await this.addTestContext(
      chunks,
      filePath,
      symbolName,
      fileExports,
      readFile
    );

    // Sort by priority (highest first)
    chunks.sort((a, b) => b.priority - a.priority);

    // Trim to fit token budget
    return this.trimToTokenBudget(chunks, maxTokens);
  }

  /**
   * Add context from imported dependencies.
   */
  private async addDependencyContext(
    chunks: ContextChunk[],
    imports: ImportedSymbol[],
    symbolName: string,
    readFile: (path: string) => Promise<string> | string
  ): Promise<void> {
    // Prioritize imports that are likely related to the target symbol
    const DEPENDENCY_PRIORITY = 60;
    const MAX_DEPENDENCIES = 5;
    let count = 0;

    for (const imp of imports) {
      if (count >= MAX_DEPENDENCIES) {
        break;
      }

      // Resolve the import to find the defining file
      const resolved = this.resolver.resolveSymbol(
        imp.importedName,
        imp.filePath
      );
      if (!resolved) {
        continue;
      }

      const content = await this.safeReadFile(
        resolved.definition.filePath,
        readFile
      );
      if (!content) {
        continue;
      }

      // Higher priority if the import name is related to the target symbol
      const isDirectlyRelated =
        imp.importedName.toLowerCase().includes(symbolName.toLowerCase()) ||
        symbolName.toLowerCase().includes(imp.importedName.toLowerCase());

      const priority = isDirectlyRelated
        ? DEPENDENCY_PRIORITY + 15
        : DEPENDENCY_PRIORITY;

      chunks.push({
        filePath: resolved.definition.filePath,
        content,
        priority,
        reason: `Dependency "${imp.importedName}" imported by the file`,
        tokenEstimate: estimateTokens(content),
      });

      count++;
    }
  }

  /**
   * Add context from files that consume (import) the target symbol.
   */
  private async addConsumerContext(
    chunks: ContextChunk[],
    consumers: string[],
    symbolName: string,
    readFile: (path: string) => Promise<string> | string
  ): Promise<void> {
    const CONSUMER_PRIORITY = 50;
    const MAX_CONSUMERS = 3;
    let count = 0;

    for (const consumerFile of consumers) {
      if (count >= MAX_CONSUMERS) {
        break;
      }

      const content = await this.safeReadFile(consumerFile, readFile);
      if (!content) {
        continue;
      }

      chunks.push({
        filePath: consumerFile,
        content,
        priority: CONSUMER_PRIORITY,
        reason: `Imports and uses "${symbolName}"`,
        tokenEstimate: estimateTokens(content),
      });

      count++;
    }
  }

  /**
   * Add context from related test files.
   */
  private async addTestContext(
    chunks: ContextChunk[],
    filePath: string,
    symbolName: string,
    _exports: ExportedSymbol[],
    readFile: (path: string) => Promise<string> | string
  ): Promise<void> {
    const TEST_PRIORITY = 70;

    // Infer test file paths from the source file
    const testPaths = this.inferTestFilePaths(filePath);

    for (const testPath of testPaths) {
      const content = await this.safeReadFile(testPath, readFile);
      if (!content) {
        continue;
      }

      // Check if the test file actually references the symbol
      if (content.includes(symbolName)) {
        chunks.push({
          filePath: testPath,
          content,
          priority: TEST_PRIORITY,
          reason: `Test file referencing "${symbolName}"`,
          tokenEstimate: estimateTokens(content),
        });
      }
    }
  }

  /**
   * Infer possible test file paths for a given source file.
   */
  private inferTestFilePaths(filePath: string): string[] {
    const paths: string[] = [];

    // Common test file naming patterns
    const withoutExt = filePath.replace(EXT_REGEX, "");
    const ext = filePath.match(EXT_REGEX)?.[0] ?? ".ts";
    const dir = filePath.replace(DIR_REGEX, "");
    const baseName = filePath
      .replace(BASENAME_REGEX, "")
      .replace(EXT_REGEX, "");

    paths.push(`${withoutExt}.test${ext}`);
    paths.push(`${withoutExt}.spec${ext}`);
    paths.push(`${dir}/__tests__/${baseName}.test${ext}`);
    paths.push(`${dir}/__tests__/${baseName}.spec${ext}`);

    return paths;
  }

  /**
   * Read a file, returning null on error instead of throwing.
   */
  private async safeReadFile(
    filePath: string,
    readFile: (path: string) => Promise<string> | string
  ): Promise<string | null> {
    try {
      return await readFile(filePath);
    } catch {
      logger.debug({ filePath }, "Could not read file for context");
      return null;
    }
  }

  /**
   * Trim chunks to fit within a token budget.
   */
  private trimToTokenBudget(
    chunks: ContextChunk[],
    maxTokens: number
  ): ContextSelectionResult {
    const result: ContextChunk[] = [];
    let totalTokens = 0;
    let truncated = false;

    for (const chunk of chunks) {
      if (totalTokens + chunk.tokenEstimate > maxTokens) {
        truncated = true;
        // Try to include a truncated version if there's room
        const remainingTokens = maxTokens - totalTokens;
        if (remainingTokens > 100) {
          const truncatedContent = chunk.content.slice(0, remainingTokens * 4);
          result.push({
            ...chunk,
            content: truncatedContent,
            tokenEstimate: estimateTokens(truncatedContent),
          });
          totalTokens += estimateTokens(truncatedContent);
        }
        break;
      }

      result.push(chunk);
      totalTokens += chunk.tokenEstimate;
    }

    return { chunks: result, totalTokens, truncated };
  }
}
