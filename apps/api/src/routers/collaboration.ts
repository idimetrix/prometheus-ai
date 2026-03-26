/**
 * Collaboration router (CT01).
 *
 * Provides tRPC endpoints for querying collaborative editing state:
 * - activeEditors: Who is editing what document right now
 * - startEditing: Register the current user as an active editor
 * - stopEditing: Unregister the current user from a document
 *
 * The actual CRDT sync happens over Socket.io (collaboration namespace),
 * but these endpoints let the dashboard query editing state via HTTP.
 */

import { createLogger } from "@prometheus/logger";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("api:collaboration");

// ---------------------------------------------------------------------------
// In-memory tracking of active editors (mirrors socket-server state for the
// API service; in production this would be backed by Redis for cross-service
// consistency)
// ---------------------------------------------------------------------------

export interface EditorRecord {
  documentId: string;
  filePath: string;
  startedAt: string;
  userId: string;
  userName: string;
}

const activeEditorRecords = new Map<string, EditorRecord>();

/** Build a composite key for deduplication */
function editorKey(userId: string, documentId: string): string {
  return `${userId}:${documentId}`;
}

export const collaborationRouter = router({
  // -------------------------------------------------------------------------
  // activeEditors — list all users currently editing documents in the org
  // -------------------------------------------------------------------------
  activeEditors: protectedProcedure
    .input(
      z
        .object({
          projectId: z.string().optional(),
        })
        .optional()
    )
    .query(({ input }) => {
      const records = Array.from(activeEditorRecords.values());

      // Optionally filter by projectId prefix in the documentId
      const filtered = input?.projectId
        ? records.filter((r) => r.documentId.startsWith(input.projectId ?? ""))
        : records;

      // Group by document
      const byDocument = new Map<string, EditorRecord[]>();
      for (const record of filtered) {
        const existing = byDocument.get(record.documentId) ?? [];
        existing.push(record);
        byDocument.set(record.documentId, existing);
      }

      return {
        documents: Array.from(byDocument.entries()).map(
          ([documentId, editors]) => ({
            documentId,
            editors: editors.map((e) => ({
              userId: e.userId,
              userName: e.userName,
              filePath: e.filePath,
              startedAt: e.startedAt,
            })),
          })
        ),
        totalEditors: filtered.length,
      };
    }),

  // -------------------------------------------------------------------------
  // startEditing — register as an active editor for a document
  // -------------------------------------------------------------------------
  startEditing: protectedProcedure
    .input(
      z.object({
        documentId: z.string().min(1),
        filePath: z.string().min(1),
        userName: z.string().optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      const userId = ctx.auth.userId;
      const key = editorKey(userId, input.documentId);

      const record: EditorRecord = {
        userId,
        userName: input.userName ?? userId,
        documentId: input.documentId,
        filePath: input.filePath,
        startedAt: new Date().toISOString(),
      };

      activeEditorRecords.set(key, record);

      logger.info(
        { userId, documentId: input.documentId, filePath: input.filePath },
        "User started editing"
      );

      return { ok: true, editor: record };
    }),

  // -------------------------------------------------------------------------
  // stopEditing — unregister from a document
  // -------------------------------------------------------------------------
  stopEditing: protectedProcedure
    .input(
      z.object({
        documentId: z.string().min(1),
      })
    )
    .mutation(({ input, ctx }) => {
      const userId = ctx.auth.userId;
      const key = editorKey(userId, input.documentId);
      const existed = activeEditorRecords.delete(key);

      if (existed) {
        logger.info(
          { userId, documentId: input.documentId },
          "User stopped editing"
        );
      }

      return { ok: true, removed: existed };
    }),
});
