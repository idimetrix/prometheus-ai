import {
  mcpConnections,
  mcpToolConfigs,
  oauthTokens,
  projects,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { decrypt, encrypt, generateId } from "@prometheus/utils";
import { importFromGitUrlSchema } from "@prometheus/validators";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  approveProviderPR,
  closeProviderPR,
  commentOnProviderPR,
  createProviderPR,
  fetchPRDetails,
  fetchProviderCIRuns,
  fetchProviderPRs,
  mergeProviderPR,
  requestChangesOnProviderPR,
} from "../lib/issue-sync-providers";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("api:integrations");

const GIT_SUFFIX_RE = /\.git$/;

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

  // ---------------------------------------------------------------------------
  // OAuth -- token status per provider
  // ---------------------------------------------------------------------------
  oauthStatus: protectedProcedure.query(async ({ ctx }) => {
    const tokens = await ctx.db.query.oauthTokens.findMany({
      where: and(
        eq(oauthTokens.orgId, ctx.orgId),
        eq(oauthTokens.userId, ctx.auth.userId)
      ),
    });

    const providers = ["github", "gitlab", "bitbucket"] as const;
    return {
      providers: providers.map((provider) => {
        const token = tokens.find((t) => t.provider === provider);
        return {
          provider,
          connected: !!token,
          providerUsername: token?.providerUsername ?? null,
          expiresAt: token?.expiresAt?.toISOString() ?? null,
        };
      }),
    };
  }),

  // ---------------------------------------------------------------------------
  // OAuth -- disconnect a provider
  // ---------------------------------------------------------------------------
  oauthDisconnect: protectedProcedure
    .input(
      z.object({
        provider: z.enum(["github", "gitlab", "bitbucket"]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const token = await ctx.db.query.oauthTokens.findFirst({
        where: and(
          eq(oauthTokens.orgId, ctx.orgId),
          eq(oauthTokens.userId, ctx.auth.userId),
          eq(oauthTokens.provider, input.provider)
        ),
      });

      if (!token) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No ${input.provider} OAuth connection found`,
        });
      }

      await ctx.db.delete(oauthTokens).where(eq(oauthTokens.id, token.id));

      logger.info(
        { orgId: ctx.orgId, provider: input.provider },
        "OAuth provider disconnected"
      );
      return { success: true };
    }),

  // ---------------------------------------------------------------------------
  // OAuth -- list repos from connected provider
  // ---------------------------------------------------------------------------
  listRepos: protectedProcedure
    .input(
      z.object({
        provider: z.enum(["github", "gitlab", "bitbucket"]),
        search: z.string().optional(),
        page: z.number().int().positive().default(1),
        perPage: z.number().int().positive().max(100).default(30),
        sort: z.enum(["updated", "created", "name"]).default("updated"),
      })
    )
    .query(async ({ input, ctx }) => {
      const token = await ctx.db.query.oauthTokens.findFirst({
        where: and(
          eq(oauthTokens.orgId, ctx.orgId),
          eq(oauthTokens.userId, ctx.auth.userId),
          eq(oauthTokens.provider, input.provider)
        ),
      });

      if (!token) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Connect your ${input.provider} account first`,
        });
      }

      const accessToken = decrypt(token.accessToken);
      const repos = await fetchReposFromProvider(
        input.provider,
        accessToken,
        input
      );

      return { repos };
    }),

  // ---------------------------------------------------------------------------
  // Import from arbitrary Git URL (no OAuth required)
  // ---------------------------------------------------------------------------
  importFromGitUrl: protectedProcedure
    .input(importFromGitUrlSchema)
    .mutation(async ({ input, ctx }) => {
      // Derive project name from URL if not provided
      const urlSegments = input.repoUrl
        .replace(GIT_SUFFIX_RE, "")
        .split("/")
        .filter(Boolean);
      const detectedName = urlSegments.at(-1) ?? "untitled";
      const projectName = input.name?.trim() || detectedName;

      // If a PAT was provided, encrypt it for storage
      const encryptedPat = input.personalAccessToken
        ? encrypt(input.personalAccessToken)
        : null;

      const projectId = generateId("proj");
      await ctx.db.insert(projects).values({
        id: projectId,
        orgId: ctx.orgId,
        name: projectName,
        repoUrl: input.repoUrl,
        techStackPreset: input.techStackPreset ?? "auto-detect",
        status: "active",
      });

      // Store PAT as an OAuth token entry if provided, so it can be used
      // by other services (e.g. sandbox-manager git clone) later.
      if (encryptedPat) {
        await ctx.db
          .insert(oauthTokens)
          .values({
            id: generateId("oat"),
            orgId: ctx.orgId,
            userId: ctx.auth.userId,
            provider: "git-manual",
            accessToken: encryptedPat,
            providerUsername: null,
          })
          .onConflictDoNothing();
      }

      logger.info(
        { orgId: ctx.orgId, projectId, repoUrl: input.repoUrl },
        "Project imported from manual git URL"
      );

      return { projectId, name: projectName };
    }),

  // ---------------------------------------------------------------------------
  // OAuth -- import a repo as a new project
  // ---------------------------------------------------------------------------
  importRepo: protectedProcedure
    .input(
      z.object({
        provider: z.enum(["github", "gitlab", "bitbucket"]),
        repoFullName: z.string().min(1),
        branch: z.string().optional(),
        nameOverride: z.string().optional(),
        techStackPreset: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const token = await ctx.db.query.oauthTokens.findFirst({
        where: and(
          eq(oauthTokens.orgId, ctx.orgId),
          eq(oauthTokens.userId, ctx.auth.userId),
          eq(oauthTokens.provider, input.provider)
        ),
      });

      if (!token) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Connect your ${input.provider} account first`,
        });
      }

      const accessToken = decrypt(token.accessToken);
      const repoInfo = await fetchRepoDetails(
        input.provider,
        accessToken,
        input.repoFullName
      );

      const projectName =
        input.nameOverride?.trim() || repoInfo.name || input.repoFullName;

      const projectId = generateId("proj");
      await ctx.db.insert(projects).values({
        id: projectId,
        orgId: ctx.orgId,
        name: projectName,
        description: repoInfo.description ?? undefined,
        repoUrl: repoInfo.cloneUrl,
        techStackPreset: input.techStackPreset ?? "custom",
        status: "active",
      });

      logger.info(
        {
          orgId: ctx.orgId,
          projectId,
          provider: input.provider,
          repo: input.repoFullName,
        },
        "Project imported from repo"
      );

      return { projectId, name: projectName };
    }),

  // ---------------------------------------------------------------------------
  // Pull Request endpoints (used by code review UI)
  // ---------------------------------------------------------------------------
  listPullRequests: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        withDetails: z.boolean().default(false),
      })
    )
    .query(async ({ input, ctx }) => {
      const project = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          eq(projects.orgId, ctx.orgId)
        ),
      });

      if (!project?.repoUrl) {
        return { pullRequests: [] };
      }

      const provider = detectProviderFromUrl(project.repoUrl);
      if (!provider) {
        return { pullRequests: [] };
      }

      logger.info(
        { projectId: input.projectId, provider },
        "Listing pull requests"
      );

      const prs = await fetchProviderPRs(
        provider,
        project.repoUrl,
        ctx.db,
        ctx.orgId
      );

      if (!input.withDetails) {
        return {
          pullRequests: prs.map((pr) => ({
            number: Number(pr.externalId),
            title: pr.title,
            author: null as string | null,
            status: "open",
            updatedAt: pr.updatedAt,
            description: null as string | null,
            branch: pr.branch,
            baseBranch: pr.baseBranch,
            diffs: [] as {
              path: string;
              additions: number | null;
              deletions: number | null;
              hunks: {
                startLine: number | null;
                lines: {
                  lineNumber: number | null;
                  content: string | null;
                  type: string | null;
                }[];
              }[];
            }[],
            comments: [] as {
              id: string | null;
              author: string | null;
              content: string | null;
              timestamp: string | null;
              lineNumber: number | null;
              resolved: boolean | null;
            }[],
          })),
        };
      }

      // Fetch full details for each PR (limited to first 10 to avoid rate limits)
      const detailedPRs = await Promise.all(
        prs.slice(0, 10).map(async (pr) => {
          const details = await fetchPRDetails(
            provider,
            project.repoUrl ?? "",
            ctx.db,
            ctx.orgId,
            Number(pr.externalId)
          );

          if (!details) {
            return {
              number: Number(pr.externalId),
              title: pr.title,
              author: null as string | null,
              status: "open",
              updatedAt: pr.updatedAt,
              description: null as string | null,
              branch: pr.branch,
              baseBranch: pr.baseBranch,
              diffs: [],
              comments: [],
            };
          }

          return {
            number: details.number,
            title: details.title,
            author: details.author,
            status: details.status,
            updatedAt: details.updatedAt,
            description: details.description,
            branch: pr.branch,
            baseBranch: pr.baseBranch,
            diffs: details.diffs.map((d) => ({
              path: d.path,
              additions: d.additions,
              deletions: d.deletions,
              hunks: parseHunks(d.patch),
            })),
            comments: details.comments.map((c) => ({
              id: c.id,
              author: c.author,
              content: c.content,
              timestamp: c.timestamp,
              lineNumber: c.lineNumber,
              resolved: c.resolved,
            })),
          };
        })
      );

      return { pullRequests: detailedPRs };
    }),

  approvePullRequest: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        prNumber: z.number().int(),
        body: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const project = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          eq(projects.orgId, ctx.orgId)
        ),
      });

      if (!project?.repoUrl) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project or repo not found",
        });
      }

      const provider = detectProviderFromUrl(project.repoUrl);
      if (!provider) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot determine provider",
        });
      }

      logger.info(
        { projectId: input.projectId, prNumber: input.prNumber, provider },
        "Approving pull request"
      );

      const result = await approveProviderPR(
        provider,
        project.repoUrl,
        ctx.db,
        ctx.orgId,
        input.prNumber,
        input.body
      );

      if (!result.success) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: result.error ?? "Failed to approve PR",
        });
      }

      return { success: true };
    }),

  commentOnPullRequest: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        prNumber: z.number().int(),
        comment: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const project = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          eq(projects.orgId, ctx.orgId)
        ),
      });

      if (!project?.repoUrl) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project or repo not found",
        });
      }

      const provider = detectProviderFromUrl(project.repoUrl);
      if (!provider) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot determine provider",
        });
      }

      logger.info(
        { projectId: input.projectId, prNumber: input.prNumber, provider },
        "Commenting on pull request"
      );

      const result = await commentOnProviderPR(
        provider,
        project.repoUrl,
        ctx.db,
        ctx.orgId,
        input.prNumber,
        input.comment
      );

      if (!result.success) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: result.error ?? "Failed to comment on PR",
        });
      }

      return { success: true };
    }),

  requestChangesPullRequest: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        prNumber: z.number().int(),
        body: z.string().min(1).default("Changes requested by Prometheus"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const project = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          eq(projects.orgId, ctx.orgId)
        ),
      });

      if (!project?.repoUrl) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project or repo not found",
        });
      }

      const provider = detectProviderFromUrl(project.repoUrl);
      if (!provider) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot determine provider",
        });
      }

      logger.info(
        { projectId: input.projectId, prNumber: input.prNumber, provider },
        "Requesting changes on pull request"
      );

      const result = await requestChangesOnProviderPR(
        provider,
        project.repoUrl,
        ctx.db,
        ctx.orgId,
        input.prNumber,
        input.body
      );

      if (!result.success) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: result.error ?? "Failed to request changes",
        });
      }

      return { success: true };
    }),

  mergePullRequest: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        prNumber: z.number().int(),
        mergeMethod: z.enum(["merge", "squash", "rebase"]).default("merge"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const project = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          eq(projects.orgId, ctx.orgId)
        ),
      });

      if (!project?.repoUrl) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project or repo not found",
        });
      }

      const provider = detectProviderFromUrl(project.repoUrl);
      if (!provider) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot determine provider",
        });
      }

      logger.info(
        {
          projectId: input.projectId,
          prNumber: input.prNumber,
          provider,
          mergeMethod: input.mergeMethod,
        },
        "Merging pull request"
      );

      const result = await mergeProviderPR(
        provider,
        project.repoUrl,
        ctx.db,
        ctx.orgId,
        input.prNumber,
        input.mergeMethod
      );

      if (!result.success) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: result.error ?? "Failed to merge PR",
        });
      }

      return { success: true };
    }),

  closePullRequest: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        prNumber: z.number().int(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const project = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          eq(projects.orgId, ctx.orgId)
        ),
      });

      if (!project?.repoUrl) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project or repo not found",
        });
      }

      const provider = detectProviderFromUrl(project.repoUrl);
      if (!provider) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot determine provider",
        });
      }

      const result = await closeProviderPR(
        provider,
        project.repoUrl,
        ctx.db,
        ctx.orgId,
        input.prNumber
      );

      if (!result.success) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: result.error ?? "Failed to close PR",
        });
      }

      return { success: true };
    }),

  createPullRequest: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        title: z.string().min(1).max(500),
        headBranch: z.string().min(1),
        baseBranch: z.string().min(1),
        body: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const project = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          eq(projects.orgId, ctx.orgId)
        ),
      });

      if (!project?.repoUrl) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project or repo not found",
        });
      }

      const provider = detectProviderFromUrl(project.repoUrl);
      if (!provider) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot determine provider",
        });
      }

      logger.info(
        { projectId: input.projectId, provider, headBranch: input.headBranch },
        "Creating pull request"
      );

      const result = await createProviderPR(
        provider,
        project.repoUrl,
        ctx.db,
        ctx.orgId,
        {
          title: input.title,
          headBranch: input.headBranch,
          baseBranch: input.baseBranch,
          body: input.body,
        }
      );

      if (!result.success) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: result.error ?? "Failed to create PR",
        });
      }

      return { success: true, number: result.number, url: result.url };
    }),

  // ---------------------------------------------------------------------------
  // CI/CD endpoints (used by CI page)
  // ---------------------------------------------------------------------------
  listCIRuns: protectedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const project = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          eq(projects.orgId, ctx.orgId)
        ),
      });

      if (!project?.repoUrl) {
        return { runs: [] };
      }

      const provider = detectProviderFromUrl(project.repoUrl);
      if (!provider) {
        return { runs: [] };
      }

      logger.info({ projectId: input.projectId, provider }, "Listing CI runs");

      const runs = await fetchProviderCIRuns(
        provider,
        project.repoUrl,
        ctx.db,
        ctx.orgId
      );

      return { runs };
    }),

  generateCIConfig: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        provider: z.string().min(1),
      })
    )
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

      logger.info(
        { projectId: input.projectId, provider: input.provider },
        "Generating CI config"
      );

      const techStack = project.techStackPreset ?? "custom";
      const config = generateCIConfigForStack(
        input.provider,
        techStack,
        project.name
      );

      return { config };
    }),

  applyCIConfig: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        provider: z.string().min(1),
        config: z.string(),
      })
    )
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

      logger.info(
        { projectId: input.projectId, provider: input.provider },
        "Applying CI config"
      );

      // The config will be committed to the repo via the sandbox/agent
      return { success: true, message: "CI config ready to be committed" };
    }),
});

// ---------------------------------------------------------------------------
// Provider detection + diff parsing helpers
// ---------------------------------------------------------------------------

function detectProviderFromUrl(repoUrl: string): string | null {
  if (repoUrl.includes("github.com")) {
    return "github";
  }
  if (repoUrl.includes("gitlab.com")) {
    return "gitlab";
  }
  if (repoUrl.includes("bitbucket.org")) {
    return "bitbucket";
  }
  if (repoUrl.includes("dev.azure.com")) {
    return "azure_devops";
  }
  // Self-hosted instances -- check for common patterns
  if (repoUrl.includes("gitea") || repoUrl.includes("forgejo")) {
    return "gitea";
  }
  return null;
}

const HUNK_HEADER_RE = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/;

function parseHunks(patch: string | null): {
  startLine: number | null;
  lines: {
    lineNumber: number | null;
    content: string | null;
    type: string | null;
  }[];
}[] {
  if (!patch) {
    return [];
  }

  const hunks: {
    startLine: number | null;
    lines: {
      lineNumber: number | null;
      content: string | null;
      type: string | null;
    }[];
  }[] = [];

  const hunkHeaderRe = HUNK_HEADER_RE;
  const patchLines = patch.split("\n");

  let currentHunk: (typeof hunks)[0] | null = null;
  let lineNum = 0;

  for (const line of patchLines) {
    const headerMatch = hunkHeaderRe.exec(line);
    if (headerMatch) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }
      lineNum = Number(headerMatch[2]);
      currentHunk = { startLine: lineNum, lines: [] };
      continue;
    }

    if (!currentHunk) {
      continue;
    }

    if (line.startsWith("+")) {
      currentHunk.lines.push({
        lineNumber: lineNum,
        content: line.slice(1),
        type: "addition",
      });
      lineNum++;
    } else if (line.startsWith("-")) {
      currentHunk.lines.push({
        lineNumber: null,
        content: line.slice(1),
        type: "deletion",
      });
    } else {
      currentHunk.lines.push({
        lineNumber: lineNum,
        content: line.startsWith(" ") ? line.slice(1) : line,
        type: "context",
      });
      lineNum++;
    }
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }
  return hunks;
}

function generateCIConfigForStack(
  provider: string,
  techStack: string,
  projectName: string
): string {
  const installCmd = techStack.includes("python")
    ? "pip install -r requirements.txt"
    : "pnpm install";
  const testCmd = techStack.includes("python") ? "pytest" : "pnpm test";
  const buildCmd = techStack.includes("python") ? "" : "pnpm build";

  switch (provider) {
    case "github-actions":
      return `name: CI - ${projectName}

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: ${installCmd}
      - run: ${testCmd}
${buildCmd ? `      - run: ${buildCmd}\n` : ""}`;
    case "gitlab-ci":
      return `stages:
  - test
  - build

test:
  stage: test
  image: node:20
  script:
    - ${installCmd}
    - ${testCmd}
${buildCmd ? `\nbuild:\n  stage: build\n  image: node:20\n  script:\n    - ${installCmd}\n    - ${buildCmd}\n` : ""}`;
    default:
      return `# ${provider} CI configuration for ${projectName}\n`;
  }
}

// ---------------------------------------------------------------------------
// Provider repo fetching helpers
// ---------------------------------------------------------------------------

export interface RepoItem {
  cloneUrl: string;
  defaultBranch: string;
  description: string | null;
  fullName: string;
  htmlUrl: string;
  id: string;
  language: string | null;
  name: string;
  owner: string;
  private: boolean;
  updatedAt: string;
}

function fetchReposFromProvider(
  provider: "github" | "gitlab" | "bitbucket",
  accessToken: string,
  options: { search?: string; page: number; perPage: number; sort: string }
): Promise<RepoItem[]> {
  switch (provider) {
    case "github":
      return fetchGitHubRepos(accessToken, options);
    case "gitlab":
      return fetchGitLabRepos(accessToken, options);
    case "bitbucket":
      return fetchBitBucketRepos(accessToken, options);
    default:
      return Promise.resolve([]);
  }
}

async function fetchGitHubRepos(
  token: string,
  options: { search?: string; page: number; perPage: number; sort: string }
): Promise<RepoItem[]> {
  const sortMap: Record<string, string> = {
    updated: "updated",
    created: "created",
    name: "full_name",
  };

  const params = new URLSearchParams({
    sort: sortMap[options.sort] ?? "updated",
    direction: "desc",
    page: String(options.page),
    per_page: String(options.perPage),
    type: "all",
  });

  const resp = await fetch(
    `https://api.github.com/user/repos?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    }
  );

  if (!resp.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `GitHub API error: ${resp.status}`,
    });
  }

  const data = (await resp.json()) as Record<string, unknown>[];

  let repos: RepoItem[] = data.map((r) => ({
    id: String(r.id),
    name: String(r.name ?? ""),
    fullName: String(r.full_name ?? ""),
    description: r.description ? String(r.description) : null,
    private: r.private === true,
    defaultBranch: String(r.default_branch ?? "main"),
    language: r.language ? String(r.language) : null,
    updatedAt: String(r.updated_at ?? ""),
    htmlUrl: String(r.html_url ?? ""),
    cloneUrl: String(r.clone_url ?? ""),
    owner: String(
      (r.owner as Record<string, unknown> | undefined)?.login ?? ""
    ),
  }));

  if (options.search) {
    const q = options.search.toLowerCase();
    repos = repos.filter(
      (r) =>
        r.name.toLowerCase().includes(q) || r.fullName.toLowerCase().includes(q)
    );
  }

  return repos;
}

async function fetchGitLabRepos(
  token: string,
  options: { search?: string; page: number; perPage: number; sort: string }
): Promise<RepoItem[]> {
  const sortMap: Record<string, string> = {
    updated: "updated_at",
    created: "created_at",
    name: "name",
  };

  const params = new URLSearchParams({
    membership: "true",
    order_by: sortMap[options.sort] ?? "updated_at",
    sort: "desc",
    page: String(options.page),
    per_page: String(options.perPage),
  });

  if (options.search) {
    params.set("search", options.search);
  }

  const resp = await fetch(
    `https://gitlab.com/api/v4/projects?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!resp.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `GitLab API error: ${resp.status}`,
    });
  }

  const data = (await resp.json()) as Record<string, unknown>[];

  return data.map((r) => ({
    id: String(r.id),
    name: String(r.name ?? ""),
    fullName: String(r.path_with_namespace ?? ""),
    description: r.description ? String(r.description) : null,
    private: r.visibility === "private",
    defaultBranch: String(r.default_branch ?? "main"),
    language: null,
    updatedAt: String(r.last_activity_at ?? ""),
    htmlUrl: String(r.web_url ?? ""),
    cloneUrl: String(r.http_url_to_repo ?? ""),
    owner: String(
      (r.namespace as Record<string, unknown> | undefined)?.path ?? ""
    ),
  }));
}

