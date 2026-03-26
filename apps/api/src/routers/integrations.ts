import { mcpConnections, mcpToolConfigs, projects } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { decrypt, encrypt, generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("api:integrations");

const SUPPORTED_PROVIDERS = [
  "github",
  "gitlab",
  "linear",
  "jira",
  "slack",
  "vercel",
  "figma",
  "notion",
] as const;

type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

/**
 * Validate that credentials contain expected keys per provider.
 */
function validateCredentials(
  provider: SupportedProvider,
  creds: Record<string, string>
): void {
  const required: Record<SupportedProvider, string[]> = {
    github: ["accessToken"],
    gitlab: ["accessToken"],
    linear: ["apiKey"],
    jira: ["email", "apiToken", "domain"],
    slack: ["botToken"],
    vercel: ["accessToken"],
    figma: ["accessToken"],
    notion: ["integrationToken"],
  };

  const missing = required[provider]?.filter((k) => !creds[k]);
  if (missing && missing.length > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Missing required credentials for ${provider}: ${missing.join(", ")}`,
    });
  }
}

export const integrationsRouter = router({
  // ---------------------------------------------------------------------------
  // List connected services
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Get available providers (with connection status)
  // ---------------------------------------------------------------------------
  available: protectedProcedure.query(async ({ ctx }) => {
    const connections = await ctx.db.query.mcpConnections.findMany({
      where: eq(mcpConnections.orgId, ctx.orgId),
    });

    const connectedMap = new Map(connections.map((c) => [c.provider, c]));

    return {
      providers: SUPPORTED_PROVIDERS.map((provider) => {
        const conn = connectedMap.get(provider);
        return {
          provider,
          status: conn?.status ?? "disconnected",
          connectedAt: conn?.connectedAt?.toISOString() ?? null,
          connectionId: conn?.id ?? null,
        };
      }),
    };
  }),

  // ---------------------------------------------------------------------------
  // Connect MCP service
  // ---------------------------------------------------------------------------
  connect: protectedProcedure
    .input(
      z.object({
        provider: z.enum(SUPPORTED_PROVIDERS),
        credentials: z.record(z.string(), z.string()),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Only validate credentials if any were provided — allow empty
      // credentials to create a "pending" connection that users can
      // configure later in Settings > Integrations.
      const hasCredentials = Object.keys(input.credentials).length > 0;
      if (hasCredentials) {
        validateCredentials(input.provider, input.credentials);
      }

      const encrypted = hasCredentials
        ? encrypt(JSON.stringify(input.credentials))
        : null;

      const existing = await ctx.db.query.mcpConnections.findFirst({
        where: and(
          eq(mcpConnections.orgId, ctx.orgId),
          eq(mcpConnections.provider, input.provider)
        ),
      });

      if (existing) {
        await ctx.db
          .update(mcpConnections)
          .set({
            credentialsEncrypted: encrypted,
            status: "connected",
            connectedAt: new Date(),
          })
          .where(eq(mcpConnections.id, existing.id));

        logger.info(
          { orgId: ctx.orgId, provider: input.provider },
          "Integration reconnected"
        );
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

      logger.info(
        { orgId: ctx.orgId, provider: input.provider },
        "Integration connected"
      );
      return { id, status: "connected" as const };
    }),

  // ---------------------------------------------------------------------------
  // Disconnect service
  // ---------------------------------------------------------------------------
  disconnect: protectedProcedure
    .input(
      z.object({ provider: z.string().min(1, "Provider is required").max(50) })
    )
    .mutation(async ({ input, ctx }) => {
      const connection = await ctx.db.query.mcpConnections.findFirst({
        where: and(
          eq(mcpConnections.orgId, ctx.orgId),
          eq(mcpConnections.provider, input.provider)
        ),
      });

      if (!connection) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Integration not found",
        });
      }

      await ctx.db
        .update(mcpConnections)
        .set({
          credentialsEncrypted: null,
          status: "disconnected",
        })
        .where(eq(mcpConnections.id, connection.id));

      logger.info(
        { orgId: ctx.orgId, provider: input.provider },
        "Integration disconnected"
      );
      return { success: true };
    }),

  // ---------------------------------------------------------------------------
  // Test connection
  // ---------------------------------------------------------------------------
  testConnection: protectedProcedure
    .input(
      z.object({ provider: z.string().min(1, "Provider is required").max(50) })
    )
    .mutation(async ({ input, ctx }) => {
      const connection = await ctx.db.query.mcpConnections.findFirst({
        where: and(
          eq(mcpConnections.orgId, ctx.orgId),
          eq(mcpConnections.provider, input.provider)
        ),
      });

      if (!connection?.credentialsEncrypted) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Integration not connected or credentials missing",
        });
      }

      try {
        const creds = JSON.parse(decrypt(connection.credentialsEncrypted));
        // Provider-specific connection test
        const ok = await testProviderConnection(
          input.provider as SupportedProvider,
          creds
        );

        if (!ok) {
          await ctx.db
            .update(mcpConnections)
            .set({ status: "error" })
            .where(eq(mcpConnections.id, connection.id));

          return { success: false, error: "Connection test failed" };
        }

        // Update status to connected on success
        await ctx.db
          .update(mcpConnections)
          .set({ status: "connected" })
          .where(eq(mcpConnections.id, connection.id));

        logger.info(
          { orgId: ctx.orgId, provider: input.provider },
          "Connection test passed"
        );
        return { success: true, error: null };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        logger.warn(
          { orgId: ctx.orgId, provider: input.provider, error: msg },
          "Connection test failed"
        );

        await ctx.db
          .update(mcpConnections)
          .set({ status: "error" })
          .where(eq(mcpConnections.id, connection.id));

        return { success: false, error: msg };
      }
    }),

  // ---------------------------------------------------------------------------
  // Tool configs (per-project)
  // ---------------------------------------------------------------------------
  getToolConfigs: protectedProcedure
    .input(z.object({ projectId: z.string().min(1, "Project ID is required") }))
    .query(async ({ input, ctx }) => {
      // Verify project belongs to org
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

      const configs = await ctx.db.query.mcpToolConfigs.findMany({
        where: eq(mcpToolConfigs.projectId, input.projectId),
      });

      return {
        configs: configs.map((c) => ({
          id: c.id,
          toolName: c.toolName,
          enabled: c.enabled,
          config: c.configJson,
        })),
      };
    }),

  setToolConfig: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1, "Project ID is required"),
        toolName: z.string().min(1, "Tool name is required").max(200),
        enabled: z.boolean(),
        config: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Verify project belongs to org
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

      const existing = await ctx.db.query.mcpToolConfigs.findFirst({
        where: and(
          eq(mcpToolConfigs.projectId, input.projectId),
          eq(mcpToolConfigs.toolName, input.toolName)
        ),
      });

      if (existing) {
        await ctx.db
          .update(mcpToolConfigs)
          .set({
            enabled: input.enabled,
            configJson: input.config ?? {},
          })
          .where(eq(mcpToolConfigs.id, existing.id));
        return { id: existing.id, action: "updated" as const };
      }
      const id = generateId("tc");
      await ctx.db.insert(mcpToolConfigs).values({
        id,
        projectId: input.projectId,
        toolName: input.toolName,
        enabled: input.enabled,
        configJson: input.config ?? {},
      });
      return { id, action: "created" as const };
    }),
});

// ---------------------------------------------------------------------------
// Provider-specific connection tests
// ---------------------------------------------------------------------------

async function testProviderConnection(
  provider: SupportedProvider,
  credentials: Record<string, string>
): Promise<boolean> {
  switch (provider) {
    case "github": {
      const resp = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${credentials.accessToken}` },
      });
      return resp.ok;
    }
    case "gitlab": {
      const resp = await fetch("https://gitlab.com/api/v4/user", {
        headers: { "PRIVATE-TOKEN": credentials.accessToken ?? "" },
      });
      return resp.ok;
    }
    case "linear": {
      const resp = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
          Authorization: credentials.apiKey ?? "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: "{ viewer { id } }" }),
      });
      return resp.ok;
    }
    case "jira": {
      const domain = credentials.domain ?? "";
      const auth = Buffer.from(
        `${credentials.email}:${credentials.apiToken}`
      ).toString("base64");
      const resp = await fetch(
        `https://${domain}.atlassian.net/rest/api/3/myself`,
        {
          headers: { Authorization: `Basic ${auth}` },
        }
      );
      return resp.ok;
    }
    case "slack": {
      const resp = await fetch("https://slack.com/api/auth.test", {
        method: "POST",
        headers: { Authorization: `Bearer ${credentials.botToken}` },
      });
      if (!resp.ok) {
        return false;
      }
      const data = (await resp.json()) as { ok: boolean };
      return data.ok === true;
    }
    case "vercel": {
      const resp = await fetch("https://api.vercel.com/v2/user", {
        headers: { Authorization: `Bearer ${credentials.accessToken}` },
      });
      return resp.ok;
    }
    case "figma": {
      const resp = await fetch("https://api.figma.com/v1/me", {
        headers: { "X-Figma-Token": credentials.accessToken ?? "" },
      });
      return resp.ok;
    }
    case "notion": {
      const resp = await fetch("https://api.notion.com/v1/users/me", {
        headers: {
          Authorization: `Bearer ${credentials.integrationToken}`,
          "Notion-Version": "2022-06-28",
        },
      });
      return resp.ok;
    }
    default:
      return false;
  }
}
