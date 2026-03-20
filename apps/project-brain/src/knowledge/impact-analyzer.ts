/**
 * Phase 5.4: Change Impact Analysis.
 *
 * Combines call graph, type hierarchy, and data flow analysis
 * to determine the blast radius of code changes, identify affected
 * tests, and calculate risk scores.
 */
import { createLogger } from "@prometheus/logger";

import type { CallGraphBuilder } from "./call-graph";
import type { DataFlowAnalyzer } from "./data-flow";
import type { TypeHierarchyBuilder } from "./type-hierarchy";

const logger = createLogger("project-brain:impact-analyzer-v2");

/** Patterns that identify test files. */
const TEST_FILE_PATTERNS = [
  /\.test\./,
  /\.spec\./,
  /__tests__\//,
  /\.e2e\./,
  /\.integration\./,
];

/** Result of a change impact analysis. */
export interface ChangeImpactResult {
  /** Files and functions directly or transitively affected */
  affectedEntries: AffectedEntry[];
  /** Risk score from 0 (safe) to 1 (high risk) */
  riskScore: number;
  /** Test files that may need re-running */
  testsAffected: string[];
}

/** A single affected file or function. */
export interface AffectedEntry {
  file: string;
  functionName?: string;
  /** How this entry is affected: direct caller, type dependent, data consumer */
  reason: "caller" | "data_consumer" | "type_dependent";
}

/**
 * Analyzes the impact of code changes by combining multiple
 * graph sources: call graph, type hierarchy, and data flow.
 */
export class ChangeImpactAnalyzer {
  private readonly callGraph: CallGraphBuilder;
  private readonly typeHierarchy: TypeHierarchyBuilder;
  private readonly dataFlow: DataFlowAnalyzer;

  constructor(
    callGraph: CallGraphBuilder,
    typeHierarchy: TypeHierarchyBuilder,
    dataFlow: DataFlowAnalyzer
  ) {
    this.callGraph = callGraph;
    this.typeHierarchy = typeHierarchy;
    this.dataFlow = dataFlow;
  }

  /**
   * Analyze the impact of changes to a set of files.
   * Returns affected files/functions, affected tests, and a risk score.
   */
  analyzeImpact(changedFiles: string[]): ChangeImpactResult {
    const start = performance.now();
    const affected = new Map<string, AffectedEntry>();

    for (const file of changedFiles) {
      // Find callers of functions in the changed file
      this.findAffectedCallers(file, affected);

      // Find types that depend on types in the changed file
      this.findAffectedTypes(file, affected);

      // Find consumers of data from the changed file
      this.findAffectedConsumers(file, affected);
    }

    const entries = [...affected.values()];
    const changedSet = new Set(changedFiles);

    // Filter to entries not in the changed files themselves
    const externalEntries = entries.filter(
      (entry) => !changedSet.has(entry.file)
    );

    // Identify affected test files
    const allFiles = new Set([
      ...changedFiles,
      ...externalEntries.map((e) => e.file),
    ]);
    const testsAffected = [...allFiles].filter((f) =>
      TEST_FILE_PATTERNS.some((p) => p.test(f))
    );

    // Calculate risk score
    const riskScore = this.computeRiskScore(
      externalEntries.length,
      testsAffected.length,
      changedFiles.length
    );

    const elapsed = Math.round(performance.now() - start);

    logger.info(
      {
        changedFiles: changedFiles.length,
        affectedCount: externalEntries.length,
        testsAffected: testsAffected.length,
        riskScore,
        durationMs: elapsed,
      },
      "Change impact analysis completed"
    );

    return {
      affectedEntries: externalEntries,
      testsAffected,
      riskScore,
    };
  }

  /**
   * Get test files that may need re-running given a set of changed files.
   */
  getTestsAffectedBy(changedFiles: string[]): string[] {
    const result = this.analyzeImpact(changedFiles);
    return result.testsAffected;
  }

  /**
   * Get a risk score (0-1) for a set of changed files based on fan-out.
   */
  getRiskScore(changedFiles: string[]): number {
    const result = this.analyzeImpact(changedFiles);
    return result.riskScore;
  }

  /**
   * Find functions that call functions in the changed file.
   */
  private findAffectedCallers(
    file: string,
    affected: Map<string, AffectedEntry>
  ): void {
    // Get all edges and find callees in this file
    const edges = this.callGraph.getAllEdges();
    for (const edge of edges) {
      if (edge.callee.file === file) {
        const key = `${edge.caller.file}#${edge.caller.functionName}`;
        if (!affected.has(key)) {
          affected.set(key, {
            file: edge.caller.file,
            functionName: edge.caller.functionName,
            reason: "caller",
          });
        }
      }
    }
  }

  /**
   * Find types that extend/implement types defined in the changed file.
   */
  private findAffectedTypes(
    file: string,
    affected: Map<string, AffectedEntry>
  ): void {
    const allEdges = this.typeHierarchy.getAllEdges();
    for (const edge of allEdges) {
      if (edge.file === file) {
        // The parent type is in the changed file; children are affected
        const children = this.typeHierarchy.getChildren(edge.parentType);
        for (const child of children) {
          const key = `type:${child.file}#${child.typeName}`;
          if (!affected.has(key)) {
            affected.set(key, {
              file: child.file,
              functionName: child.typeName,
              reason: "type_dependent",
            });
          }
        }
      }
    }
  }

  /**
   * Find functions that consume data produced by the changed file.
   */
  private findAffectedConsumers(
    file: string,
    affected: Map<string, AffectedEntry>
  ): void {
    const trackedFunctions = this.dataFlow.getTrackedFunctions();

    for (const fn of trackedFunctions) {
      const returnFlow = this.dataFlow.getReturnFlow(fn);
      if (returnFlow && returnFlow.sourceFile === file) {
        const consumers = this.dataFlow.getDataConsumers(fn);
        for (const consumer of consumers) {
          const key = `data:${consumer.consumerFile}#${consumer.consumerFunction}`;
          if (!affected.has(key)) {
            affected.set(key, {
              file: consumer.consumerFile,
              functionName: consumer.consumerFunction,
              reason: "data_consumer",
            });
          }
        }
      }
    }
  }

  /**
   * Compute a risk score from 0 (safe) to 1 (high risk).
   */
  private computeRiskScore(
    affectedCount: number,
    testCount: number,
    changedCount: number
  ): number {
    // Base risk from fan-out (logarithmic scale)
    const fanOutRisk = Math.min(1, Math.log2(1 + affectedCount) / 8);

    // Penalty if no tests cover the change
    const testPenalty = testCount === 0 ? 0.3 : 0;

    // Higher risk for more changed files
    const changeRisk = Math.min(0.2, changedCount * 0.04);

    const score = Math.min(1, fanOutRisk + testPenalty + changeRisk);
    return Math.round(score * 100) / 100;
  }
}
