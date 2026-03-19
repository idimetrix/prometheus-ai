/**
 * Phase 3.1 / 6.2: Cross-File Reference Resolution.
 * Resolves import paths (e.g., @prometheus/db -> packages/db/src/index.ts).
 * Matches caller imported symbols to defining file exports.
 * Builds a directed dependency graph stored in knowledge graph tables.
 * Handles re-exports and dynamic imports.
 * Runs as post-processing after batch indexing.
 */
import { db, graphEdges, graphNodes } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { and, eq } from "drizzle-orm";

const logger = createLogger("project-brain:reference-resolver");

const PATH_ALIAS_RE = /^@[\w-]+\//;
const RELATIVE_RE = /^\.\//;
const PARENT_RE = /^\.\.\//;
const EXT_STRIP_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const INDEX_STRIP_RE = /\/index\.(ts|js)$/;
const FILE_PREFIX_RE = /^file:/;
const PKG_MATCH_RE = /^@[\w-]+\/([\w-]+)(?:\/(.*))?$/;

/** Regex to parse static import statements */
const STATIC_IMPORT_RE =
  /import\s+(?:(?:type\s+)?(?:\{([^}]*)\}|(\w+)|\*\s+as\s+(\w+))(?:\s*,\s*(?:\{([^}]*)\}|\*\s+as\s+(\w+)))?\s+from\s+)?["']([^"']+)["']/g;

/** Regex to parse dynamic import expressions */
const DYNAMIC_IMPORT_RE = /import\s*\(\s*["']([^"']+)["']\s*\)/g;

/** Regex to parse re-export statements */
const REEXPORT_RE =
  /export\s+(?:\{([^}]*)\}|\*(?:\s+as\s+(\w+))?)\s+from\s+["']([^"']+)["']/g;

/** Regex to parse export declarations */
const _EXPORT_DECL_RE =
  /export\s+(?:default\s+)?(?:abstract\s+)?(function|class|const|let|var|interface|type|enum)\s+(\w+)/g;

export interface ParsedImport {
  /** Default import name, if any */
  defaultName?: string;
  /** Whether this is a dynamic import() */
  isDynamic: boolean;
  /** Whether this is a type-only import */
  isTypeOnly: boolean;
  /** Namespace import name (import * as X), if any */
  namespaceName?: string;
  /** The import source path */
  source: string;
  /** Named specifiers imported (e.g., ['foo', 'bar as baz']) */
  specifiers: string[];
}

export interface ParsedReExport {
  /** Whether this is a wildcard re-export */
  isWildcard: boolean;
  /** Namespace alias for 'export * as X' */
  namespaceAlias?: string;
  /** The source module */
  source: string;
  /** Named specifiers re-exported (empty for 'export *') */
  specifiers: string[];
}

export interface DependencyGraphResult {
  /** Number of dynamic import edges */
  dynamicImportCount: number;
  /** Number of import edges */
  edgeCount: number;
  /** Number of files in the graph */
  fileCount: number;
  /** Number of re-export edges */
  reExportCount: number;
}

export class ReferenceResolver {
  private readonly pathAliases: Map<string, string>;

  constructor(aliases?: Record<string, string>) {
    this.pathAliases = new Map(Object.entries(aliases ?? {}));
  }

  /**
   * Parse all imports from a source file's content.
   * Handles static imports, dynamic imports, and type-only imports.
   */
  parseImports(content: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    const seen = new Set<string>();

    // Static imports
    for (const match of content.matchAll(STATIC_IMPORT_RE)) {
      const namedSpecifiers = match[1] ?? "";
      const defaultName = match[2];
      const namespaceName = match[3];
      const additionalNamed = match[4] ?? "";
      const _additionalNamespace = match[5];
      const source = match[6];

      if (!source) {
        continue;
      }

      const key = `static:${source}:${defaultName ?? ""}:${namedSpecifiers}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      const allNamed = [namedSpecifiers, additionalNamed]
        .filter(Boolean)
        .join(",");

      const specifiers = allNamed
        ? allNamed
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

      const isTypeOnly = match[0].includes("import type");

      imports.push({
        source,
        specifiers,
        defaultName,
        namespaceName,
        isDynamic: false,
        isTypeOnly,
      });
    }

    // Dynamic imports
    for (const match of content.matchAll(DYNAMIC_IMPORT_RE)) {
      const source = match[1];
      if (!source) {
        continue;
      }

      const key = `dynamic:${source}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      imports.push({
        source,
        specifiers: [],
        isDynamic: true,
        isTypeOnly: false,
      });
    }

    return imports;
  }

  /**
   * Parse all re-export statements from a source file's content.
   */
  parseReExports(content: string): ParsedReExport[] {
    const reExports: ParsedReExport[] = [];

    for (const match of content.matchAll(REEXPORT_RE)) {
      const namedSpecifiers = match[1] ?? "";
      const namespaceAlias = match[2];
      const source = match[3];

      if (!source) {
        continue;
      }

      const isWildcard =
        namedSpecifiers || namespaceAlias
          ? Boolean(namespaceAlias)
          : match[0].includes("*");

      const specifiers = namedSpecifiers
        ? namedSpecifiers
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

      reExports.push({
        source,
        specifiers,
        namespaceAlias,
        isWildcard: isWildcard && specifiers.length === 0,
      });
    }

    return reExports;
  }

