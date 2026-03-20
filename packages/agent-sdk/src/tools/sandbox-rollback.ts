import { z } from "zod";
import type {
  AgentToolDefinition,
  ToolExecutionContext,
  ToolResult,
} from "./types";

const SANDBOX_MANAGER_URL =
  process.env.SANDBOX_MANAGER_URL ?? "http://localhost:4006";

const sandboxRollbackSchema = z.object({
  snapshotId: z
    .string()
    .optional()
    .describe(
      "ID of the snapshot to restore to. If not provided, restores to the most recent snapshot."
    ),
});

/**
 * Restore a sandbox to a previous snapshot state.
 *
 * This tool calls the sandbox-manager API to restore the sandbox
 * to a previously taken snapshot. If no snapshotId is provided,
 * it defaults to the most recent snapshot.
 */
async function executeSandboxRollback(
  input: Record<string, unknown>,
  ctx: ToolExecutionContext
): Promise<ToolResult> {
  const parsed = sandboxRollbackSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return {
      success: false,
      output: "",
      error: `Invalid input: ${issues}`,
    };
  }

  const { snapshotId } = parsed.data;

  try {
    // If no snapshotId provided, get the latest snapshot
    let targetSnapshotId = snapshotId;

    if (!targetSnapshotId) {
      const listResponse = await fetch(
        `${SANDBOX_MANAGER_URL}/sandbox/${ctx.sandboxId}/snapshots/latest`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(10_000),
        }
      );

      if (!listResponse.ok) {
        return {
          success: false,
          output: "",
          error: "No snapshots available to rollback to",
        };
      }

      const latestSnapshot = (await listResponse.json()) as {
        snapshotId?: string;
      };
      targetSnapshotId = latestSnapshot.snapshotId;

      if (!targetSnapshotId) {
        return {
          success: false,
          output: "",
          error: "No snapshots found for this sandbox session",
        };
      }
    }

    // Call the sandbox-manager rollback API
    const response = await fetch(
      `${SANDBOX_MANAGER_URL}/sandbox/${ctx.sandboxId}/rollback`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshotId: targetSnapshotId,
          sessionId: ctx.sessionId,
        }),
        signal: AbortSignal.timeout(30_000),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        output: "",
        error: `Rollback failed (${response.status}): ${errorText}`,
      };
    }

    const result = (await response.json()) as {
      restoredAt?: string;
      snapshotId?: string;
      success: boolean;
    };

    if (!result.success) {
      return {
        success: false,
        output: "",
        error: "Rollback operation failed on the sandbox manager",
      };
    }

    return {
      success: true,
      output: `Sandbox rolled back to snapshot ${targetSnapshotId}. Restored state from ${result.restoredAt ?? "unknown time"}.`,
      metadata: {
        snapshotId: targetSnapshotId,
        restoredAt: result.restoredAt,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      output: "",
      error: `Sandbox rollback error: ${message}`,
    };
  }
}

/**
 * sandbox_rollback tool definition for the agent tool registry.
 */
export const sandboxRollbackTool: AgentToolDefinition = {
  name: "sandbox_rollback",
  description:
    "Restore the sandbox to a previous snapshot state. Use this to undo changes that caused test failures or broke the project. If no snapshotId is provided, rolls back to the most recent snapshot.",
  creditCost: 1,
  permissionLevel: "execute",
  riskLevel: "medium",
  zodSchema: sandboxRollbackSchema as z.ZodType<Record<string, unknown>>,
  inputSchema: {
    type: "object",
    properties: {
      snapshotId: {
        type: "string",
        description:
          "ID of the snapshot to restore to. Defaults to the most recent snapshot.",
      },
    },
    required: [],
  },
  execute: executeSandboxRollback,
};

/** Export as array for registry integration */
export const sandboxRollbackTools: AgentToolDefinition[] = [
  sandboxRollbackTool,
];
