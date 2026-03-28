/**
 * GAP-056: Prompt Versioning
 *
 * List, create, activate, compare, and rollback prompt versions
 * for agent roles.
 */

import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("api:prompt-versions");

// ---------------------------------------------------------------------------
// In-memory store (production: database-backed)
// ---------------------------------------------------------------------------

interface PromptVersionRecord {
  activeForRole: boolean;
  agentRole: string;
  content: string;
  createdAt: string;
  createdBy: string;
  id: string;
  metadata?: Record<string, unknown>;
  orgId: string;
  testResults?: { qualityScore: number; sampleSize: number };
  version: number;
}

const promptVersions = new Map<string, PromptVersionRecord>();

function getVersionsForRole(
  orgId: string,
  agentRole: string
): PromptVersionRecord[] {
  const results: PromptVersionRecord[] = [];
  for (const v of promptVersions.values()) {
    if (v.orgId === orgId && v.agentRole === agentRole) {
      results.push(v);
    }
  }
  return results.sort((a, b) => b.version - a.version);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const promptVersionsRouter = router({
  /**
   * List prompt versions for an agent role.
   */
  list: protectedProcedure
    .input(
      z.object({
        agentRole: z.string().min(1),
        limit: z.number().int().min(1).max(50).default(20),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(({ input, ctx }) => {
      const versions = getVersionsForRole(ctx.orgId, input.agentRole);
      const total = versions.length;
      const items = versions.slice(input.offset, input.offset + input.limit);

      return {
        items: items.map((v) => ({
          id: v.id,
          version: v.version,
          agentRole: v.agentRole,
          active: v.activeForRole,
          contentPreview: v.content.slice(0, 200),
          createdBy: v.createdBy,
          createdAt: v.createdAt,
          testResults: v.testResults,
        })),
        total,
      };
    }),

  /**
   * Create a new prompt version.
   */
  create: protectedProcedure
    .input(
      z.object({
        agentRole: z.string().min(1).max(100),
        content: z.string().min(1).max(50_000),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      const existing = getVersionsForRole(ctx.orgId, input.agentRole);
      const nextVersion =
        existing.length > 0
          ? Math.max(...existing.map((v) => v.version)) + 1
          : 1;

      const id = generateId("pv");
      const record: PromptVersionRecord = {
        id,
        orgId: ctx.orgId,
        agentRole: input.agentRole,
        version: nextVersion,
        content: input.content,
        activeForRole: existing.length === 0, // First version is auto-activated
        createdBy: ctx.auth.userId,
        createdAt: new Date().toISOString(),
        metadata: input.metadata,
      };

      promptVersions.set(id, record);

      logger.info(
        {
          orgId: ctx.orgId,
          agentRole: input.agentRole,
          version: nextVersion,
        },
        "Prompt version created"
      );

      return {
        id: record.id,
        version: record.version,
        agentRole: record.agentRole,
        active: record.activeForRole,
        createdAt: record.createdAt,
      };
    }),

  /**
   * Activate a prompt version (deactivates others for same role).
   */
  activate: protectedProcedure
    .input(z.object({ versionId: z.string().min(1) }))
    .mutation(({ input, ctx }) => {
      const target = promptVersions.get(input.versionId);
      if (!target || target.orgId !== ctx.orgId) {
        throw new Error("Prompt version not found");
      }

      // Deactivate all other versions for this role
      for (const v of promptVersions.values()) {
        if (v.orgId === ctx.orgId && v.agentRole === target.agentRole) {
          v.activeForRole = false;
        }
      }

      target.activeForRole = true;

      logger.info(
        {
          orgId: ctx.orgId,
          agentRole: target.agentRole,
          version: target.version,
        },
        "Prompt version activated"
      );

      return {
        id: target.id,
        version: target.version,
        agentRole: target.agentRole,
        active: true,
      };
    }),

  /**
   * Compare two prompt versions (show diff and A/B test results).
   */
  compare: protectedProcedure
    .input(
      z.object({
        versionIdA: z.string().min(1),
        versionIdB: z.string().min(1),
      })
    )
    .query(({ input, ctx }) => {
      const vA = promptVersions.get(input.versionIdA);
      const vB = promptVersions.get(input.versionIdB);

      if (!vA || vA.orgId !== ctx.orgId) {
        throw new Error("Version A not found");
      }
      if (!vB || vB.orgId !== ctx.orgId) {
        throw new Error("Version B not found");
      }

      // Simple line diff
      const linesA = new Set(vA.content.split("\n"));
      const linesB = new Set(vB.content.split("\n"));

      const additions: string[] = [];
      const removals: string[] = [];

      for (const line of linesB) {
        if (!linesA.has(line) && line.trim() !== "") {
          additions.push(line);
        }
      }
      for (const line of linesA) {
        if (!linesB.has(line) && line.trim() !== "") {
          removals.push(line);
        }
      }

      return {
        versionA: {
          id: vA.id,
          version: vA.version,
          testResults: vA.testResults,
        },
        versionB: {
          id: vB.id,
          version: vB.version,
          testResults: vB.testResults,
        },
        diff: {
          additions: additions.slice(0, 50),
          removals: removals.slice(0, 50),
          totalChanges: additions.length + removals.length,
        },
      };
    }),

  /**
   * Rollback to a previous prompt version.
   */
  rollback: protectedProcedure
    .input(z.object({ versionId: z.string().min(1) }))
    .mutation(({ input, ctx }) => {
      const target = promptVersions.get(input.versionId);
      if (!target || target.orgId !== ctx.orgId) {
        throw new Error("Prompt version not found");
      }

      // Create a new version with the old content
      const existing = getVersionsForRole(ctx.orgId, target.agentRole);
      const nextVersion =
        existing.length > 0
          ? Math.max(...existing.map((v) => v.version)) + 1
          : 1;

      const id = generateId("pv");
      const rollbackRecord: PromptVersionRecord = {
        id,
        orgId: ctx.orgId,
        agentRole: target.agentRole,
        version: nextVersion,
        content: target.content,
        activeForRole: false,
        createdBy: ctx.auth.userId,
        createdAt: new Date().toISOString(),
        metadata: { rolledBackFrom: target.version },
      };

      promptVersions.set(id, rollbackRecord);

      // Deactivate all and activate the new rollback version
      for (const v of promptVersions.values()) {
        if (v.orgId === ctx.orgId && v.agentRole === target.agentRole) {
          v.activeForRole = false;
        }
      }
      rollbackRecord.activeForRole = true;

      logger.info(
        {
          orgId: ctx.orgId,
          agentRole: target.agentRole,
          rolledBackFrom: target.version,
          newVersion: nextVersion,
        },
        "Prompt rolled back"
      );

      return {
        id: rollbackRecord.id,
        version: rollbackRecord.version,
        agentRole: rollbackRecord.agentRole,
        active: true,
        rolledBackFrom: target.version,
        createdAt: rollbackRecord.createdAt,
      };
    }),
});
