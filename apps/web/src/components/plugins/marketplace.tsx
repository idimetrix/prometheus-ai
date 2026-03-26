"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Input,
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@prometheus/ui";
import {
  BarChart3,
  BookOpen,
  Bug,
  Check,
  Cloud,
  Code2,
  Download,
  GitBranch,
  Layers,
  Lock,
  MessageSquare,
  Palette,
  Search,
  Shield,
  Star,
  Trash2,
  Zap,
} from "lucide-react";
import { type FC, type ReactNode, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PluginCategory =
  | "All"
  | "Analytics"
  | "DevOps"
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
  tags: string[];
  verified: boolean;
  version: string;
}

// ---------------------------------------------------------------------------
// Static plugin catalogue
// ---------------------------------------------------------------------------

const INITIAL_PLUGINS: PluginData[] = [
  {
    id: "plugin-github",
    name: "GitHub Integration",
    description:
      "Connect repos, sync PRs, automate issue triage with AI agents. Full repository management and CI/CD workflow triggers.",
    category: "Integrations",
    icon: <GitBranch className="h-5 w-5" />,
    installed: true,
    installs: 14_200,
    rating: 4.8,
    tags: ["github", "git", "vcs", "ci-cd"],
    verified: true,
    version: "2.1.0",
  },
  {
    id: "plugin-slack",
    name: "Slack Notifications",
    description:
      "Real-time task updates, agent alerts, and team collaboration in Slack. Slash commands and thread replies.",
    category: "Integrations",
    icon: <MessageSquare className="h-5 w-5" />,
    installed: true,
    installs: 11_500,
    rating: 4.6,
    tags: ["slack", "messaging", "notifications"],
    verified: true,
    version: "1.5.0",
  },
  {
    id: "plugin-jira",
    name: "Jira Sync",
    description:
      "Bi-directional sync between Prometheus tasks and Jira issues. Sprint management and workflow automation.",
    category: "Integrations",
    icon: <Bug className="h-5 w-5" />,
    installed: false,
    installs: 7800,
    rating: 4.4,
    tags: ["jira", "issues", "agile"],
    verified: true,
    version: "1.3.0",
  },
  {
    id: "plugin-linear",
    name: "Linear Sync",
    description:
      "Keep Linear issues in sync with Prometheus project tasks. Cycle management and label sync.",
    category: "Integrations",
    icon: <BarChart3 className="h-5 w-5" />,
    installed: false,
    installs: 9100,
    rating: 4.7,
    tags: ["linear", "issues", "tracking"],
    verified: true,
    version: "1.4.0",
  },
  {
    id: "plugin-figma",
    name: "Figma Import",
    description:
      "Import Figma designs and generate React components automatically. Design-to-code pipeline.",
    category: "Tools",
    icon: <Palette className="h-5 w-5" />,
    installed: true,
    installs: 5300,
    rating: 4.5,
    tags: ["figma", "design", "ui"],
    verified: true,
    version: "1.1.0",
  },
  {
    id: "plugin-vercel",
    name: "Vercel Deploy",
    description:
      "One-click preview deployments and production releases. Environment management and build monitoring.",
    category: "DevOps",
    icon: <Cloud className="h-5 w-5" />,
    installed: false,
    installs: 10_300,
    rating: 4.9,
    tags: ["vercel", "deployment", "preview"],
    verified: true,
    version: "1.2.0",
  },
  {
    id: "plugin-sentry",
    name: "Sentry Errors",
    description:
      "Surface Sentry errors in context and auto-assign to AI agents. Performance monitoring and AI resolution.",
    category: "Analytics",
    icon: <Bug className="h-5 w-5" />,
    installed: false,
    installs: 6400,
    rating: 4.5,
    tags: ["sentry", "errors", "monitoring"],
    verified: true,
    version: "1.1.0",
  },
  {
    id: "plugin-datadog",
    name: "Datadog Metrics",
    description:
      "Stream application metrics, logs, and APM traces from Datadog. Infrastructure monitoring.",
    category: "Analytics",
    icon: <BarChart3 className="h-5 w-5" />,
    installed: false,
    installs: 4700,
    rating: 4.3,
    tags: ["datadog", "monitoring", "apm"],
    verified: true,
    version: "1.0.0",
  },
  {
    id: "plugin-notion",
    name: "Notion Wiki",
    description:
      "Sync project documentation with Notion workspaces automatically. Knowledge base integration.",
    category: "Tools",
    icon: <BookOpen className="h-5 w-5" />,
    installed: false,
    installs: 5600,
    rating: 4.6,
    tags: ["notion", "docs", "wiki"],
    verified: true,
    version: "1.0.0",
  },
  {
    id: "plugin-snyk",
    name: "Snyk Security",
    description:
      "Automated dependency vulnerability scanning and security fix suggestions. SBOM generation.",
    category: "Security",
    icon: <Shield className="h-5 w-5" />,
    installed: false,
    installs: 3800,
    rating: 4.4,
    tags: ["snyk", "security", "vulnerabilities"],
    verified: true,
    version: "1.0.0",
  },
  {
    id: "plugin-docker",
    name: "Docker Manager",
    description:
      "Build, manage, and deploy Docker containers. Dockerfile generation and multi-stage build optimization.",
    category: "DevOps",
    icon: <Layers className="h-5 w-5" />,
    installed: false,
    installs: 4200,
    rating: 4.3,
    tags: ["docker", "containers", "devops"],
    verified: true,
    version: "1.0.0",
  },
  {
    id: "plugin-auth0",
    name: "Auth0 Identity",
    description:
      "Auth0 integration for authentication flows, user management, and SSO configuration.",
    category: "Security",
    icon: <Lock className="h-5 w-5" />,
    installed: false,
    installs: 2900,
    rating: 4.2,
    tags: ["auth0", "authentication", "sso"],
    verified: true,
    version: "1.0.0",
  },
];

