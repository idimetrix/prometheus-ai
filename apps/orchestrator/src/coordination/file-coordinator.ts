/**
 * FileCoordinator — Validates multi-file consistency for coordinated
 * changes across a codebase. Ensures imports match exports, shared types
 * are used correctly, related files are identified, and changes can be
 * grouped atomically.
 *
 * Wired into the execution engine's post-write validation step to catch
 * cross-file inconsistencies before they reach the test suite.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:coordination:file-coordinator");

// ─── Regex constants (top-level for performance) ─────────────────────────
const IMPORT_FROM_RE =
  /import\s+(?:(?:type\s+)?(?:\{[^}]*\}|[\w*]+(?:\s*,\s*\{[^}]*\})?)\s+from\s+)?['"]([^'"]+)['"]/g;
const EXPORT_NAMED_RE =
  /export\s+(?:type\s+)?(?:interface|type|class|function|const|let|enum|abstract\s+class)\s+(\w+)/g;
const EXPORT_DEFAULT_RE = /export\s+default\s+(?:class|function)?\s*(\w+)?/g;
const RE_EXPORT_RE = /export\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
const TYPE_USAGE_RE = /:\s*(\w+)(?:<[^>]*>)?(?:\s*[;,|&)\]}])/g;
const EXTENDS_IMPLEMENTS_RE =
  /(?:extends|implements)\s+([\w,\s]+?)(?:\s*\{|\s*<)/g;
const BRACE_CONTENT_RE = /\{([^}]+)\}/;
const IMPORT_NAME_RE = /(?:type\s+)?(\w+)(?:\s+as\s+\w+)?/;
const DEFAULT_IMPORT_RE = /import\s+(\w+)\s+from/;
const RE_EXPORT_ALIAS_RE = /\s+as\s+\w+/;
const FILE_EXT_RE = /\.\w+$/;
const TEST_SPEC_EXT_RE = /\.(test|spec)\.(ts|tsx|js|jsx)$/;
const SOURCE_EXT_RE = /\.(ts|tsx|js|jsx)$/;
const BARREL_FILE_RE = /^index\.(ts|tsx|js|jsx)$/;
const PACKAGE_PATH_RE = /(?:apps|packages)\/([^/]+)/;

/** A file and its parsed import/export structure */
export interface FileStructure {
  content: string;
  exports: ExportInfo[];
  filePath: string;
  imports: ImportInfo[];
  reExports: ReExportInfo[];
  typeUsages: string[];
}

export interface ImportInfo {
  modulePath: string;
  names: string[];
}

export interface ExportInfo {
  isDefault: boolean;
  name: string;
}

export interface ReExportInfo {
  modulePath: string;
  names: string[];
}

/** Result of an import consistency check */
export interface ImportConsistencyResult {
  issues: ImportIssue[];
  valid: boolean;
}

export interface ImportIssue {
  exportFile?: string;
  importFile: string;
  missingExport: string;
  modulePath: string;
  severity: "error" | "warning";
}

/** Result of a type consistency check */
export interface TypeConsistencyResult {
  issues: TypeIssue[];
  valid: boolean;
}

export interface TypeIssue {
  details: string;
  files: string[];
  severity: "error" | "warning";
  typeName: string;
}

/** A file that should likely also be modified */
export interface RelatedFileSuggestion {
  confidence: number;
  filePath: string;
  reason: string;
}

/** A group of files that should be committed together */
export interface AtomicChangeSet {
  description: string;
  files: string[];
  id: string;
}

// ─── Builtin type set (module-level constant) ────────────────────────────
const BUILTIN_TYPES = new Set([
  "string",
  "number",
  "boolean",
  "void",
  "null",
  "undefined",
  "never",
  "any",
  "unknown",
  "object",
  "symbol",
  "bigint",
  "Array",
  "Map",
  "Set",
  "Record",
  "Promise",
  "Date",
  "Error",
  "RegExp",
  "Function",
  "Partial",
  "Required",
  "Readonly",
  "Pick",
  "Omit",
  "Exclude",
  "Extract",
  "NonNullable",
  "ReturnType",
  "Parameters",
  "InstanceType",
  "Awaited",
  "React",
  "JSX",
  "HTMLElement",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "FormEvent",
]);

/**
 * FileCoordinator validates cross-file consistency and suggests
 * related files that should change together.
 */
export class FileCoordinator {
  /**
   * Parse a file's import/export structure from its content.
   */
  parseFileStructure(filePath: string, content: string): FileStructure {
    return {
      filePath,
      content,
      imports: parseImports(content),
      exports: parseExports(content),
      reExports: parseReExports(content),
      typeUsages: parseTypeUsages(content),
    };
  }

