import { projects, sessions, tasks } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("exports-router");

const SANDBOX_MANAGER_URL =
  process.env.SANDBOX_MANAGER_URL ?? "http://localhost:4006";

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

interface SandboxFile {
  content: string;
  path: string;
}

async function listSandboxFiles(sandboxId: string): Promise<SandboxFile[]> {
  try {
    const res = await fetch(
      `${SANDBOX_MANAGER_URL}/api/sandboxes/${sandboxId}/files/list`,
      { method: "GET", headers: { "Content-Type": "application/json" } }
    );
    if (!res.ok) {
      return [];
    }
    return (await res.json()) as SandboxFile[];
  } catch {
    return [];
  }
}

async function writeSandboxFile(
  sandboxId: string,
  filePath: string,
  content: string
): Promise<void> {
  await fetch(`${SANDBOX_MANAGER_URL}/api/sandboxes/${sandboxId}/files/write`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: filePath, content }),
  });
}

async function createSandbox(
  projectId: string,
  orgId: string
): Promise<string> {
  const res = await fetch(`${SANDBOX_MANAGER_URL}/api/sandboxes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, orgId }),
  });
  if (!res.ok) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create sandbox for import",
    });
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

/* -------------------------------------------------------------------------- */
/*  Router                                                                     */
/* -------------------------------------------------------------------------- */

export const exportsRouter = router({
  /**
   * Export a full project as a structured JSON archive.
   * Contains: settings, files, session history, rules, env key names.
   */
  exportProject: protectedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const project = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          eq(projects.orgId, ctx.orgId)
        ),
      });

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      // Gather session history
      const sessionList = await ctx.db.query.sessions.findMany({
        where: eq(sessions.projectId, input.projectId),
        orderBy: [desc(sessions.startedAt)],
      });

      // Gather tasks
      const taskList = await ctx.db.query.tasks.findMany({
        where: eq(tasks.projectId, input.projectId),
        orderBy: [desc(tasks.createdAt)],
      });

      // Gather sandbox files
      const sandboxId = (project as Record<string, unknown>).sandboxId as
        | string
        | undefined;
      const files = sandboxId ? await listSandboxFiles(sandboxId) : [];

      // Build export manifest
      const exportData = {
        version: "1.0.0",
        exportedAt: new Date().toISOString(),
        project: {
          id: project.id,
          name: project.name,
          description: project.description ?? null,
          techStackPreset: project.techStackPreset ?? null,
        },
        files: files.map((f) => ({ path: f.path, content: f.content })),
        sessions: sessionList.map((s) => ({
          id: s.id,
          status: s.status,
          startedAt: s.startedAt,
        })),
        tasks: taskList.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          createdAt: t.createdAt,
        })),
      };

      logger.info(
        {
          projectId: input.projectId,
          fileCount: files.length,
          sessionCount: sessionList.length,
          taskCount: taskList.length,
        },
        "Project exported"
      );

      return exportData;
    }),

  /**
   * Import a project from a previously exported archive.
   */
  importProject: protectedProcedure
    .input(
      z.object({
        /** The JSON export data (from exportProject) */
        data: z.object({
          version: z.string(),
          project: z.object({
            name: z.string(),
            description: z.string().nullable().optional(),
            techStackPreset: z.string().nullable().optional(),
          }),
          files: z
            .array(z.object({ path: z.string(), content: z.string() }))
            .optional(),
        }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { data } = input;
      const projectId = generateId("proj");

      // Create project record
      const [created] = await ctx.db
        .insert(projects)
        .values({
          id: projectId,
          name: data.project.name,
          orgId: ctx.orgId,
          description: data.project.description ?? null,
          techStackPreset: data.project.techStackPreset ?? null,
          status: "setup",
        })
        .returning();

      // Create sandbox and upload files
      if (data.files && data.files.length > 0) {
        try {
          const sandboxId = await createSandbox(projectId, ctx.orgId);
          for (const file of data.files) {
            await writeSandboxFile(sandboxId, file.path, file.content);
          }
          logger.info(
            { projectId, fileCount: data.files.length },
            "Imported files to sandbox"
          );
        } catch (error) {
          logger.warn(
            { error, projectId },
            "Failed to create sandbox during import"
          );
        }
      }

      logger.info(
        { projectId, name: data.project.name, orgId: ctx.orgId },
        "Project imported"
      );

      return {
        projectId: created?.id ?? projectId,
        name: data.project.name,
        fileCount: data.files?.length ?? 0,
      };
    }),

  /**
   * Export session/task history as JSON for a project.
   */
  exportHistory: protectedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const project = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          eq(projects.orgId, ctx.orgId)
        ),
      });

      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      const sessionList = await ctx.db.query.sessions.findMany({
        where: eq(sessions.projectId, input.projectId),
        orderBy: [desc(sessions.startedAt)],
      });

      const taskList = await ctx.db.query.tasks.findMany({
        where: eq(tasks.projectId, input.projectId),
        orderBy: [desc(tasks.createdAt)],
      });

      logger.info(
        {
          projectId: input.projectId,
          sessionCount: sessionList.length,
          taskCount: taskList.length,
        },
        "History exported"
      );

      return {
        exportedAt: new Date().toISOString(),
        projectId: input.projectId,
        projectName: project.name,
        sessions: sessionList.map((s) => ({
          id: s.id,
          status: s.status,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
        })),
        tasks: taskList.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          createdAt: t.createdAt,
          completedAt: t.completedAt,
        })),
      };
    }),
});
