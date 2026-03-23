/**
 * Phase 7.14: Auto-update Knowledge Graph.
 *
 * On agent file changes, incrementally parses and updates graph edges.
 * Avoids full re-indexing by only updating the changed file's
 * graph nodes and edges.
 */
import { db, graphEdges, graphNodes } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { and, eq, or } from "drizzle-orm";

const logger = createLogger("project-brain:auto-graph-updater");

const VALID_NODE_TYPES = new Set([
  "function",
  "class",
  "interface",
  "type",
  "module",
]);

function mapExportType(
  expType: string
): "function" | "class" | "interface" | "type" | "module" {
  if (VALID_NODE_TYPES.has(expType)) {
    return expType as "function" | "class" | "interface" | "type" | "module";
  }
  return "module";
}

const IMPORT_PATTERN =
  /import\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+["']([^"']+)["']/g;
const EXPORT_PATTERN =
  /export\s+(?:default\s+)?(?:function|class|const|let|type|interface|enum)\s+(\w+)/g;
const EXTENDS_PATTERN = /(?:class|interface)\s+(\w+)\s+extends\s+(\w+)/g;
const IMPLEMENTS_PATTERN = /class\s+(\w+)\s+implements\s+(\w+)/g;
const BRACE_CONTENT_RE = /\{([^}]+)\}/;
const DEFAULT_IMPORT_RE = /import\s+(\w+)/;
const RELATIVE_PATH_PREFIX_RE = /^\.\//;

/**
 * AutoGraphUpdater incrementally updates the knowledge graph
 * when files are changed by agents.
 */
export class AutoGraphUpdater {
  /**
   * Handle a file change event. Parses the file, removes old graph
   * entries, and inserts updated nodes and edges.
   */
  async onFileChange(
    projectId: string,
    filePath: string,
    content: string
  ): Promise<void> {
    // Step 1: Remove old nodes and edges for this file
    await this.removeFileEntries(projectId, filePath);

    // Step 2: Parse the file for graph-relevant information
    const exports = this.findExports(content);
    const imports = this.findImports(content);
    const inheritance = this.findInheritance(content);

    // Step 3: Create the file node
    const fileNodeId = generateId("gn");
    await db.insert(graphNodes).values({
      id: fileNodeId,
      projectId,
      name: filePath.split("/").pop() ?? filePath,
      nodeType: "file",
      filePath,
      metadata: {},
    });

    // Step 4: Create export nodes and contains edges
    const exportNodeIds = new Map<string, string>();
    for (const exp of exports) {
      const nodeId = generateId("gn");
      exportNodeIds.set(exp.name, nodeId);

      await db.insert(graphNodes).values({
        id: nodeId,
        projectId,
        name: exp.name,
        nodeType: mapExportType(exp.type),
        filePath,
        metadata: { symbolType: exp.type },
      });

      await db.insert(graphEdges).values({
        id: generateId("ge"),
        projectId,
        sourceId: fileNodeId,
        targetId: nodeId,
        edgeType: "contains",
        metadata: {},
      });
    }

    // Step 5: Create import edges
    for (const imp of imports) {
      const targetPath = this.resolveImportPath(filePath, imp.source);
      const targetNodes = await db
        .select({ id: graphNodes.id })
        .from(graphNodes)
        .where(
          and(
            eq(graphNodes.projectId, projectId),
            eq(graphNodes.filePath, targetPath),
            eq(graphNodes.nodeType, "file")
          )
        )
        .limit(1);

      if (targetNodes.length > 0) {
        const targetNode = targetNodes[0] as (typeof targetNodes)[0];
        await db.insert(graphEdges).values({
          id: generateId("ge"),
          projectId,
          sourceId: fileNodeId,
          targetId: targetNode.id,
          edgeType: "imports",
          metadata: { specifiers: imp.specifiers },
        });
      }
    }

    // Step 6: Create inheritance/implementation edges
    for (const rel of inheritance) {
      const sourceId = exportNodeIds.get(rel.child);
      if (!sourceId) {
        continue;
      }

      const parentNodes = await db
        .select({ id: graphNodes.id })
        .from(graphNodes)
        .where(
          and(
            eq(graphNodes.projectId, projectId),
            eq(graphNodes.name, rel.parent)
          )
        )
        .limit(1);

      if (parentNodes.length > 0) {
        const parentNode = parentNodes[0] as (typeof parentNodes)[0];
        await db.insert(graphEdges).values({
          id: generateId("ge"),
          projectId,
          sourceId,
          targetId: parentNode.id,
          edgeType: rel.type,
          metadata: {},
        });
      }
    }

    logger.info(
      {
        projectId,
        filePath,
        exports: exports.length,
        imports: imports.length,
        inheritance: inheritance.length,
      },
      "Knowledge graph updated for file change"
    );
  }