  /**
   * Validate that all imports across a set of modified files resolve
   * to actual exports in the target modules.
   */
  validateImportConsistency(files: FileStructure[]): ImportConsistencyResult {
    const issues: ImportIssue[] = [];
    const exportMap = buildExportMap(files);

    for (const file of files) {
      const fileIssues = checkFileImports(file, exportMap);
      for (const issue of fileIssues) {
        issues.push(issue);
      }
    }

    if (issues.length > 0) {
      logger.warn(
        { issueCount: issues.length },
        "Import consistency issues found"
      );
    }

    return { valid: issues.length === 0, issues };
  }

  /**
   * Validate that shared types are used consistently across files.
   */
  validateTypeConsistency(files: FileStructure[]): TypeConsistencyResult {
    const issues: TypeIssue[] = [];
    const typeDefinitions = collectTypeDefinitions(files);

    // Check for duplicate type definitions across files
    for (const [typeName, definedIn] of typeDefinitions) {
      if (definedIn.length > 1) {
        issues.push({
          typeName,
          files: definedIn,
          severity: "warning",
          details: `Type "${typeName}" is defined in multiple files: ${definedIn.join(", ")}. Consider consolidating to a single source.`,
        });
      }
    }

    // Check for type usages without imports
    for (const file of files) {
      const fileIssues = checkTypeUsages(file, typeDefinitions);
      for (const issue of fileIssues) {
        issues.push(issue);
      }
    }

    return { valid: issues.length === 0, issues };
  }

  /**
   * Suggest files that should also be modified when a given file changes.
   */
  suggestRelatedFiles(
    changedFile: string,
    projectFiles: string[]
  ): RelatedFileSuggestion[] {
    const suggestions: RelatedFileSuggestion[] = [];
    const baseName = getBaseName(changedFile);
    const dirPath = getDirPath(changedFile);

    for (const file of projectFiles) {
      if (file === changedFile) {
        continue;
      }

      const suggestion = classifyRelatedFile(
        file,
        changedFile,
        baseName,
        dirPath
      );
      if (suggestion) {
        suggestions.push(suggestion);
      }
    }

    suggestions.sort((a, b) => b.confidence - a.confidence);
    return suggestions;
  }

  /**
   * Group related file changes into atomic change sets that should
   * be committed together to maintain consistency.
   */
  createAtomicChangeSet(files: FileStructure[]): AtomicChangeSet[] {
    const adjacency = buildAdjacencyMap(files);
    return findConnectedComponents(files, adjacency);
  }
}

// ─── Module-level helper functions ──────────────────────────────────────

function checkFileImports(
  file: FileStructure,
  exportMap: Map<string, ExportInfo[]>
): ImportIssue[] {
  const issues: ImportIssue[] = [];

  for (const imp of file.imports) {
    if (!imp.modulePath.startsWith(".")) {
      continue;
    }

    const resolvedPath = resolveImportPath(file.filePath, imp.modulePath);
    const targetExports = exportMap.get(resolvedPath);

    if (!targetExports) {
      continue;
    }

    for (const name of imp.names) {
      if (name === "*" || name === "default") {
        continue;
      }

      const hasExport = targetExports.some(
        (exp) => exp.name === name || (name === "default" && exp.isDefault)
      );

      if (!hasExport) {
        issues.push({
          importFile: file.filePath,
          modulePath: imp.modulePath,
          missingExport: name,
          exportFile: resolvedPath,
          severity: "error",
        });
      }
    }
  }

  return issues;
}

function collectTypeDefinitions(files: FileStructure[]): Map<string, string[]> {
  const typeDefinitions = new Map<string, string[]>();
  for (const file of files) {
    for (const exp of file.exports) {
      const existing = typeDefinitions.get(exp.name) ?? [];
      existing.push(file.filePath);
      typeDefinitions.set(exp.name, existing);
    }
  }
  return typeDefinitions;
}

function checkTypeUsages(
  file: FileStructure,
  typeDefinitions: Map<string, string[]>
): TypeIssue[] {
  const issues: TypeIssue[] = [];

  for (const usedType of file.typeUsages) {
    if (BUILTIN_TYPES.has(usedType)) {
      continue;
    }

    const isDefinedLocally = file.exports.some((e) => e.name === usedType);
    const isImported = file.imports.some((imp) => imp.names.includes(usedType));
    const isInContent =
      file.content.includes(`type ${usedType}`) ||
      file.content.includes(`interface ${usedType}`) ||
      file.content.includes(`enum ${usedType}`) ||
      file.content.includes(`class ${usedType}`);

    if (isDefinedLocally || isImported || isInContent) {
      continue;
    }

    const provider = typeDefinitions.get(usedType);
    if (provider && provider.length > 0) {
      issues.push({
        typeName: usedType,
        files: [file.filePath, ...provider],
        severity: "error",
        details: `Type "${usedType}" is used in ${file.filePath} but not imported. It is exported from: ${provider.join(", ")}`,
      });
    }
  }

  return issues;
}

