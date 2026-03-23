"use client";

import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PluginInfo {
  activatedAt: string | null;
  category: string;
  description: string;
  error: string | null;
  icon?: string;
  id: string;
  name: string;
  status: "registered" | "active" | "inactive" | "error";
  toolCount: number;
  version: string;
}

// ---------------------------------------------------------------------------
// Plugin data (fetched from API in production, mocked here for initial UI)
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  "mcp-adapter": "MCP Adapters",
  "tech-stack-preset": "Tech Stack Presets",
  "skill-pack": "Skill Packs",
  "agent-role": "Agent Roles",
  "model-provider": "Model Providers",
  integration: "Integrations",
  custom: "Custom",
};

const CATEGORY_ORDER = [
  "mcp-adapter",
  "skill-pack",
  "agent-role",
  "model-provider",
  "tech-stack-preset",
  "integration",
  "custom",
];

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; dotColor: string }
> = {
  active: {
    label: "Active",
    color: "text-green-400",
    dotColor: "bg-green-500",
  },
  registered: {
    label: "Registered",
    color: "text-blue-400",
    dotColor: "bg-blue-500",
  },
  inactive: {
    label: "Inactive",
    color: "text-zinc-500",
    dotColor: "bg-zinc-600",
  },
  error: { label: "Error", color: "text-red-400", dotColor: "bg-red-500" },
};