  private async removeFileEntries(
    projectId: string,
    filePath: string
  ): Promise<void> {
    const nodes = await db
      .select({ id: graphNodes.id })
      .from(graphNodes)
      .where(
        and(
          eq(graphNodes.projectId, projectId),
          eq(graphNodes.filePath, filePath)
        )
      );

    const nodeIds = nodes.map((n) => n.id);

    if (nodeIds.length > 0) {
      for (const nodeId of nodeIds) {
        await db
          .delete(graphEdges)
          .where(
            and(
              eq(graphEdges.projectId, projectId),
              or(
                eq(graphEdges.sourceId, nodeId),
                eq(graphEdges.targetId, nodeId)
              )
            )
          );
      }

      for (const nodeId of nodeIds) {
        await db.delete(graphNodes).where(eq(graphNodes.id, nodeId));
      }
    }
  }

  private findExports(content: string): Array<{ name: string; type: string }> {
    const results: Array<{ name: string; type: string }> = [];
    const regex = new RegExp(EXPORT_PATTERN.source, EXPORT_PATTERN.flags);

    const matches = content.matchAll(regex);
    for (const match of matches) {
      const fullMatch = match[0] ?? "";
      let type = "other";
      if (fullMatch.includes("function")) {
        type = "function";
      } else if (fullMatch.includes("class")) {
        type = "class";
      } else if (fullMatch.includes("interface")) {
        type = "interface";
      } else if (fullMatch.includes("type")) {
        type = "type";
      } else if (fullMatch.includes("const") || fullMatch.includes("let")) {
        type = "variable";
      }

      if (match[1]) {
        results.push({ name: match[1], type });
      }
    }

    return results;
  }

  private findImports(
    content: string
  ): Array<{ source: string; specifiers: string[] }> {
    const results: Array<{ source: string; specifiers: string[] }> = [];
    const regex = new RegExp(IMPORT_PATTERN.source, IMPORT_PATTERN.flags);

    const matches = content.matchAll(regex);
    for (const match of matches) {
      if (match[1]) {
        const specifiers = this.getImportSpecifiers(match[0] ?? "");
        results.push({ source: match[1], specifiers });
      }
    }

    return results;
  }

  private getImportSpecifiers(importLine: string): string[] {
    const braceMatch = BRACE_CONTENT_RE.exec(importLine);
    if (braceMatch?.[1]) {
      return braceMatch[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }

    const defaultMatch = DEFAULT_IMPORT_RE.exec(importLine);
    if (defaultMatch?.[1]) {
      return [defaultMatch[1]];
    }

    return [];
  }

  private findInheritance(
    content: string
  ): Array<{ child: string; parent: string; type: "extends" | "implements" }> {
    const relations: Array<{
      child: string;
      parent: string;
      type: "extends" | "implements";
    }> = [];

    const extendsMatches = content.matchAll(
      new RegExp(EXTENDS_PATTERN.source, EXTENDS_PATTERN.flags)
    );
    for (const match of extendsMatches) {
      if (match[1] && match[2]) {
        relations.push({ child: match[1], parent: match[2], type: "extends" });
      }
    }

    const implMatches = content.matchAll(
      new RegExp(IMPLEMENTS_PATTERN.source, IMPLEMENTS_PATTERN.flags)
    );
    for (const match of implMatches) {
      if (match[1] && match[2]) {
        relations.push({
          child: match[1],
          parent: match[2],
          type: "implements",
        });
      }
    }

    return relations;
  }

  private resolveImportPath(currentFile: string, importSource: string): string {
    if (importSource.startsWith(".")) {
      const dir = currentFile.split("/").slice(0, -1).join("/");
      const resolved = `${dir}/${importSource.replace(RELATIVE_PATH_PREFIX_RE, "")}`;
      if (!resolved.includes(".")) {
        return `${resolved}.ts`;
      }
      return resolved;
    }
    return importSource;
  }
}
