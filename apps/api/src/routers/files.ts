import { createLogger } from "@prometheus/logger";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("files-router");

const SANDBOX_MANAGER_URL =
  process.env.SANDBOX_MANAGER_URL ?? "http://localhost:4006";

/* -------------------------------------------------------------------------- */
/*  Helper: proxy request to sandbox-manager                                   */
/* -------------------------------------------------------------------------- */

async function sandboxRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  const url = `${SANDBOX_MANAGER_URL}${path}`;
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "Unknown error");
      logger.warn({ status: res.status, url, text }, "Sandbox request failed");
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Sandbox error: ${text}`,
      });
    }

    return await res.json();
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }
    logger.error({ error, url }, "Failed to reach sandbox-manager");
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to communicate with sandbox",
    });
  }
}

/* -------------------------------------------------------------------------- */
/*  Router                                                                     */
/* -------------------------------------------------------------------------- */

export const filesRouter = router({
  // ─── Read file content ──────────────────────────────────────────────
  read: protectedProcedure
    .input(
      z.object({
        sandboxId: z.string().min(1),
        path: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const result = (await sandboxRequest(
        "POST",
        `/api/sandboxes/${input.sandboxId}/files/read`,
        { path: input.path }
      )) as { content?: string; language?: string };

      return {
        content: result.content ?? "",
        language: result.language,
      };
    }),

  // ─── Write file content ─────────────────────────────────────────────
  write: protectedProcedure
    .input(
      z.object({
        sandboxId: z.string().min(1),
        path: z.string().min(1),
        content: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      await sandboxRequest(
        "POST",
        `/api/sandboxes/${input.sandboxId}/files/write`,
        { path: input.path, content: input.content }
      );
      return { success: true };
    }),

  // ─── List directory contents ────────────────────────────────────────
  list: protectedProcedure
    .input(
      z.object({
        sandboxId: z.string().min(1),
        path: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const result = (await sandboxRequest(
        "POST",
        `/api/sandboxes/${input.sandboxId}/files/list`,
        { path: input.path }
      )) as { tree?: unknown[] };

      return {
        tree: result.tree ?? [],
      };
    }),

  // ─── Create file ────────────────────────────────────────────────────
  create: protectedProcedure
    .input(
      z.object({
        sandboxId: z.string().min(1),
        path: z.string().min(1),
        content: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await sandboxRequest(
        "POST",
        `/api/sandboxes/${input.sandboxId}/files/create`,
        { path: input.path, content: input.content ?? "" }
      );
      return { success: true };
    }),

  // ─── Delete file ────────────────────────────────────────────────────
  delete: protectedProcedure
    .input(
      z.object({
        sandboxId: z.string().min(1),
        path: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      await sandboxRequest(
        "POST",
        `/api/sandboxes/${input.sandboxId}/files/delete`,
        { path: input.path }
      );
      return { success: true };
    }),

  // ─── Rename/move file ──────────────────────────────────────────────
  rename: protectedProcedure
    .input(
      z.object({
        sandboxId: z.string().min(1),
        oldPath: z.string().min(1),
        newPath: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      await sandboxRequest(
        "POST",
        `/api/sandboxes/${input.sandboxId}/files/rename`,
        { oldPath: input.oldPath, newPath: input.newPath }
      );
      return { success: true };
    }),
});
