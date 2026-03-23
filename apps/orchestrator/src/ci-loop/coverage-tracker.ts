import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:ci-loop:coverage-tracker");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileCoverage {
  branches: { covered: number; total: number };
  filePath: string;
  functions: { covered: number; total: number };
  lines: { covered: number; total: number };
  statements: { covered: number; total: number };
}

export interface CoverageData {
  files: FileCoverage[];
  summary: CoverageSummary;
  timestamp: number;
}

export interface CoverageSummary {
  branchPct: number;
  functionPct: number;
  linePct: number;
  statementPct: number;
}

export interface CoverageTrendPoint {
  branchPct: number;
  functionPct: number;
  linePct: number;
  sessionId: string;
  statementPct: number;
  timestamp: number;
}

export interface UncoveredPath {
  branches: number;
  filePath: string;
  functions: number;
  lines: number;
}

// ---------------------------------------------------------------------------
// CoverageTracker
// ---------------------------------------------------------------------------

/**
 * Tracks code coverage data across sessions and projects. Stores per-session
 * coverage reports and provides trend analysis and uncovered-path detection.
 */
export class CoverageTracker {
  private readonly sessionCoverage = new Map<string, CoverageData>();
  private readonly projectCoverage = new Map<string, CoverageData[]>();

  /**
   * Record coverage data for a session.
   */
  recordCoverage(sessionId: string, coverageData: CoverageData): void {
    this.sessionCoverage.set(sessionId, coverageData);

    // Also append to project-level tracking if we have project context
    logger.info(
      {
        sessionId,
        linePct: coverageData.summary.linePct,
        fileCount: coverageData.files.length,
      },
      "Coverage recorded"
    );
  }

  /**
   * Record coverage for a specific project.
   */
  recordProjectCoverage(projectId: string, coverageData: CoverageData): void {
    const existing = this.projectCoverage.get(projectId) ?? [];
    existing.push(coverageData);
    this.projectCoverage.set(projectId, existing);

    logger.info(
      {
        projectId,
        linePct: coverageData.summary.linePct,
        historyLength: existing.length,
      },
      "Project coverage recorded"
    );
  }

  /**
   * Get the coverage report for a specific session.
   */
  getCoverageForSession(sessionId: string): CoverageData | null {
    return this.sessionCoverage.get(sessionId) ?? null;
  }

  /**
   * Get coverage trend over time for a project.
   */
  getCoverageTrend(projectId: string): CoverageTrendPoint[] {
    const history = this.projectCoverage.get(projectId) ?? [];

    return history.map((data, index) => ({
      sessionId: `session-${index}`,
      timestamp: data.timestamp,
      linePct: data.summary.linePct,
      branchPct: data.summary.branchPct,
      functionPct: data.summary.functionPct,
      statementPct: data.summary.statementPct,
    }));
  }

  /**
   * Get files and functions with no test coverage in a project.
   */
  getUncoveredPaths(projectId: string): UncoveredPath[] {
    const history = this.projectCoverage.get(projectId);
    if (!history || history.length === 0) {
      return [];
    }

    // Use the most recent coverage data
    const latest = history.at(-1);
    if (!latest) {
      return [];
    }

    const uncovered: UncoveredPath[] = [];

    for (const file of latest.files) {
      const uncoveredLines = file.lines.total - file.lines.covered;
      const uncoveredFunctions = file.functions.total - file.functions.covered;
      const uncoveredBranches = file.branches.total - file.branches.covered;

      // Report files with significant uncovered code
      if (uncoveredLines > 0 || uncoveredFunctions > 0) {
        uncovered.push({
          filePath: file.filePath,
          lines: uncoveredLines,
          functions: uncoveredFunctions,
          branches: uncoveredBranches,
        });
      }
    }

    // Sort by most uncovered lines first
    uncovered.sort((a, b) => b.lines - a.lines);

    logger.info(
      { projectId, uncoveredFileCount: uncovered.length },
      "Computed uncovered paths"
    );

    return uncovered;
  }

  /**
   * Parse a coverage JSON report (Istanbul/NYC format) into CoverageData.
   */
  parseCoverageJson(json: string): CoverageData {
    const raw = JSON.parse(json) as Record<
      string,
      {
        branchMap?: Record<string, unknown>;
        b?: Record<string, number[]>;
        fnMap?: Record<string, unknown>;
        f?: Record<string, number>;
        s?: Record<string, number>;
        statementMap?: Record<string, unknown>;
      }
    >;

    const files: FileCoverage[] = [];

    for (const [filePath, data] of Object.entries(raw)) {
      const statements = data.s ?? {};
      const functions = data.f ?? {};
      const branches = data.b ?? {};

      const stmtValues = Object.values(statements);
      const fnValues = Object.values(functions);
      const branchArrays = Object.values(branches);
      const branchValues = branchArrays.flat();

      files.push({
        filePath,
        lines: {
          total: stmtValues.length,
          covered: stmtValues.filter((v) => v > 0).length,
        },
        statements: {
          total: stmtValues.length,
          covered: stmtValues.filter((v) => v > 0).length,
        },
        functions: {
          total: fnValues.length,
          covered: fnValues.filter((v) => v > 0).length,
        },
        branches: {
          total: branchValues.length,
          covered: branchValues.filter((v) => v > 0).length,
        },
      });
    }

    const summary = this.computeSummary(files);

    return {
      files,
      summary,
      timestamp: Date.now(),
    };
  }

  private computeSummary(files: FileCoverage[]): CoverageSummary {
    let totalLines = 0;
    let coveredLines = 0;
    let totalBranches = 0;
    let coveredBranches = 0;
    let totalFunctions = 0;
    let coveredFunctions = 0;
    let totalStatements = 0;
    let coveredStatements = 0;

    for (const file of files) {
      totalLines += file.lines.total;
      coveredLines += file.lines.covered;
      totalBranches += file.branches.total;
      coveredBranches += file.branches.covered;
      totalFunctions += file.functions.total;
      coveredFunctions += file.functions.covered;
      totalStatements += file.statements.total;
      coveredStatements += file.statements.covered;
    }

    return {
      linePct: totalLines > 0 ? (coveredLines / totalLines) * 100 : 0,
      branchPct:
        totalBranches > 0 ? (coveredBranches / totalBranches) * 100 : 0,
      functionPct:
        totalFunctions > 0 ? (coveredFunctions / totalFunctions) * 100 : 0,
      statementPct:
        totalStatements > 0 ? (coveredStatements / totalStatements) * 100 : 0,
    };
  }
}
