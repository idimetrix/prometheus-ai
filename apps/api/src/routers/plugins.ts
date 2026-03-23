import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const _ORCHESTRATOR_URL =
  process.env.ORCHESTRATOR_URL ?? "http://localhost:4002";

export const pluginsRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          query: z.string().optional(),
          category: z.string().optional(),
        })
        .optional()
    )
    .query(({ input }) => {
      // In production, this queries the plugin registry
      const builtinPlugins = [
        {
          id: "plugin_github",
          name: "GitHub",
          category: "vcs",
          installed: true,
          enabled: true,
        },
        {
          id: "plugin_linear",
          name: "Linear",
          category: "project-management",
          installed: false,
          enabled: false,
        },
        {
          id: "plugin_slack",
          name: "Slack",
          category: "communication",
          installed: true,
          enabled: true,
        },
        {
          id: "plugin_sentry",
          name: "Sentry",
          category: "monitoring",
          installed: false,
          enabled: false,
        },
        {
          id: "plugin_notion",
          name: "Notion",
          category: "documentation",
          installed: false,
          enabled: false,
        },
        {
          id: "plugin_datadog",
          name: "Datadog",
          category: "monitoring",
          installed: false,
          enabled: false,
        },
        {
          id: "plugin_jira",
          name: "Jira",
          category: "project-management",
          installed: true,
          enabled: true,
        },
        {
          id: "plugin_figma",
          name: "Figma",
          category: "design",
          installed: true,
          enabled: true,
        },
        {
          id: "plugin_vercel",
          name: "Vercel",
          category: "deployment",
          installed: false,
          enabled: false,
        },
        {
          id: "plugin_gitlab",
          name: "GitLab",
          category: "vcs",
          installed: false,
          enabled: false,
        },
      ];

      let filtered = builtinPlugins;
      if (input?.query) {
        const q = input.query.toLowerCase();
        filtered = filtered.filter(
          (p) => p.name.toLowerCase().includes(q) || p.category.includes(q)
        );
      }
      if (input?.category) {
        filtered = filtered.filter((p) => p.category === input.category);
      }

      return { plugins: filtered };
    }),

  install: protectedProcedure
    .input(z.object({ pluginId: z.string() }))
    .mutation(({ input }) => {
      return { success: true, pluginId: input.pluginId, installed: true };
    }),

  uninstall: protectedProcedure
    .input(z.object({ pluginId: z.string() }))
    .mutation(({ input }) => {
      return { success: true, pluginId: input.pluginId, installed: false };
    }),

  configure: protectedProcedure
    .input(
      z.object({
        pluginId: z.string(),
        config: z.record(z.string(), z.unknown()),
      })
    )
    .mutation(({ input }) => {
      return { success: true, pluginId: input.pluginId };
    }),

  enable: protectedProcedure
    .input(z.object({ pluginId: z.string() }))
    .mutation(({ input }) => {
      return { success: true, pluginId: input.pluginId, enabled: true };
    }),

  disable: protectedProcedure
    .input(z.object({ pluginId: z.string() }))
    .mutation(({ input }) => {
      return { success: true, pluginId: input.pluginId, enabled: false };
    }),
});
