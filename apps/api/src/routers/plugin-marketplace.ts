/**
 * GAP-050: Plugin Marketplace
 *
 * Search, install, uninstall, list, and submit community plugins.
 */

import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("api:plugin-marketplace");

// ---------------------------------------------------------------------------
// In-memory store (production: database-backed)
// ---------------------------------------------------------------------------

interface MarketplacePlugin {
  author: string;
  category: string;
  description: string;
  downloads: number;
  id: string;
  name: string;
  rating: number;
  status: "published" | "pending-review" | "rejected";
  tools: string[];
  version: string;
}

interface InstalledPlugin {
  installedAt: string;
  pluginId: string;
  projectId: string;
}

const catalogPlugins = new Map<string, MarketplacePlugin>();
const installedPlugins = new Map<string, InstalledPlugin[]>();

// Seed some example plugins
for (const plugin of [
  {
    id: "plg_eslint",
    name: "ESLint Integration",
    description: "Run ESLint checks as part of agent code generation",
    category: "quality",
    author: "prometheus-team",
    version: "1.0.0",
    tools: ["eslint_check", "eslint_fix"],
    downloads: 1200,
    rating: 4.5,
    status: "published" as const,
  },
  {
    id: "plg_docker",
    name: "Docker Helper",
    description: "Generate Dockerfiles and docker-compose configs",
    category: "devops",
    author: "community",
    version: "0.9.0",
    tools: ["docker_build", "docker_compose_gen"],
    downloads: 800,
    rating: 4.2,
    status: "published" as const,
  },
  {
    id: "plg_figma",
    name: "Figma Connector",
    description: "Import designs from Figma and generate components",
    category: "design",
    author: "community",
    version: "1.1.0",
    tools: ["figma_import", "component_gen"],
    downloads: 650,
    rating: 4.0,
    status: "published" as const,
  },
]) {
  catalogPlugins.set(plugin.id, plugin);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const pluginMarketplaceRouter = router({
  /**
   * Search available plugins by name or category.
   */
  search: protectedProcedure
    .input(
      z.object({
        query: z.string().max(200).default(""),
        category: z.string().max(50).optional(),
        limit: z.number().int().min(1).max(50).default(20),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(({ input }) => {
      let results = [...catalogPlugins.values()].filter(
        (p) => p.status === "published"
      );

      if (input.query) {
        const q = input.query.toLowerCase();
        results = results.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q)
        );
      }

      if (input.category) {
        results = results.filter((p) => p.category === input.category);
      }

      const total = results.length;
      const items = results.slice(input.offset, input.offset + input.limit);

      return {
        items: items.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          category: p.category,
          author: p.author,
          version: p.version,
          tools: p.tools,
          downloads: p.downloads,
          rating: p.rating,
        })),
        total,
      };
    }),

  /**
   * Install a plugin for a project.
   */
  install: protectedProcedure
    .input(
      z.object({
        pluginId: z.string().min(1),
        projectId: z.string().min(1),
      })
    )
    .mutation(({ input, ctx }) => {
      const plugin = catalogPlugins.get(input.pluginId);
      if (!plugin) {
        throw new Error(`Plugin ${input.pluginId} not found`);
      }

      const key = `${ctx.orgId}:${input.projectId}`;
      const existing = installedPlugins.get(key) ?? [];

      if (existing.some((p) => p.pluginId === input.pluginId)) {
        return { success: true, alreadyInstalled: true };
      }

      existing.push({
        pluginId: input.pluginId,
        projectId: input.projectId,
        installedAt: new Date().toISOString(),
      });
      installedPlugins.set(key, existing);

      plugin.downloads++;

      logger.info(
        {
          orgId: ctx.orgId,
          projectId: input.projectId,
          pluginId: input.pluginId,
        },
        "Plugin installed"
      );

      return { success: true, alreadyInstalled: false };
    }),

  /**
   * Uninstall a plugin from a project.
   */
  uninstall: protectedProcedure
    .input(
      z.object({
        pluginId: z.string().min(1),
        projectId: z.string().min(1),
      })
    )
    .mutation(({ input, ctx }) => {
      const key = `${ctx.orgId}:${input.projectId}`;
      const existing = installedPlugins.get(key) ?? [];
      const filtered = existing.filter((p) => p.pluginId !== input.pluginId);
      installedPlugins.set(key, filtered);

      logger.info(
        {
          orgId: ctx.orgId,
          projectId: input.projectId,
          pluginId: input.pluginId,
        },
        "Plugin uninstalled"
      );

      return { success: true };
    }),

  /**
   * List plugins installed for a project.
   */
  listInstalled: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
      })
    )
    .query(({ input, ctx }) => {
      const key = `${ctx.orgId}:${input.projectId}`;
      const installed = installedPlugins.get(key) ?? [];

      return installed.map((ip) => {
        const plugin = catalogPlugins.get(ip.pluginId);
        return {
          pluginId: ip.pluginId,
          projectId: ip.projectId,
          installedAt: ip.installedAt,
          name: plugin?.name ?? "Unknown",
          description: plugin?.description ?? "",
          tools: plugin?.tools ?? [],
        };
      });
    }),

  /**
   * Submit a community plugin for review.
   */
  submit: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().min(1).max(1000),
        category: z.string().min(1).max(50),
        version: z.string().min(1).max(20),
        tools: z.array(z.string()).min(1).max(20),
      })
    )
    .mutation(({ input, ctx }) => {
      const id = generateId("plg");
      const plugin: MarketplacePlugin = {
        id,
        name: input.name,
        description: input.description,
        category: input.category,
        author: ctx.auth.userId,
        version: input.version,
        tools: input.tools,
        downloads: 0,
        rating: 0,
        status: "pending-review",
      };

      catalogPlugins.set(id, plugin);

      logger.info(
        { pluginId: id, name: input.name, author: ctx.auth.userId },
        "Plugin submitted for review"
      );

      return {
        id,
        name: plugin.name,
        status: plugin.status,
        createdAt: new Date().toISOString(),
      };
    }),
});
