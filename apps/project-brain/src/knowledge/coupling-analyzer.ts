/**
 * Phase 5.6: Coupling-Aware Task Decomposition Helper.
 *
 * Calculates coupling scores between files, clusters files into
 * coupled groups, and suggests task boundaries for splitting work.
 */
import { createLogger } from "@prometheus/logger";

import type { CallGraphBuilder } from "./call-graph";
import type { DependencyVisualizer } from "./dependency-viz";
import type { TypeHierarchyBuilder } from "./type-hierarchy";

const logger = createLogger("project-brain:coupling-analyzer");

/** A group of tightly coupled files. */
export interface CoupledGroup {
  /** Average coupling score within the group */
  avgCoupling: number;
  /** Files in this group */
  files: string[];
}

/** A suggested task boundary for splitting work. */
export interface TaskBoundary {
  /** Description of the suggested task */
  description: string;
  /** Files that belong to this task boundary */
  files: string[];
  /** Suggested priority: higher means more core/shared */
  priority: number;
}

/**
 * Analyzes coupling between files and suggests task boundaries.
 */
export class CouplingAnalyzer {
  private readonly callGraph: CallGraphBuilder;
  private readonly typeHierarchy: TypeHierarchyBuilder;
  private readonly depViz: DependencyVisualizer;

  constructor(
    callGraph: CallGraphBuilder,
    typeHierarchy: TypeHierarchyBuilder,
    depViz: DependencyVisualizer
  ) {
    this.callGraph = callGraph;
    this.typeHierarchy = typeHierarchy;
    this.depViz = depViz;
  }

  /**
   * Calculate a coupling score between two files (0 = independent, 1 = tightly coupled).
   *
   * Factors in:
   * - Direct import relationship
   * - Shared function calls
   * - Shared type relationships
   */
  getCouplingScore(fileA: string, fileB: string): number {
    let score = 0;

    // Check direct dependency (imports)
    const fileGraph = this.depViz.getFileDependencyGraph();
    const aImportsB = fileGraph.edges.some(
      (e) => e.source === fileA && e.target === fileB
    );
    const bImportsA = fileGraph.edges.some(
      (e) => e.source === fileB && e.target === fileA
    );

    if (aImportsB || bImportsA) {
      score += 0.4;
    }
    if (aImportsB && bImportsA) {
      score += 0.2; // Bidirectional dependency is stronger coupling
    }

    // Check call graph relationships
    const callEdges = this.callGraph.getAllEdges();
    const sharedCalls = callEdges.filter(
      (e) =>
        (e.caller.file === fileA && e.callee.file === fileB) ||
        (e.caller.file === fileB && e.callee.file === fileA)
    );
    if (sharedCalls.length > 0) {
      score += Math.min(0.3, sharedCalls.length * 0.1);
    }

    // Check type hierarchy relationships
    const typeEdges = this.typeHierarchy.getAllEdges();
    const sharedTypes = typeEdges.filter((e) => {
      const files = new Set([fileA, fileB]);
      return files.has(e.file);
    });
    if (sharedTypes.length > 0) {
      score += Math.min(0.2, sharedTypes.length * 0.1);
    }

    return Math.min(1, Math.round(score * 100) / 100);
  }

  /**
   * Cluster files into groups based on coupling strength.
   * Uses a simple greedy agglomerative approach.
   */
  getCoupledFileGroups(files: string[]): CoupledGroup[] {
    if (files.length <= 1) {
      return files.map((f) => ({ files: [f], avgCoupling: 1 }));
    }

    const couplingThreshold = 0.3;

    // Build coupling matrix
    const couplings = new Map<string, number>();
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const a = files[i] as string;
        const b = files[j] as string;
        const score = this.getCouplingScore(a, b);
        couplings.set(`${a}::${b}`, score);
      }
    }

    // Greedy clustering: assign files to groups based on coupling
    const assigned = new Set<string>();
    const groups: CoupledGroup[] = [];

    for (const file of files) {
      if (assigned.has(file)) {
        continue;
      }

      const group: string[] = [file];
      assigned.add(file);

      // Find all files coupled to this one above threshold
      for (const other of files) {
        if (assigned.has(other)) {
          continue;
        }

        const key1 = `${file}::${other}`;
        const key2 = `${other}::${file}`;
        const score = couplings.get(key1) ?? couplings.get(key2) ?? 0;

        if (score >= couplingThreshold) {
          group.push(other);
          assigned.add(other);
        }
      }

      // Calculate average coupling within the group
      let totalCoupling = 0;
      let pairCount = 0;
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i] as string;
          const b = group[j] as string;
          const key1 = `${a}::${b}`;
          const key2 = `${b}::${a}`;
          totalCoupling += couplings.get(key1) ?? couplings.get(key2) ?? 0;
          pairCount++;
        }
      }

      groups.push({
        files: group,
        avgCoupling:
          pairCount > 0
            ? Math.round((totalCoupling / pairCount) * 100) / 100
            : 1,
      });
    }

    logger.debug(
      { fileCount: files.length, groupCount: groups.length },
      "File coupling groups computed"
    );

    return groups;
  }

  /**
   * Suggest task boundaries for splitting work on a set of changed files.
   * Groups files by coupling and assigns priorities based on fan-out.
   */
  suggestTaskBoundaries(changedFiles: string[]): TaskBoundary[] {
    const groups = this.getCoupledFileGroups(changedFiles);
    const fileGraph = this.depViz.getFileDependencyGraph();

    const boundaries: TaskBoundary[] = [];

    for (const group of groups) {
      // Count how many other files depend on files in this group
      const dependentCount = fileGraph.edges.filter(
        (e) => group.files.includes(e.target) && !group.files.includes(e.source)
      ).length;

      // Higher priority for files with more dependents (shared/core code)
      const priority = Math.min(10, 1 + dependentCount);

      const description = this.describeTaskGroup(group.files);

      boundaries.push({
        files: group.files,
        priority,
        description,
      });
    }

    // Sort by priority descending (most important first)
    boundaries.sort((a, b) => b.priority - a.priority);

    logger.info(
      {
        changedFiles: changedFiles.length,
        boundaries: boundaries.length,
      },
      "Task boundaries suggested"
    );

    return boundaries;
  }

  /**
   * Generate a human-readable description for a task group.
   */
  private describeTaskGroup(files: string[]): string {
    if (files.length === 1) {
      return `Update ${extractFileName(files[0] as string)}`;
    }

    // Find common directory
    const dirs = files.map((f) => {
      const parts = f.split("/");
      parts.pop();
      return parts.join("/");
    });
    const commonDir = findCommonPrefix(dirs);

    if (commonDir) {
      return `Update ${files.length} coupled files in ${commonDir}`;
    }

    return `Update ${files.length} coupled files`;
  }
}

function extractFileName(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}

function findCommonPrefix(strings: string[]): string {
  if (strings.length === 0) {
    return "";
  }
  if (strings.length === 1) {
    return strings[0] ?? "";
  }

  const first = strings[0] ?? "";
  let prefix = first;

  for (let i = 1; i < strings.length; i++) {
    const s = strings[i] ?? "";
    while (!s.startsWith(prefix) && prefix.length > 0) {
      prefix = prefix.slice(0, prefix.lastIndexOf("/"));
    }
  }

  return prefix;
}
