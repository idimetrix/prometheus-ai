/**
 * GAP-054: Architecture Analysis
 *
 * Analyze project architecture, generate Mermaid diagrams, detect
 * architectural smells, and perform impact analysis.
 */

import { createLogger } from "@prometheus/logger";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("api:architecture-analysis");
const FILE_EXTENSION_RE = /\.[^.]+$/;
const TEST_FILE_RE = /\.(\w+)$/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArchLayer {
  description: string;
  files: string[];
  name: string;
}

export interface ArchDependency {
  from: string;
  to: string;
  type: string;
}

export interface ArchPattern {
  confidence: number;
  description: string;
  name: string;
}

export interface ArchSmell {
  affectedFiles: string[];
  description: string;
  name: string;
  severity: "low" | "medium" | "high";
  suggestion: string;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const architectureAnalysisRouter = router({
  /**
   * Analyze project architecture (layers, dependencies, patterns).
   */
  analyze: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        files: z
          .array(
            z.object({
              path: z.string(),
              content: z.string().max(50_000),
            })
          )
          .max(500)
          .optional()
          .default([]),
      })
    )
    .mutation(({ input }) => {
      const layers: ArchLayer[] = [];
      const dependencies: ArchDependency[] = [];
      const patterns: ArchPattern[] = [];

      // Detect layers from file paths
      const layerMap = new Map<string, string[]>();
      for (const file of input.files) {
        const parts = file.path.split("/");
        const topDir = parts[0] ?? "root";
        const existing = layerMap.get(topDir) ?? [];
        existing.push(file.path);
        layerMap.set(topDir, existing);
      }

      for (const [name, files] of layerMap) {
        layers.push({
          name,
          description: `${files.length} files in ${name}/`,
          files: files.slice(0, 10),
        });
      }

      // Detect import dependencies
      for (const file of input.files) {
        const importMatches = file.content.matchAll(
          /import\s+.*?from\s+["'](.+?)["']/g
        );
        for (const match of importMatches) {
          const target = match[1];
          if (target) {
            dependencies.push({
              from: file.path,
              to: target,
              type: "import",
            });
          }
        }
      }

      // Detect common patterns
      const hasTests = input.files.some(
        (f) => f.path.includes("__tests__") || f.path.includes(".test.")
      );
      if (hasTests) {
        patterns.push({
          name: "Test Co-location",
          description: "Tests are co-located with source files",
          confidence: 0.8,
        });
      }

      const hasTRPC = input.files.some((f) => f.content.includes("tRPC"));
      if (hasTRPC) {
        patterns.push({
          name: "tRPC API",
          description: "Uses tRPC for type-safe API layer",
          confidence: 0.9,
        });
      }

      logger.info(
        {
          projectId: input.projectId,
          layers: layers.length,
          dependencies: dependencies.length,
          patterns: patterns.length,
        },
        "Architecture analyzed"
      );

      return {
        projectId: input.projectId,
        layers,
        dependencies: dependencies.slice(0, 100),
        patterns,
      };
    }),

  /**
   * Generate a Mermaid diagram from code structure.
   */
  generateDiagram: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        diagramType: z
          .enum(["dependency", "layer", "component"])
          .default("dependency"),
        files: z
          .array(
            z.object({ path: z.string(), content: z.string().max(50_000) })
          )
          .max(200)
          .optional()
          .default([]),
      })
    )
    .mutation(({ input }) => {
      const lines: string[] = ["graph TD"];

      if (input.diagramType === "layer") {
        // Group files into layers
        const dirs = new Set<string>();
        for (const file of input.files) {
          const dir = file.path.split("/")[0] ?? "root";
          dirs.add(dir);
        }
        for (const dir of dirs) {
          const sanitized = dir.replace(/[^a-zA-Z0-9]/g, "_");
          lines.push(`  ${sanitized}[${dir}]`);
        }
      } else {
        // Dependency diagram
        const seen = new Set<string>();
        for (const file of input.files.slice(0, 50)) {
          const fromNode = file.path.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30);
          const imports = file.content.matchAll(
            /import\s+.*?from\s+["'](.+?)["']/g
          );
          for (const match of imports) {
            const raw = match[1] ?? "";
            const toNode = raw.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30);
            const edgeKey = `${fromNode}-->${toNode}`;
            if (!seen.has(edgeKey)) {
              seen.add(edgeKey);
              lines.push(`  ${fromNode} --> ${toNode}`);
            }
          }
        }
      }

      const mermaid = lines.join("\n");

      logger.info(
        {
          projectId: input.projectId,
          diagramType: input.diagramType,
          nodeCount: lines.length - 1,
        },
        "Mermaid diagram generated"
      );

      return { projectId: input.projectId, mermaid };
    }),

  /**
   * Detect architectural smells.
   */
  findIssues: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        files: z
          .array(
            z.object({ path: z.string(), content: z.string().max(50_000) })
          )
          .max(500)
          .optional()
          .default([]),
      })
    )
    .mutation(({ input }) => {
      const issues: ArchSmell[] = [];

      // Check for god files (too many exports/functions)
      for (const file of input.files) {
        const exportCount = (file.content.match(/export\s/g) ?? []).length;
        if (exportCount > 20) {
          issues.push({
            name: "God File",
            description: `${file.path} has ${exportCount} exports - consider splitting`,
            severity: "high",
            affectedFiles: [file.path],
            suggestion:
              "Split into smaller, focused modules with single responsibility",
          });
        }
      }

      // Check for circular dependency patterns
      const circularIssues = detectCircularDependencies(input.files);
      issues.push(...circularIssues);

      logger.info(
        { projectId: input.projectId, issueCount: issues.length },
        "Architecture issues detected"
      );

      return { projectId: input.projectId, issues };
    }),

  /**
   * Impact analysis: given a file change, what else might break?
   */
  impactAnalysis: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        changedFile: z.string().min(1),
        files: z
          .array(
            z.object({ path: z.string(), content: z.string().max(50_000) })
          )
          .max(500)
          .optional()
          .default([]),
      })
    )
    .mutation(({ input }) => {
      const impacted: Array<{ path: string; reason: string }> = [];

      // Find files that import the changed file
      for (const file of input.files) {
        if (file.path === input.changedFile) {
          continue;
        }

        const changedBaseName = input.changedFile
          .replace(FILE_EXTENSION_RE, "")
          .split("/")
          .pop();

        if (changedBaseName && file.content.includes(changedBaseName)) {
          impacted.push({
            path: file.path,
            reason: `Imports or references ${input.changedFile}`,
          });
        }
      }

      // Check for test files
      const testFile = input.changedFile.replace(TEST_FILE_RE, ".test.$1");
      const hasTest = input.files.some((f) => f.path.includes(testFile));

      logger.info(
        {
          projectId: input.projectId,
          changedFile: input.changedFile,
          impactedCount: impacted.length,
        },
        "Impact analysis completed"
      );

      return {
        projectId: input.projectId,
        changedFile: input.changedFile,
        impactedFiles: impacted,
        hasTests: hasTest,
        riskLevel: getRiskLevel(impacted.length),
      };
    }),
});

