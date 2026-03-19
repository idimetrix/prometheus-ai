import type { Database } from "@prometheus/db";
import { graphEdges, graphNodes, projects } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("architecture-router");

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

// ─── Type definitions for edge/node types ────────────────────────────────────

const nodeTypeEnum = z.enum([
  "file",
  "function",
  "class",
  "module",
  "component",
  "interface",
  "type",
]);

const edgeTypeEnum = z.enum([
  "imports",
  "calls",
  "extends",
  "implements",
  "depends_on",
  "contains",
  "exports",
  "uses_type",
]);

// ─── Router ──────────────────────────────────────────────────────────────────

export const architectureRouter = router({
  // ─── Get Knowledge Graph ───────────────────────────────────────────────
  getGraph: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1, "Project ID is required"),
        nodeTypes: z.array(nodeTypeEnum).optional(),
        edgeTypes: z.array(edgeTypeEnum).optional(),
        filePath: z.string().optional(),
        depth: z.number().int().min(1).max(10).default(3),
        limit: z.number().int().min(1).max(1000).default(200),
      })
    )
    .query(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);

      // Build node query conditions
      const nodeConditions = [eq(graphNodes.projectId, input.projectId)];

      if (input.nodeTypes && input.nodeTypes.length > 0) {
        nodeConditions.push(inArray(graphNodes.nodeType, input.nodeTypes));
      }

      if (input.filePath) {
        nodeConditions.push(eq(graphNodes.filePath, input.filePath));
      }

      // Fetch nodes
      const nodes = await ctx.db
        .select()
        .from(graphNodes)
        .where(and(...nodeConditions))
        .limit(input.limit);

      if (nodes.length === 0) {
        return { nodes: [], edges: [], stats: { nodeCount: 0, edgeCount: 0 } };
      }

      const nodeIds = nodes.map((n) => n.id);

      // Fetch edges connected to these nodes
      const edgeConditions = [
        eq(graphEdges.projectId, input.projectId),
        or(
          inArray(graphEdges.sourceId, nodeIds),
          inArray(graphEdges.targetId, nodeIds)
        ),
      ];

      if (input.edgeTypes && input.edgeTypes.length > 0) {
        edgeConditions.push(inArray(graphEdges.edgeType, input.edgeTypes));
      }

      const edges = await ctx.db
        .select()
        .from(graphEdges)
        .where(and(...edgeConditions))
        .limit(input.limit * 3);

      logger.info(
        {
          projectId: input.projectId,
          nodeCount: nodes.length,
          edgeCount: edges.length,
        },
        "Architecture graph retrieved"
      );

      return {
        nodes: nodes.map((n) => ({
          id: n.id,
          type: n.nodeType,
          name: n.name,
          filePath: n.filePath,
          startLine: n.startLine,
          endLine: n.endLine,
          metadata: n.metadata,
        })),
        edges: edges.map((e) => ({
          id: e.id,
          sourceId: e.sourceId,
          targetId: e.targetId,
          type: e.edgeType,
          weight: e.weight,
          metadata: e.metadata,
        })),
        stats: {
          nodeCount: nodes.length,
          edgeCount: edges.length,
        },
      };
    }),

  // ─── Get Node Detail ───────────────────────────────────────────────────
  getNodeDetail: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1, "Project ID is required"),
        nodeId: z.string().min(1, "Node ID is required"),
      })
    )
    .query(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);

      const [node] = await ctx.db
        .select()
        .from(graphNodes)
        .where(
          and(
            eq(graphNodes.id, input.nodeId),
            eq(graphNodes.projectId, input.projectId)
          )
        )
        .limit(1);

      if (!node) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Graph node not found",
        });
      }

      // Fetch incoming edges (dependencies on this node)
      const incomingEdges = await ctx.db
        .select()
        .from(graphEdges)
        .where(
          and(
            eq(graphEdges.targetId, input.nodeId),
            eq(graphEdges.projectId, input.projectId)
          )
        );

      // Fetch outgoing edges (this node's dependencies)
      const outgoingEdges = await ctx.db
        .select()
        .from(graphEdges)
        .where(
          and(
            eq(graphEdges.sourceId, input.nodeId),
            eq(graphEdges.projectId, input.projectId)
          )
        );

      // Get the connected node details
      const connectedNodeIds = [
        ...incomingEdges.map((e) => e.sourceId),
        ...outgoingEdges.map((e) => e.targetId),
      ];

      const connectedNodes =
        connectedNodeIds.length > 0
          ? await ctx.db
              .select()
              .from(graphNodes)
              .where(
                and(
                  inArray(graphNodes.id, connectedNodeIds),
                  eq(graphNodes.projectId, input.projectId)
                )
              )
          : [];

      const connectedNodeMap = new Map(connectedNodes.map((n) => [n.id, n]));

      return {
        node: {
          id: node.id,
          type: node.nodeType,
          name: node.name,
          filePath: node.filePath,
          startLine: node.startLine,
          endLine: node.endLine,
          metadata: node.metadata,
          createdAt: node.createdAt,
          updatedAt: node.updatedAt,
        },
        dependencies: outgoingEdges.map((e) => ({
          edgeId: e.id,
          type: e.edgeType,
          weight: e.weight,
          target: connectedNodeMap.get(e.targetId)
            ? {
                id: e.targetId,
                name: connectedNodeMap.get(e.targetId)?.name ?? "",
                type: connectedNodeMap.get(e.targetId)?.nodeType ?? "",
                filePath: connectedNodeMap.get(e.targetId)?.filePath ?? "",
              }
            : null,
        })),
        dependents: incomingEdges.map((e) => ({
          edgeId: e.id,
          type: e.edgeType,
          weight: e.weight,
          source: connectedNodeMap.get(e.sourceId)
            ? {
                id: e.sourceId,
                name: connectedNodeMap.get(e.sourceId)?.name ?? "",
                type: connectedNodeMap.get(e.sourceId)?.nodeType ?? "",
                filePath: connectedNodeMap.get(e.sourceId)?.filePath ?? "",
              }
            : null,
        })),
        stats: {
          inDegree: incomingEdges.length,
          outDegree: outgoingEdges.length,
          totalConnections: incomingEdges.length + outgoingEdges.length,
        },
      };
    }),

  // ─── Impact Analysis ───────────────────────────────────────────────────
  getImpactAnalysis: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1, "Project ID is required"),
        filePath: z.string().min(1, "File path is required"),
        depth: z.number().int().min(1).max(10).default(3),
      })
    )
    .query(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);

      // Find all nodes in the given file
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
        return {
          filePath: input.filePath,
          directDependents: [],
          transitiveDependents: [],
          impactScore: 0,
          affectedFiles: [],
        };
      }

      const fileNodeIds = fileNodes.map((n) => n.id);

      // BFS traversal to find transitively affected nodes
      const visited = new Set<string>(fileNodeIds);
      let currentLevel = fileNodeIds;
      const directDependents: Array<{
        nodeId: string;
        name: string;
        type: string;
        filePath: string;
        edgeType: string;
      }> = [];
      const transitiveDependents: Array<{
        nodeId: string;
        name: string;
        type: string;
        filePath: string;
        depth: number;
      }> = [];

      for (let depth = 1; depth <= input.depth; depth++) {
        if (currentLevel.length === 0) {
          break;
        }

        // Find all edges where current level nodes are targets (i.e., things that depend on them)
        const edges = await ctx.db
          .select()
          .from(graphEdges)
          .where(
            and(
              eq(graphEdges.projectId, input.projectId),
              inArray(graphEdges.targetId, currentLevel)
            )
          );

        const nextLevelIds: string[] = [];

        for (const edge of edges) {
          if (visited.has(edge.sourceId)) {
            continue;
          }
          visited.add(edge.sourceId);
          nextLevelIds.push(edge.sourceId);
        }

        if (nextLevelIds.length === 0) {
          break;
        }

        // Fetch the dependent nodes
        const dependentNodes = await ctx.db
          .select()
          .from(graphNodes)
          .where(
            and(
              inArray(graphNodes.id, nextLevelIds),
              eq(graphNodes.projectId, input.projectId)
            )
          );

        const dependentNodeMap = new Map(dependentNodes.map((n) => [n.id, n]));

        for (const edge of edges) {
          const node = dependentNodeMap.get(edge.sourceId);
          if (!node) {
            continue;
          }

          if (depth === 1) {
            directDependents.push({
              nodeId: node.id,
              name: node.name,
              type: node.nodeType,
              filePath: node.filePath,
              edgeType: edge.edgeType,
            });
          } else {
            transitiveDependents.push({
              nodeId: node.id,
              name: node.name,
              type: node.nodeType,
              filePath: node.filePath,
              depth,
            });
          }
        }

        currentLevel = nextLevelIds;
      }

      // Compute affected files (unique)
      const affectedFilesSet = new Set<string>();
      for (const d of directDependents) {
        affectedFilesSet.add(d.filePath);
      }
      for (const d of transitiveDependents) {
        affectedFilesSet.add(d.filePath);
      }
      // Remove the source file itself
      affectedFilesSet.delete(input.filePath);

      const totalAffected =
        directDependents.length + transitiveDependents.length;
      // Impact score: normalized 0-100 based on number of dependents
      const impactScore = Math.min(
        100,
        Math.round((totalAffected / Math.max(visited.size, 1)) * 100)
      );

      logger.info(
        {
          projectId: input.projectId,
          filePath: input.filePath,
          directCount: directDependents.length,
          transitiveCount: transitiveDependents.length,
          impactScore,
        },
        "Impact analysis complete"
      );

      return {
        filePath: input.filePath,
        directDependents,
        transitiveDependents,
        impactScore,
        affectedFiles: Array.from(affectedFilesSet),
      };
    }),

  // ─── Architecture Metrics ──────────────────────────────────────────────
  getMetrics: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1, "Project ID is required"),
      })
    )
    .query(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);

      // Count nodes by type
      const nodesByType = await ctx.db
        .select({
          type: graphNodes.nodeType,
          count: sql<number>`COUNT(*)`,
        })
        .from(graphNodes)
        .where(eq(graphNodes.projectId, input.projectId))
        .groupBy(graphNodes.nodeType);

      // Count edges by type
      const edgesByType = await ctx.db
        .select({
          type: graphEdges.edgeType,
          count: sql<number>`COUNT(*)`,
        })
        .from(graphEdges)
        .where(eq(graphEdges.projectId, input.projectId))
        .groupBy(graphEdges.edgeType);

      // Total counts
      const [totalNodes] = await ctx.db
        .select({ count: sql<number>`COUNT(*)` })
        .from(graphNodes)
        .where(eq(graphNodes.projectId, input.projectId));

      const [totalEdges] = await ctx.db
        .select({ count: sql<number>`COUNT(*)` })
        .from(graphEdges)
        .where(eq(graphEdges.projectId, input.projectId));

      // Unique files
      const [uniqueFiles] = await ctx.db
        .select({
          count: sql<number>`COUNT(DISTINCT ${graphNodes.filePath})`,
        })
        .from(graphNodes)
        .where(eq(graphNodes.projectId, input.projectId));

      // Average degree (connections per node)
      const nodeCount = Number(totalNodes?.count ?? 0);
      const edgeCount = Number(totalEdges?.count ?? 0);
      const avgDegree = nodeCount > 0 ? edgeCount / nodeCount : 0;

      // Find most connected nodes (highest coupling)
      const mostConnected = await ctx.db
        .select({
          nodeId: graphNodes.id,
          name: graphNodes.name,
          nodeType: graphNodes.nodeType,
          filePath: graphNodes.filePath,
          connections: sql<number>`(
            SELECT COUNT(*) FROM graph_edges
            WHERE graph_edges.source_id = ${graphNodes.id}
               OR graph_edges.target_id = ${graphNodes.id}
          )`,
        })
        .from(graphNodes)
        .where(eq(graphNodes.projectId, input.projectId))
        .orderBy(
          sql`(
            SELECT COUNT(*) FROM graph_edges
            WHERE graph_edges.source_id = ${graphNodes.id}
               OR graph_edges.target_id = ${graphNodes.id}
          ) DESC`
        )
        .limit(10);

      // Compute coupling metric (ratio of edges to theoretical maximum)
      // For a directed graph: max edges = n * (n - 1)
      const maxEdges = nodeCount * Math.max(nodeCount - 1, 1);
      const couplingRatio = maxEdges > 0 ? edgeCount / maxEdges : 0;

      // Instability metric per file (Ce / (Ca + Ce))
      // Ce = outgoing dependencies, Ca = incoming dependencies
      const fileInstability = await ctx.db
        .select({
          filePath: graphNodes.filePath,
          outgoing: sql<number>`COUNT(DISTINCT ge_out.id)`,
          incoming: sql<number>`COUNT(DISTINCT ge_in.id)`,
        })
        .from(graphNodes)
        .leftJoin(
          sql`graph_edges ge_out`,
          sql`ge_out.source_id = ${graphNodes.id}`
        )
        .leftJoin(
          sql`graph_edges ge_in`,
          sql`ge_in.target_id = ${graphNodes.id}`
        )
        .where(eq(graphNodes.projectId, input.projectId))
        .groupBy(graphNodes.filePath)
        .limit(50);

      const instabilityByFile = fileInstability.map((f) => {
        const outgoing = Number(f.outgoing);
        const incoming = Number(f.incoming);
        const total = outgoing + incoming;
        return {
          filePath: f.filePath,
          instability: total > 0 ? outgoing / total : 0,
          outgoing,
          incoming,
        };
      });

      // Sort by instability descending
      instabilityByFile.sort((a, b) => b.instability - a.instability);

      logger.info(
        {
          projectId: input.projectId,
          nodeCount,
          edgeCount,
          fileCount: Number(uniqueFiles?.count ?? 0),
        },
        "Architecture metrics computed"
      );

      return {
        summary: {
          totalNodes: nodeCount,
          totalEdges: edgeCount,
          uniqueFiles: Number(uniqueFiles?.count ?? 0),
          averageDegree: Math.round(avgDegree * 100) / 100,
          couplingRatio: Math.round(couplingRatio * 10_000) / 10_000,
        },
        nodesByType: nodesByType.map((n) => ({
          type: n.type,
          count: Number(n.count),
        })),
        edgesByType: edgesByType.map((e) => ({
          type: e.type,
          count: Number(e.count),
        })),
        mostConnectedNodes: mostConnected.map((n) => ({
          nodeId: n.nodeId,
          name: n.name,
          type: n.nodeType,
          filePath: n.filePath,
          connections: Number(n.connections),
        })),
        instabilityByFile: instabilityByFile.slice(0, 20),
      };
    }),
});
