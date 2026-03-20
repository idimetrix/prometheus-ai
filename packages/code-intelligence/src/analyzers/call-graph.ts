/**
 * Call Graph Analyzer
 *
 * Builds a call graph from parsed source files by tracking function calls
 * across file boundaries. Supports impact analysis, reachability queries,
 * and coupling detection.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("code-intelligence:call-graph");

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface CallGraphNode {
  /** File path */
  filePath: string;
  /** Fully qualified name: "filePath:symbolName" */
  id: string;
  /** Whether this symbol is exported */
  isExported: boolean;
  /** Symbol kind */
  kind: "function" | "method" | "class" | "component";
  /** Line number of definition */
  line?: number;
  /** Symbol name */
  name: string;
}

export interface CallGraphEdge {
  /** Callee node id */
  callee: string;
  /** Caller node id */
  caller: string;
  /** Line number in caller where the call occurs */
  callSiteLine?: number;
  /** Type of call */
  callType: "direct" | "callback" | "constructor" | "method" | "dynamic";
}

export interface ImpactAnalysis {
  /** Affected files (deduplicated) */
  affectedFiles: string[];
  /** The changed node */
  changedNode: string;
  /** Nodes directly affected (callers) */
  directCallers: CallGraphNode[];
  /** Depth of the impact (max call chain length) */
  maxDepth: number;
  /** All transitively affected nodes */
  transitiveCallers: CallGraphNode[];
}

export interface CouplingPair {
  /** Number of cross-file calls between them */
  callCount: number;
  /** Coupling score (0-1) */
  couplingScore: number;
  /** First file */
  fileA: string;
  /** Second file */
  fileB: string;
}

// ─── Regex Patterns ────────────────────────────────────────────────────────────

