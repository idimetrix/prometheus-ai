/**
 * Cross-file symbol resolver for code intelligence.
 *
 * Tracks imports and exports across multiple files to resolve
 * where symbols are defined and consumed throughout a project.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("code-intelligence:cross-file-resolver");

// Top-level regex for stripping leading "./" from paths
const LEADING_DOT_SLASH_RE = /^\.\//;

/**
 * An exported symbol from a source file.
 */
export interface ExportedSymbol {
  /** The exported name (may differ from local name for re-exports) */
  exportedName: string;
  /** The file that exports this symbol */
  filePath: string;
  /** Whether this is a default export */
  isDefault: boolean;
  /** Whether this is a re-export from another module */
  isReExport: boolean;
  /** The kind of symbol (function, class, type, etc.) */
  kind: string;
  /** The local name within the defining file */
  localName: string;
  /** Source module for re-exports */
  reExportSource?: string;
}

/**
 * An import declaration within a source file.
 */
export interface ImportedSymbol {
  /** Alias used in the importing file (may differ from the exported name) */
  alias?: string;
  /** The file that contains this import */
  filePath: string;
  /** The imported name (or "*" for namespace imports, "default" for default imports) */
  importedName: string;
  /** Whether this is a namespace import (import * as X) */
  isNamespace: boolean;
  /** Whether this is a type-only import */
  isTypeOnly: boolean;
  /** The module specifier (e.g. "./utils", "lodash") */
  source: string;
}

/**
 * Result of resolving a symbol to its definition.
 */
export interface ResolvedSymbol {
  /** The defining export */
  definition: ExportedSymbol;
  /** Chain of re-exports traversed to reach the definition */
  reExportChain: ExportedSymbol[];
}

/**
 * Cross-file symbol resolver that tracks imports and exports across files.
 *
 * @example
 * ```ts
 * const resolver = new CrossFileResolver();
 *
 * resolver.registerExports("src/utils.ts", [
 *   { exportedName: "formatDate", localName: "formatDate", kind: "function",
 *     filePath: "src/utils.ts", isDefault: false, isReExport: false },
 * ]);
 *
 * resolver.registerImports("src/app.ts", [
 *   { importedName: "formatDate", source: "./utils",
 *     filePath: "src/app.ts", isNamespace: false, isTypeOnly: false },
 * ]);
 *
 * const resolved = resolver.resolveSymbol("formatDate", "src/app.ts");
 * // => { definition: { exportedName: "formatDate", filePath: "src/utils.ts", ... }, ... }
 * ```
 */
export class CrossFileResolver {
  /** Exports indexed by file path */
  private readonly exportsByFile = new Map<string, ExportedSymbol[]>();
  /** Imports indexed by file path */
  private readonly importsByFile = new Map<string, ImportedSymbol[]>();
  /** Exports indexed by symbol name for fast lookup */
  private readonly exportsByName = new Map<string, ExportedSymbol[]>();

  /**
   * Register exports from a file.
   */
  registerExports(filePath: string, exports: ExportedSymbol[]): void {
    this.exportsByFile.set(filePath, exports);

    for (const exp of exports) {
      const existing = this.exportsByName.get(exp.exportedName) ?? [];
      existing.push(exp);
      this.exportsByName.set(exp.exportedName, existing);
    }

    logger.debug(
      { filePath, count: exports.length },
      `Registered ${exports.length} exports from ${filePath}`
    );
  }

  /**
   * Register imports for a file.
   */
  registerImports(filePath: string, imports: ImportedSymbol[]): void {
    this.importsByFile.set(filePath, imports);

    logger.debug(
      { filePath, count: imports.length },
      `Registered ${imports.length} imports for ${filePath}`
    );
  }