const CATEGORIES: PluginCategory[] = [
  "All",
  "Integrations",
  "DevOps",
  "Tools",
  "Analytics",
  "Security",
];

// ---------------------------------------------------------------------------
// Skill packs
// ---------------------------------------------------------------------------

interface SkillPackData {
  description: string;
  icon: ReactNode;
  id: string;
  name: string;
  patternCount: number;
  tags: string[];
}

const SKILL_PACKS: SkillPackData[] = [
  {
    id: "skill-pack-ecommerce",
    name: "E-commerce",
    description:
      "Stripe integration, cart logic, checkout flow, inventory management, and order lifecycle.",
    icon: <Code2 className="h-5 w-5" />,
    patternCount: 5,
    tags: ["payments", "cart", "checkout", "stripe"],
  },
  {
    id: "skill-pack-auth",
    name: "Authentication & Authorization",
    description:
      "OAuth 2.0 patterns, JWT handling, session management, RBAC, and multi-factor authentication.",
    icon: <Lock className="h-5 w-5" />,
    patternCount: 5,
    tags: ["oauth", "jwt", "rbac", "mfa"],
  },
  {
    id: "skill-pack-real-time",
    name: "Real-time & Collaboration",
    description:
      "WebSocket patterns, event streaming, presence tracking, live notifications, and collaborative editing.",
    icon: <Zap className="h-5 w-5" />,
    patternCount: 5,
    tags: ["websocket", "streaming", "presence"],
  },
  {
    id: "skill-pack-data-pipeline",
    name: "Data Pipeline",
    description:
      "ETL patterns, job scheduling, data quality monitoring, pipeline orchestration, and observability.",
    icon: <Layers className="h-5 w-5" />,
    patternCount: 5,
    tags: ["etl", "scheduling", "batch-jobs"],
  },
  {
    id: "skill-pack-mobile",
    name: "Mobile & Responsive",
    description:
      "Responsive design, offline-first architecture, push notifications, gestures, and PWA patterns.",
    icon: <Code2 className="h-5 w-5" />,
    patternCount: 5,
    tags: ["mobile", "responsive", "pwa"],
  },
  {
    id: "skill-pack-saas",
    name: "SaaS Platform",
    description:
      "Multi-tenancy, subscription billing, onboarding flows, usage metering, and team management.",
    icon: <Cloud className="h-5 w-5" />,
    patternCount: 5,
    tags: ["multi-tenant", "billing", "onboarding"],
  },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StarRating({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-1">
      <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
      {rating.toFixed(1)}
    </span>
  );
}

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
          p.description.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q))
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
          Extend Prometheus with integrations, tools, and domain skill packs.
        </p>
      </div>

      <Tabs defaultValue="plugins">
        <TabsList>
          <TabsTrigger value="plugins">Plugins</TabsTrigger>
          <TabsTrigger value="skill-packs">Skill Packs</TabsTrigger>
        </TabsList>

        {/* ---- Plugins tab ---- */}
        <TabsContent className="space-y-6" value="plugins">
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

            <div className="flex flex-wrap gap-2">
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
              <Card className="flex flex-col" key={plugin.id}>
                <CardHeader className="flex flex-row items-start gap-3 space-y-0 pb-2">
                  <div className="rounded-md border p-2">{plugin.icon}</div>
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold leading-none">
                        {plugin.name}
                      </h3>
                      {plugin.installed && (
                        <Badge variant="secondary">
                          <Check className="mr-1 h-3 w-3" />
                          Installed
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{plugin.category}</Badge>
                      {plugin.verified && (
                        <Badge
                          className="border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-400"
                          variant="outline"
                        >
                          Verified
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="flex flex-1 flex-col space-y-3">
                  <p className="text-muted-foreground text-sm">
                    {plugin.description}
                  </p>

                  {/* Tags */}
                  <div className="flex flex-wrap gap-1">
                    {plugin.tags.slice(0, 3).map((tag) => (
                      <Badge
                        className="text-[10px]"
                        key={tag}
                        variant="secondary"
                      >
                        {tag}
                      </Badge>
                    ))}
                  </div>

                  <div className="flex items-center gap-4 text-muted-foreground text-xs">
                    <span className="flex items-center gap-1">
                      <Download className="h-3 w-3" />
                      {plugin.installs.toLocaleString()}
                    </span>
                    <StarRating rating={plugin.rating} />
                    <span className="text-muted-foreground/60">
                      v{plugin.version}
                    </span>
                  </div>

                  <div className="mt-auto pt-1">
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
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {filteredPlugins.length === 0 && (
            <div className="py-12 text-center text-muted-foreground">
              No plugins found matching your search.
            </div>
          )}
        </TabsContent>

        {/* ---- Skill Packs tab ---- */}
        <TabsContent className="space-y-6" value="skill-packs">
          <p className="text-muted-foreground text-sm">
            Domain skill packs provide your AI agents with specialized knowledge
            and patterns for common application domains.
          </p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SKILL_PACKS.map((pack) => (
              <Card className="flex flex-col" key={pack.id}>
                <CardHeader className="flex flex-row items-start gap-3 space-y-0 pb-2">
                  <div className="rounded-md border p-2">{pack.icon}</div>
                  <div className="flex-1 space-y-1">
                    <h3 className="font-semibold leading-none">{pack.name}</h3>
                    <Badge variant="outline">
                      {pack.patternCount} patterns
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="flex flex-1 flex-col space-y-3">
                  <p className="text-muted-foreground text-sm">
                    {pack.description}
                  </p>

                  <div className="flex flex-wrap gap-1">
                    {pack.tags.map((tag) => (
                      <Badge
                        className="text-[10px]"
                        key={tag}
                        variant="secondary"
                      >
                        {tag}
                      </Badge>
                    ))}
                  </div>

                  <Separator />

                  <div className="mt-auto">
                    <Button className="w-full" size="sm" variant="outline">
                      Enable Skill Pack
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};
