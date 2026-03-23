import type { Database } from "@prometheus/db";
import {
  blueprintComponents,
  blueprints,
  blueprintVersions,
  projects,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("blueprints-enhanced-router");

const ORCHESTRATOR_URL =
  process.env.ORCHESTRATOR_URL ?? "http://localhost:4002";
const PROJECT_BRAIN_URL =
  process.env.PROJECT_BRAIN_URL ?? "http://localhost:4003";

/**
 * Verify that a project belongs to the caller's org.
 * Returns the project row or throws TRPC NOT_FOUND.
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

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const blueprintComponentSchema = z.object({
  id: z.string(),
  type: z.enum([
    "frontend",
    "backend",
    "database",
    "auth",
    "deployment",
    "testing",
    "ci-cd",
    "monitoring",
    "storage",
    "messaging",
  ]),
  name: z.string(),
  description: z.string(),
  config: z.record(z.string(), z.unknown()).optional(),
});

// ─── Router ──────────────────────────────────────────────────────────────────

export const blueprintsEnhancedRouter = router({
  // ─── Analyze NL Description ──────────────────────────────────────────────
  analyze: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1, "Project ID is required"),
        description: z
          .string()
          .min(10, "Description must be at least 10 characters")
          .max(10_000),
        constraints: z
          .object({
            budget: z.enum(["free", "low", "medium", "high"]).optional(),
            teamSize: z.number().int().min(1).max(100).optional(),
            timeline: z.enum(["mvp", "sprint", "quarter", "year"]).optional(),
            scalability: z
              .enum(["small", "medium", "large", "enterprise"])
              .optional(),
          })
          .optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);

      logger.info(
        {
          projectId: input.projectId,
          descriptionLength: input.description.length,
        },
        "Analyzing project description for tech stack recommendations"
      );

      // Send to project-brain for AI-powered analysis
      const res = await fetch(`${PROJECT_BRAIN_URL}/blueprints/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: input.projectId,
          orgId: ctx.orgId,
          description: input.description,
          constraints: input.constraints ?? {},
        }),
      });

      if (!res.ok) {
        logger.error(
          { projectId: input.projectId, status: res.status },
          "Failed to analyze project description via project-brain"
        );

        // Return heuristic-based recommendations as fallback
        return {
          summary: input.description.slice(0, 200),
          recommendations: await getHeuristicRecommendations(
            ctx.db,
            input.description
          ),
          suggestedPreset: null,
          estimatedComplexity: "medium" as const,
        };
      }

      const data = (await res.json()) as {
        summary: string;
        recommendations: Array<{
          category: string;
          name: string;
          reason: string;
          confidence: number;
          alternatives: string[];
        }>;
        suggestedPreset: string | null;
        estimatedComplexity: "low" | "medium" | "high" | "enterprise";
      };

      logger.info(
        {
          projectId: input.projectId,
          recommendationCount: data.recommendations.length,
          complexity: data.estimatedComplexity,
        },
        "Project description analysis complete"
      );

      return data;
    }),

  // ─── Scaffold Project from Blueprint ───────────────────────────────────
  scaffold: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1, "Project ID is required"),
        blueprintId: z.string().min(1, "Blueprint ID is required").optional(),
        components: z.array(blueprintComponentSchema).min(1).optional(),
        description: z
          .string()
          .min(10, "Description must be at least 10 characters")
          .max(10_000)
          .optional(),
        techStack: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const project = await verifyProjectAccess(
        ctx.db,
        input.projectId,
        ctx.orgId
      );

      // Resolve blueprint if provided
      let blueprintContent: string | null = null;
      let techStack: Record<string, unknown> = {};

      if (input.blueprintId) {
        const blueprint = await ctx.db.query.blueprints.findFirst({
          where: and(
            eq(blueprints.id, input.blueprintId),
            eq(blueprints.projectId, input.projectId)
          ),
        });

        if (!blueprint) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Blueprint not found",
          });
        }

        blueprintContent = blueprint.content;
        techStack = (blueprint.techStack ?? {}) as Record<string, unknown>;
      }

      // Merge with explicit tech stack overrides
      if (input.techStack) {
        techStack = { ...techStack, ...input.techStack };
      }

      logger.info(
        { projectId: input.projectId, hasBlueprint: !!blueprintContent },
        "Triggering project scaffold via orchestrator"
      );

      // Send scaffold request to orchestrator
      const res = await fetch(`${ORCHESTRATOR_URL}/blueprints/scaffold`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: input.projectId,
          orgId: ctx.orgId,
          userId: ctx.auth.userId,
          blueprintContent,
          components: input.components ?? [],
          description: input.description ?? project.description ?? "",
          techStack,
        }),
      });

      if (!res.ok) {
        logger.error(
          { projectId: input.projectId, status: res.status },
          "Failed to scaffold project via orchestrator"
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to scaffold project",
        });
      }

      const result = (await res.json()) as {
        sessionId: string;
        taskId: string;
        estimatedSteps: number;
      };

      // Create a new blueprint version if scaffolding from description
      if (!input.blueprintId && input.description) {
        const bpId = generateId("bp");
        await ctx.db.insert(blueprints).values({
          id: bpId,
          projectId: input.projectId,
          version: "1.0.0",
          content: input.description,
          techStack,
          isActive: true,
        });

        logger.info(
          { projectId: input.projectId, blueprintId: bpId },
          "Blueprint created from scaffold description"
        );
      }

      logger.info(
        {
          projectId: input.projectId,
          sessionId: result.sessionId,
          taskId: result.taskId,
        },
        "Project scaffold initiated"
      );

      return {
        success: true,
        sessionId: result.sessionId,
        taskId: result.taskId,
        estimatedSteps: result.estimatedSteps,
      };
    }),

  // ─── Get Blueprint Components ──────────────────────────────────────────
  getComponents: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1, "Project ID is required"),
        blueprintId: z.string().min(1, "Blueprint ID is required"),
      })
    )
    .query(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);

      const blueprint = await ctx.db.query.blueprints.findFirst({
        where: and(
          eq(blueprints.id, input.blueprintId),
          eq(blueprints.projectId, input.projectId)
        ),
        with: {
          versions: {
            orderBy: [desc(blueprintVersions.createdAt)],
            limit: 10,
          },
        },
      });

      if (!blueprint) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Blueprint not found",
        });
      }

      // Fetch components from the dedicated blueprintComponents table
      const components = await ctx.db
        .select()
        .from(blueprintComponents)
        .where(eq(blueprintComponents.blueprintId, input.blueprintId))
        .orderBy(asc(blueprintComponents.order));

      return {
        blueprintId: blueprint.id,
        version: blueprint.version,
        content: blueprint.content,
        techStack: blueprint.techStack,
        components,
        versions: blueprint.versions,
      };
    }),

  // ─── Update Blueprint Component ────────────────────────────────────────
  updateComponent: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1, "Project ID is required"),
        blueprintId: z.string().min(1, "Blueprint ID is required"),
        componentId: z.string().min(1, "Component ID is required"),
        updates: z.object({
          name: z.string().min(1).max(200).optional(),
          description: z.string().max(5000).optional(),
          componentType: z
            .enum([
              "page",
              "api_route",
              "db_table",
              "component",
              "service",
              "middleware",
              "hook",
              "utility",
              "test",
            ])
            .optional(),
          filePath: z.string().max(1000).optional(),
          dependencies: z.array(z.string()).optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
          order: z.number().int().min(0).optional(),
        }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await verifyProjectAccess(ctx.db, input.projectId, ctx.orgId);

      // Verify blueprint belongs to project
      const blueprint = await ctx.db.query.blueprints.findFirst({
        where: and(
          eq(blueprints.id, input.blueprintId),
          eq(blueprints.projectId, input.projectId)
        ),
      });

      if (!blueprint) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Blueprint not found",
        });
      }

      // Verify the component exists and belongs to this blueprint
      const [component] = await ctx.db
        .select()
        .from(blueprintComponents)
        .where(
          and(
            eq(blueprintComponents.id, input.componentId),
            eq(blueprintComponents.blueprintId, input.blueprintId)
          )
        )
        .limit(1);

      if (!component) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Component not found in blueprint",
        });
      }

      // Create a version snapshot before updating
      const versionId = generateId("bpv");
      await ctx.db.insert(blueprintVersions).values({
        id: versionId,
        blueprintId: input.blueprintId,
        version: blueprint.version,
        diff: JSON.stringify({
          componentId: input.componentId,
          changes: input.updates,
          previousValues: {
            name: component.name,
            description: component.description,
            componentType: component.componentType,
            filePath: component.filePath,
          },
        }),
        changedBy: ctx.auth.userId,
      });

      // Build the update set, only including provided fields
      const updateSet: Record<string, unknown> = {
        updatedAt: new Date(),
      };
      if (input.updates.name !== undefined) {
        updateSet.name = input.updates.name;
      }
      if (input.updates.description !== undefined) {
        updateSet.description = input.updates.description;
      }
      if (input.updates.componentType !== undefined) {
        updateSet.componentType = input.updates.componentType;
      }
      if (input.updates.filePath !== undefined) {
        updateSet.filePath = input.updates.filePath;
      }
      if (input.updates.dependencies !== undefined) {
        updateSet.dependencies = input.updates.dependencies;
      }
      if (input.updates.metadata !== undefined) {
        updateSet.metadata = input.updates.metadata;
      }
      if (input.updates.order !== undefined) {
        updateSet.order = input.updates.order;
      }

      const [updated] = await ctx.db
        .update(blueprintComponents)
        .set(updateSet)
        .where(eq(blueprintComponents.id, input.componentId))
        .returning();

      logger.info(
        {
          projectId: input.projectId,
          blueprintId: input.blueprintId,
          componentId: input.componentId,
        },
        "Blueprint component updated"
      );

      return {
        component: updated as NonNullable<typeof updated>,
        versionId,
      };
    }),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generate heuristic-based recommendations when AI analysis is unavailable.
 * Inspects keywords in the description to suggest tech stack options.
 */
function getHeuristicRecommendations(
  _db: Database,
  description: string
): Array<{
  category: string;
  name: string;
  reason: string;
  confidence: number;
  alternatives: string[];
}> {
  const lower = description.toLowerCase();
  const recommendations: Array<{
    category: string;
    name: string;
    reason: string;
    confidence: number;
    alternatives: string[];
  }> = [];

  // Frontend detection
  if (
    lower.includes("web") ||
    lower.includes("dashboard") ||
    lower.includes("ui") ||
    lower.includes("frontend")
  ) {
    recommendations.push({
      category: "frontend",
      name: "Next.js",
      reason: "Full-stack React framework with SSR, ideal for web applications",
      confidence: 0.8,
      alternatives: ["Remix", "Vite + React", "SvelteKit"],
    });
  }

  // API detection
  if (
    lower.includes("api") ||
    lower.includes("backend") ||
    lower.includes("server") ||
    lower.includes("microservice")
  ) {
    recommendations.push({
      category: "backend",
      name: "Hono",
      reason: "Lightweight, fast web framework with TypeScript support",
      confidence: 0.75,
      alternatives: ["Express", "Fastify", "NestJS"],
    });
  }

  // Database detection
  if (
    lower.includes("data") ||
    lower.includes("store") ||
    lower.includes("database") ||
    lower.includes("crud")
  ) {
    recommendations.push({
      category: "database",
      name: "PostgreSQL + Drizzle ORM",
      reason: "Robust relational database with type-safe ORM",
      confidence: 0.85,
      alternatives: ["MongoDB", "MySQL", "SQLite"],
    });
  }

  // Auth detection
  if (
    lower.includes("auth") ||
    lower.includes("login") ||
    lower.includes("user") ||
    lower.includes("account")
  ) {
    recommendations.push({
      category: "auth",
      name: "Clerk",
      reason: "Managed authentication with excellent DX",
      confidence: 0.7,
      alternatives: ["Auth.js", "Lucia", "Supabase Auth"],
    });
  }

  // Real-time detection
  if (
    lower.includes("real-time") ||
    lower.includes("realtime") ||
    lower.includes("chat") ||
    lower.includes("live") ||
    lower.includes("websocket")
  ) {
    recommendations.push({
      category: "messaging",
      name: "Socket.IO",
      reason: "Battle-tested real-time communication library",
      confidence: 0.75,
      alternatives: ["ws", "Pusher", "Ably"],
    });
  }

  // If no specific patterns matched, provide generic recommendations
  if (recommendations.length === 0) {
    recommendations.push(
      {
        category: "frontend",
        name: "Next.js",
        reason: "Versatile full-stack framework suitable for most web projects",
        confidence: 0.6,
        alternatives: ["Remix", "Vite + React"],
      },
      {
        category: "backend",
        name: "Hono",
        reason: "Modern, fast web framework with excellent TypeScript support",
        confidence: 0.6,
        alternatives: ["Express", "Fastify"],
      },
      {
        category: "database",
        name: "PostgreSQL",
        reason: "Industry-standard relational database",
        confidence: 0.7,
        alternatives: ["SQLite", "MongoDB"],
      }
    );
  }

  return recommendations;
}
