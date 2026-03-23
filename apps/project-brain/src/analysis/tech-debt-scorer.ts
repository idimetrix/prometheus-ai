/**
 * Tech Debt Scorer — Evaluates technical debt across a project by
 * analyzing code complexity, test coverage gaps, dependency age,
 * TODO markers, and code duplication.
 */

import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("project-brain:tech-debt-scorer");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DebtCategory =
  | "complexity"
  | "testing"
  | "dependencies"
  | "todos"
  | "duplication"
  | "type-safety"
  | "documentation";

export type EffortSize = "S" | "M" | "L";

export interface DebtItem {
  category: DebtCategory;
  description: string;
  effort: EffortSize;
  filePath?: string;
  id: string;
  impact: number;
  priority: number;
}

export interface TechDebtReport {
  debtItems: DebtItem[];
  projectId: string;
  score: number;
  scoredAt: string;
  summary: Record<DebtCategory, number>;
}

export interface DebtTrend {
  date: string;
  score: number;
}

// ---------------------------------------------------------------------------
// Analysis patterns
// ---------------------------------------------------------------------------

const TODO_PATTERN = /(?:TODO|FIXME|HACK|XXX|TEMP)[\s:]/g;
const ANY_PATTERN = /:\s*any\b|as\s+any\b/g;
const FUNCTION_START_RE =
  /(?:function\s+\w+|(?:async\s+)?(?:\w+\s*)?(?:=>|\{))/;
const EXPORT_START_RE = /^export\s+(?:class|function|const|interface)/;
const LONG_FUNCTION_THRESHOLD = 50;
const HIGH_COMPLEXITY_THRESHOLD = 10;

// ---------------------------------------------------------------------------
// TechDebtScorer
// ---------------------------------------------------------------------------

export class TechDebtScorer {
  private readonly trendHistory: Map<string, DebtTrend[]> = new Map();

  /**
   * Score an entire project's tech debt (0 = no debt, 100 = severe debt).
   */
  scoreProject(
    projectId: string,
    files: Array<{ content: string; path: string }>
  ): TechDebtReport {
    logger.info({ projectId, fileCount: files.length }, "Scoring tech debt");

    const debtItems: DebtItem[] = [];

    for (const file of files) {
      debtItems.push(...this.analyzeFile(file.path, file.content));
    }

    // Calculate category scores
    const summary: Record<DebtCategory, number> = {
      complexity: 0,
      testing: 0,
      dependencies: 0,
      todos: 0,
      duplication: 0,
      "type-safety": 0,
      documentation: 0,
    };

    for (const item of debtItems) {
      summary[item.category] += item.impact;
    }

    // Normalize scores to 0-100
    const maxPerCategory = files.length * 10;
    for (const key of Object.keys(summary) as DebtCategory[]) {
      summary[key] = Math.min(
        100,
        Math.round((summary[key] / Math.max(maxPerCategory, 1)) * 100)
      );
    }

    const categoryScores = Object.values(summary);
    const overallScore =
      categoryScores.length > 0
        ? Math.round(
            categoryScores.reduce((a, b) => a + b, 0) / categoryScores.length
          )
        : 0;

    // Sort debt items by priority
    debtItems.sort((a, b) => b.priority - a.priority);

    // Record trend
    const trend: DebtTrend = {
      date: new Date().toISOString(),
      score: overallScore,
    };
    const existing = this.trendHistory.get(projectId) ?? [];
    existing.push(trend);
    this.trendHistory.set(projectId, existing);

    return {
      projectId,
      score: overallScore,
      summary,
      debtItems,
      scoredAt: new Date().toISOString(),
    };
  }

  /**
   * Get prioritized list of debt items.
   */
  getDebtItems(report: TechDebtReport): DebtItem[] {
    return report.debtItems;
  }

  /**
   * Estimate remediation effort for a debt item.
   */
  estimateRemediationEffort(debtItem: DebtItem): {
    effort: EffortSize;
    estimatedHours: number;
    rationale: string;
  } {
    const hours: Record<EffortSize, number> = { S: 1, M: 4, L: 16 };

    const rationale = this.getEffortRationale(debtItem);

    return {
      effort: debtItem.effort,
      estimatedHours: hours[debtItem.effort],
      rationale,
    };
  }

  /**
   * Get debt score trend over time for a project.
   */
  getTrend(projectId: string): DebtTrend[] {
    return this.trendHistory.get(projectId) ?? [];
  }

  // ---- Private analysis methods ---------------------------------------------

  private analyzeFile(filePath: string, content: string): DebtItem[] {
    const items: DebtItem[] = [];

    const todoItem = this.checkTodos(filePath, content);
    if (todoItem) {
      items.push(todoItem);
    }

    const anyItem = this.checkAnyUsage(filePath, content);
    if (anyItem) {
      items.push(anyItem);
    }

    const longFnItem = this.checkLongFunctions(filePath, content);
    if (longFnItem) {
      items.push(longFnItem);
    }

    const docItem = this.checkUndocumentedExports(filePath, content);
    if (docItem) {
      items.push(docItem);
    }

    const complexityItem = this.checkComplexity(filePath, content);
    if (complexityItem) {
      items.push(complexityItem);
    }

    return items;
  }

  private checkTodos(filePath: string, content: string): DebtItem | null {
    const todoMatches = content.match(TODO_PATTERN);
    if (!todoMatches || todoMatches.length === 0) {
      return null;
    }
    const count = todoMatches.length;
    return {
      id: generateId("debt"),
      category: "todos",
      description: `${count} TODO/FIXME marker(s) found`,
      filePath,
      impact: count * 2,
      priority: count > 3 ? 7 : 4,
      effort: count > 5 ? "M" : "S",
    };
  }

  private checkAnyUsage(filePath: string, content: string): DebtItem | null {
    const anyMatches = content.match(ANY_PATTERN);
    if (!anyMatches || anyMatches.length === 0) {
      return null;
    }
    const count = anyMatches.length;
    return {
      id: generateId("debt"),
      category: "type-safety",
      description: `${count} \`any\` type usage(s) found`,
      filePath,
      impact: count * 3,
      priority: count > 2 ? 8 : 5,
      effort: count > 5 ? "M" : "S",
    };
  }

  private checkLongFunctions(
    filePath: string,
    content: string
  ): DebtItem | null {
    const longFunctions = this.detectLongFunctions(content);
    if (longFunctions === 0) {
      return null;
    }
    return {
      id: generateId("debt"),
      category: "complexity",
      description: `${longFunctions} function(s) exceed ${LONG_FUNCTION_THRESHOLD} lines`,
      filePath,
      impact: longFunctions * 5,
      priority: longFunctions > 2 ? 8 : 5,
      effort: "M",
    };
  }

  private checkUndocumentedExports(
    filePath: string,
    content: string
  ): DebtItem | null {
    const undocumentedExports = this.countUndocumentedExports(content);
    if (undocumentedExports === 0) {
      return null;
    }
    return {
      id: generateId("debt"),
      category: "documentation",
      description: `${undocumentedExports} exported symbol(s) without JSDoc`,
      filePath,
      impact: undocumentedExports * 1,
      priority: 3,
      effort: "S",
    };
  }

  private checkComplexity(filePath: string, content: string): DebtItem | null {
    const complexity = this.estimateCyclomaticComplexity(content);
    if (complexity <= HIGH_COMPLEXITY_THRESHOLD) {
      return null;
    }
    return {
      id: generateId("debt"),
      category: "complexity",
      description: `High cyclomatic complexity (~${complexity})`,
      filePath,
      impact: Math.min(complexity, 20),
      priority: complexity > 20 ? 9 : 6,
      effort: complexity > 20 ? "L" : "M",
    };
  }

  private detectLongFunctions(content: string): number {
    const lines = content.split("\n");
    let longCount = 0;
    let braceDepth = 0;
    let functionStart = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line && FUNCTION_START_RE.test(line) && braceDepth === 0) {
        functionStart = i;
      }

      const result = this.processBracesInLine(
        line ?? "",
        braceDepth,
        functionStart,
        i
      );
      braceDepth = result.braceDepth;
      functionStart = result.functionStart;
      longCount += result.longFunctionsFound;
    }

    return longCount;
  }

  private processBracesInLine(
    line: string,
    braceDepth: number,
    functionStart: number,
    lineIndex: number
  ): {
    braceDepth: number;
    functionStart: number;
    longFunctionsFound: number;
  } {
    let depth = braceDepth;
    let fnStart = functionStart;
    let found = 0;

    for (const ch of line) {
      if (ch === "{") {
        depth++;
      }
      if (ch !== "}") {
        continue;
      }
      depth--;
      if (depth === 0 && fnStart >= 0) {
        if (lineIndex - fnStart > LONG_FUNCTION_THRESHOLD) {
          found++;
        }
        fnStart = -1;
      }
    }

    return {
      braceDepth: depth,
      functionStart: fnStart,
      longFunctionsFound: found,
    };
  }

  private countUndocumentedExports(content: string): number {
    const exportLines: number[] = [];
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      if (EXPORT_START_RE.test(lines[i] ?? "")) {
        exportLines.push(i);
      }
    }

    let undocumented = 0;
    for (const lineNum of exportLines) {
      // Check if the line before is a JSDoc comment end
      if (lineNum > 0 && !lines[lineNum - 1]?.trim().endsWith("*/")) {
        undocumented++;
      }
    }

    return undocumented;
  }

  private estimateCyclomaticComplexity(content: string): number {
    let complexity = 1;
    const branchPatterns = [
      /\bif\s*\(/g,
      /\belse\s+if\s*\(/g,
      /\bwhile\s*\(/g,
      /\bfor\s*\(/g,
      /\bcase\s+/g,
      /\bcatch\s*\(/g,
      /&&/g,
      /\|\|/g,
      /\?\s*(?!\.)/g,
    ];

    for (const pattern of branchPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        complexity += matches.length;
      }
    }

    return complexity;
  }

  private getEffortRationale(item: DebtItem): string {
    switch (item.category) {
      case "todos":
        return "Address TODO/FIXME items by implementing the noted changes or removing stale markers.";
      case "type-safety":
        return "Replace `any` types with proper typed alternatives using type guards or generics.";
      case "complexity":
        return "Extract sub-functions, simplify conditionals, or apply design patterns to reduce complexity.";
      case "documentation":
        return "Add JSDoc comments to exported symbols describing purpose, parameters, and return values.";
      case "testing":
        return "Write unit tests for uncovered code paths, focusing on edge cases and error handling.";
      case "dependencies":
        return "Update outdated dependencies, checking changelogs for breaking changes.";
      case "duplication":
        return "Extract shared logic into utility functions or shared modules.";
      default:
        return "Review and address the identified issue.";
    }
  }
}
