import { createLogger } from "@prometheus/logger";

const logger = createLogger("tech-debt-scorer");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TechDebtCategory {
  codeComplexity: number;
  deadCode: number;
  dependencyAge: number;
  duplicateCode: number;
  securityVulns: number;
  testCoverage: number;
  todoComments: number;
  typeAnyUsage: number;
}

export interface TechDebtHotspot {
  file: string;
  issues: string[];
  score: number;
}

export interface TechDebtRecommendation {
  affectedFiles: string[];
  description: string;
  estimatedEffort: string;
  priority: "high" | "medium" | "low";
}

export interface TechDebtResult {
  categories: TechDebtCategory;
  hotspots: TechDebtHotspot[];
  overallScore: number;
  recommendations: TechDebtRecommendation[];
}

interface FileAnalysis {
  complexity: number;
  duplicateBlocks: number;
  file: string;
  issues: string[];
  lines: number;
  todoCount: number;
  typeAnyCount: number;
}

// ---------------------------------------------------------------------------
// Constants & top-level regex patterns
// ---------------------------------------------------------------------------

const MAX_SCORE = 100;
const CATEGORY_WEIGHTS: Record<keyof TechDebtCategory, number> = {
  codeComplexity: 0.2,
  testCoverage: 0.2,
  dependencyAge: 0.1,
  duplicateCode: 0.15,
  todoComments: 0.05,
  securityVulns: 0.15,
  typeAnyUsage: 0.1,
  deadCode: 0.05,
};

const HIGH_COMPLEXITY_THRESHOLD = 20;
const DUPLICATE_LINE_THRESHOLD = 10;
const STALE_DEPENDENCY_DAYS = 365;

const CONTROL_FLOW_RE = /\b(if|else if|switch|for|while|do|catch)\b/;
const TERNARY_RE = /\?[^?:]*:/g;
const OPEN_BRACE_RE = /\{/g;
const CLOSE_BRACE_RE = /\}/g;
const TODO_RE = /\/\/\s*(TODO|FIXME|HACK|XXX|TEMP|WORKAROUND)\b/gi;
const TYPE_ANY_RE = /:\s*any\b|<any>|as\s+any\b/g;
const EVAL_RE = /eval\s*\(/;
const INNER_HTML_RE = /innerHTML\s*=/;
const DANGEROUS_HTML_RE = /dangerouslySetInnerHTML/;
const DOCUMENT_COOKIE_RE = /document\.cookie/;
const NEW_FUNCTION_RE = /new Function\s*\(/;
const PROCESS_ENV_RE = /process\.env\.\w+/;
const PROCESS_ENV_NODE_RE = /process\.env\.NODE_ENV/;
const CONFIG_ENV_RE = /config|env/i;
const IMPORT_RE = /import\s+\{?\s*([^}]+)\s*\}?\s+from/g;
const ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;
const RETURN_RE = /^\s*return\b.*;?\s*$/gm;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function scoreFromRatio(ratio: number): number {
  return clamp(Math.round(ratio * MAX_SCORE), 0, MAX_SCORE);
}

function effortEstimate(fileCount: number, severity: number): string {
  if (severity > 70 || fileCount > 20) {
    return "1-2 weeks";
  }
  if (severity > 40 || fileCount > 10) {
    return "2-3 days";
  }
  if (severity > 20 || fileCount > 5) {
    return "1 day";
  }
  return "A few hours";
}

// ---------------------------------------------------------------------------
// Core analysis functions
// ---------------------------------------------------------------------------

function analyzeComplexity(content: string): number {
  let complexity = 0;
  const lines = content.split("\n");
  let nestingDepth = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    if (CONTROL_FLOW_RE.test(trimmed)) {
      complexity += 1;
    }

    const ternaryCount = (trimmed.match(TERNARY_RE) ?? []).length;
    complexity += ternaryCount;

    const opens = (trimmed.match(OPEN_BRACE_RE) ?? []).length;
    const closes = (trimmed.match(CLOSE_BRACE_RE) ?? []).length;
    nestingDepth += opens - closes;

    if (nestingDepth > 4) {
      complexity += 1;
    }
  }

  return complexity;
}

