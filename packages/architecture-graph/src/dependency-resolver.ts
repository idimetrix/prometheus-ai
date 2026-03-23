import { createLogger } from "@prometheus/logger";

const logger = createLogger("architecture-graph:dependency-resolver");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DependencyEntry {
  /** Direct dependencies (IDs of other entries) */
  dependencies: string[];
  /** File path or module identifier */
  id: string;
}

export interface CircularDependency {
  /** The cycle represented as an ordered list of IDs */
  cycle: string[];
}

export interface DependencyResolutionResult {
  /** Detected circular dependency chains */
  circularDependencies: CircularDependency[];
  /** Topologically sorted order (if no cycles, otherwise best-effort) */
  order: string[];
  /** Map from each ID to its full set of transitive dependencies */
  transitiveDeps: Map<string, Set<string>>;
}

// ---------------------------------------------------------------------------
// DependencyResolver
// ---------------------------------------------------------------------------

/**
 * Resolves file/module dependencies and detects circular dependency chains.
 *
 * Accepts an array of dependency entries and produces:
 * - A topological sort order for build / evaluation ordering
 * - A list of all circular dependency cycles
 * - A transitive dependency map for each entry
 */
export class DependencyResolver {
  private readonly adjacency = new Map<string, Set<string>>();

  /**
   * Load dependency entries into the resolver.
   * Replaces any previously loaded data.
   */
  load(entries: DependencyEntry[]): void {
    this.adjacency.clear();

    // Ensure all IDs are present in the adjacency map
    for (const entry of entries) {
      if (!this.adjacency.has(entry.id)) {
        this.adjacency.set(entry.id, new Set());
      }
      for (const dep of entry.dependencies) {
        this.adjacency.get(entry.id)?.add(dep);
        // Ensure the dep node exists even if it has no own entry
        if (!this.adjacency.has(dep)) {
          this.adjacency.set(dep, new Set());
        }
      }
    }

    logger.debug(
      { entries: entries.length, nodes: this.adjacency.size },
      "Dependencies loaded"
    );
  }

  /**
   * Resolve dependencies: detect cycles, compute topological order,
   * and build transitive dependency sets.
   */
  resolve(): DependencyResolutionResult {
    const circularDependencies = this.detectCycles();
    const order = this.topologicalSort();
    const transitiveDeps = this.computeTransitiveDeps();

    logger.info(
      {
        nodes: this.adjacency.size,
        cycles: circularDependencies.length,
        orderedCount: order.length,
      },
      "Dependency resolution complete"
    );

    return { order, circularDependencies, transitiveDeps };
  }

  // -------------------------------------------------------------------------
  // Cycle detection (Johnson's simplified DFS-based approach)
  // -------------------------------------------------------------------------

  private detectCycles(): CircularDependency[] {
    const cycles: CircularDependency[] = [];
    const visited = new Set<string>();
    const stack = new Set<string>();
    const path: string[] = [];

    const dfs = (nodeId: string): void => {
      if (stack.has(nodeId)) {
        // Found a cycle – extract it from the path
        const cycleStart = path.indexOf(nodeId);
        if (cycleStart !== -1) {
          const cycle = path.slice(cycleStart);
          cycle.push(nodeId); // close the cycle
          cycles.push({ cycle });
        }
        return;
      }

      if (visited.has(nodeId)) {
        return;
      }

      visited.add(nodeId);
      stack.add(nodeId);
      path.push(nodeId);

      const deps = this.adjacency.get(nodeId);
      if (deps) {
        for (const dep of deps) {
          dfs(dep);
        }
      }

      path.pop();
      stack.delete(nodeId);
    };

    for (const nodeId of this.adjacency.keys()) {
      if (!visited.has(nodeId)) {
        dfs(nodeId);
      }
    }

    return cycles;
  }

  // -------------------------------------------------------------------------
  // Topological sort (Kahn's algorithm)
  // -------------------------------------------------------------------------

  private computeInDegrees(): Map<string, number> {
    const inDegree = new Map<string, number>();
    for (const id of this.adjacency.keys()) {
      if (!inDegree.has(id)) {
        inDegree.set(id, 0);
      }
    }
    for (const [, deps] of this.adjacency) {
      for (const dep of deps) {
        inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
      }
    }
    return inDegree;
  }

  private topologicalSort(): string[] {
    const inDegree = this.computeInDegrees();

    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) {
        queue.push(id);
      }
    }

    const order: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      order.push(current);
      this.decrementDependents(current, inDegree, queue);
    }

    return order;
  }

  private decrementDependents(
    nodeId: string,
    inDegree: Map<string, number>,
    queue: string[]
  ): void {
    const deps = this.adjacency.get(nodeId);
    if (!deps) {
      return;
    }
    for (const dep of deps) {
      const newDegree = (inDegree.get(dep) ?? 1) - 1;
      inDegree.set(dep, newDegree);
      if (newDegree === 0) {
        queue.push(dep);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Transitive dependency computation
  // -------------------------------------------------------------------------

  private computeTransitiveDeps(): Map<string, Set<string>> {
    const cache = new Map<string, Set<string>>();

    const resolve = (nodeId: string, visiting: Set<string>): Set<string> => {
      if (cache.has(nodeId)) {
        return cache.get(nodeId) as Set<string>;
      }

      const result = new Set<string>();
      const directDeps = this.adjacency.get(nodeId);
      if (directDeps) {
        for (const dep of directDeps) {
          result.add(dep);
          // Guard against cycles during transitive resolution
          if (!visiting.has(dep)) {
            visiting.add(dep);
            const transitive = resolve(dep, visiting);
            for (const t of transitive) {
              result.add(t);
            }
            visiting.delete(dep);
          }
        }
      }

      cache.set(nodeId, result);
      return result;
    };

    for (const nodeId of this.adjacency.keys()) {
      if (!cache.has(nodeId)) {
        resolve(nodeId, new Set([nodeId]));
      }
    }

    return cache;
  }

  /** Clear all loaded dependency data */
  clear(): void {
    this.adjacency.clear();
  }
}
