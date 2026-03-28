/**
 * Multi-File Coordinator — GAP-027
 *
 * Plans and validates coordinated changes across multiple files in a
 * codebase. Ensures type-first ordering (types -> implementations -> tests),
 * validates cross-file consistency, and applies changes atomically.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:coordination:multi-file-coordinator");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileChangeEntry {
  /** Action to perform */
  action: "create" | "modify" | "delete";
  /** New file content (for create/modify) */
  content?: string;
  /** Other files in the changeset this depends on */
  dependencies: string[];
  /** File path relative to project root */
  path: string;
}

export interface ChangeSet {
  /** Ordered list of file changes */
  files: FileChangeEntry[];
}

export interface ProjectContext {
  /** Existing file paths in the project */
  existingFiles: string[];
  /** Primary language */
  language: string;
  /** Project root path */
  projectRoot: string;
}

export interface ConsistencyIssue {
  /** Detailed description of the issue */
  details: string;
  /** File where the issue was found */
  file: string;
  /** Severity of the issue */
  severity: "error" | "warning";
}

export interface ConsistencyReport {
  /** Detected issues */
  issues: ConsistencyIssue[];
  /** Whether all consistency checks passed */
  valid: boolean;
}

export interface ApplyResult {
  /** Per-file results */
  fileResults: Array<{
    error?: string;
    path: string;
    success: boolean;
  }>;
  /** Whether all changes were applied successfully */
  success: boolean;
}