function countTodos(content: string): number {
  const matches = content.match(TODO_RE);
  return matches?.length ?? 0;
}

function countTypeAny(content: string): number {
  const matches = content.match(TYPE_ANY_RE);
  return matches?.length ?? 0;
}

function detectDuplicateBlocks(content: string): number {
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const blockSize = 5;
  const seen = new Set<string>();
  let duplicates = 0;

  for (let i = 0; i <= lines.length - blockSize; i++) {
    const block = lines.slice(i, i + blockSize).join("\n");
    if (seen.has(block)) {
      duplicates += 1;
    } else {
      seen.add(block);
    }
  }

  return duplicates;
}

function detectSecurityIssues(content: string): string[] {
  const issues: string[] = [];

  if (EVAL_RE.test(content)) {
    issues.push("Uses eval() which is a security risk");
  }
  if (INNER_HTML_RE.test(content)) {
    issues.push("Direct innerHTML assignment (XSS risk)");
  }
  if (DANGEROUS_HTML_RE.test(content)) {
    issues.push("Uses dangerouslySetInnerHTML");
  }
  if (DOCUMENT_COOKIE_RE.test(content)) {
    issues.push("Direct document.cookie access");
  }
  if (NEW_FUNCTION_RE.test(content)) {
    issues.push("Dynamic code generation via new Function()");
  }
  if (
    PROCESS_ENV_RE.test(content) &&
    !PROCESS_ENV_NODE_RE.test(content) &&
    !CONFIG_ENV_RE.test(content)
  ) {
    issues.push("Direct process.env access outside configuration");
  }

  return issues;
}

function detectDeadCode(content: string): number {
  let count = 0;

  // Unused imports (simplified heuristic)
  const importMatches = content.matchAll(IMPORT_RE);
  for (const match of importMatches) {
    const matchGroup = match[1];
    if (!matchGroup) {
      continue;
    }
    const imports = matchGroup
      .split(",")
      .map((s) => s.trim().split(" as ").pop()?.trim())
      .filter(Boolean);

    for (const imp of imports) {
      if (!imp) {
        continue;
      }
      const escapedImp = imp.replace(ESCAPE_RE, "\\$&");
      const usagePattern = new RegExp(`\\b${escapedImp}\\b`, "g");
      const usages = content.match(usagePattern);
      if (usages && usages.length <= 1) {
        count += 1;
      }
    }
  }

  // Unreachable code after return (simplified)
  for (const returnMatch of content.matchAll(RETURN_RE)) {
    const nextLineStart = (returnMatch.index ?? 0) + returnMatch[0].length + 1;
    const nextLine = content
      .slice(nextLineStart, content.indexOf("\n", nextLineStart))
      .trim();
    if (nextLine && !nextLine.startsWith("}") && !nextLine.startsWith("//")) {
      count += 1;
    }
  }

  return count;
}

function analyzeFile(filePath: string, content: string): FileAnalysis {
  const complexity = analyzeComplexity(content);
  const todoCount = countTodos(content);
  const typeAnyCount = countTypeAny(content);
  const duplicateBlocks = detectDuplicateBlocks(content);
  const securityIssues = detectSecurityIssues(content);
  const deadCodeCount = detectDeadCode(content);
  const lines = content.split("\n").length;

  const issues: string[] = [];
  if (complexity > HIGH_COMPLEXITY_THRESHOLD) {
    issues.push(`High cyclomatic complexity (${complexity})`);
  }
  if (todoCount > 3) {
    issues.push(`${todoCount} TODO/FIXME comments`);
  }
  if (typeAnyCount > 0) {
    issues.push(`${typeAnyCount} uses of 'any' type`);
  }
  if (duplicateBlocks > DUPLICATE_LINE_THRESHOLD) {
    issues.push(`${duplicateBlocks} duplicate code blocks`);
  }
  if (securityIssues.length > 0) {
    issues.push(...securityIssues);
  }
  if (deadCodeCount > 2) {
    issues.push(`${deadCodeCount} potential dead code instances`);
  }

  return {
    file: filePath,
    lines,
    complexity,
    todoCount,
    typeAnyCount,
    duplicateBlocks,
    issues,
  };
}

