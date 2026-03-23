/**
 * Phase 3.1: Function-level Call Graph Builder.
 *
 * Extracts function declarations, call sites, type references, and
 * export/import bindings at the symbol level using regex-based analysis.
 * Produces a fine-grained call graph with typed nodes and edges suitable
 * for dependency analysis, dead-code detection, and impact assessment.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:call-graph-builder");

// ─── Public Interfaces ──────────────────────────────────────────────────

export interface CallGraphNode {
  endLine: number;
  exported: boolean;
  filePath: string;
  id: string;
  name: string;
  params?: string[];
  returnType?: string;
  startLine: number;
  type:
    | "function"
    | "class"
    | "method"
    | "variable"
    | "type"
    | "interface"
    | "enum";
}

export interface CallGraphEdge {
  filePath: string;
  line: number;
  sourceId: string;
  targetId: string;
  type:
    | "calls_function"
    | "references_type"
    | "assigns_to"
    | "imports_symbol"
    | "extends_class"
    | "implements_interface";
}

export interface CallGraphResult {
  edges: CallGraphEdge[];
  nodes: CallGraphNode[];
}

// ─── Regex Patterns ─────────────────────────────────────────────────────

// Function declarations: named functions and async functions
const NAMED_FN_RE =
  /^(export\s+)?(?:default\s+)?(async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^\s{]+))?\s*\{/gm;

// Arrow function assignments: const foo = (...) => { ... }
const ARROW_FN_RE =
  /^(export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(async\s+)?(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^\s=>{]+))?\s*=>/gm;

// Class declarations
const CLASS_DECL_RE =
  /^(export\s+)?(?:default\s+)?(abstract\s+)?class\s+(\w+)(?:\s*<[^>]*>)?(?:\s+extends\s+([\w.]+)(?:\s*<[^>]*>)?)?(?:\s+implements\s+([\w,\s<>]+))?\s*\{/gm;

// Class method declarations
const METHOD_RE =
  /^\s+(public\s+|private\s+|protected\s+)?(static\s+)?(async\s+)?(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^\s{]+))?\s*\{/gm;

// Interface declarations
const INTERFACE_RE =
  /^(export\s+)?interface\s+(\w+)(?:\s*<[^>]*>)?(?:\s+extends\s+([\w,\s<>.]+))?\s*\{/gm;

// Type alias declarations
const TYPE_ALIAS_RE = /^(export\s+)?type\s+(\w+)(?:\s*<[^>]*>)?\s*=/gm;

// Enum declarations
const ENUM_RE = /^(export\s+)?(?:const\s+)?enum\s+(\w+)\s*\{/gm;

// Variable declarations (exported consts that are not functions)
const VAR_DECL_RE =
  /^(export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*([^=]+))?\s*=\s*(?!(?:async\s+)?\(|(?:async\s+)?function)/gm;

// Import statements
const NAMED_IMPORT_RE =
  /^import\s+(?:type\s+)?\{\s*([^}]+)\s*\}\s+from\s+["']([^"']+)["']/gm;
const DEFAULT_IMPORT_RE =
  /^import\s+(?:type\s+)?(\w+)\s+from\s+["']([^"']+)["']/gm;
const NS_IMPORT_RE = /^import\s+\*\s+as\s+(\w+)\s+from\s+["']([^"']+)["']/gm;

// Function call sites: identifier followed by parentheses
const CALL_SITE_RE = /(?<![.\w])(\w+)\s*(?:<[^>]*>)?\s*\(/g;

// Type references in annotations: `: TypeName`, `<TypeName>`, `as TypeName`
const TYPE_REF_RE = /(?::\s*|<|extends\s+|implements\s+|as\s+)(\b[A-Z]\w+)\b/g;

// Assignment targets: `variable = ...`
const _ASSIGNMENT_RE = /(?<![.\w])(\w+)\s*(?:\[[\w.]*\]\s*)?=[^=]/g;

// Lines starting with import/export keywords
const IMPORT_EXPORT_LINE_RE = /^\s*(import|export)\s/;

// Param cleanup: strip optional/default markers
const PARAM_SUFFIX_RE = /[?=].*$/;

// Generic type params in implements/extends clauses
const GENERIC_PARAMS_RE = /<[^>]*>/g;

// Import alias separator
const AS_SEPARATOR_RE = /\s+as\s+/;

// Keywords to exclude from call-site detection
const CALL_SITE_KEYWORDS = new Set([
  "if",
  "else",
  "for",
  "while",
  "do",
  "switch",
  "case",
  "return",
  "throw",
  "new",
  "delete",
  "typeof",
  "void",
  "catch",
  "finally",
  "try",
  "import",
  "export",
  "from",
  "const",
  "let",
  "var",
  "function",
  "class",
  "interface",
  "type",
  "enum",
  "async",
  "await",
  "yield",
  "super",
  "this",
]);

// Built-in types to exclude from type-reference edges
const BUILTIN_TYPES = new Set([
  "String",
  "Number",
  "Boolean",
  "Object",
  "Array",
  "Map",
  "Set",
  "Promise",
  "Record",
  "Partial",
  "Required",
  "Readonly",
  "Pick",
  "Omit",
  "Exclude",
  "Extract",
  "ReturnType",
  "Parameters",
  "Date",
  "RegExp",
  "Error",
  "Function",
  "Symbol",
  "BigInt",
  "WeakMap",
  "WeakSet",
  "Awaited",
  "NonNullable",
  "InstanceType",
  "ConstructorParameters",
  "ThisType",
  "Uppercase",
  "Lowercase",
  "Capitalize",
  "Uncapitalize",
]);

// ─── Helpers ────────────────────────────────────────────────────────────

function makeNodeId(filePath: string, name: string, type: string): string {
  return `${type}:${filePath}:${name}`;
}

function estimateEndLine(
  content: string,
  startLine: number,
  kind: "block" | "statement"
): number {
  const lines = content.split("\n");
  if (kind === "statement") {
    // Single-line declarations: type aliases, variable decls
    return startLine;
  }

  // For block declarations, count braces to find matching close
  let depth = 0;
  let foundOpen = false;
  for (let i = startLine - 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    for (const ch of line) {
      if (ch === "{") {
        depth++;
        foundOpen = true;
      } else if (ch === "}") {
        depth--;
        if (foundOpen && depth === 0) {
          return i + 1; // 1-indexed
        }
      }
    }
  }
  // Fallback: assume a reasonable span
  return Math.min(startLine + 20, lines.length);
}

function lineNumberOf(content: string, charIndex: number): number {
  let line = 1;
  for (let i = 0; i < charIndex && i < content.length; i++) {
    if (content[i] === "\n") {
      line++;
    }
  }
  return line;
}

function parseParams(raw: string): string[] {
  if (!raw.trim()) {
    return [];
  }
  return raw
    .split(",")
    .map((p) => p.trim().split(":")[0]?.trim().replace(PARAM_SUFFIX_RE, ""))
    .filter((p): p is string => Boolean(p) && p !== "");
}

// ─── CallGraphBuilder ───────────────────────────────────────────────────

export class CallGraphBuilder {
  /**
   * Build a call graph from a single file's content.
   */
  buildFromFile(filePath: string, content: string): CallGraphResult {
    const nodes: CallGraphNode[] = [];
    const edges: CallGraphEdge[] = [];
    const nodeNames = new Set<string>();
    const importedSymbols = new Map<string, { source: string; line: number }>();

    // ── Extract nodes ─────────────────────────────────────────────
    this.extractFunctionNodes(filePath, content, nodes, nodeNames);
    this.extractArrowFunctionNodes(filePath, content, nodes, nodeNames);
    this.extractClassNodes(filePath, content, nodes, edges, nodeNames);
    this.extractMethodNodes(filePath, content, nodes, nodeNames);
    this.extractDeclarationNodes(filePath, content, nodes, nodeNames);

    // ── Extract import edges ──────────────────────────────────────
    this.extractImportEdges(filePath, content, edges, importedSymbols);

    // ── Extract call-site and type-reference edges ────────────────
    const lines = content.split("\n");
    this.extractCallSiteEdges(
      filePath,
      lines,
      nodes,
      edges,
      nodeNames,
      importedSymbols
    );
    this.extractTypeRefEdges(
      filePath,
      lines,
      nodes,
      edges,
      nodeNames,
      importedSymbols
    );

    // ── Deduplicate edges ─────────────────────────────────────────
    const deduped = deduplicateEdges(edges);

    logger.debug(
      { filePath, nodes: nodes.length, edges: deduped.length },
      "Call graph built for file"
    );

    return { nodes, edges: deduped };
  }

  private extractFunctionNodes(
    filePath: string,
    content: string,
    nodes: CallGraphNode[],
    nodeNames: Set<string>
  ): void {
    for (const match of content.matchAll(NAMED_FN_RE)) {
      const name = match[3];
      if (!name) {
        continue;
      }
      const line = lineNumberOf(content, match.index);
      nodes.push({
        id: makeNodeId(filePath, name, "fn"),
        name,
        type: "function",
        filePath,
        startLine: line,
        endLine: estimateEndLine(content, line, "block"),
        exported: Boolean(match[1]),
        params: parseParams(match[4] ?? ""),
        returnType: match[5]?.trim(),
      });
      nodeNames.add(name);
    }
  }

  private extractArrowFunctionNodes(
    filePath: string,
    content: string,
    nodes: CallGraphNode[],
    nodeNames: Set<string>
  ): void {
    for (const match of content.matchAll(ARROW_FN_RE)) {
      const name = match[2];
      if (!name || nodeNames.has(name)) {
        continue;
      }
      const line = lineNumberOf(content, match.index);
      nodes.push({
        id: makeNodeId(filePath, name, "fn"),
        name,
        type: "function",
        filePath,
        startLine: line,
        endLine: estimateEndLine(content, line, "block"),
        exported: Boolean(match[1]),
        params: parseParams(match[4] ?? ""),
        returnType: match[5]?.trim(),
      });
      nodeNames.add(name);
    }
  }

  private extractClassNodes(
    filePath: string,
    content: string,
    nodes: CallGraphNode[],
    edges: CallGraphEdge[],
    nodeNames: Set<string>
  ): void {
    for (const match of content.matchAll(CLASS_DECL_RE)) {
      const name = match[3];
      if (!name) {
        continue;
      }
      const line = lineNumberOf(content, match.index);
      const id = makeNodeId(filePath, name, "class");
      nodes.push({
        id,
        name,
        type: "class",
        filePath,
        startLine: line,
        endLine: estimateEndLine(content, line, "block"),
        exported: Boolean(match[1]),
      });
      nodeNames.add(name);

      const baseClass = match[4]?.trim();
      if (baseClass) {
        edges.push({
          sourceId: id,
          targetId: makeNodeId(filePath, baseClass, "class"),
          type: "extends_class",
          filePath,
          line,
        });
      }

      const interfaces = match[5];
      if (interfaces) {
        for (const iface of interfaces.split(",")) {
          const trimmed = iface.replace(GENERIC_PARAMS_RE, "").trim();
          if (trimmed) {
            edges.push({
              sourceId: id,
              targetId: makeNodeId(filePath, trimmed, "interface"),
              type: "implements_interface",
              filePath,
              line,
            });
          }
        }
      }
    }
  }

  private extractMethodNodes(
    filePath: string,
    content: string,
    nodes: CallGraphNode[],
    nodeNames: Set<string>
  ): void {
    for (const match of content.matchAll(METHOD_RE)) {
      const name = match[4];
      if (!name || name === "constructor") {
        continue;
      }
      if (CALL_SITE_KEYWORDS.has(name)) {
        continue;
      }
      if (nodeNames.has(name)) {
        continue;
      }
      const line = lineNumberOf(content, match.index);
      nodes.push({
        id: makeNodeId(filePath, name, "method"),
        name,
        type: "method",
        filePath,
        startLine: line,
        endLine: estimateEndLine(content, line, "block"),
        exported: false,
        params: parseParams(match[5] ?? ""),
        returnType: match[6]?.trim(),
      });
      nodeNames.add(name);
    }
  }

  private extractDeclarationNodes(
    filePath: string,
    content: string,
    nodes: CallGraphNode[],
    nodeNames: Set<string>
  ): void {
    for (const match of content.matchAll(INTERFACE_RE)) {
      const name = match[2];
      if (!name) {
        continue;
      }
      const line = lineNumberOf(content, match.index);
      nodes.push({
        id: makeNodeId(filePath, name, "interface"),
        name,
        type: "interface",
        filePath,
        startLine: line,
        endLine: estimateEndLine(content, line, "block"),
        exported: Boolean(match[1]),
      });
      nodeNames.add(name);
    }

    for (const match of content.matchAll(TYPE_ALIAS_RE)) {
      const name = match[2];
      if (!name) {
        continue;
      }
      const line = lineNumberOf(content, match.index);
      nodes.push({
        id: makeNodeId(filePath, name, "type"),
        name,
        type: "type",
        filePath,
        startLine: line,
        endLine: estimateEndLine(content, line, "statement"),
        exported: Boolean(match[1]),
      });
      nodeNames.add(name);
    }

    for (const match of content.matchAll(ENUM_RE)) {
      const name = match[2];
      if (!name) {
        continue;
      }
      const line = lineNumberOf(content, match.index);
      nodes.push({
        id: makeNodeId(filePath, name, "enum"),
        name,
        type: "enum",
        filePath,
        startLine: line,
        endLine: estimateEndLine(content, line, "block"),
        exported: Boolean(match[1]),
      });
      nodeNames.add(name);
    }

    for (const match of content.matchAll(VAR_DECL_RE)) {
      const name = match[2];
      if (!name || nodeNames.has(name)) {
        continue;
      }
      const line = lineNumberOf(content, match.index);
      nodes.push({
        id: makeNodeId(filePath, name, "var"),
        name,
        type: "variable",
        filePath,
        startLine: line,
        endLine: estimateEndLine(content, line, "statement"),
        exported: Boolean(match[1]),
        returnType: match[3]?.trim(),
      });
      nodeNames.add(name);
    }
  }

  private extractImportEdges(
    filePath: string,
    content: string,
    edges: CallGraphEdge[],
    importedSymbols: Map<string, { source: string; line: number }>
  ): void {
    for (const match of content.matchAll(NAMED_IMPORT_RE)) {
      const specifiers = match[1];
      const source = match[2];
      if (!(specifiers && source)) {
        continue;
      }
      const line = lineNumberOf(content, match.index);
      for (const spec of specifiers.split(",")) {
        const parts = spec.trim().split(AS_SEPARATOR_RE);
        const importedName = parts[0]?.trim();
        const localName = (parts[1] ?? parts[0])?.trim();
        if (!(importedName && localName)) {
          continue;
        }
        importedSymbols.set(localName, { source, line });
        edges.push({
          sourceId: makeNodeId(filePath, localName, "fn"),
          targetId: `import:${source}:${importedName}`,
          type: "imports_symbol",
          filePath,
          line,
        });
      }
    }

    for (const match of content.matchAll(DEFAULT_IMPORT_RE)) {
      const name = match[1];
      const source = match[2];
      if (!(name && source) || name.startsWith("{")) {
        continue;
      }
      const line = lineNumberOf(content, match.index);
      importedSymbols.set(name, { source, line });
      edges.push({
        sourceId: makeNodeId(filePath, name, "fn"),
        targetId: `import:${source}:default`,
        type: "imports_symbol",
        filePath,
        line,
      });
    }

    for (const match of content.matchAll(NS_IMPORT_RE)) {
      const name = match[1];
      const source = match[2];
      if (!(name && source)) {
        continue;
      }
      const line = lineNumberOf(content, match.index);
      importedSymbols.set(name, { source, line });
      edges.push({
        sourceId: makeNodeId(filePath, name, "fn"),
        targetId: `import:${source}:*`,
        type: "imports_symbol",
        filePath,
        line,
      });
    }
  }

  private extractCallSiteEdges(
    filePath: string,
    lines: string[],
    nodes: CallGraphNode[],
    edges: CallGraphEdge[],
    nodeNames: Set<string>,
    importedSymbols: Map<string, { source: string; line: number }>
  ): void {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (IMPORT_EXPORT_LINE_RE.test(line)) {
        continue;
      }

      for (const match of line.matchAll(CALL_SITE_RE)) {
        const calledName = match[1];
        if (!calledName || CALL_SITE_KEYWORDS.has(calledName)) {
          continue;
        }
        if (!(nodeNames.has(calledName) || importedSymbols.has(calledName))) {
          continue;
        }

        const caller = findEnclosingNode(nodes, i + 1);
        const sourceId = caller
          ? caller.id
          : makeNodeId(filePath, "<module>", "fn");
        const targetId = importedSymbols.has(calledName)
          ? `import:${importedSymbols.get(calledName)?.source}:${calledName}`
          : makeNodeId(filePath, calledName, "fn");

        edges.push({
          sourceId,
          targetId,
          type: "calls_function",
          filePath,
          line: i + 1,
        });
      }
    }
  }

  private extractTypeRefEdges(
    filePath: string,
    lines: string[],
    nodes: CallGraphNode[],
    edges: CallGraphEdge[],
    nodeNames: Set<string>,
    importedSymbols: Map<string, { source: string; line: number }>
  ): void {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (IMPORT_EXPORT_LINE_RE.test(line)) {
        continue;
      }

      for (const match of line.matchAll(TYPE_REF_RE)) {
        const typeName = match[1];
        if (!typeName || BUILTIN_TYPES.has(typeName)) {
          continue;
        }
        if (!(nodeNames.has(typeName) || importedSymbols.has(typeName))) {
          continue;
        }

        const referrer = findEnclosingNode(nodes, i + 1);
        const sourceId = referrer
          ? referrer.id
          : makeNodeId(filePath, "<module>", "fn");
        const targetId = importedSymbols.has(typeName)
          ? `import:${importedSymbols.get(typeName)?.source}:${typeName}`
          : makeNodeId(filePath, typeName, "type");

        edges.push({
          sourceId,
          targetId,
          type: "references_type",
          filePath,
          line: i + 1,
        });
      }
    }
  }

  /**
   * Build a merged call graph from multiple files.
   * Resolves cross-file import references where possible.
   */
  buildFromFiles(
    files: Array<{ path: string; content: string }>
  ): CallGraphResult {
    const allNodes: CallGraphNode[] = [];
    const allEdges: CallGraphEdge[] = [];

    // Build per-file graphs
    const fileGraphs = new Map<string, CallGraphResult>();
    for (const file of files) {
      const graph = this.buildFromFile(file.path, file.content);
      fileGraphs.set(file.path, graph);
      allNodes.push(...graph.nodes);
      allEdges.push(...graph.edges);
    }

    // Build an index of exported symbols across all files
    const exportedSymbolIndex = new Map<
      string,
      { nodeId: string; filePath: string }
    >();
    for (const node of allNodes) {
      if (node.exported) {
        // Index by name for cross-file resolution
        exportedSymbolIndex.set(node.name, {
          nodeId: node.id,
          filePath: node.filePath,
        });
      }
    }

    // Resolve cross-file import targets
    const resolvedEdges: CallGraphEdge[] = [];
    for (const edge of allEdges) {
      if (edge.targetId.startsWith("import:")) {
        // Extract the symbol name from import:source:symbolName
        const parts = edge.targetId.split(":");
        const symbolName = parts.at(-1) ?? "";

        if (symbolName === "*" || symbolName === "default") {
          // Keep as-is for namespace and default imports
          resolvedEdges.push(edge);
          continue;
        }

        // Try to resolve to an actual exported node
        const resolved = exportedSymbolIndex.get(symbolName);
        if (resolved) {
          resolvedEdges.push({
            ...edge,
            targetId: resolved.nodeId,
          });
        } else {
          // Keep the unresolved import reference
          resolvedEdges.push(edge);
        }
      } else {
        resolvedEdges.push(edge);
      }
    }

    const deduped = deduplicateEdges(resolvedEdges);

    logger.info(
      {
        fileCount: files.length,
        totalNodes: allNodes.length,
        totalEdges: deduped.length,
        exportedSymbols: exportedSymbolIndex.size,
      },
      "Multi-file call graph built"
    );

    return { nodes: allNodes, edges: deduped };
  }
}

// ─── Module-level Helpers ───────────────────────────────────────────────

/**
 * Find the innermost function/method node that contains the given line.
 */
function findEnclosingNode(
  nodes: CallGraphNode[],
  line: number
): CallGraphNode | undefined {
  let best: CallGraphNode | undefined;
  let bestSpan = Number.POSITIVE_INFINITY;

  for (const node of nodes) {
    if (
      (node.type === "function" ||
        node.type === "method" ||
        node.type === "class") &&
      node.startLine <= line &&
      node.endLine >= line
    ) {
      const span = node.endLine - node.startLine;
      if (span < bestSpan) {
        best = node;
        bestSpan = span;
      }
    }
  }

  return best;
}

/**
 * Remove duplicate edges (same source, target, type, line).
 */
function deduplicateEdges(edges: CallGraphEdge[]): CallGraphEdge[] {
  const seen = new Set<string>();
  const result: CallGraphEdge[] = [];

  for (const edge of edges) {
    const key = `${edge.sourceId}|${edge.targetId}|${edge.type}|${edge.line}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(edge);
    }
  }

  return result;
}
