/**
 * Architecture Drift Detector
 *
 * Compares current codebase structure against defined architecture
 * blueprints and detects deviations such as dependency violations,
 * layer breaches, circular dependencies, and naming mismatches.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:architecture-drift");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DriftType =
  | "dependency_violation"
  | "layer_breach"
  | "naming_deviation"
  | "unused_abstraction"
  | "circular_dependency"
  | "god_object";

export type DriftSeverity = "critical" | "warning" | "info";

export type TrendDirection = "improving" | "stable" | "degrading";

export interface ArchitectureDrift {
  blueprintRule: string;
  description: string;
  file: string;
  severity: DriftSeverity;
  suggestedFix: string;
  type: DriftType;
}

export interface DriftDetectionResult {
  drifts: ArchitectureDrift[];
  overallHealth: number;
  trendDirection: TrendDirection;
}

export interface BlueprintRule {
  /** Brief description of what the rule enforces */
  description: string;
  /** Rule identifier */
  id: string;
  /** Configuration for rule checks */
  params: Record<string, unknown>;
  /** Type of drift this rule detects */
  type: DriftType;
}

export interface ArchitectureBlueprint {
  /** List of rules that define the desired architecture */
  rules: BlueprintRule[];
}

interface FileNode {
  content: string;
  path: string;
}

interface DependencyEdge {
  from: string;
  to: string;
}

// ---------------------------------------------------------------------------
// Constants & Patterns
// ---------------------------------------------------------------------------

const IMPORT_FROM_RE = /(?:import|require)\s*\(?['"]([^'"]+)['"]\)?/g;
const METHODS_RE =
  /(?:async\s+)?(?:public\s+|private\s+|protected\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{/g;
const CONSTRUCTOR_RE = /\bconstructor\b/;
const GETTER_SETTER_RE = /\b(?:get|set)\s+\w+/;
const CLASS_RE = /\bclass\s+(\w+)/;
const LINES_RE = /\n/g;
const PASCAL_CASE_RE = /^[A-Z]/;
const KEBAB_CASE_RE = /^[a-z]+-[a-z]+/;
const EXPORT_SYMBOL_RE =
  /export\s+(?:class|interface|type|function|const|enum)\s+(\w+)/g;
const NAMED_IMPORT_RE = /import\s+(?:type\s+)?\{([^}]+)\}/g;
const DEFAULT_IMPORT_RE = /import\s+(\w+)\s+from/;

const GOD_OBJECT_METHOD_THRESHOLD = 15;
const GOD_OBJECT_LINE_THRESHOLD = 500;
const HEALTH_PENALTY_CRITICAL = 15;
const HEALTH_PENALTY_WARNING = 5;
const HEALTH_PENALTY_INFO = 1;
const MAX_HEALTH = 100;

// ---------------------------------------------------------------------------
// Default layer rules for typical monorepo structure
// ---------------------------------------------------------------------------

const _DEFAULT_LAYER_ORDER = [
  "apps/web",
  "apps/api",
  "apps/orchestrator",
  "apps/queue-worker",
  "apps/socket-server",
  "packages/",
];

const DEFAULT_FORBIDDEN_IMPORTS: Array<{ from: string; to: string }> = [
  { from: "packages/", to: "apps/" },
  { from: "apps/web", to: "apps/api/src" },
  { from: "apps/api", to: "apps/web/src" },
  { from: "apps/orchestrator", to: "apps/web/src" },
];

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

function extractImports(content: string): string[] {
  const imports: string[] = [];
  for (const match of content.matchAll(IMPORT_FROM_RE)) {
    if (match[1]) {
      imports.push(match[1]);
    }
  }
  return imports;
}

function buildDependencyGraph(files: FileNode[]): DependencyEdge[] {
  const edges: DependencyEdge[] = [];
  for (const file of files) {
    const imports = extractImports(file.content);
    for (const imp of imports) {
      edges.push({ from: file.path, to: imp });
    }
  }
  return edges;
}

function detectCircularDependencies(edges: DependencyEdge[]): string[][] {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!adjacency.has(edge.from)) {
      adjacency.set(edge.from, new Set());
    }
    adjacency.get(edge.from)?.add(edge.to);
  }

  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack = new Set<string>();

  function dfs(node: string, path: string[]): void {
    if (stack.has(node)) {
      const cycleStart = path.indexOf(node);
      if (cycleStart >= 0) {
        cycles.push(path.slice(cycleStart));
      }
      return;
    }

    if (visited.has(node)) {
      return;
    }

    visited.add(node);
    stack.add(node);
    path.push(node);

    const neighbors = adjacency.get(node);
    if (neighbors) {
      for (const neighbor of neighbors) {
        dfs(neighbor, [...path]);
      }
    }

    stack.delete(node);
  }

  for (const node of adjacency.keys()) {
    dfs(node, []);
  }

  return cycles;
}