const IMPORT_FROM_RE = /import\s+.*?from\s+["']\.\.?\/(.*?)["']/g;

function detectCircularDependencies(
  files: Array<{ path: string; content: string }>
): ArchSmell[] {
  const issues: ArchSmell[] = [];
  const importMap = new Map<string, string[]>();

  for (const file of files) {
    const imports: string[] = [];
    const matches = file.content.matchAll(IMPORT_FROM_RE);
    for (const m of matches) {
      if (m[1]) {
        imports.push(m[1]);
      }
    }
    importMap.set(file.path, imports);
  }

  for (const [fileA, importsA] of importMap) {
    for (const importTarget of importsA) {
      for (const [fileB, importsB] of importMap) {
        if (
          fileB.includes(importTarget) &&
          importsB.some((i) => fileA.includes(i))
        ) {
          issues.push({
            name: "Potential Circular Dependency",
            description: `${fileA} and ${fileB} may have circular imports`,
            severity: "medium",
            affectedFiles: [fileA, fileB],
            suggestion:
              "Extract shared types/interfaces into a separate module",
          });
        }
      }
    }
  }

  return issues;
}

function getRiskLevel(impactedCount: number): "high" | "medium" | "low" {
  if (impactedCount > 10) {
    return "high";
  }
  if (impactedCount > 3) {
    return "medium";
  }
  return "low";
}
