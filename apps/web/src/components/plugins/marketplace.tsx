"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Input,
} from "@prometheus/ui";
import {
  BarChart3,
  BookOpen,
  Bug,
  Cloud,
  Download,
  FigmaIcon,
  Github,
  MessageSquare,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import { type FC, type ReactNode, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PluginCategory =
  | "All"
  | "Analytics"
  | "Integrations"
  | "Security"
  | "Tools";

interface PluginData {
  category: PluginCategory;
  description: string;
  icon: ReactNode;
  id: string;
  installed: boolean;
  installs: number;
  name: string;
  rating: number;
}

// ---------------------------------------------------------------------------
// Static plugin catalogue
// ---------------------------------------------------------------------------

const INITIAL_PLUGINS: PluginData[] = [
  {
    id: "plugin_github",
    name: "GitHub Integration",
    description:
      "Connect repos, sync PRs, automate issue triage with AI agents.",
    category: "Integrations",
    icon: <Github className="h-5 w-5" />,
    installed: true,
    installs: 12_400,
    rating: 4.8,
  },
  {
    id: "plugin_slack",
    name: "Slack Notifications",
    description:
      "Real-time task updates, agent alerts, and team collaboration in Slack.",
    category: "Integrations",
    icon: <MessageSquare className="h-5 w-5" />,
    installed: true,
    installs: 9800,
    rating: 4.6,
  },
  {
    id: "plugin_jira",
    name: "Jira Sync",
    description:
      "Bi-directional sync between Prometheus tasks and Jira issues.",
    category: "Integrations",
    icon: <Bug className="h-5 w-5" />,
    installed: false,
    installs: 7200,
    rating: 4.4,
  },
  {
    id: "plugin_linear",
    name: "Linear Sync",
    description: "Keep Linear issues in sync with Prometheus project tasks.",
    category: "Integrations",
    icon: <BarChart3 className="h-5 w-5" />,
    installed: false,
    installs: 6500,
    rating: 4.7,
  },
  {
    id: "plugin_figma",
    name: "Figma Import",
    description:
      "Import Figma designs and generate React components automatically.",
    category: "Tools",
    icon: <FigmaIcon className="h-5 w-5" />,
    installed: true,
    installs: 5300,
    rating: 4.5,
  },
  {
    id: "plugin_vercel",
    name: "Vercel Deploy",
    description: "One-click preview deployments and production releases.",
    category: "Tools",
    icon: <Cloud className="h-5 w-5" />,
    installed: false,
    installs: 8100,
    rating: 4.9,
  },
  {
    id: "plugin_sentry",
    name: "Sentry Errors",
    description:
      "Surface Sentry errors in context and auto-assign to AI agents.",
    category: "Analytics",
    icon: <Bug className="h-5 w-5" />,
    installed: false,
    installs: 4700,
    rating: 4.3,
  },
  {
    id: "plugin_datadog",
    name: "Datadog Metrics",
    description: "Stream application metrics and alerts from Datadog.",
    category: "Analytics",
    icon: <BarChart3 className="h-5 w-5" />,
    installed: false,
    installs: 3900,
    rating: 4.2,
  },
  {
    id: "plugin_notion",
    name: "Notion Wiki",
    description:
      "Sync project documentation with Notion workspaces automatically.",
    category: "Tools",
    icon: <BookOpen className="h-5 w-5" />,
    installed: false,
    installs: 5600,
    rating: 4.6,
  },
  {
    id: "plugin_confluence",
    name: "Confluence Docs",
    description: "Publish and sync engineering docs with Confluence spaces.",
    category: "Tools",
    icon: <BookOpen className="h-5 w-5" />,
    installed: false,
    installs: 3100,
    rating: 4.1,
  },
];

const CATEGORIES: PluginCategory[] = [
  "All",
  "Integrations",
  "Tools",
  "Analytics",
  "Security",
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const PluginMarketplace: FC = () => {
  const [plugins, setPlugins] = useState<PluginData[]>(INITIAL_PLUGINS);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<PluginCategory>("All");

  const filteredPlugins = useMemo(() => {
    let list = plugins;

    if (activeCategory !== "All") {
      list = list.filter((p) => p.category === activeCategory);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q)
      );
    }

    return list;
  }, [plugins, searchQuery, activeCategory]);

  function handleToggleInstall(pluginId: string) {
    setPlugins((prev) =>
      prev.map((p) =>
        p.id === pluginId
          ? {
              ...p,
              installed: !p.installed,
              installs: p.installed ? p.installs - 1 : p.installs + 1,
            }
          : p
      )
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="font-bold text-2xl tracking-tight">
          Plugin Marketplace
        </h2>
        <p className="text-muted-foreground">
          Extend Prometheus with first-party integrations and tools.
        </p>
      </div>

      {/* Search and filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search plugins..."
            value={searchQuery}
          />
        </div>

        <div className="flex gap-2">
          {CATEGORIES.map((cat) => (
            <Button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              size="sm"
              variant={activeCategory === cat ? "default" : "outline"}
            >
              {cat}
            </Button>
          ))}
        </div>
      </div>

      {/* Plugin grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filteredPlugins.map((plugin) => (
          <Card key={plugin.id}>
            <CardHeader className="flex flex-row items-start gap-3 space-y-0 pb-2">
              <div className="rounded-md border p-2">{plugin.icon}</div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold leading-none">{plugin.name}</h3>
                  {plugin.installed && (
                    <Badge variant="secondary">Installed</Badge>
                  )}
                </div>
                <Badge variant="outline">{plugin.category}</Badge>
              </div>
            </CardHeader>

            <CardContent className="space-y-3">
              <p className="text-muted-foreground text-sm">
                {plugin.description}
              </p>

              <div className="flex items-center gap-4 text-muted-foreground text-xs">
                <span className="flex items-center gap-1">
                  <Download className="h-3 w-3" />
                  {plugin.installs.toLocaleString()}
                </span>
                <span className="flex items-center gap-1">
                  <Star className="h-3 w-3" />
                  {plugin.rating}
                </span>
              </div>

              <Button
                className="w-full"
                onClick={() => handleToggleInstall(plugin.id)}
                size="sm"
                variant={plugin.installed ? "destructive" : "default"}
              >
                {plugin.installed ? (
                  <>
                    <Trash2 className="mr-1 h-3 w-3" /> Uninstall
                  </>
                ) : (
                  <>
                    <Download className="mr-1 h-3 w-3" /> Install
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredPlugins.length === 0 && (
        <div className="py-12 text-center text-muted-foreground">
          No plugins found matching your search.
        </div>
      )}
    </div>
  );
};