  /**
   * Build a full dependency graph for a project from file contents.
   * Parses imports, re-exports, and dynamic imports from each file
   * and stores directed edges in the knowledge graph tables.
   */
  async buildDependencyGraph(
    projectId: string,
    files: Array<{ filePath: string; content: string }>
  ): Promise<DependencyGraphResult> {
    let edgeCount = 0;
    let reExportCount = 0;
    let dynamicImportCount = 0;

    // Build file path lookup
    const fileNodes = await db
      .select({ id: graphNodes.id, filePath: graphNodes.filePath })
      .from(graphNodes)
      .where(
        and(
          eq(graphNodes.projectId, projectId),
          eq(graphNodes.nodeType, "file")
        )
      );

    const filePathToId = new Map<string, string>();
    for (const node of fileNodes) {
      filePathToId.set(node.filePath, node.id);
      const noExt = node.filePath.replace(EXT_STRIP_RE, "");
      filePathToId.set(noExt, node.id);
      if (
        node.filePath.endsWith("/index.ts") ||
        node.filePath.endsWith("/index.js")
      ) {
        const dir = node.filePath.replace(INDEX_STRIP_RE, "");
        filePathToId.set(dir, node.id);
      }
    }

    for (const file of files) {
      const sourceNodeId = `file:${file.filePath}`;

      // Parse and resolve static + dynamic imports
      const imports = this.parseImports(file.content);
      for (const imp of imports) {
        const resolvedId = this.resolveImportPath(
          imp.source,
          file.filePath,
          filePathToId
        );

        const targetId = resolvedId ?? `file:${imp.source}`;
        const edgeType = imp.isDynamic
          ? ("depends_on" as const)
          : ("imports" as const);

        await this.upsertEdge(projectId, sourceNodeId, targetId, edgeType, {
          specifiers: imp.specifiers,
          defaultName: imp.defaultName,
          namespaceName: imp.namespaceName,
          isDynamic: imp.isDynamic,
          isTypeOnly: imp.isTypeOnly,
        });

        if (imp.isDynamic) {
          dynamicImportCount++;
        }
        edgeCount++;
      }

      // Parse and resolve re-exports
      const reExports = this.parseReExports(file.content);
      for (const reExp of reExports) {
        const resolvedId = this.resolveImportPath(
          reExp.source,
          file.filePath,
          filePathToId
        );

        const targetId = resolvedId ?? `file:${reExp.source}`;

        await this.upsertEdge(projectId, sourceNodeId, targetId, "exports", {
          reExportSpecifiers: reExp.specifiers,
          namespaceAlias: reExp.namespaceAlias,
          isWildcard: reExp.isWildcard,
          isReExport: true,
        });

        reExportCount++;
        edgeCount++;
      }
    }

    logger.info(
      {
        projectId,
        fileCount: files.length,
        edgeCount,
        reExportCount,
        dynamicImportCount,
      },
      "Dependency graph built"
    );

    return {
      fileCount: files.length,
      edgeCount,
      reExportCount,
      dynamicImportCount,
    };
  }

  /**
   * Resolve all import references in a project.
   * Updates graph edges to point to actual file node IDs.
   */
  async resolveAll(projectId: string): Promise<{
    resolved: number;
    unresolved: number;
  }> {
    let resolved = 0;
    let unresolved = 0;

    // Find all import edges with unresolved targets
    const importEdges = await db
      .select()
      .from(graphEdges)
      .where(
        and(
          eq(graphEdges.projectId, projectId),
          eq(graphEdges.edgeType, "imports")
        )
      );

    // Build a lookup of known file nodes
    const fileNodes = await db
      .select({ id: graphNodes.id, filePath: graphNodes.filePath })
      .from(graphNodes)
      .where(
        and(
          eq(graphNodes.projectId, projectId),
          eq(graphNodes.nodeType, "file")
        )
      );

    const filePathToId = new Map<string, string>();
    for (const node of fileNodes) {
      filePathToId.set(node.filePath, node.id);
      // Also index without extension
      const noExt = node.filePath.replace(EXT_STRIP_RE, "");
      filePathToId.set(noExt, node.id);
      // Also index /index variants
      if (
        node.filePath.endsWith("/index.ts") ||
        node.filePath.endsWith("/index.js")
      ) {
        const dir = node.filePath.replace(INDEX_STRIP_RE, "");
        filePathToId.set(dir, node.id);
      }
    }

    for (const edge of importEdges) {
      const targetId = edge.targetId;
      // Check if target is an unresolved file: reference
      if (!targetId.startsWith("file:")) {
        continue;
      }

      const importPath = targetId.replace(FILE_PREFIX_RE, "");
      const sourceFilePath = edge.sourceId.replace(FILE_PREFIX_RE, "");

      const resolvedPath = this.resolveImportPath(
        importPath,
        sourceFilePath,
        filePathToId
      );

      if (resolvedPath && resolvedPath !== targetId) {
        // Update the edge to point to the resolved file node
        await db
          .update(graphEdges)
          .set({ targetId: resolvedPath })
          .where(eq(graphEdges.id, edge.id));
        resolved++;
      } else {
        unresolved++;
      }
    }

    logger.info(
      { projectId, resolved, unresolved },
      "Reference resolution complete"
    );

    return { resolved, unresolved };
  }