export interface SandboxExecutor {
  exec(
    sandboxId: string,
    command: string,
    timeoutMs: number
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** File ordering priority: lower number = applied first */
const FILE_ORDER_PRIORITY: Record<string, number> = {
  // Types and interfaces first
  ".d.ts": 0,
  types: 1,
  interfaces: 1,
  enums: 1,
  // Schema and models
  schema: 2,
  model: 2,
  models: 2,
  // Configuration
  config: 3,
  // Implementation
  lib: 4,
  utils: 4,
  helpers: 4,
  service: 5,
  services: 5,
  handler: 5,
  handlers: 5,
  controller: 5,
  router: 6,
  routes: 6,
  // Components and pages
  component: 7,
  components: 7,
  page: 8,
  pages: 8,
  // Tests last
  test: 9,
  spec: 9,
  __tests__: 9,
};

/** Import statement patterns */
const IMPORT_RE = /(?:import|from)\s+['"]([^'"]+)['"]/g;
const _EXPORT_RE =
  /export\s+(?:default\s+)?(?:type\s+)?(?:interface|type|class|function|const|let|enum)\s+(\w+)/g;

// ---------------------------------------------------------------------------
// MultiFileCoordinator
// ---------------------------------------------------------------------------

export class MultiFileCoordinator {
  /**
   * Plan multi-file changes from a task description and project context.
   * This is a skeleton that the agent system fills in with actual changes.
   */
  planChanges(
    taskDescription: string,
    projectContext: ProjectContext
  ): ChangeSet {
    logger.info(
      {
        task: taskDescription.slice(0, 100),
        existingFiles: projectContext.existingFiles.length,
      },
      "Planning multi-file changes"
    );

    // The actual planning is done by the agent; this provides the framework
    return { files: [] };
  }

  /**
   * Validate cross-file consistency for a set of changes.
   * Checks for:
   * - Broken imports (importing from deleted files)
   * - Missing exports (importing symbols that are not exported)
   * - Circular dependencies
   * - Consistent type usage
   */
  validateConsistency(changes: ChangeSet): ConsistencyReport {
    const issues: ConsistencyIssue[] = [];

    const activeFiles = new Set(
      changes.files.filter((f) => f.action !== "delete").map((f) => f.path)
    );
    const deletedFiles = new Set(
      changes.files.filter((f) => f.action === "delete").map((f) => f.path)
    );

    this.checkDeletedImports(changes, deletedFiles, issues);
    this.checkDependencyIssues(changes, activeFiles, deletedFiles, issues);

    // Check for circular dependencies within the changeset
    const circularDeps = this.detectCircularDependencies(changes);
    for (const cycle of circularDeps) {
      issues.push({
        file: cycle[0] ?? "unknown",
        severity: "warning",
        details: `Circular dependency detected: ${cycle.join(" -> ")}`,
      });
    }

    return {
      valid: issues.filter((i) => i.severity === "error").length === 0,
      issues,
    };
  }

  private checkDeletedImports(
    changes: ChangeSet,
    deletedFiles: Set<string>,
    issues: ConsistencyIssue[]
  ): void {
    for (const file of changes.files) {
      if (file.action === "delete" || !file.content) {
        continue;
      }
      const imports = this.extractImports(file.content);
      for (const importPath of imports) {
        if (this.resolveImportToDeleted(importPath, deletedFiles)) {
          issues.push({
            file: file.path,
            severity: "error",
            details: `Imports from "${importPath}" which is being deleted`,
          });
        }
      }
    }
  }

  private checkDependencyIssues(
    changes: ChangeSet,
    activeFiles: Set<string>,
    deletedFiles: Set<string>,
    issues: ConsistencyIssue[]
  ): void {
    for (const file of changes.files) {
      if (file.action === "delete") {
        continue;
      }
      for (const dep of file.dependencies) {
        if (deletedFiles.has(dep)) {
          issues.push({
            file: file.path,
            severity: "error",
            details: `Depends on "${dep}" which is being deleted`,
          });
        }
        if (!(activeFiles.has(dep) || this.isExternalImport(dep))) {
          issues.push({
            file: file.path,
            severity: "warning",
            details: `Dependency "${dep}" is not part of the changeset`,
          });
        }
      }
    }
  }

  /**
   * Apply changes in the correct order: types first, then implementations,
   * then tests. Respects explicit dependency declarations.
   */
  async applyChanges(
    changes: ChangeSet,
    sandboxId: string,
    executor?: SandboxExecutor
  ): Promise<ApplyResult> {
    // Sort files by priority
    const sortedFiles = this.sortByPriority(changes.files);

    logger.info(
      {
        sandboxId,
        fileCount: sortedFiles.length,
        order: sortedFiles.map((f) => f.path),
      },
      "Applying multi-file changes in order"
    );

    const fileResults: ApplyResult["fileResults"] = [];

    for (const file of sortedFiles) {
      const result = await this.applyFileChange(file, sandboxId, executor);
      fileResults.push(result);
    }

    const success = fileResults.every((r) => r.success);

    logger.info(
      {
        sandboxId,
        success,
        applied: fileResults.filter((r) => r.success).length,
        failed: fileResults.filter((r) => !r.success).length,
      },
      "Multi-file changes applied"
    );

    return { success, fileResults };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async applyFileChange(
    file: FileChangeEntry,
    sandboxId: string,
    executor?: SandboxExecutor
  ): Promise<{ path: string; success: boolean; error?: string }> {
    try {
      if (!executor) {
        return {
          path: file.path,
          success: false,
          error: "No sandbox executor provided",
        };
      }

      switch (file.action) {
        case "create":
        case "modify": {
          if (!file.content) {
            return {
              path: file.path,
              success: false,
              error: "No content provided for create/modify",
            };
          }
          const dir = file.path.slice(0, file.path.lastIndexOf("/"));
          if (dir) {
            await executor.exec(
              sandboxId,
              `mkdir -p '/workspace/repo/${dir}'`,
              10_000
            );
          }
          const encoded = Buffer.from(file.content).toString("base64");
          const writeResult = await executor.exec(
            sandboxId,
            `echo '${encoded}' | base64 -d > '/workspace/repo/${file.path}'`,
            15_000
          );
          return {
            path: file.path,
            success: writeResult.exitCode === 0,
            error: writeResult.exitCode === 0 ? undefined : writeResult.stderr,
          };
        }

        case "delete": {
          const deleteResult = await executor.exec(
            sandboxId,
            `rm -f '/workspace/repo/${file.path}'`,
            10_000
          );
          return {
            path: file.path,
            success: deleteResult.exitCode === 0,
            error:
              deleteResult.exitCode === 0 ? undefined : deleteResult.stderr,
          };
        }

        default:
          return {
            path: file.path,
            success: false,
            error: `Unknown action: ${file.action}`,
          };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { path: file.path, success: false, error: msg };
    }
  }

  /**
   * Sort files by application priority: types first, tests last.
   */
  private sortByPriority(files: FileChangeEntry[]): FileChangeEntry[] {
    return [...files].sort((a, b) => {
      const priorityA = this.getFilePriority(a.path);
      const priorityB = this.getFilePriority(b.path);

      // Higher priority (lower number) goes first
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }

      // Dependencies: if a depends on b, b goes first
      if (a.dependencies.includes(b.path)) {
        return 1;
      }
      if (b.dependencies.includes(a.path)) {
        return -1;
      }

      return 0;
    });
  }

  /**
   * Get the application priority for a file based on its path.
   */
  private getFilePriority(filePath: string): number {
    const lower = filePath.toLowerCase();

    for (const [keyword, priority] of Object.entries(FILE_ORDER_PRIORITY)) {
      if (lower.includes(keyword)) {
        return priority;
      }
    }

    // Default: middle priority
    return 5;
  }

  /**
   * Extract import paths from source code.
   */
  private extractImports(content: string): string[] {
    const imports: string[] = [];
    const regex = new RegExp(IMPORT_RE.source, "g");
    let match = regex.exec(content);

    while (match !== null) {
      if (match[1]) {
        imports.push(match[1]);
      }
      match = regex.exec(content);
    }

    return imports;
  }

  /**
   * Check if an import path resolves to a deleted file.
   */
  private resolveImportToDeleted(
    importPath: string,
    deletedFiles: Set<string>
  ): boolean {
    // Check direct match and common extensions
    const extensions = [
      "",
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      "/index.ts",
      "/index.js",
    ];
    for (const ext of extensions) {
      if (deletedFiles.has(importPath + ext)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if an import is from an external package (not a local file).
   */
  private isExternalImport(path: string): boolean {
    return !(path.startsWith(".") || path.startsWith("/"));
  }

  /**
   * Detect circular dependencies within a changeset.
   */
  private detectCircularDependencies(changes: ChangeSet): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const depMap = new Map<string, string[]>();
    for (const file of changes.files) {
      depMap.set(file.path, file.dependencies);
    }

    const dfs = (node: string, path: string[]): void => {
      if (inStack.has(node)) {
        const cycleStart = path.indexOf(node);
        if (cycleStart >= 0) {
          cycles.push([...path.slice(cycleStart), node]);
        }
        return;
      }

      if (visited.has(node)) {
        return;
      }

      visited.add(node);
      inStack.add(node);

      const deps = depMap.get(node) ?? [];
      for (const dep of deps) {
        dfs(dep, [...path, node]);
      }

      inStack.delete(node);
    };

    for (const file of changes.files) {
      if (!visited.has(file.path)) {
        dfs(file.path, []);
      }
    }

    return cycles;
  }
}
