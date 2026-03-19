import type { Database } from "@prometheus/db";
import {
  codeEmbeddings,
  graphEdges,
  graphNodes,
  projects,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("code-analysis-router");

const PROJECT_BRAIN_URL = "http://localhost:4003";

/**
 * Verify that a project belongs to the caller's org.
 */
async function verifyProjectAccess(
  db: Database,
  projectId: string,
  orgId: string
) {
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.orgId, orgId)),
  });

  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }

  return project;
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const codeAnalysisRouter = router({
  // ─── Analyze Single File ───────────────────────────────────────────────
  analyzeFile: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1, "Project ID is required"),
        filePath: z.string().min(1, "File path is required"),
      })
    )
    .query(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);

      // Fetch all graph nodes in this file
      const fileNodes = await ctx.db
        .select()
        .from(graphNodes)
        .where(
          and(
            eq(graphNodes.projectId, input.projectId),
            eq(graphNodes.filePath, input.filePath)
          )
        );

      if (fileNodes.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "No analysis data found for this file. Ensure the project has been indexed.",
        });
      }

      const nodeIds = fileNodes.map((n) => n.id);

      // Fetch edges for these nodes
      const outgoingEdges = await ctx.db
        .select()
        .from(graphEdges)
        .where(
          and(
            eq(graphEdges.projectId, input.projectId),
            inArray(graphEdges.sourceId, nodeIds)
          )
        );

      const incomingEdges = await ctx.db
        .select()
        .from(graphEdges)
        .where(
          and(
            eq(graphEdges.projectId, input.projectId),
            inArray(graphEdges.targetId, nodeIds)
          )
        );

      // Fetch code embeddings for this file
      const embeddings = await ctx.db
        .select({
          id: codeEmbeddings.id,
          chunkIndex: codeEmbeddings.chunkIndex,
          content: codeEmbeddings.content,
        })
        .from(codeEmbeddings)
        .where(
          and(
            eq(codeEmbeddings.projectId, input.projectId),
            eq(codeEmbeddings.filePath, input.filePath)
          )
        );

      // Compute file-level metrics
      const functionCount = fileNodes.filter(
        (n) => n.nodeType === "function"
      ).length;
      const classCount = fileNodes.filter((n) => n.nodeType === "class").length;
      const interfaceCount = fileNodes.filter(
        (n) => n.nodeType === "interface" || n.nodeType === "type"
      ).length;
      const componentCount = fileNodes.filter(
        (n) => n.nodeType === "component"
      ).length;

      // Compute imports and exports
      const imports = outgoingEdges.filter((e) => e.edgeType === "imports");
      const exports = outgoingEdges.filter((e) => e.edgeType === "exports");

      // Line count estimation from node ranges
      let maxLine = 0;
      for (const node of fileNodes) {
        if (node.endLine && node.endLine > maxLine) {
          maxLine = node.endLine;
        }
      }

      // Compute complexity heuristic based on node and edge counts
      const complexityScore = computeComplexityScore(
        fileNodes.length,
        outgoingEdges.length + incomingEdges.length,
        functionCount,
        classCount
      );

      // Also attempt AI-powered analysis from project-brain
      let aiInsights: {
        summary: string;
        patterns: string[];
        concerns: string[];
      } | null = null;

      try {
        const res = await fetch(`${PROJECT_BRAIN_URL}/analysis/file`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: input.projectId,
            orgId: ctx.orgId,
            filePath: input.filePath,
          }),
        });

        if (res.ok) {
          aiInsights = (await res.json()) as typeof aiInsights;
        }
      } catch {
        // AI analysis is optional, continue without it
      }

      logger.info(
        {
          projectId: input.projectId,
          filePath: input.filePath,
          nodeCount: fileNodes.length,
          complexityScore,
        },
        "File analysis complete"
      );

      return {
        filePath: input.filePath,
        estimatedLines: maxLine,
        symbols: {
          functions: functionCount,
          classes: classCount,
          interfaces: interfaceCount,
          components: componentCount,
          total: fileNodes.length,
        },
        dependencies: {
          imports: imports.length,
          exports: exports.length,
          incomingReferences: incomingEdges.length,
          outgoingReferences: outgoingEdges.length,
        },
        complexity: {
          score: complexityScore,
          level: getComplexityLevel(complexityScore),
        },
        nodes: fileNodes.map((n) => ({
          id: n.id,
          type: n.nodeType,
          name: n.name,
          startLine: n.startLine,
          endLine: n.endLine,
        })),
        chunks: embeddings.length,
        aiInsights,
      };
    }),

  // ─── Detect Dead Code ──────────────────────────────────────────────────
  detectDeadCode: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1, "Project ID is required"),
        nodeTypes: z
          .array(
            z.enum([
              "function",
              "class",
              "module",
              "component",
              "interface",
              "type",
            ])
          )
          .default(["function", "class", "component"]),
        limit: z.number().int().min(1).max(200).default(50),
      })
    )
    .query(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);

      // Find nodes of the requested types
      const exportedNodes = await ctx.db
        .select()
        .from(graphNodes)
        .where(
          and(
            eq(graphNodes.projectId, input.projectId),
            inArray(graphNodes.nodeType, input.nodeTypes)
          )
        );

      if (exportedNodes.length === 0) {
        return { deadCode: [], totalAnalyzed: 0, deadCodeCount: 0 };
      }

      const nodeIds = exportedNodes.map((n) => n.id);

      // For each node, check if it has any incoming edges from other files
      // This is done by finding nodes with zero incoming "imports" or "calls" edges
      const nodesWithIncomingRefs = await ctx.db
        .select({ targetId: graphEdges.targetId })
        .from(graphEdges)
        .where(
          and(
            eq(graphEdges.projectId, input.projectId),
            inArray(graphEdges.targetId, nodeIds),
            inArray(graphEdges.edgeType, ["imports", "calls", "uses_type"])
          )
        )
        .groupBy(graphEdges.targetId);

      const referencedNodeIds = new Set(
        nodesWithIncomingRefs.map((r) => r.targetId)
      );

      // Nodes with no incoming references are potentially dead
      const deadCandidates = exportedNodes.filter(
        (n) => !referencedNodeIds.has(n.id)
      );

      // Exclude nodes that have "contains" edges (parent modules)
      const deadCandidateIds = deadCandidates.map((n) => n.id);
      const containedNodes =
        deadCandidateIds.length > 0
          ? await ctx.db
              .select({ targetId: graphEdges.targetId })
              .from(graphEdges)
              .where(
                and(
                  eq(graphEdges.projectId, input.projectId),
                  inArray(graphEdges.targetId, deadCandidateIds),
                  eq(graphEdges.edgeType, "contains")
                )
              )
          : [];

      const containedNodeIds = new Set(containedNodes.map((c) => c.targetId));

      const deadCode = deadCandidates
        .filter((n) => !containedNodeIds.has(n.id))
        .slice(0, input.limit)
        .map((n) => ({
          nodeId: n.id,
          name: n.name,
          type: n.nodeType,
          filePath: n.filePath,
          startLine: n.startLine,
          endLine: n.endLine,
          confidence: 0.7, // Heuristic-based, not 100% certain
        }));

      logger.info(
        {
          projectId: input.projectId,
          totalAnalyzed: exportedNodes.length,
          deadCodeFound: deadCode.length,
        },
        "Dead code detection complete"
      );

      return {
        deadCode,
        totalAnalyzed: exportedNodes.length,
        deadCodeCount: deadCode.length,
      };
    }),

  // ─── Measure Tech Debt ─────────────────────────────────────────────────
  measureTechDebt: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1, "Project ID is required"),
      })
    )
    .query(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);

      // Gather metrics from the graph
      const [nodeStats] = await ctx.db
        .select({
          totalNodes: sql<number>`COUNT(*)`,
          totalFiles: sql<number>`COUNT(DISTINCT ${graphNodes.filePath})`,
          avgNodesPerFile: sql<number>`COUNT(*)::float / NULLIF(COUNT(DISTINCT ${graphNodes.filePath}), 0)`,
        })
        .from(graphNodes)
        .where(eq(graphNodes.projectId, input.projectId));

      const [edgeStats] = await ctx.db
        .select({
          totalEdges: sql<number>`COUNT(*)`,
          avgEdgesPerNode: sql<number>`COUNT(*)::float / NULLIF((
            SELECT COUNT(*) FROM graph_nodes WHERE project_id = ${input.projectId}
          ), 0)`,
        })
        .from(graphEdges)
        .where(eq(graphEdges.projectId, input.projectId));

      // Files with very high node counts (complex files)
      const complexFiles = await ctx.db
        .select({
          filePath: graphNodes.filePath,
          nodeCount: sql<number>`COUNT(*)`,
        })
        .from(graphNodes)
        .where(eq(graphNodes.projectId, input.projectId))
        .groupBy(graphNodes.filePath)
        .having(sql`COUNT(*) > 20`)
        .orderBy(sql`COUNT(*) DESC`)
        .limit(10);

      // Files with very high coupling (many incoming + outgoing edges)
      const highCouplingFiles = await ctx.db
        .select({
          filePath: graphNodes.filePath,
          edgeCount: sql<number>`(
            SELECT COUNT(*) FROM graph_edges
            WHERE graph_edges.project_id = ${input.projectId}
            AND (graph_edges.source_id IN (
              SELECT id FROM graph_nodes WHERE file_path = ${graphNodes.filePath} AND project_id = ${input.projectId}
            ) OR graph_edges.target_id IN (
              SELECT id FROM graph_nodes WHERE file_path = ${graphNodes.filePath} AND project_id = ${input.projectId}
            ))
          )`,
        })
        .from(graphNodes)
        .where(eq(graphNodes.projectId, input.projectId))
        .groupBy(graphNodes.filePath)
        .orderBy(
          sql`(
          SELECT COUNT(*) FROM graph_edges
          WHERE graph_edges.project_id = ${input.projectId}
          AND (graph_edges.source_id IN (
            SELECT id FROM graph_nodes WHERE file_path = ${graphNodes.filePath} AND project_id = ${input.projectId}
          ) OR graph_edges.target_id IN (
            SELECT id FROM graph_nodes WHERE file_path = ${graphNodes.filePath} AND project_id = ${input.projectId}
          ))
        ) DESC`
        )
        .limit(10);

      // Compute tech debt score (0-100, higher = more debt)
      const totalNodes = Number(nodeStats?.totalNodes ?? 0);
      const totalFiles = Number(nodeStats?.totalFiles ?? 0);
      const totalEdges = Number(edgeStats?.totalEdges ?? 0);
      const avgNodesPerFile = Number(nodeStats?.avgNodesPerFile ?? 0);
      const avgEdgesPerNode = Number(edgeStats?.avgEdgesPerNode ?? 0);

      // Scoring factors:
      // 1. Average file complexity (nodes per file) - ideal: 5-15
      const complexityPenalty = Math.max(0, (avgNodesPerFile - 15) / 30) * 25;
      // 2. Coupling ratio (edges per node) - ideal: 1-3
      const couplingPenalty = Math.max(0, (avgEdgesPerNode - 3) / 5) * 25;
      // 3. Number of highly complex files
      const complexFilePenalty = Math.min(25, complexFiles.length * 2.5);
      // 4. Number of highly coupled files
      const highCouplingPenalty = Math.min(25, highCouplingFiles.length * 2.5);

      const techDebtScore = Math.min(
        100,
        Math.round(
          complexityPenalty +
            couplingPenalty +
            complexFilePenalty +
            highCouplingPenalty
        )
      );

      const techDebtLevel = getTechDebtLevel(techDebtScore);

      logger.info(
        {
          projectId: input.projectId,
          techDebtScore,
          techDebtLevel,
          totalFiles,
          totalNodes,
        },
        "Tech debt measurement complete"
      );

      return {
        score: techDebtScore,
        level: techDebtLevel,
        summary: {
          totalFiles,
          totalNodes,
          totalEdges,
          avgNodesPerFile: Math.round(avgNodesPerFile * 10) / 10,
          avgEdgesPerNode: Math.round(avgEdgesPerNode * 10) / 10,
        },
        factors: {
          complexityPenalty: Math.round(complexityPenalty),
          couplingPenalty: Math.round(couplingPenalty),
          complexFilePenalty: Math.round(complexFilePenalty),
          highCouplingPenalty: Math.round(highCouplingPenalty),
        },
        complexFiles: complexFiles.map((f) => ({
          filePath: f.filePath,
          nodeCount: Number(f.nodeCount),
        })),
        highCouplingFiles: highCouplingFiles.map((f) => ({
          filePath: f.filePath,
          edgeCount: Number(f.edgeCount),
        })),
      };
    }),

  // ─── Suggest Refactoring ───────────────────────────────────────────────
  suggestRefactoring: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1, "Project ID is required"),
        filePath: z.string().min(1, "File path is required").optional(),
        limit: z.number().int().min(1).max(50).default(10),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);

      // Attempt AI-powered suggestions from project-brain
      try {
        const res = await fetch(
          `${PROJECT_BRAIN_URL}/analysis/suggest-refactoring`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: input.projectId,
              orgId: ctx.orgId,
              filePath: input.filePath ?? null,
              limit: input.limit,
            }),
          }
        );

        if (res.ok) {
          const data = (await res.json()) as {
            suggestions: Array<{
              type: string;
              title: string;
              description: string;
              filePath: string;
              priority: "low" | "medium" | "high" | "critical";
              estimatedEffort: string;
            }>;
          };

          logger.info(
            {
              projectId: input.projectId,
              suggestionCount: data.suggestions.length,
            },
            "AI refactoring suggestions generated"
          );

          return { suggestions: data.suggestions, source: "ai" as const };
        }
      } catch {
        // Fall through to heuristic analysis
      }

      // Heuristic-based suggestions from graph analysis
      const suggestions: Array<{
        type: string;
        title: string;
        description: string;
        filePath: string;
        priority: "low" | "medium" | "high" | "critical";
        estimatedEffort: string;
      }> = [];

      // Find large files that should be split
      const fileConditions = [eq(graphNodes.projectId, input.projectId)];
      if (input.filePath) {
        fileConditions.push(eq(graphNodes.filePath, input.filePath));
      }

      const largeFiles = await ctx.db
        .select({
          filePath: graphNodes.filePath,
          nodeCount: sql<number>`COUNT(*)`,
          functionCount: sql<number>`COUNT(*) FILTER (WHERE ${graphNodes.nodeType} = 'function')`,
          classCount: sql<number>`COUNT(*) FILTER (WHERE ${graphNodes.nodeType} = 'class')`,
        })
        .from(graphNodes)
        .where(and(...fileConditions))
        .groupBy(graphNodes.filePath)
        .having(sql`COUNT(*) > 15`)
        .orderBy(sql`COUNT(*) DESC`)
        .limit(input.limit);

      for (const file of largeFiles) {
        const nodeCount = Number(file.nodeCount);
        const functionCount = Number(file.functionCount);

        if (nodeCount > 30) {
          suggestions.push({
            type: "extract_module",
            title: `Split large file: ${file.filePath}`,
            description: `This file contains ${nodeCount} symbols (${functionCount} functions). Consider extracting related functionality into separate modules for better maintainability.`,
            filePath: file.filePath,
            priority: nodeCount > 50 ? "critical" : "high",
            estimatedEffort: nodeCount > 50 ? "4-8 hours" : "2-4 hours",
          });
        } else if (functionCount > 10) {
          suggestions.push({
            type: "extract_functions",
            title: `Extract functions from: ${file.filePath}`,
            description: `This file has ${functionCount} functions. Group related functions into separate utility modules.`,
            filePath: file.filePath,
            priority: "medium",
            estimatedEffort: "1-2 hours",
          });
        }
      }

      // Find circular dependencies
      const circularEdges = await ctx.db
        .select({
          sourceFile: sql<string>`source_nodes.file_path`,
          targetFile: sql<string>`target_nodes.file_path`,
        })
        .from(graphEdges)
        .innerJoin(
          sql`graph_nodes source_nodes`,
          sql`source_nodes.id = ${graphEdges.sourceId}`
        )
        .innerJoin(
          sql`graph_nodes target_nodes`,
          sql`target_nodes.id = ${graphEdges.targetId}`
        )
        .where(
          and(
            eq(graphEdges.projectId, input.projectId),
            eq(graphEdges.edgeType, "imports"),
            sql`EXISTS (
              SELECT 1 FROM graph_edges ge2
              JOIN graph_nodes gn_src ON gn_src.id = ge2.source_id
              JOIN graph_nodes gn_tgt ON gn_tgt.id = ge2.target_id
              WHERE ge2.edge_type = 'imports'
              AND gn_src.file_path = target_nodes.file_path
              AND gn_tgt.file_path = source_nodes.file_path
              AND ge2.project_id = ${input.projectId}
            )`
          )
        )
        .limit(10);

      const seenCircular = new Set<string>();
      for (const edge of circularEdges) {
        const key = [edge.sourceFile, edge.targetFile].sort().join("↔");
        if (seenCircular.has(key)) {
          continue;
        }
        seenCircular.add(key);

        suggestions.push({
          type: "break_circular_dependency",
          title: `Circular dependency: ${edge.sourceFile} ↔ ${edge.targetFile}`,
          description:
            "These files have a circular import dependency. Introduce an interface or shared module to break the cycle.",
          filePath: edge.sourceFile,
          priority: "high",
          estimatedEffort: "2-4 hours",
        });
      }

      logger.info(
        {
          projectId: input.projectId,
          suggestionCount: suggestions.length,
        },
        "Heuristic refactoring suggestions generated"
      );

      return {
        suggestions: suggestions.slice(0, input.limit),
        source: "heuristic" as const,
      };
    }),

  // ─── Find Performance Issues ───────────────────────────────────────────
  findPerformanceIssues: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1, "Project ID is required"),
        limit: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);

      // Attempt AI-powered performance analysis from project-brain
      try {
        const res = await fetch(
          `${PROJECT_BRAIN_URL}/analysis/performance-issues`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: input.projectId,
              orgId: ctx.orgId,
              limit: input.limit,
            }),
          }
        );

        if (res.ok) {
          const data = (await res.json()) as {
            issues: Array<{
              type: string;
              title: string;
              description: string;
              filePath: string;
              severity: "info" | "warning" | "error";
              suggestion: string;
            }>;
          };

          logger.info(
            {
              projectId: input.projectId,
              issueCount: data.issues.length,
            },
            "AI performance analysis complete"
          );

          return { issues: data.issues, source: "ai" as const };
        }
      } catch {
        // Fall through to heuristic analysis
      }

      // Heuristic detection based on graph patterns
      const issues: Array<{
        type: string;
        title: string;
        description: string;
        filePath: string;
        severity: "info" | "warning" | "error";
        suggestion: string;
      }> = [];

      // Detect barrel files (files that re-export many modules)
      const barrelFiles = await ctx.db
        .select({
          filePath: graphNodes.filePath,
          exportCount: sql<number>`COUNT(*) FILTER (WHERE ${graphNodes.nodeType} = 'module')`,
        })
        .from(graphNodes)
        .where(eq(graphNodes.projectId, input.projectId))
        .groupBy(graphNodes.filePath)
        .having(
          sql`COUNT(*) FILTER (WHERE ${graphNodes.nodeType} = 'module') > 10`
        )
        .limit(10);

      for (const file of barrelFiles) {
        issues.push({
          type: "barrel_file",
          title: `Potential barrel file: ${file.filePath}`,
          description: `This file re-exports ${Number(file.exportCount)} modules. Barrel files can cause tree-shaking issues and increase bundle size.`,
          filePath: file.filePath,
          severity: "warning",
          suggestion:
            "Import directly from source modules instead of through barrel files to improve tree-shaking.",
        });
      }

      // Detect overly large files that may cause slow IDE performance
      const largeFiles = await ctx.db
        .select({
          filePath: graphNodes.filePath,
          maxLine: sql<number>`MAX(${graphNodes.endLine})`,
        })
        .from(graphNodes)
        .where(eq(graphNodes.projectId, input.projectId))
        .groupBy(graphNodes.filePath)
        .having(sql`MAX(${graphNodes.endLine}) > 500`)
        .orderBy(sql`MAX(${graphNodes.endLine}) DESC`)
        .limit(10);

      for (const file of largeFiles) {
        const lineCount = Number(file.maxLine);
        issues.push({
          type: "large_file",
          title: `Large file (${lineCount}+ lines): ${file.filePath}`,
          description: `This file appears to be ${lineCount}+ lines. Large files are harder to maintain and can slow down IDE tooling.`,
          filePath: file.filePath,
          severity: lineCount > 1000 ? "error" : "warning",
          suggestion:
            "Split this file into smaller, cohesive modules. Extract utility functions, types, and constants into separate files.",
        });
      }

      logger.info(
        {
          projectId: input.projectId,
          issueCount: issues.length,
        },
        "Heuristic performance analysis complete"
      );

      return {
        issues: issues.slice(0, input.limit),
        source: "heuristic" as const,
      };
    }),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeComplexityScore(
  totalNodes: number,
  totalEdges: number,
  functionCount: number,
  classCount: number
): number {
  // Weighted complexity formula
  const nodeWeight = totalNodes * 1;
  const edgeWeight = totalEdges * 1.5;
  const functionWeight = functionCount * 0.5;
  const classWeight = classCount * 2;

  const raw = nodeWeight + edgeWeight + functionWeight + classWeight;

  // Normalize to 0-100 scale (logarithmic to handle wide range)
  return Math.min(100, Math.round(Math.log2(raw + 1) * 10));
}

function getComplexityLevel(
  score: number
): "low" | "medium" | "high" | "critical" {
  if (score < 25) {
    return "low";
  }
  if (score < 50) {
    return "medium";
  }
  if (score < 75) {
    return "high";
  }
  return "critical";
}

function getTechDebtLevel(
  score: number
): "minimal" | "low" | "moderate" | "high" | "critical" {
  if (score < 10) {
    return "minimal";
  }
  if (score < 25) {
    return "low";
  }
  if (score < 50) {
    return "moderate";
  }
  if (score < 75) {
    return "high";
  }
  return "critical";
}