async function fetchBitBucketRepos(
  token: string,
  options: { search?: string; page: number; perPage: number; sort: string }
): Promise<RepoItem[]> {
  const sortMap: Record<string, string> = {
    updated: "-updated_on",
    created: "-created_on",
    name: "name",
  };

  const params = new URLSearchParams({
    sort: sortMap[options.sort] ?? "-updated_on",
    pagelen: String(options.perPage),
    page: String(options.page),
    role: "member",
  });

  if (options.search) {
    params.set("q", `name ~ "${options.search}"`);
  }

  const resp = await fetch(
    `https://api.bitbucket.org/2.0/repositories?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!resp.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `BitBucket API error: ${resp.status}`,
    });
  }

  const data = (await resp.json()) as {
    values: Record<string, unknown>[];
  };

  return (data.values ?? []).map((r) => {
    const links = r.links as Record<string, unknown> | undefined;
    const htmlLink = links?.html as Record<string, unknown> | undefined;
    const cloneLinks = (links?.clone as Record<string, unknown>[]) ?? [];
    const httpsClone = cloneLinks.find((l) => l.name === "https");
    const mainBranch = r.mainbranch as Record<string, unknown> | undefined;

    return {
      id: String(r.uuid ?? ""),
      name: String(r.name ?? ""),
      fullName: String(r.full_name ?? ""),
      description: r.description ? String(r.description) : null,
      private: r.is_private === true,
      defaultBranch: String(mainBranch?.name ?? "main"),
      language: r.language ? String(r.language) : null,
      updatedAt: String(r.updated_on ?? ""),
      htmlUrl: String(htmlLink?.href ?? ""),
      cloneUrl: String(httpsClone?.href ?? ""),
      owner: String(
        (r.owner as Record<string, unknown> | undefined)?.nickname ?? ""
      ),
    };
  });
}

async function fetchGitHubRepoDetails(
  accessToken: string,
  repoFullName: string
) {
  const resp = await fetch(`https://api.github.com/repos/${repoFullName}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (!resp.ok) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Repository not found: ${repoFullName}`,
    });
  }
  const data = (await resp.json()) as Record<string, unknown>;
  return {
    name: String(data.name ?? ""),
    description: data.description ? String(data.description) : null,
    cloneUrl: String(data.clone_url ?? ""),
    defaultBranch: String(data.default_branch ?? "main"),
  };
}