  /**
   * Resolve a symbol name used in a file to its definition.
   *
   * Walks through imports to find the original export, following
   * re-export chains up to a maximum depth of 10.
   *
   * @param symbolName - The symbol name as used in the source file
   * @param fromFile - The file where the symbol is referenced
   * @returns The resolved definition and re-export chain, or undefined
   */
  resolveSymbol(
    symbolName: string,
    fromFile: string
  ): ResolvedSymbol | undefined {
    const imports = this.importsByFile.get(fromFile);
    if (!imports) {
      return undefined;
    }

    // Find the import that brings this symbol into scope
    const relevantImport = imports.find(
      (imp) =>
        imp.importedName === symbolName ||
        imp.alias === symbolName ||
        imp.isNamespace
    );

    if (!relevantImport) {
      // Symbol might be locally defined, not imported
      return undefined;
    }

    // Search for matching exports
    const candidates = this.exportsByName.get(
      relevantImport.alias ? relevantImport.importedName : symbolName
    );

    if (!candidates || candidates.length === 0) {
      return undefined;
    }

    // Prefer the candidate whose file path matches the import source
    const directMatch = candidates.find((c) =>
      c.filePath.includes(
        relevantImport.source.replace(LEADING_DOT_SLASH_RE, "")
      )
    );

    const definition = directMatch ?? candidates[0];
    if (!definition) {
      return undefined;
    }

    // Follow re-export chain
    const reExportChain: ExportedSymbol[] = [];
    let current = definition;
    const visited = new Set<string>();
    const MAX_DEPTH = 10;

    while (
      current.isReExport &&
      current.reExportSource &&
      reExportChain.length < MAX_DEPTH
    ) {
      const key = `${current.filePath}:${current.exportedName}`;
      if (visited.has(key)) {
        break; // Circular re-export
      }
      visited.add(key);
      reExportChain.push(current);

      const nextCandidates = this.exportsByName.get(current.exportedName);
      const next = nextCandidates?.find(
        (c) =>
          c.filePath !== current.filePath &&
          c.filePath.includes(
            current.reExportSource?.replace(LEADING_DOT_SLASH_RE, "") ?? ""
          )
      );

      if (!next) {
        break;
      }
      current = next;
    }

    return { definition: current, reExportChain };
  }

  /**
   * Get all exports registered for a file.
   *
   * @param filePath - The file path
   * @returns Array of exported symbols, or empty array
   */
  getExportsForFile(filePath: string): ExportedSymbol[] {
    return this.exportsByFile.get(filePath) ?? [];
  }

  /**
   * Get all imports registered for a file.
   *
   * @param filePath - The file path
   * @returns Array of imported symbols, or empty array
   */
  getImportsForFile(filePath: string): ImportedSymbol[] {
    return this.importsByFile.get(filePath) ?? [];
  }

  /**
   * Find all files that import a given symbol name.
   *
   * @param symbolName - The exported symbol name to search for
   * @returns Array of file paths that import this symbol
   */
  findConsumers(symbolName: string): string[] {
    const consumers: string[] = [];
    for (const [filePath, imports] of this.importsByFile) {
      const found = imports.some(
        (imp) => imp.importedName === symbolName || imp.alias === symbolName
      );
      if (found) {
        consumers.push(filePath);
      }
    }
    return consumers;
  }

  /**
   * Remove all registered data for a file.
   */
  removeFile(filePath: string): void {
    const exports = this.exportsByFile.get(filePath);
    if (exports) {
      for (const exp of exports) {
        const nameEntries = this.exportsByName.get(exp.exportedName);
        if (nameEntries) {
          const filtered = nameEntries.filter((e) => e.filePath !== filePath);
          if (filtered.length > 0) {
            this.exportsByName.set(exp.exportedName, filtered);
          } else {
            this.exportsByName.delete(exp.exportedName);
          }
        }
      }
    }
    this.exportsByFile.delete(filePath);
    this.importsByFile.delete(filePath);
  }

  /**
   * Clear all tracked data.
   */
  clear(): void {
    this.exportsByFile.clear();
    this.importsByFile.clear();
    this.exportsByName.clear();
    logger.debug("Cross-file resolver cleared");
  }
}