function classifyRelatedFile(
  file: string,
  changedFile: string,
  baseName: string,
  dirPath: string
): RelatedFileSuggestion | null {
  if (isTestFileFor(file, baseName)) {
    return {
      filePath: file,
      reason: `Test file for ${baseName}`,
      confidence: 0.9,
    };
  }

  if (isBarrelFile(file) && getDirPath(file) === dirPath) {
    return {
      filePath: file,
      reason: "Barrel file in same directory — may need to re-export",
      confidence: 0.8,
    };
  }

  const otherBase = getBaseName(file);
  if (
    (otherBase.startsWith(baseName) || baseName.startsWith(otherBase)) &&
    getDirPath(file) === dirPath
  ) {
    return {
      filePath: file,
      reason: `Related file with matching base name: ${otherBase}`,
      confidence: 0.7,
    };
  }

  if (
    (changedFile.includes("schema") || changedFile.includes("types")) &&
    (file.includes("validator") ||
      file.includes("schema") ||
      file.includes("types")) &&
    sharePackage(changedFile, file)
  ) {
    return {
      filePath: file,
      reason: "Schema/validator file in same package",
      confidence: 0.6,
    };
  }

  return null;
}

function buildAdjacencyMap(files: FileStructure[]): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();

  for (const file of files) {
    if (!adjacency.has(file.filePath)) {
      adjacency.set(file.filePath, new Set());
    }

    for (const imp of file.imports) {
      if (!imp.modulePath.startsWith(".")) {
        continue;
      }
      const resolvedPath = resolveImportPath(file.filePath, imp.modulePath);
      const isInSet = files.some((f) => f.filePath === resolvedPath);
      if (isInSet) {
        adjacency.get(file.filePath)?.add(resolvedPath);
        if (!adjacency.has(resolvedPath)) {
          adjacency.set(resolvedPath, new Set());
        }
        adjacency.get(resolvedPath)?.add(file.filePath);
      }
    }
  }

  return adjacency;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: BFS graph traversal with component grouping requires nested control flow
function findConnectedComponents(
  files: FileStructure[],
  adjacency: Map<string, Set<string>>
): AtomicChangeSet[] {
  const changeSets: AtomicChangeSet[] = [];
  const visited = new Set<string>();
  let setCounter = 0;

  for (const file of files) {
    if (visited.has(file.filePath)) {
      continue;
    }

    const component: string[] = [];
    const queue = [file.filePath];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current)) {
        continue;
      }
      visited.add(current);
      component.push(current);

      const neighbors = adjacency.get(current);
      if (neighbors) {
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            queue.push(neighbor);
          }
        }
      }
    }

    setCounter++;
    changeSets.push({
      id: `changeset-${setCounter}`,
      files: component,
      description: describeChangeSet(component),
    });
  }

  logger.info(
    { totalFiles: files.length, changeSets: changeSets.length },
    "Atomic change sets created"
  );

  return changeSets;
}

// ─── Parsing helpers ────────────────────────────────────────────────────

function parseImports(content: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  IMPORT_FROM_RE.lastIndex = 0;
  let match = IMPORT_FROM_RE.exec(content);

  while (match !== null) {
    const fullStatement = match[0];
    const modulePath = match[1] ?? "";
    const names = extractImportNames(fullStatement);
    imports.push({ modulePath, names });
    match = IMPORT_FROM_RE.exec(content);
  }

  return imports;
}

function extractImportNames(statement: string): string[] {
  const names: string[] = [];
  const braceMatch = statement.match(BRACE_CONTENT_RE);
  if (braceMatch?.[1]) {
    const items = braceMatch[1].split(",");
    for (const item of items) {
      const trimmed = item.trim();
      const nameMatch = trimmed.match(IMPORT_NAME_RE);
      if (nameMatch?.[1]) {
        names.push(nameMatch[1]);
      }
    }
  }
  const defaultMatch = statement.match(DEFAULT_IMPORT_RE);
  if (defaultMatch?.[1]) {
    names.push(defaultMatch[1]);
  }
  return names;
}

