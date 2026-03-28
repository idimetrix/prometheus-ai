/**
 * GAP-092: Digital Twin Manager
 *
 * Maintains a virtual representation of the codebase state in memory.
 * Tracks files, dependencies, and architecture, syncs on file changes,
 * and supports queries like "what is the current state of module X?"
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:digital-twin");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FileNode {
  exports: string[];
  hash: string;
  imports: string[];
  language: string;
  lastModified: number;
  path: string;
  size: number;
}

export interface DependencyEdge {
  from: string;
  to: string;
  type: "import" | "runtime" | "test";
}

export interface ModuleState {
  dependencies: DependencyEdge[];
  files: FileNode[];
  healthScore: number;
  lastUpdated: number;
  name: string;
}

export interface TwinSnapshot {
  createdAt: number;
  modules: Map<string, ModuleState>;
  projectId: string;
  totalDependencies: number;
  totalFiles: number;
}

export interface TwinQueryResult {
  answer: string;
  confidence: number;
  queryTimeMs: number;
  relatedFiles: string[];
}

// ─── Digital Twin Manager ─────────────────────────────────────────────────────

export class DigitalTwinManager {
  private readonly files = new Map<string, FileNode>();
  private readonly dependencies: DependencyEdge[] = [];
  private readonly modules = new Map<string, ModuleState>();
  private readonly projectId: string;
  private lastSyncAt = 0;

  constructor(projectId: string) {
    this.projectId = projectId;
  }

  /**
   * Sync a file change into the digital twin.
   */
  syncFile(file: FileNode): void {
    this.files.set(file.path, file);
    this.updateModuleForFile(file);
    this.lastSyncAt = Date.now();

    logger.debug(
      { path: file.path, language: file.language },
      "File synced to digital twin"
    );
  }

  /**
   * Remove a file from the twin (deleted file).
   */
  removeFile(path: string): void {
    this.files.delete(path);

    // Remove associated dependency edges
    const remaining = this.dependencies.filter(
      (d) => d.from !== path && d.to !== path
    );
    this.dependencies.length = 0;
    this.dependencies.push(...remaining);

    this.lastSyncAt = Date.now();
    logger.debug({ path }, "File removed from digital twin");
  }

  /**
   * Add a dependency edge between two files.
   */
  addDependency(edge: DependencyEdge): void {
    const exists = this.dependencies.some(
      (d) => d.from === edge.from && d.to === edge.to && d.type === edge.type
    );
    if (!exists) {
      this.dependencies.push(edge);
    }
  }

  /**
   * Query the digital twin about a module or file.
   */
  query(question: string): TwinQueryResult {
    const startMs = Date.now();
    const lowerQ = question.toLowerCase();

    // Detect query intent
    if (lowerQ.includes("state of") || lowerQ.includes("status of")) {
      return this.queryModuleState(question, startMs);
    }

    if (lowerQ.includes("depends on") || lowerQ.includes("dependencies")) {
      return this.queryDependencies(question, startMs);
    }

    if (lowerQ.includes("who imports") || lowerQ.includes("used by")) {
      return this.queryDependents(question, startMs);
    }

    // Default: search for related files
    return this.queryGeneral(question, startMs);
  }

  /**
   * Get a full snapshot of the current twin state.
   */
  getSnapshot(): TwinSnapshot {
    return {
      projectId: this.projectId,
      totalFiles: this.files.size,
      totalDependencies: this.dependencies.length,
      modules: new Map(this.modules),
      createdAt: this.lastSyncAt,
    };
  }

  /**
   * Get stats about the digital twin.
   */
  getStats(): {
    projectId: string;
    totalFiles: number;
    totalDependencies: number;
    totalModules: number;
    lastSyncAt: number;
  } {
    return {
      projectId: this.projectId,
      totalFiles: this.files.size,
      totalDependencies: this.dependencies.length,
      totalModules: this.modules.size,
      lastSyncAt: this.lastSyncAt,
    };
  }

  // ─── Private Methods ────────────────────────────────────────────────────

  private updateModuleForFile(file: FileNode): void {
    const moduleName = this.extractModuleName(file.path);
    const existing = this.modules.get(moduleName) ?? {
      name: moduleName,
      files: [],
      dependencies: [],
      healthScore: 1.0,
      lastUpdated: Date.now(),
    };

    // Update or add the file in the module
    const fileIndex = existing.files.findIndex((f) => f.path === file.path);
    if (fileIndex >= 0) {
      existing.files[fileIndex] = file;
    } else {
      existing.files.push(file);
    }

    existing.lastUpdated = Date.now();
    existing.dependencies = this.dependencies.filter(
      (d) =>
        existing.files.some((f) => f.path === d.from) ||
        existing.files.some((f) => f.path === d.to)
    );

    this.modules.set(moduleName, existing);
  }

  private extractModuleName(filePath: string): string {
    const parts = filePath.split("/");
    // Extract the first meaningful directory as module name
    if (parts.length >= 2) {
      return parts.slice(0, 2).join("/");
    }
    return parts[0] ?? "root";
  }

  private queryModuleState(question: string, startMs: number): TwinQueryResult {
    const moduleName = this.findModuleInQuestion(question);
    const mod = moduleName ? this.modules.get(moduleName) : undefined;

    if (mod) {
      const fileList = mod.files.map((f) => f.path);
      return {
        answer: `Module "${mod.name}" has ${mod.files.length} files and ${mod.dependencies.length} dependencies. Health score: ${mod.healthScore.toFixed(2)}. Last updated: ${new Date(mod.lastUpdated).toISOString()}.`,
        confidence: 0.9,
        relatedFiles: fileList.slice(0, 10),
        queryTimeMs: Date.now() - startMs,
      };
    }

    return {
      answer: `Could not find a module matching the query. Total modules tracked: ${this.modules.size}.`,
      confidence: 0.3,
      relatedFiles: [],
      queryTimeMs: Date.now() - startMs,
    };
  }

  private queryDependencies(
    question: string,
    startMs: number
  ): TwinQueryResult {
    const filePath = this.findFileInQuestion(question);
    if (!filePath) {
      return {
        answer: "Could not identify a specific file in the query.",
        confidence: 0.2,
        relatedFiles: [],
        queryTimeMs: Date.now() - startMs,
      };
    }

    const deps = this.dependencies
      .filter((d) => d.from === filePath)
      .map((d) => d.to);

    return {
      answer: `"${filePath}" depends on ${deps.length} files: ${deps.slice(0, 10).join(", ")}`,
      confidence: 0.85,
      relatedFiles: deps.slice(0, 10),
      queryTimeMs: Date.now() - startMs,
    };
  }

  private queryDependents(question: string, startMs: number): TwinQueryResult {
    const filePath = this.findFileInQuestion(question);
    if (!filePath) {
      return {
        answer: "Could not identify a specific file in the query.",
        confidence: 0.2,
        relatedFiles: [],
        queryTimeMs: Date.now() - startMs,
      };
    }

    const dependents = this.dependencies
      .filter((d) => d.to === filePath)
      .map((d) => d.from);

    return {
      answer: `"${filePath}" is imported by ${dependents.length} files: ${dependents.slice(0, 10).join(", ")}`,
      confidence: 0.85,
      relatedFiles: dependents.slice(0, 10),
      queryTimeMs: Date.now() - startMs,
    };
  }

  private queryGeneral(question: string, startMs: number): TwinQueryResult {
    const lowerQ = question.toLowerCase();
    const matchingFiles: string[] = [];

    for (const [path] of this.files) {
      if (lowerQ.includes(path.toLowerCase())) {
        matchingFiles.push(path);
      }
    }

    return {
      answer: `Found ${matchingFiles.length} files related to query. Total tracked: ${this.files.size} files across ${this.modules.size} modules.`,
      confidence: matchingFiles.length > 0 ? 0.7 : 0.4,
      relatedFiles: matchingFiles.slice(0, 10),
      queryTimeMs: Date.now() - startMs,
    };
  }

  private findModuleInQuestion(question: string): string | undefined {
    const lowerQ = question.toLowerCase();
    for (const [name] of this.modules) {
      if (lowerQ.includes(name.toLowerCase())) {
        return name;
      }
    }
    return undefined;
  }

  private findFileInQuestion(question: string): string | undefined {
    const lowerQ = question.toLowerCase();
    for (const [path] of this.files) {
      if (lowerQ.includes(path.toLowerCase())) {
        return path;
      }
    }
    return undefined;
  }
}
