import { createLogger } from "@prometheus/logger";
import type { MarketplaceCatalogEntry } from "@prometheus/plugins";
import { getBuiltinCatalog } from "@prometheus/plugins";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("plugins-router");

/**
 * In-memory installed state keyed by "orgId:pluginId".
 * In production this would be backed by a database table.
 */
const installedPlugins = new Map<
  string,
  {
    config: Record<string, unknown>;
    enabled: boolean;
    installedAt: string;
    pluginId: string;
  }
>();

/** Rating overrides submitted by users: pluginId -> { total, count } */
const ratingAccumulator = new Map<string, { total: number; count: number }>();

function getInstalledKey(orgId: string, pluginId: string): string {
  return `${orgId}:${pluginId}`;
}

function enrichWithInstallState(
  plugins: MarketplaceCatalogEntry[],
  orgId: string
): Array<MarketplaceCatalogEntry & { installed: boolean; enabled: boolean }> {
  return plugins.map((p) => {
    const inst = installedPlugins.get(getInstalledKey(orgId, p.id));
    return {
      ...p,
      installed: !!inst,
      enabled: inst?.enabled ?? false,
    };
  });
}

// ---------------------------------------------------------------------------
// Plugin categories for filtering
// ---------------------------------------------------------------------------

const pluginCategorySchema = z.enum([
  "integration",
  "mcp-adapter",
  "tech-stack-preset",
  "skill-pack",
  "agent-role",
  "model-provider",
  "theme",
  "custom",
]);

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const pluginsRouter = router({
  /**
   * List available plugins with search, category filter, and pagination.
   */
  list: protectedProcedure
    .input(
      z
        .object({
          query: z.string().optional(),
          category: pluginCategorySchema.optional(),
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .optional()
    )
    .query(({ input, ctx }) => {
      const catalog = getBuiltinCatalog();
      let filtered = catalog;

      if (input?.query) {
        const q = input.query.toLowerCase();
        filtered = filtered.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q) ||
            p.tags.some((t) => t.toLowerCase().includes(q))
        );
      }

      if (input?.category) {
        filtered = filtered.filter((p) => p.category === input.category);
      }

      const total = filtered.length;
      const offset = input?.offset ?? 0;
      const limit = input?.limit ?? 50;
      const page = filtered.slice(offset, offset + limit);

      const orgId = ctx.orgId ?? "default";

      return {
        plugins: enrichWithInstallState(page, orgId),
        total,
        hasMore: offset + limit < total,
      };
    }),

  /**
   * Get detailed information about a specific plugin.
   */
  get: protectedProcedure
    .input(z.object({ pluginId: z.string().min(1) }))
    .query(({ input, ctx }) => {
      const catalog = getBuiltinCatalog();
      const plugin = catalog.find((p) => p.id === input.pluginId);

      if (!plugin) {
        return null;
      }

      const orgId = ctx.orgId ?? "default";
      const inst = installedPlugins.get(getInstalledKey(orgId, input.pluginId));

      // Apply user ratings if any
      const userRatings = ratingAccumulator.get(input.pluginId);
      const effectiveRating = userRatings
        ? (plugin.rating * plugin.ratingCount + userRatings.total) /
          (plugin.ratingCount + userRatings.count)
        : plugin.rating;
      const effectiveRatingCount =
        plugin.ratingCount + (userRatings?.count ?? 0);

      return {
        ...plugin,
        rating: Math.round(effectiveRating * 10) / 10,
        ratingCount: effectiveRatingCount,
        installed: !!inst,
        enabled: inst?.enabled ?? false,
        installedAt: inst?.installedAt ?? null,
      };
    }),

  /**
   * Install a plugin for the current organization.
   */
  install: protectedProcedure
    .input(
      z.object({
        pluginId: z.string().min(1),
        config: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      const catalog = getBuiltinCatalog();
      const plugin = catalog.find((p) => p.id === input.pluginId);

      if (!plugin) {
        return { success: false, error: "Plugin not found" };
      }

      const orgId = ctx.orgId ?? "default";
      const key = getInstalledKey(orgId, input.pluginId);

      if (installedPlugins.has(key)) {
        return { success: false, error: "Plugin already installed" };
      }

      installedPlugins.set(key, {
        pluginId: input.pluginId,
        enabled: true,
        config: input.config ?? {},
        installedAt: new Date().toISOString(),
      });

      logger.info({ orgId, pluginId: input.pluginId }, "Plugin installed");

      return {
        success: true,
        pluginId: input.pluginId,
        installed: true,
        name: plugin.name,
      };
    }),

  /**
   * Uninstall a plugin from the current organization.
   */
  uninstall: protectedProcedure
    .input(z.object({ pluginId: z.string().min(1) }))
    .mutation(({ input, ctx }) => {
      const orgId = ctx.orgId ?? "default";
      const key = getInstalledKey(orgId, input.pluginId);
      const existed = installedPlugins.delete(key);

      if (existed) {
        logger.info({ orgId, pluginId: input.pluginId }, "Plugin uninstalled");
      }

      return {
        success: true,
        pluginId: input.pluginId,
        installed: false,
      };
    }),

  /**
   * Rate a plugin (1-5 stars).
   */
  rate: protectedProcedure
    .input(
      z.object({
        pluginId: z.string().min(1),
        rating: z.number().int().min(1).max(5),
      })
    )
    .mutation(({ input }) => {
      const catalog = getBuiltinCatalog();
      const plugin = catalog.find((p) => p.id === input.pluginId);

      if (!plugin) {
        return { success: false, error: "Plugin not found" };
      }

      const existing = ratingAccumulator.get(input.pluginId) ?? {
        total: 0,
        count: 0,
      };
      ratingAccumulator.set(input.pluginId, {
        total: existing.total + input.rating,
        count: existing.count + 1,
      });

      const newTotal =
        plugin.rating * plugin.ratingCount + existing.total + input.rating;
      const newCount = plugin.ratingCount + existing.count + 1;

      logger.info(
        { pluginId: input.pluginId, rating: input.rating },
        "Plugin rated"
      );

      return {
        success: true,
        pluginId: input.pluginId,
        rating: Math.round((newTotal / newCount) * 10) / 10,
        ratingCount: newCount,
      };
    }),

  /**
   * Configure a plugin.
   */
  configure: protectedProcedure
    .input(
      z.object({
        pluginId: z.string().min(1),
        config: z.record(z.string(), z.unknown()),
      })
    )
    .mutation(({ input, ctx }) => {
      const orgId = ctx.orgId ?? "default";
      const key = getInstalledKey(orgId, input.pluginId);
      const inst = installedPlugins.get(key);

      if (!inst) {
        return { success: false, error: "Plugin not installed" };
      }

      inst.config = { ...inst.config, ...input.config };
      logger.info({ orgId, pluginId: input.pluginId }, "Plugin configured");

      return { success: true, pluginId: input.pluginId };
    }),

  /**
   * Enable an installed plugin.
   */
  enable: protectedProcedure
    .input(z.object({ pluginId: z.string().min(1) }))
    .mutation(({ input, ctx }) => {
      const orgId = ctx.orgId ?? "default";
      const key = getInstalledKey(orgId, input.pluginId);
      const inst = installedPlugins.get(key);

      if (!inst) {
        return { success: false, error: "Plugin not installed" };
      }

      inst.enabled = true;
      return { success: true, pluginId: input.pluginId, enabled: true };
    }),

  /**
   * Disable an installed plugin.
   */
  disable: protectedProcedure
    .input(z.object({ pluginId: z.string().min(1) }))
    .mutation(({ input, ctx }) => {
      const orgId = ctx.orgId ?? "default";
      const key = getInstalledKey(orgId, input.pluginId);
      const inst = installedPlugins.get(key);

      if (!inst) {
        return { success: false, error: "Plugin not installed" };
      }

      inst.enabled = false;
      return { success: true, pluginId: input.pluginId, enabled: false };
    }),

  /**
   * List installed plugins for the current org.
   */
  installed: protectedProcedure.query(({ ctx }) => {
    const orgId = ctx.orgId ?? "default";
    const catalog = getBuiltinCatalog();
    const installed: Array<
      MarketplaceCatalogEntry & {
        installed: true;
        enabled: boolean;
        installedAt: string;
      }
    > = [];

    for (const [key, inst] of installedPlugins) {
      if (!key.startsWith(`${orgId}:`)) {
        continue;
      }
      const plugin = catalog.find((p) => p.id === inst.pluginId);
      if (plugin) {
        installed.push({
          ...plugin,
          installed: true,
          enabled: inst.enabled,
          installedAt: inst.installedAt,
        });
      }
    }

    return { plugins: installed };
  }),

  /**
   * List available skill packs.
   */
  skillPacks: protectedProcedure.query(() => {
    return {
      packs: [
        {
          id: "skill-pack-ecommerce",
          name: "E-commerce",
          description:
            "Payment processing, cart management, checkout flows, inventory, and order management",
          category: "skill-pack",
          tags: ["ecommerce", "payments", "cart", "checkout", "stripe"],
          patternCount: 5,
        },
        {
          id: "skill-pack-auth",
          name: "Authentication & Authorization",
          description:
            "OAuth patterns, JWT handling, session management, RBAC, and MFA",
          category: "skill-pack",
          tags: ["auth", "oauth", "jwt", "sessions", "rbac"],
          patternCount: 5,
        },
        {
          id: "skill-pack-real-time",
          name: "Real-time & Collaboration",
          description:
            "WebSocket patterns, event streaming, presence, notifications, and collaborative editing",
          category: "skill-pack",
          tags: ["websocket", "real-time", "streaming", "presence"],
          patternCount: 5,
        },
        {
          id: "skill-pack-data-pipeline",
          name: "Data Pipeline",
          description:
            "ETL processes, job scheduling, data quality monitoring, and pipeline orchestration",
          category: "skill-pack",
          tags: ["etl", "data", "pipeline", "scheduling"],
          patternCount: 5,
        },
        {
          id: "skill-pack-mobile",
          name: "Mobile & Responsive",
          description:
            "Responsive design, offline-first architecture, push notifications, and PWA patterns",
          category: "skill-pack",
          tags: ["mobile", "responsive", "offline", "pwa"],
          patternCount: 5,
        },
        {
          id: "skill-pack-saas",
          name: "SaaS Platform",
          description:
            "Multi-tenancy, subscription billing, onboarding, usage metering, and team management",
          category: "skill-pack",
          tags: ["saas", "multi-tenant", "billing", "subscriptions"],
          patternCount: 5,
        },
      ],
    };
  }),
});