function parseExports(content: string): ExportInfo[] {
  const exports: ExportInfo[] = [];

  EXPORT_NAMED_RE.lastIndex = 0;
  let match = EXPORT_NAMED_RE.exec(content);
  while (match !== null) {
    if (match[1]) {
      exports.push({ name: match[1], isDefault: false });
    }
    match = EXPORT_NAMED_RE.exec(content);
  }

  EXPORT_DEFAULT_RE.lastIndex = 0;
  match = EXPORT_DEFAULT_RE.exec(content);
  while (match !== null) {
    exports.push({ name: match[1] ?? "default", isDefault: true });
    match = EXPORT_DEFAULT_RE.exec(content);
  }

  return exports;
}

function parseReExports(content: string): ReExportInfo[] {
  const reExports: ReExportInfo[] = [];
  RE_EXPORT_RE.lastIndex = 0;
  let match = RE_EXPORT_RE.exec(content);

  while (match !== null) {
    const names = (match[1] ?? "")
      .split(",")
      .map((n) => n.trim().replace(RE_EXPORT_ALIAS_RE, ""))
      .filter(Boolean);
    const modulePath = match[2] ?? "";
    reExports.push({ modulePath, names });
    match = RE_EXPORT_RE.exec(content);
  }

  return reExports;
}

function parseTypeUsages(content: string): string[] {
  const usages = new Set<string>();

  TYPE_USAGE_RE.lastIndex = 0;
  let match = TYPE_USAGE_RE.exec(content);
  while (match !== null) {
    if (match[1] && !BUILTIN_TYPES.has(match[1])) {
      usages.add(match[1]);
    }
    match = TYPE_USAGE_RE.exec(content);
  }

  EXTENDS_IMPLEMENTS_RE.lastIndex = 0;
  match = EXTENDS_IMPLEMENTS_RE.exec(content);
  while (match !== null) {
    if (match[1]) {
      const types = match[1].split(",").map((t) => t.trim());
      for (const t of types) {
        if (t && !BUILTIN_TYPES.has(t)) {
          usages.add(t);
        }
      }
    }
    match = EXTENDS_IMPLEMENTS_RE.exec(content);
  }

  return [...usages];
}

// ─── Utility helpers ────────────────────────────────────────────────────

function buildExportMap(files: FileStructure[]): Map<string, ExportInfo[]> {
  const map = new Map<string, ExportInfo[]>();
  for (const file of files) {
    map.set(file.filePath, file.exports);
  }
  return map;
}

function resolveImportPath(importerPath: string, modulePath: string): string {
  const importerDir = getDirPath(importerPath);
  const parts = importerDir.split("/");
  const moduleParts = modulePath.split("/");

  for (const part of moduleParts) {
    if (part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }

  let resolved = parts.join("/");

  if (!FILE_EXT_RE.test(resolved)) {
    resolved = `${resolved}.ts`;
  }

  return resolved;
}

function getBaseName(filePath: string): string {
  const fileName = filePath.split("/").pop() ?? "";
  return fileName.replace(TEST_SPEC_EXT_RE, "").replace(SOURCE_EXT_RE, "");
}

function getDirPath(filePath: string): string {
  const parts = filePath.split("/");
  parts.pop();
  return parts.join("/");
}

function isTestFileFor(testFile: string, sourceName: string): boolean {
  return (
    testFile.includes(sourceName) &&
    (testFile.includes(".test.") ||
      testFile.includes(".spec.") ||
      testFile.includes("__tests__"))
  );
}

function isBarrelFile(filePath: string): boolean {
  const fileName = filePath.split("/").pop() ?? "";
  return BARREL_FILE_RE.test(fileName);
}

function sharePackage(fileA: string, fileB: string): boolean {
  const pkgA = fileA.match(PACKAGE_PATH_RE)?.[1];
  const pkgB = fileB.match(PACKAGE_PATH_RE)?.[1];
  return Boolean(pkgA && pkgB && pkgA === pkgB);
}

function describeChangeSet(files: string[]): string {
  if (files.length === 1) {
    return `Standalone change: ${files[0]}`;
  }

  const packages = new Set<string>();
  for (const file of files) {
    const pkg = file.match(PACKAGE_PATH_RE)?.[1];
    if (pkg) {
      packages.add(pkg);
    }
  }

  if (packages.size === 1) {
    return `Linked changes in @prometheus/${[...packages][0]} (${files.length} files)`;
  }

  return `Cross-package changes across ${[...packages].map((p) => `@prometheus/${p}`).join(", ")} (${files.length} files)`;
}
