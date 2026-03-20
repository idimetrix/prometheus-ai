/**
 * Phase 5.5: Dependency Visualization Data.
 *
 * Generates graph data structures suitable for visualization,
 * including package-level and file-level dependency graphs,
 * and circular dependency detection.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:dependency-viz");

/** A node in the visualization graph. */
export interface VizNode {
  id: string;
  label: string;
  type: "file" | "package" | "directory";
}

/** An edge in the visualization graph. */
export interface VizEdge {
  source: string;
  target: string;
  type: "depends_on" | "exports" | "imports";
}

/** Complete graph data for visualization. */
export interface VizGraph {
  edges: VizEdge[];
  nodes: VizNode[];
}

/** A circular dependency cycle. */
export interface DependencyCycle {
  /** Files or packages involved in the cycle */
  members: string[];
  /** Number of nodes in the cycle */
  size: number;
}

/**
 * Generates dependency visualization data from file and package imports.
 */
export class DependencyVisualizer {
  /** Package-level imports: packageA -> Set<packageB> */
  private readonly packageDeps = new Map<string, Set<string>>();

  /** File-level imports: fileA -> Set<fileB> */
  private readonly fileDeps = new Map<string, Set<string>>();

  /** File -> package mapping */
  private readonly fileToPackage = new Map<string, string>();

  /**
   * Register a file-level dependency.
   */
  addFileDependency(sourceFile: string, targetFile: string): void {
    if (!this.fileDeps.has(sourceFile)) {
      this.fileDeps.set(sourceFile, new Set());
    }
    this.fileDeps.get(sourceFile)?.add(targetFile);
  }

  /**
   * Register a package-level dependency.
   */
  addPackageDependency(sourcePackage: string, targetPackage: string): void {
    if (sourcePackage === targetPackage) {
      return;
    }

    if (!this.packageDeps.has(sourcePackage)) {
      this.packageDeps.set(sourcePackage, new Set());
    }
    this.packageDeps.get(sourcePackage)?.add(targetPackage);
  }

  /**
   * Register a file to package mapping.
   */
  setFilePackage(file: string, packageName: string): void {
    this.fileToPackage.set(file, packageName);
  }

  /**
   * Get the package-level dependency graph.
   */
  getPackageDependencyGraph(): VizGraph {
    const nodes: VizNode[] = [];
    const edges: VizEdge[] = [];
    const seen = new Set<string>();

    for (const [source, targets] of this.packageDeps) {
      if (!seen.has(source)) {
        seen.add(source);
        nodes.push({ id: source, label: source, type: "package" });
      }

      for (const target of targets) {
        if (!seen.has(target)) {
          seen.add(target);
          nodes.push({ id: target, label: target, type: "package" });
        }
        edges.push({ source, target, type: "depends_on" });
      }
    }

    logger.debug(
      { nodeCount: nodes.length, edgeCount: edges.length },
      "Package dependency graph generated"
    );

    return { nodes, edges };
  }

  /**
   * Get the file-level dependency graph, optionally filtered to a directory.
   */
  getFileDependencyGraph(directory?: string): VizGraph {
    const nodes: VizNode[] = [];
    const edges: VizEdge[] = [];
    const seen = new Set<string>();

    for (const [source, targets] of this.fileDeps) {
      if (directory && !source.startsWith(directory)) {
        continue;
      }

      if (!seen.has(source)) {
        seen.add(source);
        nodes.push({
          id: source,
          label: extractFileName(source),
          type: "file",
        });
      }

      for (const target of targets) {
        if (directory && !target.startsWith(directory)) {
          continue;
        }

        if (!seen.has(target)) {
          seen.add(target);
          nodes.push({
            id: target,
            label: extractFileName(target),
            type: "file",
          });
        }
        edges.push({ source, target, type: "imports" });
      }
    }

    logger.debug(
      { directory, nodeCount: nodes.length, edgeCount: edges.length },
      "File dependency graph generated"
    );

    return { nodes, edges };
  }

  /**
   * Detect circular dependencies in both file and package graphs.
   * Returns all cycles found.
   */
  detectCircularDependencies(): DependencyCycle[] {
    const cycles: DependencyCycle[] = [];

    // Detect cycles in package graph
    const packageCycles = this.findCycles(this.packageDeps);
    for (const cycle of packageCycles) {
      cycles.push({ members: cycle, size: cycle.length });
    }

    // Detect cycles in file graph
    const fileCycles = this.findCycles(this.fileDeps);
    for (const cycle of fileCycles) {
      cycles.push({ members: cycle, size: cycle.length });
    }

    logger.info(
      {
        packageCycles: packageCycles.length,
        fileCycles: fileCycles.length,
        totalCycles: cycles.length,
      },
      "Circular dependency detection completed"
    );

    return cycles;
  }

  /**
   * Find cycles in a directed graph using iterative DFS.
   */
  private findCycles(adjacency: Map<string, Set<string>>): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const pathMap = new Map<string, string[]>();

    for (const startNode of adjacency.keys()) {
      if (visited.has(startNode)) {
        continue;
      }

      const stack: Array<{ node: string; iterator: Iterator<string> }> = [];
      stack.push({
        node: startNode,
        iterator: (adjacency.get(startNode) ?? new Set()).values(),
      });
      visited.add(startNode);
      inStack.add(startNode);
      pathMap.set(startNode, [startNode]);

      while (stack.length > 0) {
        const current = stack.at(-1);
        if (!current) {
          break;
        }

        const next = current.iterator.next();

        if (next.done) {
          inStack.delete(current.node);
          stack.pop();
          continue;
        }

        const neighbor = next.value;
        if (inStack.has(neighbor)) {
          // Found a cycle - extract it
          const currentPath = pathMap.get(current.node) ?? [];
          const cycleStart = currentPath.indexOf(neighbor);
          if (cycleStart >= 0) {
            cycles.push(currentPath.slice(cycleStart));
          } else {
            cycles.push([...currentPath, neighbor]);
          }
        } else if (!visited.has(neighbor)) {
          visited.add(neighbor);
          inStack.add(neighbor);
          const parentPath = pathMap.get(current.node) ?? [];
          pathMap.set(neighbor, [...parentPath, neighbor]);
          stack.push({
            node: neighbor,
            iterator: (adjacency.get(neighbor) ?? new Set()).values(),
          });
        }
      }
    }

    return cycles;
  }
}

/**
 * Extract just the file name from a path.
 */
function extractFileName(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}