function detectLayerBreaches(
  files: FileNode[],
  forbiddenImports: Array<{ from: string; to: string }>
): ArchitectureDrift[] {
  const drifts: ArchitectureDrift[] = [];

  for (const file of files) {
    const imports = extractImports(file.content);

    for (const imp of imports) {
      for (const rule of forbiddenImports) {
        if (file.path.includes(rule.from) && imp.includes(rule.to)) {
          drifts.push({
            type: "layer_breach",
            severity: "critical",
            file: file.path,
            description: `File in "${rule.from}" imports from "${rule.to}", violating layer boundaries`,
            blueprintRule: `No imports from ${rule.from} to ${rule.to}`,
            suggestedFix:
              "Move shared code to a common package or reverse the dependency direction",
          });
        }
      }
    }
  }

  return drifts;
}

function detectDependencyViolations(
  files: FileNode[],
  _blueprint: ArchitectureBlueprint
): ArchitectureDrift[] {
  const drifts: ArchitectureDrift[] = [];

  for (const file of files) {
    const imports = extractImports(file.content);

    // Detect relative imports crossing module boundaries
    for (const imp of imports) {
      const parentTraversals = (imp.match(/\.\.\//g) ?? []).length;
      if (parentTraversals > 3) {
        drifts.push({
          type: "dependency_violation",
          severity: "warning",
          file: file.path,
          description: `Deep relative import "${imp}" suggests missing abstraction`,
          blueprintRule: "Limit relative import depth to 3 levels",
          suggestedFix: `Create a shared package or use path aliases for "${imp}"`,
        });
      }
    }
  }

  return drifts;
}

function detectNamingDeviations(
  files: FileNode[],
  _blueprint: ArchitectureBlueprint
): ArchitectureDrift[] {
  const drifts: ArchitectureDrift[] = [];

  for (const file of files) {
    // Check that test files follow naming convention
    if (
      file.path.includes("__tests__") &&
      !file.path.endsWith(".test.ts") &&
      !file.path.endsWith(".test.tsx") &&
      !file.path.endsWith(".spec.ts") &&
      !file.path.endsWith(".spec.tsx")
    ) {
      drifts.push({
        type: "naming_deviation",
        severity: "info",
        file: file.path,
        description:
          "Test file does not follow *.test.ts or *.spec.ts naming convention",
        blueprintRule: "Test files must use .test.ts or .spec.ts suffix",
        suggestedFix: "Rename file to use .test.ts or .spec.ts extension",
      });
    }

    // Check component files use PascalCase
    if (file.path.includes("/components/") && file.path.endsWith(".tsx")) {
      const fileName = file.path.split("/").pop()?.replace(".tsx", "") ?? "";
      if (
        fileName &&
        fileName !== "index" &&
        !PASCAL_CASE_RE.test(fileName) &&
        !KEBAB_CASE_RE.test(fileName)
      ) {
        drifts.push({
          type: "naming_deviation",
          severity: "info",
          file: file.path,
          description: `Component file "${fileName}" does not follow PascalCase or kebab-case convention`,
          blueprintRule: "Component files use PascalCase or kebab-case naming",
          suggestedFix: `Rename to PascalCase (e.g., ${fileName.charAt(0).toUpperCase() + fileName.slice(1)}.tsx) or kebab-case`,
        });
      }
    }
  }

  return drifts;
}

function detectGodObjects(files: FileNode[]): ArchitectureDrift[] {
  const drifts: ArchitectureDrift[] = [];

  for (const file of files) {
    const classMatch = CLASS_RE.exec(file.content);
    if (!classMatch) {
      continue;
    }

    const className = classMatch[1] ?? "Unknown";
    const lineCount = (file.content.match(LINES_RE) ?? []).length + 1;

    // Count methods (exclude constructor, getters, setters)
    const methodMatches = file.content.matchAll(METHODS_RE);
    let methodCount = 0;
    for (const match of methodMatches) {
      const name = match[1] ?? "";
      if (!(CONSTRUCTOR_RE.test(name) || GETTER_SETTER_RE.test(name))) {
        methodCount += 1;
      }
    }

    if (
      methodCount > GOD_OBJECT_METHOD_THRESHOLD ||
      lineCount > GOD_OBJECT_LINE_THRESHOLD
    ) {
      drifts.push({
        type: "god_object",
        severity:
          methodCount > GOD_OBJECT_METHOD_THRESHOLD * 2
            ? "critical"
            : "warning",
        file: file.path,
        description: `Class "${className}" has ${methodCount} methods and ${lineCount} lines, indicating a god object`,
        blueprintRule: `Classes should have fewer than ${GOD_OBJECT_METHOD_THRESHOLD} methods and ${GOD_OBJECT_LINE_THRESHOLD} lines`,
        suggestedFix: `Split "${className}" into smaller, focused classes with single responsibilities`,
      });
    }
  }

  return drifts;
}

function collectExportedSymbols(files: FileNode[]): Map<string, string> {
  const symbols = new Map<string, string>();
  for (const file of files) {
    for (const match of file.content.matchAll(EXPORT_SYMBOL_RE)) {
      if (match[1]) {
        symbols.set(match[1], file.path);
      }
    }
  }
  return symbols;
}

function collectImportedSymbols(files: FileNode[]): Set<string> {
  const symbols = new Set<string>();
  for (const file of files) {
    for (const importMatch of file.content.matchAll(NAMED_IMPORT_RE)) {
      const names = (importMatch[1] ?? "").split(",");
      for (const name of names) {
        const trimmed = name.trim().split(" as ")[0]?.trim();
        if (trimmed) {
          symbols.add(trimmed);
        }
      }
    }

    const imports = extractImports(file.content);
    for (const imp of imports) {
      const defaultMatch = DEFAULT_IMPORT_RE.exec(imp);
      if (defaultMatch?.[1]) {
        symbols.add(defaultMatch[1]);
      }
    }
  }
  return symbols;
}

function detectUnusedAbstractions(files: FileNode[]): ArchitectureDrift[] {
  const drifts: ArchitectureDrift[] = [];
  const exportedSymbols = collectExportedSymbols(files);
  const importedSymbols = collectImportedSymbols(files);

  for (const [symbol, filePath] of exportedSymbols) {
    if (importedSymbols.has(symbol)) {
      continue;
    }
    // Skip index files and entry points
    if (filePath.includes("index.") || filePath.includes("main.")) {
      continue;
    }

    drifts.push({
      type: "unused_abstraction",
      severity: "info",
      file: filePath,
      description: `Exported symbol "${symbol}" appears to be unused across the codebase`,
      blueprintRule: "Remove or document all unused exports",
      suggestedFix: `Remove the export of "${symbol}" or add it to the module's public API index`,
    });
  }

  return drifts;
}

function computeTrend(
  currentHealth: number,
  previousHealth?: number
): TrendDirection {
  if (previousHealth === undefined) {
    return "stable";
  }
  const delta = currentHealth - previousHealth;
  if (delta > 2) {
    return "improving";
  }
  if (delta < -2) {
    return "degrading";
  }
  return "stable";
}

// ---------------------------------------------------------------------------
// Main class
// ---------------------------------------------------------------------------

export class ArchitectureDriftDetector {
  private readonly previousHealthScores: Map<string, number> = new Map();

  /**
   * Detect architecture drift in a project's codebase.
   */
  detect(
    projectId: string,
    files: FileNode[] = [],
    blueprint: ArchitectureBlueprint = { rules: [] }
  ): Promise<DriftDetectionResult> {
    logger.info(
      { projectId, fileCount: files.length, ruleCount: blueprint.rules.length },
      "Starting architecture drift detection"
    );

    const allDrifts: ArchitectureDrift[] = [];

    // Layer breach detection
    allDrifts.push(...detectLayerBreaches(files, DEFAULT_FORBIDDEN_IMPORTS));

    // Dependency violations
    allDrifts.push(...detectDependencyViolations(files, blueprint));

    // Naming deviations
    allDrifts.push(...detectNamingDeviations(files, blueprint));

    // Circular dependency detection
    const edges = buildDependencyGraph(files);
    const cycles = detectCircularDependencies(edges);
    for (const cycle of cycles) {
      allDrifts.push({
        type: "circular_dependency",
        severity: "critical",
        file: cycle[0] ?? "unknown",
        description: `Circular dependency detected: ${cycle.join(" -> ")}`,
        blueprintRule: "No circular dependencies allowed",
        suggestedFix:
          "Break the cycle by extracting shared code into a separate module",
      });
    }

    // God object detection
    allDrifts.push(...detectGodObjects(files));

    // Unused abstraction detection
    allDrifts.push(...detectUnusedAbstractions(files));

    // Calculate overall health
    let healthDeductions = 0;
    for (const drift of allDrifts) {
      if (drift.severity === "critical") {
        healthDeductions += HEALTH_PENALTY_CRITICAL;
      } else if (drift.severity === "warning") {
        healthDeductions += HEALTH_PENALTY_WARNING;
      } else {
        healthDeductions += HEALTH_PENALTY_INFO;
      }
    }

    const overallHealth = Math.max(0, MAX_HEALTH - healthDeductions);

    // Determine trend
    const previousHealth = this.previousHealthScores.get(projectId);
    const trendDirection = computeTrend(overallHealth, previousHealth);

    // Store for future trend calculation
    this.previousHealthScores.set(projectId, overallHealth);

    logger.info(
      {
        projectId,
        driftCount: allDrifts.length,
        overallHealth,
        trendDirection,
      },
      "Architecture drift detection complete"
    );

    return Promise.resolve({
      drifts: allDrifts,
      overallHealth,
      trendDirection,
    });
  }
}
