import { createLogger } from "@prometheus/logger";
import type { FailureAnalysis } from "./failure-analyzer";

const logger = createLogger("orchestrator:ci-loop:systemic");

export interface SystemicFailureGroup {
  commonPattern: string;
  failures: FailureAnalysis[];
  recommendedRole: string;
  rootCause: string;
  sharedFiles: string[];
}

/**
 * SystemicAnalyzer groups test failures by common root cause.
 * When 3+ failures share files or error patterns, escalates to
 * the architect agent instead of dispatching individual fixers.
 */
export class SystemicAnalyzer {
  private readonly escalationThreshold: number;

  constructor(escalationThreshold = 3) {
    this.escalationThreshold = escalationThreshold;
  }

  /**
   * Analyze failures for systemic patterns.
   */
  analyze(failures: FailureAnalysis[]): {
    systemic: SystemicFailureGroup[];
    isolated: FailureAnalysis[];
  } {
    const groups: SystemicFailureGroup[] = [];
    const grouped = new Set<string>();

    // Group by shared files
    const fileGroups = this.groupBySharedFiles(failures);
    for (const [_key, group] of fileGroups) {
      if (group.length >= this.escalationThreshold) {
        const sharedFiles = this.findSharedFiles(group);
        groups.push({
          rootCause: `Multiple failures related to: ${sharedFiles.join(", ")}`,
          failures: group,
          sharedFiles,
          commonPattern: this.findCommonPattern(group),
          recommendedRole: "architect",
        });
        for (const f of group) {
          grouped.add(f.testName);
        }
      }
    }

    // Group by error pattern
    const patternGroups = this.groupByErrorPattern(
      failures.filter((f) => !grouped.has(f.testName))
    );
    for (const [pattern, group] of patternGroups) {
      if (group.length >= this.escalationThreshold) {
        groups.push({
          rootCause: `Common error pattern: ${pattern}`,
          failures: group,
          sharedFiles: this.findSharedFiles(group),
          commonPattern: pattern,
          recommendedRole: "architect",
        });
        for (const f of group) {
          grouped.add(f.testName);
        }
      }
    }

    const isolated = failures.filter((f) => !grouped.has(f.testName));

    logger.info(
      {
        total: failures.length,
        systemicGroups: groups.length,
        isolated: isolated.length,
      },
      "Systemic analysis complete"
    );

    return { systemic: groups, isolated };
  }

  private groupBySharedFiles(
    failures: FailureAnalysis[]
  ): Map<string, FailureAnalysis[]> {
    const fileMap = new Map<string, FailureAnalysis[]>();

    for (const failure of failures) {
      for (const file of failure.affectedFiles) {
        const existing = fileMap.get(file) ?? [];
        existing.push(failure);
        fileMap.set(file, existing);
      }
    }

    return fileMap;
  }

  private groupByErrorPattern(
    failures: FailureAnalysis[]
  ): Map<string, FailureAnalysis[]> {
    const patternMap = new Map<string, FailureAnalysis[]>();

    for (const failure of failures) {
      // Normalize error to a pattern (remove specifics)
      const pattern = failure.rootCause
        .replace(/['"`].*?['"`]/g, "'...'")
        .replace(/\d+/g, "N")
        .replace(/at .*?:\d+:\d+/g, "at ...")
        .trim()
        .slice(0, 100);

      const existing = patternMap.get(pattern) ?? [];
      existing.push(failure);
      patternMap.set(pattern, existing);
    }

    return patternMap;
  }

  private findSharedFiles(failures: FailureAnalysis[]): string[] {
    if (failures.length === 0) {
      return [];
    }

    const fileCounts = new Map<string, number>();
    for (const f of failures) {
      for (const file of f.affectedFiles) {
        fileCounts.set(file, (fileCounts.get(file) ?? 0) + 1);
      }
    }

    // Return files that appear in 2+ failures
    return Array.from(fileCounts.entries())
      .filter(([, count]) => count >= 2)
      .sort(([, a], [, b]) => b - a)
      .map(([file]) => file);
  }

  private findCommonPattern(failures: FailureAnalysis[]): string {
    if (failures.length === 0) {
      return "unknown";
    }

    // Find the most common failure type
    const typeCounts = new Map<string, number>();
    for (const f of failures) {
      typeCounts.set(f.failureType, (typeCounts.get(f.failureType) ?? 0) + 1);
    }

    const sorted = Array.from(typeCounts.entries()).sort(
      ([, a], [, b]) => b - a
    );
    return sorted[0]?.[0] ?? "unknown";
  }
}