// ---------------------------------------------------------------------------
// Category scoring helpers (extracted to reduce cognitive complexity)
// ---------------------------------------------------------------------------

function computeCategoryScores(
  fileAnalyses: FileAnalysis[],
  options: {
    testCoveragePercent?: number;
    dependencyAgeDays?: number;
    knownVulnCount?: number;
  }
): { categories: TechDebtCategory; highComplexityFiles: FileAnalysis[] } {
  const totalFiles = Math.max(fileAnalyses.length, 1);

  const highComplexityFiles = fileAnalyses.filter(
    (f) => f.complexity > HIGH_COMPLEXITY_THRESHOLD
  );
  const codeComplexity = scoreFromRatio(
    highComplexityFiles.length / totalFiles
  );

  const testCoveragePercent = options.testCoveragePercent ?? 50;
  const testCoverage = scoreFromRatio(1 - testCoveragePercent / 100);

  const dependencyAgeDays = options.dependencyAgeDays ?? 180;
  const dependencyAge = scoreFromRatio(
    clamp(dependencyAgeDays / STALE_DEPENDENCY_DAYS, 0, 1)
  );

  const totalDuplicates = fileAnalyses.reduce(
    (sum, f) => sum + f.duplicateBlocks,
    0
  );
  const duplicateCode = scoreFromRatio(
    clamp(totalDuplicates / (totalFiles * 5), 0, 1)
  );

  const totalTodos = fileAnalyses.reduce((sum, f) => sum + f.todoCount, 0);
  const todoComments = scoreFromRatio(
    clamp(totalTodos / (totalFiles * 2), 0, 1)
  );

  const knownVulnCount = options.knownVulnCount ?? 0;
  const securityIssuesInCode = fileAnalyses.reduce(
    (sum, f) =>
      sum +
      f.issues.filter(
        (i) => i.includes("XSS") || i.includes("eval") || i.includes("security")
      ).length,
    0
  );
  const securityVulns = scoreFromRatio(
    clamp((knownVulnCount + securityIssuesInCode) / 10, 0, 1)
  );

  const totalAny = fileAnalyses.reduce((sum, f) => sum + f.typeAnyCount, 0);
  const typeAnyUsage = scoreFromRatio(clamp(totalAny / (totalFiles * 3), 0, 1));

  // Dead code estimate based on file analysis issues
  const deadCodeFiles = fileAnalyses.filter((f) =>
    f.issues.some((i) => i.includes("dead code"))
  );
  const deadCode = scoreFromRatio(
    clamp(deadCodeFiles.length / totalFiles, 0, 1)
  );

  return {
    categories: {
      codeComplexity,
      testCoverage,
      dependencyAge,
      duplicateCode,
      todoComments,
      securityVulns,
      typeAnyUsage,
      deadCode,
    },
    highComplexityFiles,
  };
}

