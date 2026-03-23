/**
 * Progressive Context Loading
 *
 * Loads context on demand at increasing levels of detail:
 * overview -> file details -> symbol expansion.
 * Caches loaded context for reuse within a session.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:progressive-loader");

const BRAIN_BASE_URL = process.env.PROJECT_BRAIN_URL ?? "http://localhost:4003";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectOverview {
  description: string;
  fileCount: number;
  frameworks: string[];
  languages: string[];
  projectId: string;
  structure: string;
}

export interface FileDetail {
  content: string;
  exports: string[];
  filePath: string;
  imports: string[];
  language: string;
  tokenEstimate: number;
}

export interface SymbolExpansion {
  definition: string;
  definitionFile: string;
  symbolName: string;
  usages: Array<{ filePath: string; line: string }>;
}

type ContextDepth = "overview" | "file" | "symbol";

// ---------------------------------------------------------------------------
// ProgressiveContextLoader
// ---------------------------------------------------------------------------

export class ProgressiveContextLoader {
  private readonly overviewCache = new Map<string, ProjectOverview>();
  private readonly fileCache = new Map<string, FileDetail>();
  private readonly symbolCache = new Map<string, SymbolExpansion>();
  private currentDepth: ContextDepth = "overview";

  /**
   * Load a high-level project summary.
   */
  async loadOverview(projectId: string): Promise<ProjectOverview> {
    const cached = this.overviewCache.get(projectId);
    if (cached) {
      logger.debug({ projectId }, "Overview cache hit");
      return cached;
    }

    this.currentDepth = "overview";

    try {
      const response = await fetch(
        `${BRAIN_BASE_URL}/analysis/${projectId}/summary`,
        {
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(15_000),
        }
      );

      if (!response.ok) {
        throw new Error(`Project Brain returned ${response.status}`);
      }

      const data = (await response.json()) as ProjectOverview;
      this.overviewCache.set(projectId, data);

      logger.info(
        {
          projectId,
          languages: data.languages,
          fileCount: data.fileCount,
        },
        "Project overview loaded"
      );

      return data;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(
        { error: msg, projectId },
        "Failed to load project overview, using fallback"
      );

      const fallback: ProjectOverview = {
        projectId,
        description: "Project overview unavailable",
        languages: [],
        frameworks: [],
        fileCount: 0,
        structure: "",
      };
      this.overviewCache.set(projectId, fallback);
      return fallback;
    }
  }

  /**
   * Load file details on demand.
   */
  async drillDown(filePath: string): Promise<FileDetail> {
    const cached = this.fileCache.get(filePath);
    if (cached) {
      logger.debug({ filePath }, "File detail cache hit");
      return cached;
    }

    this.currentDepth = "file";

    try {
      const encodedPath = encodeURIComponent(filePath);
      const response = await fetch(
        `${BRAIN_BASE_URL}/files/detail?path=${encodedPath}`,
        {
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(10_000),
        }
      );

      if (!response.ok) {
        throw new Error(`Project Brain returned ${response.status}`);
      }

      const data = (await response.json()) as FileDetail;
      data.tokenEstimate = Math.ceil(data.content.length / 4);
      this.fileCache.set(filePath, data);

      logger.debug(
        {
          filePath,
          tokens: data.tokenEstimate,
          exports: data.exports.length,
        },
        "File detail loaded"
      );

      return data;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ error: msg, filePath }, "Failed to load file detail");

      const fallback: FileDetail = {
        filePath,
        content: "",
        language: "",
        imports: [],
        exports: [],
        tokenEstimate: 0,
      };
      this.fileCache.set(filePath, fallback);
      return fallback;
    }
  }

  /**
   * Expand a symbol to show its definition and usages.
   */
  async expandSymbol(symbolName: string): Promise<SymbolExpansion> {
    const cached = this.symbolCache.get(symbolName);
    if (cached) {
      logger.debug({ symbolName }, "Symbol expansion cache hit");
      return cached;
    }

    this.currentDepth = "symbol";

    try {
      const encodedSymbol = encodeURIComponent(symbolName);
      const response = await fetch(
        `${BRAIN_BASE_URL}/search/symbol?name=${encodedSymbol}`,
        {
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(10_000),
        }
      );

      if (!response.ok) {
        throw new Error(`Project Brain returned ${response.status}`);
      }

      const data = (await response.json()) as SymbolExpansion;
      this.symbolCache.set(symbolName, data);

      logger.debug(
        {
          symbolName,
          definitionFile: data.definitionFile,
          usageCount: data.usages.length,
        },
        "Symbol expanded"
      );

      return data;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ error: msg, symbolName }, "Failed to expand symbol");

      const fallback: SymbolExpansion = {
        symbolName,
        definition: "",
        definitionFile: "",
        usages: [],
      };
      this.symbolCache.set(symbolName, fallback);
      return fallback;
    }
  }

  /**
   * Get the current context depth level.
   */
  getDepth(): ContextDepth {
    return this.currentDepth;
  }

  /**
   * Get cache statistics.
   */
  getCacheStats(): {
    overviews: number;
    files: number;
    symbols: number;
  } {
    return {
      overviews: this.overviewCache.size,
      files: this.fileCache.size,
      symbols: this.symbolCache.size,
    };
  }

  /**
   * Clear all caches (e.g., when switching sessions).
   */
  clearCaches(): void {
    this.overviewCache.clear();
    this.fileCache.clear();
    this.symbolCache.clear();
    this.currentDepth = "overview";
  }
}
