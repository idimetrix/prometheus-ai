/**
 * Impact Analysis Engine.
 *
 * Traverses the code knowledge graph to determine the blast radius
 * of a code change, identifying direct dependents, transitive dependents,
 * affected test files, and an overall risk score.
 */

import { db, graphEdges, graphNodes } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { and, eq, inArray, or } from "drizzle-orm";

const logger = createLogger("project-brain:impact-analysis");

const FILE_PREFIX_RE = /^file:/;

/**
 * Result of an impact analysis for a given file/symbol change.
 */
export interface ImpactResult {
  /** Test files that exercise the changed file/symbol */
  affectedTests: string[];
  /** Files that directly depend on the changed file/symbol */
  directDependents: string[];
  /** Risk score from 0 (safe) to 1 (high risk) */
  riskScore: number;
  /** Files that transitively depend on the changed file/symbol */
  transitiveDependents: string[];
}

/** Maximum traversal depth for transitive dependency analysis. */
const MAX_TRAVERSAL_DEPTH = 5;

/** Edge types that indicate a dependency relationship. */
const DEPENDENCY_EDGE_TYPES = [
  "imports",
  "depends_on",
  "calls",
  "uses_type",
] as const;

/** Patterns that identify test files. */
const TEST_FILE_PATTERNS = [
  /\.test\./,
  /\.spec\./,
  /__tests__\//,
  /\.e2e\./,
  /\.integration\./,
];

/**
 * Analyzes the impact (blast radius) of a code change by traversing
 * the project knowledge graph.
 *
 * @example
 * ```ts
 * const analyzer = new ImpactAnalyzer();
 * const impact = await analyzer.analyzeImpact("proj_123", "src/auth/login.ts");
 * console.log(`Risk: ${impact.riskScore}, Tests: ${impact.affectedTests.length}`);
 * ```
 */
export class ImpactAnalyzer {
  /**
   * Analyze the impact of a change to a file or symbol.
   *
   * @param projectId - The project identifier
   * @param filePath - Path of the changed file
   * @param symbolName - Optional specific symbol within the file
   * @returns Impact result with dependents, affected tests, and risk score
   */
  async analyzeImpact(
    projectId: string,
    filePath: string,
    symbolName?: string
  ): Promise<ImpactResult> {
    const start = performance.now();

    const nodeId = symbolName
      ? `fn:${filePath}:${symbolName}`
      : `file:${filePath}`;

    // Find direct dependents (1-hop reverse traversal)
    const directDependents = await this.findDirectDependents(
      projectId,
      nodeId,
      filePath
    );

    // Find transitive dependents (multi-hop)
    const transitiveDependents = await this.findTransitiveDependents(
      projectId,
      directDependents
    );

    // Identify affected test files
    const allDependents = [
      ...new Set([filePath, ...directDependents, ...transitiveDependents]),
    ];
    const affectedTests = allDependents.filter((dep) =>
      TEST_FILE_PATTERNS.some((pattern) => pattern.test(dep))
    );

    // Also find test files that import any of the affected files
    const testImporters = await this.findTestImporters(
      projectId,
      allDependents
    );
    const allAffectedTests = [...new Set([...affectedTests, ...testImporters])];

    // Calculate risk score
    const riskScore = this.calculateRiskScore(
      directDependents.length,
      transitiveDependents.length,
      allAffectedTests.length
    );

    const elapsed = Math.round(performance.now() - start);

    logger.info(
      {
        projectId,
        filePath,
        symbolName,
        directCount: directDependents.length,
        transitiveCount: transitiveDependents.length,
        testCount: allAffectedTests.length,
        riskScore,
        durationMs: elapsed,
      },
      "Impact analysis completed"
    );

    return {
      directDependents,
      transitiveDependents,
      affectedTests: allAffectedTests,
      riskScore,
    };
  }

  /**
   * Find files that directly depend on the given node.
   */
  private async findDirectDependents(
    projectId: string,
    nodeId: string,
    filePath: string
  ): Promise<string[]> {
    // Find edges where the target is our file/symbol
    const edges = await db
      .select({
        sourceId: graphEdges.sourceId,
      })
      .from(graphEdges)
      .where(
        and(
          eq(graphEdges.projectId, projectId),
          or(
            eq(graphEdges.targetId, nodeId),
            eq(graphEdges.targetId, `file:${filePath}`)
          ),
          inArray(graphEdges.edgeType, DEPENDENCY_EDGE_TYPES)
        )
      )
      .limit(200);

    // Resolve source IDs to file paths
    const sourceIds = [...new Set(edges.map((e) => e.sourceId))];
    if (sourceIds.length === 0) {
      return [];
    }

    const nodes = await db
      .select({ filePath: graphNodes.filePath })
      .from(graphNodes)
      .where(inArray(graphNodes.id, sourceIds));

    const dependents = [
      ...new Set(
        nodes
          .map((n) => n.filePath)
          .filter((p): p is string => p !== null && p !== filePath)
      ),
    ];

    return dependents;
  }