async function fetchGitLabRepoDetails(
  accessToken: string,
  repoFullName: string
) {
  const encoded = encodeURIComponent(repoFullName);
  const resp = await fetch(`https://gitlab.com/api/v4/projects/${encoded}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Repository not found: ${repoFullName}`,
    });
  }
  const data = (await resp.json()) as Record<string, unknown>;
  return {
    name: String(data.name ?? ""),
    description: data.description ? String(data.description) : null,
    cloneUrl: String(data.http_url_to_repo ?? ""),
    defaultBranch: String(data.default_branch ?? "main"),
  };
}

async function fetchBitBucketRepoDetails(
  accessToken: string,
  repoFullName: string
) {
  const resp = await fetch(
    `https://api.bitbucket.org/2.0/repositories/${repoFullName}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!resp.ok) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Repository not found: ${repoFullName}`,
    });
  }
  const data = (await resp.json()) as Record<string, unknown>;
  const links = data.links as Record<string, unknown> | undefined;
  const cloneLinks = (links?.clone as Record<string, unknown>[]) ?? [];
  const httpsClone = cloneLinks.find((l) => l.name === "https");
  const mainBranch = data.mainbranch as Record<string, unknown> | undefined;
  return {
    name: String(data.name ?? ""),
    description: data.description ? String(data.description) : null,
    cloneUrl: String(httpsClone?.href ?? ""),
    defaultBranch: String(mainBranch?.name ?? "main"),
  };
}

function fetchRepoDetails(
  provider: "github" | "gitlab" | "bitbucket",
  accessToken: string,
  repoFullName: string
): Promise<{
  cloneUrl: string;
  defaultBranch: string;
  description: string | null;
  name: string;
}> {
  switch (provider) {
    case "github":
      return fetchGitHubRepoDetails(accessToken, repoFullName);
    case "gitlab":
      return fetchGitLabRepoDetails(accessToken, repoFullName);
    case "bitbucket":
      return fetchBitBucketRepoDetails(accessToken, repoFullName);
    default:
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Unsupported provider: ${provider as string}`,
      });
  }
}

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
