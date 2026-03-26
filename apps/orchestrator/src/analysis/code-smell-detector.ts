import { createLogger } from "@prometheus/logger";

const logger = createLogger("code-smell-detector");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CodeSmellType =
  | "data_clump"
  | "dead_code"
  | "feature_envy"
  | "god_class"
  | "lazy_class"
  | "long_method"
  | "parallel_inheritance"
  | "primitive_obsession"
  | "speculative_generality"
  | "switch_statement";

export type SmellSeverity = "high" | "low" | "medium";

export interface CodeSmell {
  description: string;
  file: string;
  line: number;
  refactoring: string;
  severity: SmellSeverity;
  type: CodeSmellType;
}

export interface CodeSmellSummary {
  bySeverity: Record<string, number>;
  byType: Record<string, number>;
  total: number;
  worstFiles: Array<{ file: string; smellCount: number }>;
}

export interface CodeSmellResult {
  smells: CodeSmell[];
  summary: CodeSmellSummary;
}

// ---------------------------------------------------------------------------
// Constants & patterns
// ---------------------------------------------------------------------------

const LONG_METHOD_THRESHOLD = 60;
const GOD_CLASS_METHOD_THRESHOLD = 15;
const GOD_CLASS_LINE_THRESHOLD = 500;
const LAZY_CLASS_LINE_THRESHOLD = 20;
const SWITCH_CASE_THRESHOLD = 5;
const PARAM_COUNT_THRESHOLD = 5;
const PRIMITIVE_PARAM_THRESHOLD = 4;

