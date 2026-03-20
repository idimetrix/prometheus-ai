/**
 * Phase 5.1: Call Graph Extraction.
 *
 * Builds and queries a call graph using an adjacency list representation.
 * Tracks caller-callee relationships between functions across files,
 * enabling transitive dependency analysis.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:call-graph");

/** A unique identifier for a function within the codebase. */
export interface FunctionRef {
  file: string;
  functionName: string;
}

/** An edge in the call graph from caller to callee. */
export interface CallEdge {
  callee: FunctionRef;
  caller: FunctionRef;
}

function refKey(file: string, functionName: string): string {
  return `${file}#${functionName}`;
}

/**
 * Builds and queries function-level call graphs.
 *
 * Uses an adjacency list internally to track caller-callee relationships
 * and supports forward/reverse traversal with depth limiting.
 */
export class CallGraphBuilder {
  /** Forward edges: caller -> Set<callee keys> */
  private readonly forward = new Map<string, Set<string>>();

  /** Reverse edges: callee -> Set<caller keys> */
  private readonly reverse = new Map<string, Set<string>>();

  /** Map from key to FunctionRef for resolution */
  private readonly refs = new Map<string, FunctionRef>();

  /**
   * Add a call edge from caller to callee.
   */
  addCall(
    callerFile: string,
    callerFunction: string,
    calleeFile: string,
    calleeFunction: string
  ): void {
    const callerKey = refKey(callerFile, callerFunction);
    const calleeKey = refKey(calleeFile, calleeFunction);

    this.refs.set(callerKey, {
      file: callerFile,
      functionName: callerFunction,
    });
    this.refs.set(calleeKey, {
      file: calleeFile,
      functionName: calleeFunction,
    });

    if (!this.forward.has(callerKey)) {
      this.forward.set(callerKey, new Set());
    }
    this.forward.get(callerKey)?.add(calleeKey);

    if (!this.reverse.has(calleeKey)) {
      this.reverse.set(calleeKey, new Set());
    }
    this.reverse.get(calleeKey)?.add(callerKey);

    logger.debug(
      { callerFile, callerFunction, calleeFile, calleeFunction },
      "Call edge added"
    );
  }

  /**
   * Get all functions that call the specified function.
   */
  getCallersOf(file: string, functionName: string): FunctionRef[] {
    const key = refKey(file, functionName);
    const callerKeys = this.reverse.get(key);
    if (!callerKeys) {
      return [];
    }

    return this.resolveKeys(callerKeys);
  }

  /**
   * Get all functions called by the specified function.
   */
  getCalleesOf(file: string, functionName: string): FunctionRef[] {
    const key = refKey(file, functionName);
    const calleeKeys = this.forward.get(key);
    if (!calleeKeys) {
      return [];
    }

    return this.resolveKeys(calleeKeys);
  }

  /**
   * Get transitive dependencies (callees) of a function, following
   * the call chain up to the specified depth.
   */
  getTransitiveDependencies(
    file: string,
    functionName: string,
    depth: number
  ): FunctionRef[] {
    const startKey = refKey(file, functionName);
    const visited = new Set<string>();
    visited.add(startKey);

    let frontier = new Set<string>();
    const initial = this.forward.get(startKey);
    if (initial) {
      for (const k of initial) {
        frontier.add(k);
      }
    }

    for (let d = 0; d < depth && frontier.size > 0; d++) {
      const nextFrontier = new Set<string>();

      for (const key of frontier) {
        if (visited.has(key)) {
          continue;
        }
        visited.add(key);

        const callees = this.forward.get(key);
        if (callees) {
          for (const callee of callees) {
            if (!visited.has(callee)) {
              nextFrontier.add(callee);
            }
          }
        }
      }

      frontier = nextFrontier;
    }

    // Remove the start node from results
    visited.delete(startKey);

    logger.debug(
      { file, functionName, depth, resultCount: visited.size },
      "Transitive dependencies computed"
    );

    return this.resolveKeys(visited);
  }

  /**
   * Get all edges in the call graph.
   */
  getAllEdges(): CallEdge[] {
    const edges: CallEdge[] = [];

    for (const [callerKey, calleeKeys] of this.forward) {
      const caller = this.refs.get(callerKey);
      if (!caller) {
        continue;
      }

      for (const calleeKey of calleeKeys) {
        const callee = this.refs.get(calleeKey);
        if (callee) {
          edges.push({ caller, callee });
        }
      }
    }

    return edges;
  }

  /**
   * Get the total number of functions tracked.
   */
  get size(): number {
    return this.refs.size;
  }

  /**
   * Resolve a set of keys to FunctionRef objects.
   */
  private resolveKeys(keys: Set<string>): FunctionRef[] {
    const results: FunctionRef[] = [];
    for (const key of keys) {
      const ref = this.refs.get(key);
      if (ref) {
        results.push(ref);
      }
    }
    return results;
  }
}