const FUNC_CALL_RE = /\b([A-Za-z_$][\w$]*)\s*\(/g;

const METHOD_CALL_RE = /\b([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g;

const NEW_CALL_RE = /\bnew\s+([A-Za-z_$][\w$]*)\s*\(/g;

const FUNC_DEF_RE =
  /(?:export\s+)?(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/g;

const CLASS_DEF_RE = /(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g;

const _METHOD_DEF_RE =
  /(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*\w+\s*)?{/g;

const BUILTIN_GLOBALS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "throw",
  "typeof",
  "instanceof",
  "await",
  "yield",
  "import",
  "export",
  "require",
  "console",
  "Math",
  "Object",
  "Array",
  "String",
  "Number",
  "Boolean",
  "Promise",
  "Date",
  "RegExp",
  "Error",
  "JSON",
  "Map",
  "Set",
  "Symbol",
  "parseInt",
  "parseFloat",
  "setTimeout",
  "setInterval",
  "clearTimeout",
  "clearInterval",
  "fetch",
  "process",
  "Buffer",
]);

// ─── CallGraph ─────────────────────────────────────────────────────────────────

export class CallGraph {
  private readonly nodes = new Map<string, CallGraphNode>();
  private readonly edges: CallGraphEdge[] = [];
  /** Adjacency list: callee → callers */
  private readonly callers = new Map<string, Set<string>>();
  /** Adjacency list: caller → callees */
  private readonly callees = new Map<string, Set<string>>();

  /**
   * Analyze a source file and add its symbols and calls to the graph.
   */
  addFile(filePath: string, content: string): void {
    const definitions = this.extractDefinitions(filePath, content);
    const calls = this.extractCalls(filePath, content, definitions);

    for (const def of definitions) {
      this.nodes.set(def.id, def);
    }

    for (const edge of calls) {
      this.addEdge(edge);
    }

    logger.debug(
      { filePath, definitions: definitions.length, calls: calls.length },
      "Analyzed file for call graph"
    );
  }

  /**
   * Remove a file from the call graph.
   */
  removeFile(filePath: string): void {
    const toRemove: string[] = [];
    for (const [id, node] of this.nodes) {
      if (node.filePath === filePath) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      this.nodes.delete(id);
      this.callers.delete(id);
      this.callees.delete(id);
    }

    // Remove edges involving this file
    const filePrefix = `${filePath}:`;
    for (let i = this.edges.length - 1; i >= 0; i--) {
      const edge = this.edges[i];
      if (
        edge &&
        (edge.caller.startsWith(filePrefix) ||
          edge.callee.startsWith(filePrefix))
      ) {
        this.edges.splice(i, 1);
      }
    }
  }

  /**
   * Get all direct callers of a function.
   */
  getCallers(nodeId: string): CallGraphNode[] {
    const callerIds = this.callers.get(nodeId);
    if (!callerIds) {
      return [];
    }
    return [...callerIds]
      .map((id) => this.nodes.get(id))
      .filter((n): n is CallGraphNode => n !== undefined);
  }

  /**
   * Get all direct callees of a function.
   */
  getCallees(nodeId: string): CallGraphNode[] {
    const calleeIds = this.callees.get(nodeId);
    if (!calleeIds) {
      return [];
    }
    return [...calleeIds]
      .map((id) => this.nodes.get(id))
      .filter((n): n is CallGraphNode => n !== undefined);
  }

  /**
   * Analyze the impact of changing a function. Returns all directly
   * and transitively affected callers, up to maxDepth hops.
   */
  analyzeImpact(nodeId: string, maxDepth = 10): ImpactAnalysis {
    const directCallers = this.getCallers(nodeId);

    const visited = new Set<string>([nodeId]);
    const transitiveCallers: CallGraphNode[] = [];
    let currentDepth = 0;
    let frontier = new Set(directCallers.map((n) => n.id));

    while (frontier.size > 0 && currentDepth < maxDepth) {
      const nextFrontier = new Set<string>();
      for (const callerId of frontier) {
        if (visited.has(callerId)) {
          continue;
        }
        visited.add(callerId);

        const node = this.nodes.get(callerId);
        if (node) {
          transitiveCallers.push(node);
        }

        const upstreamCallers = this.callers.get(callerId);
        if (upstreamCallers) {
          for (const id of upstreamCallers) {
            if (!visited.has(id)) {
              nextFrontier.add(id);
            }
          }
        }
      }
      frontier = nextFrontier;
      currentDepth++;
    }

    const affectedFiles = [
      ...new Set(transitiveCallers.map((n) => n.filePath)),
    ];

    return {
      changedNode: nodeId,
      directCallers,
      transitiveCallers,
      affectedFiles,
      maxDepth: currentDepth,
    };
  }

  /**
   * Find files with the highest coupling (most cross-file calls).
   */
  findCoupledFiles(minCalls = 3): CouplingPair[] {
    const pairCounts = new Map<string, number>();

    for (const edge of this.edges) {
      const callerNode = this.nodes.get(edge.caller);
      const calleeNode = this.nodes.get(edge.callee);
      if (!(callerNode && calleeNode)) {
        continue;
      }
      if (callerNode.filePath === calleeNode.filePath) {
        continue;
      }

      const pairKey = [callerNode.filePath, calleeNode.filePath]
        .sort()
        .join("|");
      pairCounts.set(pairKey, (pairCounts.get(pairKey) ?? 0) + 1);
    }

    const pairs: CouplingPair[] = [];
    for (const [key, count] of pairCounts) {
      if (count >= minCalls) {
        const [fileA, fileB] = key.split("|") as [string, string];
        pairs.push({
          fileA,
          fileB,
          callCount: count,
          couplingScore: Math.min(1, count / 20),
        });
      }
    }

    return pairs.sort((a, b) => b.callCount - a.callCount);
  }

  /**
   * Get graph statistics.
   */
  getStats(): {
    nodeCount: number;
    edgeCount: number;
    fileCount: number;
    avgCallsPerFunction: number;
  } {
    const files = new Set<string>();
    for (const node of this.nodes.values()) {
      files.add(node.filePath);
    }

    return {
      nodeCount: this.nodes.size,
      edgeCount: this.edges.length,
      fileCount: files.size,
      avgCallsPerFunction:
        this.nodes.size > 0 ? this.edges.length / this.nodes.size : 0,
    };
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  private addEdge(edge: CallGraphEdge): void {
    this.edges.push(edge);

    if (!this.callers.has(edge.callee)) {
      this.callers.set(edge.callee, new Set());
    }
    this.callers.get(edge.callee)?.add(edge.caller);

    if (!this.callees.has(edge.caller)) {
      this.callees.set(edge.caller, new Set());
    }
    this.callees.get(edge.caller)?.add(edge.callee);
  }

  private extractDefinitions(
    filePath: string,
    content: string
  ): CallGraphNode[] {
    const defs: CallGraphNode[] = [];
    const lines = content.split("\n");

    // Extract function definitions
    for (const match of content.matchAll(FUNC_DEF_RE)) {
      const name = match[1] ?? match[2];
      if (!name || BUILTIN_GLOBALS.has(name)) {
        continue;
      }
      const line = getLineNumber(content, match.index ?? 0);
      const isExported =
        match[0].startsWith("export") ||
        lines.some((l) => l.includes("export") && l.includes(name));
      defs.push({
        id: `${filePath}:${name}`,
        name,
        filePath,
        kind: "function",
        isExported,
        line,
      });
    }

    // Extract class definitions
    for (const match of content.matchAll(CLASS_DEF_RE)) {
      const name = match[1];
      if (!name) {
        continue;
      }
      const line = getLineNumber(content, match.index ?? 0);
      defs.push({
        id: `${filePath}:${name}`,
        name,
        filePath,
        kind: "class",
        isExported: match[0].startsWith("export"),
        line,
      });
    }

    return defs;
  }

  private extractCalls(
    filePath: string,
    content: string,
    localDefs: CallGraphNode[]
  ): CallGraphEdge[] {
    const edges: CallGraphEdge[] = [];
    const localNames = new Set(localDefs.map((d) => d.name));

    // Find the enclosing function for each call
    const functionRanges = this.buildFunctionRanges(filePath, content);

    // Direct function calls
    for (const match of content.matchAll(FUNC_CALL_RE)) {
      const name = match[1];
      if (!name || BUILTIN_GLOBALS.has(name)) {
        continue;
      }

      const callLine = getLineNumber(content, match.index ?? 0);
      const enclosingFunc = findEnclosing(functionRanges, callLine);
      const callerId = enclosingFunc ?? `${filePath}:<module>`;

      // If calling a local function
      if (localNames.has(name)) {
        edges.push({
          caller: callerId,
          callee: `${filePath}:${name}`,
          callSiteLine: callLine,
          callType: "direct",
        });
      } else {
        // Cross-file call — callee will be resolved via node matching
        edges.push({
          caller: callerId,
          callee: `*:${name}`,
          callSiteLine: callLine,
          callType: "direct",
        });
      }
    }

    // Constructor calls
    for (const match of content.matchAll(NEW_CALL_RE)) {
      const name = match[1];
      if (!name || BUILTIN_GLOBALS.has(name)) {
        continue;
      }
      const callLine = getLineNumber(content, match.index ?? 0);
      const enclosingFunc = findEnclosing(functionRanges, callLine);
      const callerId = enclosingFunc ?? `${filePath}:<module>`;

      edges.push({
        caller: callerId,
        callee: localNames.has(name) ? `${filePath}:${name}` : `*:${name}`,
        callSiteLine: callLine,
        callType: "constructor",
      });
    }

    // Method calls
    for (const match of content.matchAll(METHOD_CALL_RE)) {
      const obj = match[1];
      const method = match[2];
      if (!(obj && method) || BUILTIN_GLOBALS.has(obj)) {
        continue;
      }
      const callLine = getLineNumber(content, match.index ?? 0);
      const enclosingFunc = findEnclosing(functionRanges, callLine);
      const callerId = enclosingFunc ?? `${filePath}:<module>`;

      edges.push({
        caller: callerId,
        callee: `*:${obj}.${method}`,
        callSiteLine: callLine,
        callType: "method",
      });
    }

    return edges;
  }

  private buildFunctionRanges(
    filePath: string,
    content: string
  ): Array<{ id: string; startLine: number; endLine: number }> {
    const ranges: Array<{
      id: string;
      startLine: number;
      endLine: number;
    }> = [];
    const lines = content.split("\n");

    for (const match of content.matchAll(FUNC_DEF_RE)) {
      const name = match[1] ?? match[2];
      if (!name) {
        continue;
      }
      const startLine = getLineNumber(content, match.index ?? 0);
      // Estimate end line by counting braces
      let braceCount = 0;
      let endLine = startLine;
      let started = false;

      for (let i = startLine - 1; i < lines.length; i++) {
        const line = lines[i] ?? "";
        for (const ch of line) {
          if (ch === "{") {
            braceCount++;
            started = true;
          } else if (ch === "}") {
            braceCount--;
          }
        }
        if (started && braceCount <= 0) {
          endLine = i + 1;
          break;
        }
      }

      ranges.push({ id: `${filePath}:${name}`, startLine, endLine });
    }

    return ranges;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getLineNumber(content: string, charIndex: number): number {
  let line = 1;
  for (let i = 0; i < charIndex && i < content.length; i++) {
    if (content[i] === "\n") {
      line++;
    }
  }
  return line;
}

function findEnclosing(
  ranges: Array<{ id: string; startLine: number; endLine: number }>,
  line: number
): string | undefined {
  for (const range of ranges) {
    if (line >= range.startLine && line <= range.endLine) {
      return range.id;
    }
  }
  return undefined;
}
