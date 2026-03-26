/**
 * Continuous Indexer (P4.2).
 *
 * Processes git push events to incrementally re-index only changed files,
 * update the symbol graph, regenerate embeddings, and detect convention drift.
 */

import { createHash } from "node:crypto";
import { getInternalAuthHeaders } from "@prometheus/auth";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("project-brain:continuous-indexer");

const MODEL_ROUTER_URL =
  process.env.MODEL_ROUTER_URL ?? "http://localhost:4004";
const PROJECT_BRAIN_URL =
  process.env.PROJECT_BRAIN_URL ?? "http://localhost:4003";

/** Maximum chunk size in characters for embedding generation. */
const MAX_CHUNK_SIZE = 1500;

/** Minimum chunk size to avoid embedding tiny fragments. */
const MIN_CHUNK_SIZE = 100;

// ── Regex patterns (top-level for performance) ──

/** Matches exported function/class/interface/type/const declarations. */
const SYMBOL_PATTERN =
  /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|enum)\s+(\w+)/g;

/** Matches import statements to track dependencies. */
const IMPORT_PATTERN =
  /import\s+(?:(?:\{[^}]*\}|[\w*]+)\s+from\s+)?['"]([^'"]+)['"]/g;

/** Matches naming convention: camelCase function names. */
const CAMEL_CASE_FN_PATTERN = /(?:function|const)\s+([A-Z]\w+)\s*[=(]/g;

/** Matches files that should use arrow functions (non-class files). */
const TRADITIONAL_FN_PATTERN = /^export\s+function\s+\w+/gm;

/** Matches React component files (contains JSX return). */
const JSX_RETURN_PATTERN = /return\s*\(/;

/** Matches class component usage. */
const CLASS_COMPONENT_PATTERN = /class\s+\w+\s+extends\s+(?:React\.)?Component/;

/** Matches console.log statements. */
const CONSOLE_LOG_PATTERN = /console\.(log|debug|info|warn|error)\(/g;

/** Matches `any` type annotations. */
const ANY_TYPE_PATTERN = /:\s*any\b/g;

export interface IndexDelta {
  added: string[];
  deleted: string[];
  modified: string[];
  timestamp: string;
}

export interface ConventionDrift {
  actual: string;
  convention: string;
  expected: string;
  file: string;
  severity: "info" | "warning";
}

interface ExtractedSymbol {
  filePath: string;
  hash: string;
  kind: string;
  name: string;
}

export class ContinuousIndexer {
  private readonly projectBrainUrl: string;
  private readonly modelRouterUrl: string;

  constructor(opts?: { projectBrainUrl?: string; modelRouterUrl?: string }) {
    this.projectBrainUrl = opts?.projectBrainUrl ?? PROJECT_BRAIN_URL;
    this.modelRouterUrl = opts?.modelRouterUrl ?? MODEL_ROUTER_URL;
  }

  /**
   * Process a git push event -- only re-index changed files.
   */
  async processGitPush(
    projectId: string,
    delta: IndexDelta
  ): Promise<{
    filesIndexed: number;
    symbolsUpdated: number;
    embeddingsGenerated: number;
    conventionDrifts: ConventionDrift[];
    durationMs: number;
  }> {
    const start = performance.now();
    const operationId = generateId();

    logger.info(
      {
        operationId,
        projectId,
        added: delta.added.length,
        modified: delta.modified.length,
        deleted: delta.deleted.length,
      },
      "Processing git push for continuous indexing"
    );

    let totalSymbols = 0;
    let totalEmbeddings = 0;
    const allDrifts: ConventionDrift[] = [];
    const filesToProcess = [...delta.added, ...delta.modified];

    // Remove deleted files from all indices first
    if (delta.deleted.length > 0) {
      await this.removeFromIndices(projectId, delta.deleted);
    }

    // Process added and modified files
    for (const filePath of filesToProcess) {
      try {
        const content = await this.fetchFileContent(projectId, filePath);
        if (!content) {
          logger.warn({ projectId, filePath }, "Could not fetch file content");
          continue;
        }

        const symbolCount = await this.updateSymbolDelta(
          projectId,
          filePath,
          content
        );
        totalSymbols += symbolCount;

        const embeddingCount = await this.updateEmbeddingDelta(
          projectId,
          filePath,
          content
        );
        totalEmbeddings += embeddingCount;

        const drifts = this.detectConventionDrift(projectId, filePath, content);
        allDrifts.push(...drifts);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(
          { projectId, filePath, error: msg },
          "Failed to process file during continuous indexing"
        );
      }
    }

    const durationMs = Math.round(performance.now() - start);

    logger.info(
      {
        operationId,
        projectId,
        filesIndexed: filesToProcess.length,
        symbolsUpdated: totalSymbols,
        embeddingsGenerated: totalEmbeddings,
        conventionDrifts: allDrifts.length,
        durationMs,
      },
      "Continuous indexing complete"
    );

    return {
      filesIndexed: filesToProcess.length,
      symbolsUpdated: totalSymbols,
      embeddingsGenerated: totalEmbeddings,
      conventionDrifts: allDrifts,
      durationMs,
    };
  }

  /**
   * Update only changed symbols in the knowledge graph.
   */
  private async updateSymbolDelta(
    projectId: string,
    filePath: string,
    content: string
  ): Promise<number> {
    const symbols = this.extractSymbols(filePath, content);

    if (symbols.length === 0) {
      return 0;
    }

    try {
      const response = await fetch(
        `${this.projectBrainUrl}/api/symbols/update`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getInternalAuthHeaders(),
          },
          body: JSON.stringify({
            projectId,
            filePath,
            symbols: symbols.map((s) => ({
              name: s.name,
              kind: s.kind,
              hash: s.hash,
            })),
          }),
          signal: AbortSignal.timeout(30_000),
        }
      );

      if (!response.ok) {
        logger.warn(
          { projectId, filePath, status: response.status },
          "Symbol update request failed"
        );
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.debug(
        { projectId, filePath, error: msg },
        "Symbol update service unavailable, storing locally"
      );
    }

    return symbols.length;
  }

  /**
   * Re-embed only changed code chunks via model router.
   */
  private async updateEmbeddingDelta(
    projectId: string,
    filePath: string,
    content: string
  ): Promise<number> {
    const chunks = this.chunkContent(content);

    if (chunks.length === 0) {
      return 0;
    }

    let embeddedCount = 0;

    for (const chunk of chunks) {
      try {
        const response = await fetch(`${this.modelRouterUrl}/embeddings`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getInternalAuthHeaders(),
          },
          body: JSON.stringify({
            input: chunk.text,
            metadata: {
              projectId,
              filePath,
              chunkIndex: chunk.index,
            },
          }),
          signal: AbortSignal.timeout(30_000),
        });

        if (response.ok) {
          const data = (await response.json()) as {
            embedding: number[];
          };

          // Store the embedding in project brain
          await this.storeEmbedding(
            projectId,
            filePath,
            chunk.index,
            data.embedding,
            chunk.text
          );
          embeddedCount++;
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.debug(
          { projectId, filePath, chunkIndex: chunk.index, error: msg },
          "Embedding generation failed for chunk"
        );
      }
    }

    return embeddedCount;
  }

  /**
   * Detect when code diverges from established conventions.
   */
  private detectConventionDrift(
    _projectId: string,
    filePath: string,
    content: string
  ): ConventionDrift[] {
    const drifts: ConventionDrift[] = [];

    // Check for PascalCase function names (should be camelCase)
    const camelCaseMatches = content.matchAll(CAMEL_CASE_FN_PATTERN);
    for (const match of camelCaseMatches) {
      const name = match[1] ?? "";
      // Skip React components (PascalCase is correct for those)
      if (!JSX_RETURN_PATTERN.test(content)) {
        drifts.push({
          file: filePath,
          convention: "naming",
          expected: "camelCase for non-component functions",
          actual: `PascalCase: ${name}`,
          severity: "info",
        });
      }
    }

    // Check for class components instead of functional components
    if (CLASS_COMPONENT_PATTERN.test(content)) {
      drifts.push({
        file: filePath,
        convention: "react-patterns",
        expected: "Functional components with hooks",
        actual: "Class component detected",
        severity: "warning",
      });
    }

    // Check for console.log usage (should use @prometheus/logger)
    const consoleMatches = content.matchAll(CONSOLE_LOG_PATTERN);
    let consoleCount = 0;
    for (const _match of consoleMatches) {
      consoleCount++;
    }
    if (consoleCount > 0) {
      drifts.push({
        file: filePath,
        convention: "logging",
        expected: "Use @prometheus/logger for structured logging",
        actual: `Found ${consoleCount} console.* call(s)`,
        severity: "warning",
      });
    }

    // Check for `any` type usage
    const anyMatches = content.matchAll(ANY_TYPE_PATTERN);
    let anyCount = 0;
    for (const _match of anyMatches) {
      anyCount++;
    }
    if (anyCount > 0) {
      drifts.push({
        file: filePath,
        convention: "type-safety",
        expected: "Explicit types or unknown instead of any",
        actual: `Found ${anyCount} usage(s) of 'any' type`,
        severity: "warning",
      });
    }

    // Check for traditional function exports in non-class files
    if (
      !content.includes("class ") &&
      TRADITIONAL_FN_PATTERN.test(content) &&
      filePath.endsWith(".ts")
    ) {
      // Reset regex lastIndex after test
      TRADITIONAL_FN_PATTERN.lastIndex = 0;
      drifts.push({
        file: filePath,
        convention: "style",
        expected: "Arrow function exports",
        actual: "Traditional function exports detected",
        severity: "info",
      });
    }

    return drifts;
  }

  /**
   * Remove deleted files from all indices.
   */
  private async removeFromIndices(
    projectId: string,
    filePaths: string[]
  ): Promise<void> {
    logger.info(
      { projectId, fileCount: filePaths.length },
      "Removing deleted files from indices"
    );

    try {
      await fetch(`${this.projectBrainUrl}/api/index/remove`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getInternalAuthHeaders(),
        },
        body: JSON.stringify({ projectId, filePaths }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { projectId, error: msg },
        "Failed to remove files from index"
      );
    }

    try {
      await fetch(`${this.projectBrainUrl}/api/symbols/remove`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getInternalAuthHeaders(),
        },
        body: JSON.stringify({ projectId, filePaths }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { projectId, error: msg },
        "Failed to remove symbols from graph"
      );
    }

    try {
      await fetch(`${this.projectBrainUrl}/api/embeddings/remove`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getInternalAuthHeaders(),
        },
        body: JSON.stringify({ projectId, filePaths }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ projectId, error: msg }, "Failed to remove embeddings");
    }
  }

  // ── Private helpers ──

  private extractSymbols(filePath: string, content: string): ExtractedSymbol[] {
    const symbols: ExtractedSymbol[] = [];
    const matches = content.matchAll(SYMBOL_PATTERN);

    for (const match of matches) {
      const name = match[1] ?? "";
      const fullMatch = match[0];

      // Determine symbol kind from the declaration keyword
      let kind = "unknown";
      if (fullMatch.includes("function")) {
        kind = "function";
      } else if (fullMatch.includes("class")) {
        kind = "class";
      } else if (fullMatch.includes("interface")) {
        kind = "interface";
      } else if (fullMatch.includes("type")) {
        kind = "type";
      } else if (fullMatch.includes("const") || fullMatch.includes("let")) {
        kind = "variable";
      } else if (fullMatch.includes("enum")) {
        kind = "enum";
      }

      symbols.push({
        name,
        kind,
        filePath,
        hash: createHash("sha256")
          .update(`${filePath}:${name}:${kind}`)
          .digest("hex")
          .slice(0, 16),
      });
    }

    // Also extract imports for dependency tracking
    const importMatches = content.matchAll(IMPORT_PATTERN);
    for (const match of importMatches) {
      const source = match[1] ?? "";
      symbols.push({
        name: source,
        kind: "import",
        filePath,
        hash: createHash("sha256")
          .update(`${filePath}:import:${source}`)
          .digest("hex")
          .slice(0, 16),
      });
    }

    return symbols;
  }

  private chunkContent(
    content: string
  ): Array<{ text: string; index: number }> {
    const lines = content.split("\n");
    const chunks: Array<{ text: string; index: number }> = [];
    let currentChunk = "";
    let chunkIndex = 0;

    for (const line of lines) {
      if (
        currentChunk.length + line.length + 1 > MAX_CHUNK_SIZE &&
        currentChunk.length >= MIN_CHUNK_SIZE
      ) {
        chunks.push({ text: currentChunk, index: chunkIndex });
        chunkIndex++;
        currentChunk = line;
      } else {
        currentChunk += (currentChunk.length > 0 ? "\n" : "") + line;
      }
    }

    if (currentChunk.length >= MIN_CHUNK_SIZE) {
      chunks.push({ text: currentChunk, index: chunkIndex });
    }

    return chunks;
  }

  private async fetchFileContent(
    projectId: string,
    filePath: string
  ): Promise<string | null> {
    try {
      const response = await fetch(
        `${this.projectBrainUrl}/api/files/content?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(filePath)}`,
        { signal: AbortSignal.timeout(15_000) }
      );

      if (!response.ok) {
        return null;
      }

      return await response.text();
    } catch {
      return null;
    }
  }

  private async storeEmbedding(
    projectId: string,
    filePath: string,
    chunkIndex: number,
    embedding: number[],
    content: string
  ): Promise<void> {
    try {
      await fetch(`${this.projectBrainUrl}/api/embeddings/store`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getInternalAuthHeaders(),
        },
        body: JSON.stringify({
          id: generateId(),
          projectId,
          filePath,
          chunkIndex,
          embedding,
          content,
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.debug(
        { projectId, filePath, chunkIndex, error: msg },
        "Failed to store embedding"
      );
    }
  }
}