  /**
   * Find transitive dependents by walking the graph outward from
   * direct dependents up to MAX_TRAVERSAL_DEPTH hops.
   */
  private async findTransitiveDependents(
    projectId: string,
    directDependents: string[]
  ): Promise<string[]> {
    if (directDependents.length === 0) {
      return [];
    }

    const visited = new Set(directDependents);
    let frontier = directDependents.map((fp) => `file:${fp}`);

    for (
      let depth = 0;
      depth < MAX_TRAVERSAL_DEPTH && frontier.length > 0;
      depth++
    ) {
      const edges = await db
        .select({ sourceId: graphEdges.sourceId })
        .from(graphEdges)
        .where(
          and(
            eq(graphEdges.projectId, projectId),
            inArray(graphEdges.targetId, frontier),
            inArray(graphEdges.edgeType, DEPENDENCY_EDGE_TYPES)
          )
        )
        .limit(500);

      const newSourceIds = edges
        .map((e) => e.sourceId)
        .filter((id) => !visited.has(id.replace(FILE_PREFIX_RE, "")));

      if (newSourceIds.length === 0) {
        break;
      }

      // Resolve to file paths
      const nodes = await db
        .select({ id: graphNodes.id, filePath: graphNodes.filePath })
        .from(graphNodes)
        .where(inArray(graphNodes.id, newSourceIds));

      const newFilePaths: string[] = [];
      const nextFrontier: string[] = [];

      for (const node of nodes) {
        if (node.filePath && !visited.has(node.filePath)) {
          visited.add(node.filePath);
          newFilePaths.push(node.filePath);
          nextFrontier.push(node.id);
        }
      }

      frontier = nextFrontier;
    }

    // Remove direct dependents from the transitive set
    const directSet = new Set(directDependents);
    return [...visited].filter((fp) => !directSet.has(fp));
  }

  /**
   * Find test files that import any of the affected files.
   */
  private async findTestImporters(
    projectId: string,
    affectedFiles: string[]
  ): Promise<string[]> {
    if (affectedFiles.length === 0) {
      return [];
    }

    const targetIds = affectedFiles.map((fp) => `file:${fp}`);

    const edges = await db
      .select({ sourceId: graphEdges.sourceId })
      .from(graphEdges)
      .where(
        and(
          eq(graphEdges.projectId, projectId),
          inArray(graphEdges.targetId, targetIds),
          eq(graphEdges.edgeType, "imports")
        )
      )
      .limit(500);

    const sourceIds = [...new Set(edges.map((e) => e.sourceId))];
    if (sourceIds.length === 0) {
      return [];
    }

    const nodes = await db
      .select({ filePath: graphNodes.filePath })
      .from(graphNodes)
      .where(inArray(graphNodes.id, sourceIds));

    return nodes
      .map((n) => n.filePath)
      .filter(
        (fp): fp is string =>
          fp !== null && TEST_FILE_PATTERNS.some((pattern) => pattern.test(fp))
      );
  }

  /**
   * Calculate a risk score from 0 (safe) to 1 (high risk).
   *
   * Factors: number of direct dependents, transitive dependents,
   * and whether tests are affected (higher risk if no tests cover the change).
   */
  private calculateRiskScore(
    directCount: number,
    transitiveCount: number,
    testCount: number
  ): number {
    // Base risk from dependency count (logarithmic scale)
    const depRisk = Math.min(
      1,
      Math.log2(1 + directCount + transitiveCount * 0.5) / 8
    );

    // Test coverage factor: if no tests are affected, risk is higher
    const testPenalty = testCount === 0 ? 0.3 : 0;

    // Direct dependents weight more than transitive
    const directWeight = Math.min(0.3, directCount * 0.05);

    const score = Math.min(1, depRisk + testPenalty + directWeight);

    return Math.round(score * 100) / 100;
  }
}