// Default plugins reflecting built-in Prometheus adapters and skill packs
const DEFAULT_PLUGINS: PluginInfo[] = [
  {
    id: "github",
    name: "GitHub",
    description: "Repository hosting, PRs, issues, and CI/CD",
    version: "1.0.0",
    category: "mcp-adapter",
    status: "active",
    icon: "G",
    error: null,
    toolCount: 10,
    activatedAt: new Date().toISOString(),
  },
  {
    id: "gitlab",
    name: "GitLab",
    description: "Repository hosting and CI/CD pipelines",
    version: "1.0.0",
    category: "mcp-adapter",
    status: "active",
    icon: "GL",
    error: null,
    toolCount: 6,
    activatedAt: new Date().toISOString(),
  },
  {
    id: "linear",
    name: "Linear",
    description: "Issue tracking and project management",
    version: "1.0.0",
    category: "mcp-adapter",
    status: "active",
    icon: "L",
    error: null,
    toolCount: 5,
    activatedAt: new Date().toISOString(),
  },
  {
    id: "jira",
    name: "Jira",
    description: "Project management and issue tracking",
    version: "1.0.0",
    category: "mcp-adapter",
    status: "active",
    icon: "J",
    error: null,
    toolCount: 5,
    activatedAt: new Date().toISOString(),
  },
  {
    id: "slack",
    name: "Slack",
    description: "Team messaging and notifications",
    version: "1.0.0",
    category: "mcp-adapter",
    status: "active",
    icon: "S",
    error: null,
    toolCount: 3,
    activatedAt: new Date().toISOString(),
  },
  {
    id: "vercel",
    name: "Vercel",
    description: "Frontend deployment and preview URLs",
    version: "1.0.0",
    category: "mcp-adapter",
    status: "active",
    icon: "V",
    error: null,
    toolCount: 4,
    activatedAt: new Date().toISOString(),
  },
  {
    id: "figma",
    name: "Figma",
    description: "Design file access and inspection",
    version: "1.0.0",
    category: "mcp-adapter",
    status: "active",
    icon: "F",
    error: null,
    toolCount: 3,
    activatedAt: new Date().toISOString(),
  },
  {
    id: "skill-pack-ecommerce",
    name: "E-commerce",
    description: "Payment, cart, checkout, and order management patterns",
    version: "1.0.0",
    category: "skill-pack",
    status: "active",
    icon: "EC",
    error: null,
    toolCount: 0,
    activatedAt: new Date().toISOString(),
  },
  {
    id: "skill-pack-saas",
    name: "SaaS Platform",
    description: "Multi-tenancy, billing, onboarding, and team management",
    version: "1.0.0",
    category: "skill-pack",
    status: "active",
    icon: "SA",
    error: null,
    toolCount: 0,
    activatedAt: new Date().toISOString(),
  },
  {
    id: "skill-pack-data-pipeline",
    name: "Data Pipeline",
    description: "ETL, scheduling, monitoring, and pipeline orchestration",
    version: "1.0.0",
    category: "skill-pack",
    status: "active",
    icon: "DP",
    error: null,
    toolCount: 0,
    activatedAt: new Date().toISOString(),
  },
  {
    id: "skill-pack-mobile",
    name: "Mobile & Responsive",
    description: "Offline-first, push notifications, responsive design, PWA",
    version: "1.0.0",
    category: "skill-pack",
    status: "active",
    icon: "MB",
    error: null,
    toolCount: 0,
    activatedAt: new Date().toISOString(),
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PluginsPage() {
  const [plugins, setPlugins] = useState<PluginInfo[]>(DEFAULT_PLUGINS);
  const [filter, setFilter] = useState<string>("all");
  const [healthResults, setHealthResults] = useState<Record<string, boolean>>(
    {}
  );
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Simulated health check
  const runHealthCheck = useCallback(async () => {
    const results: Record<string, boolean> = {};
    for (const p of plugins) {
      results[p.id] = p.status === "active" && !p.error;
    }
    setHealthResults(results);
  }, [plugins]);

  useEffect(() => {
    runHealthCheck();
  }, [runHealthCheck]);

  const handleToggle = async (pluginId: string) => {
    setTogglingId(pluginId);

    // Simulate API call delay
    await new Promise((r) => setTimeout(r, 300));

    setPlugins((prev) =>
      prev.map((p) => {
        if (p.id !== pluginId) {
          return p;
        }
        const newStatus = p.status === "active" ? "inactive" : "active";
        return {
          ...p,
          status: newStatus,
          activatedAt: newStatus === "active" ? new Date().toISOString() : null,
          error: null,
        };
      })
    );

    setTogglingId(null);
  };

  // Group plugins by category
  const grouped: Record<string, PluginInfo[]> = {};
  for (const plugin of plugins) {
    if (filter !== "all" && plugin.category !== filter) {
      continue;
    }
    if (!grouped[plugin.category]) {
      grouped[plugin.category] = [];
    }
    grouped[plugin.category]?.push(plugin);
  }

  const sortedCategories = CATEGORY_ORDER.filter((c) => grouped[c]);

  const activeCount = plugins.filter((p) => p.status === "active").length;
  const errorCount = plugins.filter((p) => p.status === "error").length;
  const totalTools = plugins.reduce(
    (sum, p) => sum + (p.status === "active" ? p.toolCount : 0),
    0
  );

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-bold text-2xl text-zinc-100">Plugins</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Manage MCP adapters, skill packs, and extensions.
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="text-xs text-zinc-500">Active Plugins</div>
          <div className="mt-1 font-bold text-2xl text-zinc-100">
            {activeCount}
          </div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="text-xs text-zinc-500">Registered Tools</div>
          <div className="mt-1 font-bold text-2xl text-zinc-100">
            {totalTools}
          </div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="text-xs text-zinc-500">Health Issues</div>
          <div
            className={`mt-1 font-bold text-2xl ${errorCount > 0 ? "text-red-400" : "text-green-400"}`}
          >
            {errorCount}
          </div>
        </div>
      </div>

      {/* Category Filter */}
      <div className="flex flex-wrap gap-1.5">
        <button
          className={`rounded-lg px-3 py-1.5 font-medium text-xs transition-colors ${
            filter === "all"
              ? "bg-violet-600 text-white"
              : "border border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:text-zinc-200"
          }`}
          onClick={() => setFilter("all")}
          type="button"
        >
          All ({plugins.length})
        </button>
        {CATEGORY_ORDER.map((cat) => {
          const count = plugins.filter((p) => p.category === cat).length;
          if (count === 0) {
            return null;
          }
          return (
            <button
              className={`rounded-lg px-3 py-1.5 font-medium text-xs transition-colors ${
                filter === cat
                  ? "bg-violet-600 text-white"
                  : "border border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:text-zinc-200"
              }`}
              key={cat}
              onClick={() => setFilter(cat)}
              type="button"
            >
              {CATEGORY_LABELS[cat] ?? cat} ({count})
            </button>
          );
        })}
      </div>

      {/* Plugin List by Category */}
      {sortedCategories.map((category) => (
        <div className="space-y-2" key={category}>
          <h2 className="font-semibold text-sm text-zinc-300">
            {CATEGORY_LABELS[category] ?? category}
          </h2>

          <div className="space-y-2">
            {grouped[category]?.map((plugin) => {
              const statusCfg = (STATUS_CONFIG[plugin.status] ??
                STATUS_CONFIG.inactive) as NonNullable<
                (typeof STATUS_CONFIG)[string]
              >;
              const isHealthy = healthResults[plugin.id] ?? true;

              return (
                <div
                  className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
                  key={plugin.id}
                >
                  <div className="flex items-center gap-3">
                    {/* Icon */}
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-800 font-bold text-xs text-zinc-400">
                      {plugin.icon ?? plugin.name.slice(0, 2).toUpperCase()}
                    </div>

                    {/* Info */}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-zinc-200">
                          {plugin.name}
                        </span>
                        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
                          v{plugin.version}
                        </span>
                        {plugin.toolCount > 0 && (
                          <span className="text-[10px] text-zinc-600">
                            {plugin.toolCount} tools
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-500">
                        {plugin.description}
                      </div>
                      {plugin.error && (
                        <div className="mt-1 text-red-400 text-xs">
                          Error: {plugin.error}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Status + Toggle */}
                  <div className="flex items-center gap-3">
                    {/* Health indicator */}
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`h-2 w-2 rounded-full ${(() => {
                          if (plugin.status === "active") {
                            return isHealthy ? "bg-green-500" : "bg-yellow-500";
                          }
                          return statusCfg.dotColor;
                        })()}`}
                      />
                      <span className={`text-xs ${statusCfg.color}`}>
                        {statusCfg.label}
                      </span>
                    </div>

                    {/* Toggle */}
                    <button
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        plugin.status === "active"
                          ? "bg-violet-600"
                          : "bg-zinc-700"
                      } ${togglingId === plugin.id ? "opacity-50" : ""}`}
                      disabled={togglingId === plugin.id}
                      onClick={() => handleToggle(plugin.id)}
                      type="button"
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          plugin.status === "active"
                            ? "translate-x-6"
                            : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Empty state */}
      {sortedCategories.length === 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
          <p className="text-sm text-zinc-500">
            No plugins found for this category.
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-between rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <button
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          onClick={() => runHealthCheck()}
          type="button"
        >
          Run Health Checks
        </button>
        <button
          className="rounded-lg bg-violet-600 px-4 py-2 font-medium text-sm text-white hover:bg-violet-700"
          type="button"
        >
          Install Plugin
        </button>
      </div>
    </div>
  );
}