function generateRecommendations(
  categories: TechDebtCategory,
  fileAnalyses: FileAnalysis[],
  highComplexityFiles: FileAnalysis[]
): TechDebtRecommendation[] {
  const recommendations: TechDebtRecommendation[] = [];

  if (categories.codeComplexity > 40) {
    recommendations.push({
      priority: categories.codeComplexity > 70 ? "high" : "medium",
      description:
        "Refactor high-complexity functions into smaller, focused units",
      estimatedEffort: effortEstimate(
        highComplexityFiles.length,
        categories.codeComplexity
      ),
      affectedFiles: highComplexityFiles.map((f) => f.file).slice(0, 10),
    });
  }

  if (categories.testCoverage > 50) {
    recommendations.push({
      priority: categories.testCoverage > 70 ? "high" : "medium",
      description: "Increase test coverage to reduce regression risk",
      estimatedEffort: "1-2 weeks",
      affectedFiles: [],
    });
  }

  if (categories.typeAnyUsage > 30) {
    const anyFiles = fileAnalyses
      .filter((f) => f.typeAnyCount > 0)
      .map((f) => f.file);
    recommendations.push({
      priority: categories.typeAnyUsage > 60 ? "high" : "medium",
      description:
        "Replace 'any' types with proper type definitions for better type safety",
      estimatedEffort: effortEstimate(anyFiles.length, categories.typeAnyUsage),
      affectedFiles: anyFiles.slice(0, 10),
    });
  }

  if (categories.duplicateCode > 30) {
    const dupFiles = fileAnalyses
      .filter((f) => f.duplicateBlocks > 0)
      .map((f) => f.file);
    recommendations.push({
      priority: categories.duplicateCode > 60 ? "high" : "medium",
      description:
        "Extract duplicate code blocks into shared utilities or components",
      estimatedEffort: effortEstimate(
        dupFiles.length,
        categories.duplicateCode
      ),
      affectedFiles: dupFiles.slice(0, 10),
    });
  }

  if (categories.securityVulns > 20) {
    recommendations.push({
      priority: "high",
      description: "Address security vulnerabilities and unsafe code patterns",
      estimatedEffort: "1-3 days",
      affectedFiles: fileAnalyses
        .filter((f) =>
          f.issues.some(
            (i) =>
              i.includes("XSS") || i.includes("eval") || i.includes("security")
          )
        )
        .map((f) => f.file)
        .slice(0, 10),
    });
  }

  if (categories.dependencyAge > 50) {
    recommendations.push({
      priority: categories.dependencyAge > 80 ? "high" : "low",
      description: "Update stale dependencies to their latest versions",
      estimatedEffort: "1-2 days",
      affectedFiles: ["package.json"],
    });
  }

  if (categories.todoComments > 30) {
    const todoFiles = fileAnalyses
      .filter((f) => f.todoCount > 0)
      .map((f) => f.file);
    recommendations.push({
      priority: "low",
      description:
        "Address TODO/FIXME comments or convert them to tracked issues",
      estimatedEffort: effortEstimate(
        todoFiles.length,
        categories.todoComments
      ),
      affectedFiles: todoFiles.slice(0, 10),
    });
  }

  const priorityOrder = { high: 0, medium: 1, low: 2 };
  recommendations.sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
  );

  return recommendations;
}

// ---------------------------------------------------------------------------
// Main scorer class
// ---------------------------------------------------------------------------

export class TechDebtScorer {
  /**
   * Analyze a set of files and produce a comprehensive tech debt score.
   *
   * In a real implementation, this would fetch files from the project's
   * repository via the sandbox or git integration. Here we accept
   * file contents directly for flexibility.
   */
  analyze(
    projectId: string,
    files: Map<string, string> = new Map(),
    options: {
      testCoveragePercent?: number;
      dependencyAgeDays?: number;
      knownVulnCount?: number;
    } = {}
  ): TechDebtResult {
    logger.info(
      { projectId, fileCount: files.size },
      "Starting tech debt analysis"
    );

    const fileAnalyses: FileAnalysis[] = [];
    for (const [filePath, content] of files) {
      fileAnalyses.push(analyzeFile(filePath, content));
    }

    const { categories, highComplexityFiles } = computeCategoryScores(
      fileAnalyses,
      options
    );

    const overallScore = Math.round(
      Object.entries(CATEGORY_WEIGHTS).reduce((sum, [key, weight]) => {
        const catKey = key as keyof TechDebtCategory;
        return sum + categories[catKey] * weight;
      }, 0)
    );

    const hotspots: TechDebtHotspot[] = fileAnalyses
      .filter((f) => f.issues.length > 0)
      .map((f) => ({
        file: f.file,
        score: clamp(
          Math.round(
            (f.complexity / HIGH_COMPLEXITY_THRESHOLD) * 30 +
              f.todoCount * 5 +
              f.typeAnyCount * 10 +
              f.duplicateBlocks * 3
          ),
          0,
          MAX_SCORE
        ),
        issues: f.issues,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    const recommendations = generateRecommendations(
      categories,
      fileAnalyses,
      highComplexityFiles
    );

    logger.info(
      {
        projectId,
        overallScore,
        hotspotCount: hotspots.length,
        recommendationCount: recommendations.length,
      },
      "Tech debt analysis complete"
    );

    return {
      overallScore,
      categories,
      hotspots,
      recommendations,
    };
  }
}
