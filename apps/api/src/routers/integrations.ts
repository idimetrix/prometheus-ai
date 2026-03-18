import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { mcpConnections, mcpToolConfigs, projects } from "@prometheus/db";
import { generateId } from "@prometheus/utils";
import { encrypt } from "@prometheus/utils";

export const integrationsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const connections = await ctx.db.query.mcpConnections.findMany({
      where: eq(mcpConnections.orgId, ctx.orgId),
    });

    return {
      integrations: connections.map((c) => ({
        id: c.id,
        provider: c.provider,
        status: c.status,
        connectedAt: c.connectedAt?.toISOString() ?? null,
      })),
    };
  }),

  connect: protectedProcedure
    .input(z.object({
      provider: z.enum(["github", "gitlab", "linear", "jira", "slack", "vercel", "figma", "notion"]),
      credentials: z.record(z.string()),
    }))
    .mutation(async ({ input, ctx }) => {
      const encrypted = encrypt(JSON.stringify(input.credentials));

      const existing = await ctx.db.query.mcpConnections.findFirst({
        where: and(
          eq(mcpConnections.orgId, ctx.orgId),
          eq(mcpConnections.provider, input.provider),
        ),
      });

      if (existing) {
        await ctx.db.update(mcpConnections)
          .set({
            credentialsEncrypted: encrypted,
            status: "connected",
            connectedAt: new Date(),
          })
          .where(eq(mcpConnections.id, existing.id));
        return { id: existing.id, status: "connected" as const };
      }

      const id = generateId("int");
      await ctx.db.insert(mcpConnections).values({
        id,
        orgId: ctx.orgId,
        provider: input.provider,
        credentialsEncrypted: encrypted,
        status: "connected",
        connectedAt: new Date(),
      });

      return { id, status: "connected" as const };
    }),

  disconnect: protectedProcedure
    .input(z.object({ provider: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.db.update(mcpConnections)
        .set({
          credentialsEncrypted: null,
          status: "disconnected",
        })
        .where(and(
          eq(mcpConnections.orgId, ctx.orgId),
          eq(mcpConnections.provider, input.provider),
        ));
      return { success: true };
    }),

  getToolConfigs: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input, ctx }) => {
      const configs = await ctx.db.query.mcpToolConfigs.findMany({
        where: eq(mcpToolConfigs.projectId, input.projectId),
      });
      return { configs };
    }),

  setToolConfig: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      toolName: z.string(),
      enabled: z.boolean(),
      config: z.record(z.unknown()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const existing = await ctx.db.query.mcpToolConfigs.findFirst({
        where: and(
          eq(mcpToolConfigs.projectId, input.projectId),
          eq(mcpToolConfigs.toolName, input.toolName),
        ),
      });

      if (existing) {
        await ctx.db.update(mcpToolConfigs)
          .set({
            enabled: input.enabled,
            configJson: input.config ?? {},
          })
          .where(eq(mcpToolConfigs.id, existing.id));
      } else {
        await ctx.db.insert(mcpToolConfigs).values({
          id: generateId("tc"),
          projectId: input.projectId,
          toolName: input.toolName,
          enabled: input.enabled,
          configJson: input.config ?? {},
        });
      }

      return { success: true };
    }),
});
