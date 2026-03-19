/**
 * Phase 6.2: Cross-File Reference Resolution.
 * Resolves import paths (e.g., @prometheus/db → packages/db/src/index.ts).
 * Matches caller imported symbols to defining file exports.
 * Runs as post-processing after batch indexing.
 */
import { db, graphEdges, graphNodes } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { and, eq } from "drizzle-orm";

const logger = createLogger("project-brain:reference-resolver");

const PATH_ALIAS_RE = /^@[\w-]+\//;
const RELATIVE_RE = /^\.\//;
const PARENT_RE = /^\.\.\//;
const EXT_STRIP_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const INDEX_STRIP_RE = /\/index\.(ts|js)$/;
const FILE_PREFIX_RE = /^file:/;
const PKG_MATCH_RE = /^@[\w-]+\/([\w-]+)(?:\/(.*))?$/;

export class ReferenceResolver {
  private readonly pathAliases: Map<string, string>;

  constructor(aliases?: Record<string, string>) {
    this.pathAliases = new Map(Object.entries(aliases ?? {}));
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
  private resolveImportPath(
    importPath: string,
    sourceFilePath: string,
    fileIndex: Map<string, string>
  ): string | null {
    // 1. Try path aliases (e.g., @prometheus/db → packages/db/src)
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

    // 3. Node modules — don't resolve (external dependency)
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