const CLASS_RE = /^(?:export\s+)?class\s+(\w+)/gm;
const METHOD_RE =
  /(?:async\s+)?(?:static\s+)?(?:\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/g;
const FUNCTION_RE =
  /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g;
const ARROW_FN_RE =
  /(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>/g;
const SWITCH_RE = /\bswitch\s*\(/g;
const CASE_RE = /\bcase\s+/g;
const _THIS_DOT_RE = /this\.\w+/g;
const _EXTERNAL_ACCESS_RE = /(\w+)\.\w+/g;
const PRIMITIVE_PARAM_RE = /:\s*(?:string|number|boolean)(?:\s*[,)])/g;
const UNUSED_PARAM_RE = /^_/;
const IMPLEMENTS_RE = /implements\s+(\w+)/;
const EXTENDS_RE = /extends\s+(\w+)/;
const GENERIC_RE = /<[A-Z]\w*(?:\s+extends\s+\w+)?>/;
const INTERFACE_KEYWORD_RE = /\binterface\s+\w+/;

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

function countLines(content: string, startIndex: number): number {
  const before = content.slice(0, startIndex);
  return (before.match(/\n/g) ?? []).length + 1;
}

function findMatchingBrace(content: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < content.length; i++) {
    if (content[i] === "{") {
      depth++;
    }
    if (content[i] === "}") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return content.length;
}

function bodyLineCount(content: string, startIndex: number): number {
  const braceIdx = content.indexOf("{", startIndex);
  if (braceIdx === -1) {
    return 0;
  }
  const endIdx = findMatchingBrace(content, braceIdx);
  const body = content.slice(braceIdx, endIdx);
  return body.split("\n").length;
}

// ---------------------------------------------------------------------------
// Individual smell detectors
// ---------------------------------------------------------------------------

function detectLongMethods(
  file: string,
  content: string,
  smells: CodeSmell[]
): void {
  // Check named functions
  let fnMatch = FUNCTION_RE.exec(content);
  while (fnMatch !== null) {
    const lines = bodyLineCount(content, fnMatch.index);
    if (lines > LONG_METHOD_THRESHOLD) {
      smells.push({
        type: "long_method",
        file,
        line: countLines(content, fnMatch.index),
        severity: lines > LONG_METHOD_THRESHOLD * 2 ? "high" : "medium",
        description: `Function "${fnMatch[1]}" has ${lines} lines (threshold: ${LONG_METHOD_THRESHOLD})`,
        refactoring: "Extract Method — break into smaller, focused functions",
      });
    }
    fnMatch = FUNCTION_RE.exec(content);
  }

  // Check arrow functions
  let arrowMatch = ARROW_FN_RE.exec(content);
  while (arrowMatch !== null) {
    const braceIdx = content.indexOf(
      "{",
      arrowMatch.index + arrowMatch[0].length
    );
    if (braceIdx !== -1) {
      const lines = bodyLineCount(content, arrowMatch.index);
      if (lines > LONG_METHOD_THRESHOLD) {
        smells.push({
          type: "long_method",
          file,
          line: countLines(content, arrowMatch.index),
          severity: lines > LONG_METHOD_THRESHOLD * 2 ? "high" : "medium",
          description: `Arrow function "${arrowMatch[1]}" has ${lines} lines (threshold: ${LONG_METHOD_THRESHOLD})`,
          refactoring: "Extract Method — break into smaller, focused functions",
        });
      }
    }
    arrowMatch = ARROW_FN_RE.exec(content);
  }
}

function detectGodClasses(
  file: string,
  content: string,
  smells: CodeSmell[]
): void {
  let classMatch = CLASS_RE.exec(content);
  while (classMatch !== null) {
    const braceIdx = content.indexOf("{", classMatch.index);
    if (braceIdx === -1) {
      classMatch = CLASS_RE.exec(content);
      continue;
    }
    const endIdx = findMatchingBrace(content, braceIdx);
    const classBody = content.slice(braceIdx, endIdx);
    const classLines = classBody.split("\n").length;
    const methodCount = (classBody.match(METHOD_RE) ?? []).length;

    if (
      classLines > GOD_CLASS_LINE_THRESHOLD ||
      methodCount > GOD_CLASS_METHOD_THRESHOLD
    ) {
      smells.push({
        type: "god_class",
        file,
        line: countLines(content, classMatch.index),
        severity: classLines > GOD_CLASS_LINE_THRESHOLD * 2 ? "high" : "medium",
        description: `Class "${classMatch[1]}" has ${classLines} lines and ${methodCount} methods`,
        refactoring:
          "Extract Class — split responsibilities into focused classes following SRP",
      });
    }

    classMatch = CLASS_RE.exec(content);
  }
}

function detectSwitchStatements(
  file: string,
  content: string,
  smells: CodeSmell[]
): void {
  let switchMatch = SWITCH_RE.exec(content);
  while (switchMatch !== null) {
    const braceIdx = content.indexOf("{", switchMatch.index);
    if (braceIdx !== -1) {
      const endIdx = findMatchingBrace(content, braceIdx);
      const switchBody = content.slice(braceIdx, endIdx);
      const caseCount = (switchBody.match(CASE_RE) ?? []).length;

      if (caseCount >= SWITCH_CASE_THRESHOLD) {
        smells.push({
          type: "switch_statement",
          file,
          line: countLines(content, switchMatch.index),
          severity: caseCount >= SWITCH_CASE_THRESHOLD * 2 ? "medium" : "low",
          description: `Switch statement with ${caseCount} cases`,
          refactoring:
            "Replace Conditional with Polymorphism — use strategy or visitor pattern",
        });
      }
    }
    switchMatch = SWITCH_RE.exec(content);
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: complex analysis logic requires deep nesting
function detectFeatureEnvy(
  file: string,
  content: string,
  smells: CodeSmell[]
): void {
  // Heuristic: functions that access another object's properties many times
  let fnMatch = FUNCTION_RE.exec(content);
  while (fnMatch !== null) {
    const braceIdx = content.indexOf("{", fnMatch.index);
    if (braceIdx !== -1) {
      const endIdx = findMatchingBrace(content, braceIdx);
      const body = content.slice(braceIdx, endIdx);

      // Count accesses to external objects (not "this")
      const externalAccesses = new Map<string, number>();
      const accessRe = /(\w+)\.\w+/g;
      let accessMatch = accessRe.exec(body);
      while (accessMatch !== null) {
        const obj = accessMatch[1];
        if (
          obj &&
          obj !== "this" &&
          obj !== "console" &&
          obj !== "Math" &&
          obj !== "JSON" &&
          obj !== "Object" &&
          obj !== "Array" &&
          obj !== "Promise"
        ) {
          externalAccesses.set(obj, (externalAccesses.get(obj) ?? 0) + 1);
        }
        accessMatch = accessRe.exec(body);
      }

      for (const [obj, count] of externalAccesses) {
        if (count >= 6) {
          smells.push({
            type: "feature_envy",
            file,
            line: countLines(content, fnMatch.index),
            severity: count >= 10 ? "medium" : "low",
            description: `Function "${fnMatch[1]}" accesses "${obj}" ${count} times — may belong on that object`,
            refactoring:
              "Move Method — relocate the function to the class it accesses most",
          });
        }
      }
    }
    fnMatch = FUNCTION_RE.exec(content);
  }
}

function detectPrimitiveObsession(
  file: string,
  content: string,
  smells: CodeSmell[]
): void {
  let fnMatch = FUNCTION_RE.exec(content);
  while (fnMatch !== null) {
    const params = fnMatch[2] ?? "";
    const primitiveCount = (params.match(PRIMITIVE_PARAM_RE) ?? []).length;
    const totalParams = params.split(",").filter((p) => p.trim()).length;

    if (
      totalParams >= PARAM_COUNT_THRESHOLD &&
      primitiveCount >= PRIMITIVE_PARAM_THRESHOLD
    ) {
      smells.push({
        type: "primitive_obsession",
        file,
        line: countLines(content, fnMatch.index),
        severity: totalParams >= PARAM_COUNT_THRESHOLD * 2 ? "medium" : "low",
        description: `Function "${fnMatch[1]}" has ${totalParams} parameters (${primitiveCount} primitives) — consider using an options object`,
        refactoring:
          "Introduce Parameter Object — group related primitives into a typed object",
      });
    }
    fnMatch = FUNCTION_RE.exec(content);
  }
}

function detectDataClumps(
  file: string,
  content: string,
  smells: CodeSmell[]
): void {
  // Detect repeated parameter groups across functions
  const paramGroups = new Map<string, number>();
  let fnMatch = FUNCTION_RE.exec(content);
  while (fnMatch !== null) {
    const params = fnMatch[2] ?? "";
    const paramNames = params
      .split(",")
      .map((p) => p.trim().split(":")[0]?.trim())
      .filter((p) => p && !UNUSED_PARAM_RE.test(p))
      .sort();

    if (paramNames.length >= 3) {
      const key = paramNames.join(",");
      paramGroups.set(key, (paramGroups.get(key) ?? 0) + 1);
    }
    fnMatch = FUNCTION_RE.exec(content);
  }

  for (const [params, count] of paramGroups) {
    if (count >= 3) {
      smells.push({
        type: "data_clump",
        file,
        line: 1,
        severity: count >= 5 ? "medium" : "low",
        description: `Parameter group (${params}) appears in ${count} functions`,
        refactoring:
          "Extract Class — create a dedicated type or value object for the repeated group",
      });
    }
  }
}

function detectLazyClasses(
  file: string,
  content: string,
  smells: CodeSmell[]
): void {
  let classMatch = CLASS_RE.exec(content);
  while (classMatch !== null) {
    const braceIdx = content.indexOf("{", classMatch.index);
    if (braceIdx !== -1) {
      const endIdx = findMatchingBrace(content, braceIdx);
      const classBody = content.slice(braceIdx, endIdx);
      const classLines = classBody.split("\n").length;

      if (classLines <= LAZY_CLASS_LINE_THRESHOLD) {
        smells.push({
          type: "lazy_class",
          file,
          line: countLines(content, classMatch.index),
          severity: "low",
          description: `Class "${classMatch[1]}" has only ${classLines} lines — may not justify its own class`,
          refactoring:
            "Inline Class — merge functionality into the caller or collapse to a plain function",
        });
      }
    }
    classMatch = CLASS_RE.exec(content);
  }
}

function detectSpeculativeGenerality(
  file: string,
  content: string,
  smells: CodeSmell[]
): void {
  // Heuristic: interfaces with only one implementor, unused generics
  const hasInterface = INTERFACE_KEYWORD_RE.test(content);
  const _hasGeneric = GENERIC_RE.test(content);
  const hasImplements = IMPLEMENTS_RE.test(content);
  const hasExtends = EXTENDS_RE.test(content);

  // Single-method interfaces that aren't implemented in the same file
  if (hasInterface && !hasImplements && !hasExtends) {
    const interfaceRe = /\binterface\s+(\w+)\s*\{/g;
    let ifMatch = interfaceRe.exec(content);
    while (ifMatch !== null) {
      const braceIdx = content.indexOf("{", ifMatch.index);
      if (braceIdx !== -1) {
        const endIdx = findMatchingBrace(content, braceIdx);
        const body = content.slice(braceIdx, endIdx);
        const memberCount = body
          .split("\n")
          .filter(
            (l) => l.trim() && l.trim() !== "{" && l.trim() !== "}"
          ).length;

        if (memberCount <= 1) {
          smells.push({
            type: "speculative_generality",
            file,
            line: countLines(content, ifMatch.index),
            severity: "low",
            description: `Interface "${ifMatch[1]}" has only ${memberCount} member(s) — may be premature abstraction`,
            refactoring:
              "Collapse Hierarchy — inline the interface or wait until needed",
          });
        }
      }
      ifMatch = interfaceRe.exec(content);
    }
  }
}

function detectDeadCode(
  file: string,
  content: string,
  smells: CodeSmell[]
): void {
  // Detect exported functions/classes that are never used elsewhere
  // (limited to same-file analysis — cross-file detection needs project scope)
  const unusedExports: Array<{ name: string; line: number }> = [];

  const exportFnRe = /export\s+(?:async\s+)?function\s+(\w+)/g;
  let expMatch = exportFnRe.exec(content);
  while (expMatch !== null) {
    const name = expMatch[1];
    if (name) {
      // Check if the function is used elsewhere in the file (beyond its declaration)
      const usageRe = new RegExp(`\\b${name}\\b`, "g");
      const usages = content.match(usageRe);
      if (usages && usages.length <= 1) {
        unusedExports.push({
          name,
          line: countLines(content, expMatch.index),
        });
      }
    }
    expMatch = exportFnRe.exec(content);
  }

  // Only flag if there are many potentially unused exports (heuristic)
  if (unusedExports.length >= 3) {
    smells.push({
      type: "dead_code",
      file,
      line: unusedExports[0]?.line ?? 1,
      severity: unusedExports.length >= 6 ? "medium" : "low",
      description: `${unusedExports.length} exported functions may be unused: ${unusedExports
        .map((e) => e.name)
        .slice(0, 5)
        .join(", ")}`,
      refactoring:
        "Remove Dead Code — delete unused exports after verifying no external consumers",
    });
  }
}

// ---------------------------------------------------------------------------
// Main detector class
// ---------------------------------------------------------------------------

export class CodeSmellDetector {
  /**
   * Detect code smells in the provided files.
   *
   * @param projectId - The project being analyzed
   * @param files - Map of file path -> file content. In production this
   *                would be fetched from the sandbox filesystem.
   */
  detect(
    projectId: string,
    files: Map<string, string> = new Map()
  ): CodeSmellResult {
    logger.info(
      { projectId, fileCount: files.size },
      "Starting code smell detection"
    );

    const smells: CodeSmell[] = [];

    for (const [filePath, content] of files) {
      detectLongMethods(filePath, content, smells);
      detectGodClasses(filePath, content, smells);
      detectSwitchStatements(filePath, content, smells);
      detectFeatureEnvy(filePath, content, smells);
      detectPrimitiveObsession(filePath, content, smells);
      detectDataClumps(filePath, content, smells);
      detectLazyClasses(filePath, content, smells);
      detectSpeculativeGenerality(filePath, content, smells);
      detectDeadCode(filePath, content, smells);
    }

    const summary = buildSummary(smells);

    logger.info(
      {
        projectId,
        total: summary.total,
        bySeverity: summary.bySeverity,
      },
      "Code smell detection complete"
    );

    return { smells, summary };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSummary(smells: CodeSmell[]): CodeSmellSummary {
  const bySeverity: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const fileCounts = new Map<string, number>();

  for (const smell of smells) {
    bySeverity[smell.severity] = (bySeverity[smell.severity] ?? 0) + 1;
    byType[smell.type] = (byType[smell.type] ?? 0) + 1;
    fileCounts.set(smell.file, (fileCounts.get(smell.file) ?? 0) + 1);
  }

  const worstFiles = [...fileCounts.entries()]
    .map(([file, smellCount]) => ({ file, smellCount }))
    .sort((a, b) => b.smellCount - a.smellCount)
    .slice(0, 10);

  return {
    total: smells.length,
    bySeverity,
    byType,
    worstFiles,
  };
}