  /**
   * Resolve a single import path to a file node ID.
   */
  resolveImportPath(
    importPath: string,
    sourceFilePath: string,
    fileIndex: Map<string, string>
  ): string | null {
    // 1. Try path aliases (e.g., @prometheus/db -> packages/db/src)
    if (PATH_ALIAS_RE.test(importPath)) {
      for (const [alias, target] of this.pathAliases) {
        if (importPath.startsWith(alias)) {
          const resolved = importPath.replace(alias, target);
          const nodeId = this.findFile(resolved, fileIndex);
          if (nodeId) {
            return nodeId;
          }
        }
      }
      // Try common monorepo patterns
      const pkgMatch = importPath.match(PKG_MATCH_RE);
      if (pkgMatch) {
        const pkgName = pkgMatch[1];
        const subPath = pkgMatch[2] ?? "src/index";
        const candidates = [
          `packages/${pkgName}/src/${subPath}`,
          `packages/${pkgName}/src/index`,
          `packages/${pkgName}/${subPath}`,
        ];
        for (const candidate of candidates) {
          const nodeId = this.findFile(candidate, fileIndex);
          if (nodeId) {
            return nodeId;
          }
        }
      }
    }

    // 2. Relative imports
    if (RELATIVE_RE.test(importPath) || PARENT_RE.test(importPath)) {
      const sourceDir = sourceFilePath.split("/").slice(0, -1).join("/");
      const resolved = resolvePath(sourceDir, importPath);
      const nodeId = this.findFile(resolved, fileIndex);
      if (nodeId) {
        return nodeId;
      }
    }

    // 3. Node modules -- don't resolve (external dependency)
    return null;
  }

  private findFile(
    path: string,
    fileIndex: Map<string, string>
  ): string | null {
    // Try exact match
    if (fileIndex.has(path)) {
      return fileIndex.get(path) ?? null;
    }

    // Try with extensions
    const extensions = [".ts", ".tsx", ".js", ".jsx"];
    for (const ext of extensions) {
      if (fileIndex.has(`${path}${ext}`)) {
        return fileIndex.get(`${path}${ext}`) ?? null;
      }
    }

    // Try /index
    for (const ext of extensions) {
      if (fileIndex.has(`${path}/index${ext}`)) {
        return fileIndex.get(`${path}/index${ext}`) ?? null;
      }
    }

    return null;
  }

  /**
   * Upsert an edge in the graph, avoiding duplicates.
   */
  private async upsertEdge(
    projectId: string,
    sourceId: string,
    targetId: string,
    edgeType:
      | "imports"
      | "calls"
      | "extends"
      | "implements"
      | "depends_on"
      | "contains"
      | "exports"
      | "uses_type",
    metadata: Record<string, unknown>
  ): Promise<void> {
    const existing = await db
      .select({ id: graphEdges.id })
      .from(graphEdges)
      .where(
        and(
          eq(graphEdges.projectId, projectId),
          eq(graphEdges.sourceId, sourceId),
          eq(graphEdges.targetId, targetId),
          eq(graphEdges.edgeType, edgeType)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(graphEdges)
        .set({ metadata })
        .where(eq(graphEdges.id, existing[0]?.id ?? ""));
      return;
    }

    await db.insert(graphEdges).values({
      id: generateId("ge"),
      projectId,
      sourceId,
      targetId,
      edgeType,
      metadata,
    });
  }

  /**
   * Auto-detect path aliases from tsconfig.json paths.
   */
  static async detectAliases(
    tsconfigPath: string
  ): Promise<Record<string, string>> {
    try {
      const fs = await import("node:fs/promises");
      const content = await fs.readFile(tsconfigPath, "utf-8");
      const parsed = JSON.parse(content);
      const paths = parsed.compilerOptions?.paths ?? {};
      const aliases: Record<string, string> = {};

      for (const [alias, targets] of Object.entries(paths)) {
        const cleanAlias = alias.replace("/*", "/");
        const target = (targets as string[])[0]?.replace("/*", "/") ?? "";
        if (cleanAlias && target) {
          aliases[cleanAlias] = target;
        }
      }

      return aliases;
    } catch {
      return {};
    }
  }
}

function resolvePath(base: string, relative: string): string {
  const parts = base.split("/");
  const relParts = relative.split("/");

  for (const part of relParts) {
    if (part === "..") {
      parts.pop();
    } else if (part !== ".") {
      parts.push(part);
    }
  }

  return parts.join("/");
}
