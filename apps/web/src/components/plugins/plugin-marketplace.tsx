"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@prometheus/ui";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Bug,
  Check,
  Cloud,
  Code2,
  Download,
  Eye,
  GitBranch,
  Image,
  Layers,
  Lock,
  MessageSquare,
  Palette,
  Plus,
  Search,
  Settings,
  Shield,
  Star,
  Trash2,
  Zap,
} from "lucide-react";
import { type FC, type ReactNode, useCallback, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PluginCategory =
  | "All"
  | "AI Tools"
  | "Code Quality"
  | "Integrations"
  | "Security"
  | "Workflow";

type PriceFilter = "all" | "free" | "paid";

interface PluginReview {
  author: string;
  content: string;
  date: string;
  id: string;
  rating: number;
}

interface PluginChangelog {
  changes: string[];
  date: string;
  version: string;
}

interface PluginData {
  author: string;
  category: PluginCategory;
  changelog: PluginChangelog[];
  description: string;
  fullDescription: string;
  icon: ReactNode;
  id: string;
  installed: boolean;
  installs: number;
  name: string;
  price: "free" | "paid";
  rating: number;
  reviews: PluginReview[];
  screenshots: string[];
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
    author: "Prometheus Team",
    description:
      "Connect repos, sync PRs, automate issue triage with AI agents.",
    fullDescription:
      "Full GitHub integration for Prometheus. Connect your repositories, sync pull requests, automate issue triage with AI agents, and trigger CI/CD workflows directly from the platform. Supports GitHub Actions, branch protection rules, and code review assignments.",
    category: "Integrations",
    icon: <GitBranch className="h-5 w-5" />,
    installed: true,
    installs: 14_200,
    rating: 4.8,
    price: "free",
    tags: ["github", "git", "vcs", "ci-cd"],
    verified: true,
    version: "2.1.0",
    screenshots: [
      "/screenshots/github-repos.png",
      "/screenshots/github-pr.png",
    ],
    reviews: [
      {
        id: "r1",
        author: "devuser42",
        rating: 5,
        content: "Seamless PR integration. Best GitHub plugin I have used.",
        date: "2026-03-10",
      },
    ],
    changelog: [
      {
        version: "2.1.0",
        date: "2026-03-01",
        changes: ["Added branch protection support", "Improved PR sync speed"],
      },
    ],
  },
  {
    id: "plugin-slack",
    name: "Slack Notifications",
    author: "Prometheus Team",
    description:
      "Real-time task updates, agent alerts, and team collaboration in Slack.",
    fullDescription:
      "Get real-time notifications for task completions, agent alerts, and deployment events directly in Slack. Supports slash commands for creating tasks, thread replies for context, and channel-specific routing rules.",
    category: "Integrations",
    icon: <MessageSquare className="h-5 w-5" />,
    installed: true,
    installs: 11_500,
    rating: 4.6,
    price: "free",
    tags: ["slack", "messaging", "notifications"],
    verified: true,
    version: "1.5.0",
    screenshots: [],
    reviews: [],
    changelog: [
      {
        version: "1.5.0",
        date: "2026-02-15",
        changes: ["Added slash commands", "Thread reply support"],
      },
    ],
  },
  {
    id: "plugin-copilot-enhance",
    name: "AI Code Enhancer",
    author: "CodeSmith Labs",
    description:
      "Advanced AI-powered code suggestions with context-aware refactoring.",
    fullDescription:
      "Enhance your AI agent capabilities with advanced code suggestions, context-aware refactoring, and intelligent code completion. Integrates with your project's coding standards and provides framework-specific recommendations.",
    category: "AI Tools",
    icon: <Zap className="h-5 w-5" />,
    installed: false,
    installs: 8900,
    rating: 4.7,
    price: "free",
    tags: ["ai", "code-completion", "refactoring"],
    verified: true,
    version: "1.2.0",
    screenshots: [],
    reviews: [],
    changelog: [],
  },
  {
    id: "plugin-sonarqube",
    name: "SonarQube Analysis",
    author: "QualityFirst Inc",
    description:
      "Continuous code quality inspection with deep static analysis.",
    fullDescription:
      "Integrate SonarQube code quality analysis into your Prometheus workflow. Automatically scan code for bugs, vulnerabilities, and code smells. View quality gate results directly in your dashboard.",
    category: "Code Quality",
    icon: <Bug className="h-5 w-5" />,
    installed: false,
    installs: 6200,
    rating: 4.4,
    price: "free",
    tags: ["sonarqube", "static-analysis", "quality"],
    verified: true,
    version: "1.1.0",
    screenshots: [],
    reviews: [],
    changelog: [],
  },
  {
    id: "plugin-snyk",
    name: "Snyk Security",
    author: "Snyk Partner",
    description:
      "Automated dependency vulnerability scanning and security fix suggestions.",
    fullDescription:
      "Automated dependency vulnerability scanning and security fix suggestions. SBOM generation, license compliance checks, and container image scanning. Get remediation pull requests automatically created by AI agents.",
    category: "Security",
    icon: <Shield className="h-5 w-5" />,
    installed: false,
    installs: 3800,
    rating: 4.4,
    price: "paid",
    tags: ["snyk", "security", "vulnerabilities", "sbom"],
    verified: true,
    version: "1.0.0",
    screenshots: [],
    reviews: [],
    changelog: [],
  },
  {
    id: "plugin-jira",
    name: "Jira Sync",
    author: "Prometheus Team",
    description:
      "Bi-directional sync between Prometheus tasks and Jira issues.",
    fullDescription:
      "Bi-directional sync between Prometheus tasks and Jira issues. Sprint management, workflow automation, and custom field mapping. Supports Jira Cloud and Jira Data Center.",
    category: "Integrations",
    icon: <Bug className="h-5 w-5" />,
    installed: false,
    installs: 7800,
    rating: 4.4,
    price: "free",
    tags: ["jira", "issues", "agile"],
    verified: true,
    version: "1.3.0",
    screenshots: [],
    reviews: [],
    changelog: [],
  },
  {
    id: "plugin-linear",
    name: "Linear Sync",
    author: "Prometheus Team",
    description: "Keep Linear issues in sync with Prometheus project tasks.",
    fullDescription:
      "Keep Linear issues in sync with Prometheus project tasks. Cycle management, label sync, and automated status transitions. Two-way synchronization ensures both platforms stay in sync.",
    category: "Integrations",
    icon: <BarChart3 className="h-5 w-5" />,
    installed: false,
    installs: 9100,
    rating: 4.7,
    price: "free",
    tags: ["linear", "issues", "tracking"],
    verified: true,
    version: "1.4.0",
    screenshots: [],
    reviews: [],
    changelog: [],
  },
  {
    id: "plugin-figma",
    name: "Figma Import",
    author: "DesignBridge",
    description:
      "Import Figma designs and generate React components automatically.",
    fullDescription:
      "Import Figma designs and generate React components automatically. Design-to-code pipeline with support for design tokens, responsive layouts, and component variants.",
    category: "AI Tools",
    icon: <Palette className="h-5 w-5" />,
    installed: true,
    installs: 5300,
    rating: 4.5,
    price: "paid",
    tags: ["figma", "design", "ui"],
    verified: true,
    version: "1.1.0",
    screenshots: [],
    reviews: [],
    changelog: [],
  },
  {
    id: "plugin-vercel",
    name: "Vercel Deploy",
    author: "Prometheus Team",
    description: "One-click preview deployments and production releases.",
    fullDescription:
      "One-click preview deployments and production releases. Environment management, build monitoring, and automatic rollback on failure. Supports Vercel Edge Functions and serverless configuration.",
    category: "Workflow",
    icon: <Cloud className="h-5 w-5" />,
    installed: false,
    installs: 10_300,
    rating: 4.9,
    price: "free",
    tags: ["vercel", "deployment", "preview"],
    verified: true,
    version: "1.2.0",
    screenshots: [],
    reviews: [],
    changelog: [],
  },
  {
    id: "plugin-eslint-ai",
    name: "AI Lint Rules",
    author: "LintMaster",
    description:
      "AI-generated custom lint rules based on your codebase patterns.",
    fullDescription:
      "Automatically generate custom lint rules based on your codebase patterns and team conventions. Uses AI to detect anti-patterns and suggest project-specific rules that enforce your coding standards.",
    category: "Code Quality",
    icon: <Code2 className="h-5 w-5" />,
    installed: false,
    installs: 2400,
    rating: 4.1,
    price: "free",
    tags: ["linting", "code-quality", "ai"],
    verified: false,
    version: "0.9.0",
    screenshots: [],
    reviews: [],
    changelog: [],
  },
  {
    id: "plugin-approval-flow",
    name: "Approval Workflows",
    author: "FlowCraft",
    description:
      "Multi-stage approval workflows for deployments and code changes.",
    fullDescription:
      "Create multi-stage approval workflows for deployments, code changes, and configuration updates. Define approval chains, set required reviewers, and track approval status with audit trails.",
    category: "Workflow",
    icon: <Layers className="h-5 w-5" />,
    installed: false,
    installs: 3100,
    rating: 4.3,
    price: "paid",
    tags: ["approvals", "workflow", "governance"],
    verified: true,
    version: "1.0.0",
    screenshots: [],
    reviews: [],
    changelog: [],
  },
  {
    id: "plugin-vault",
    name: "Vault Secrets",
    author: "SecureOps",
    description: "HashiCorp Vault integration for secure secrets management.",
    fullDescription:
      "Integrate HashiCorp Vault for enterprise-grade secrets management. Dynamic secrets, encryption as a service, and PKI certificate management. Supports multiple auth methods and secret engines.",
    category: "Security",
    icon: <Lock className="h-5 w-5" />,
    installed: false,
    installs: 1800,
    rating: 4.6,
    price: "paid",
    tags: ["vault", "secrets", "encryption"],
    verified: true,
    version: "1.0.0",
    screenshots: [],
    reviews: [],
    changelog: [],
  },
];

const CATEGORIES: PluginCategory[] = [
  "All",
  "AI Tools",
  "Integrations",
  "Workflow",
  "Code Quality",
  "Security",
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

function _StarRatingInteractive({
  rating,
  onRate,
}: {
  rating: number;
  onRate: (r: number) => void;
}) {
  return (
    <span className="flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, i) => {
        const starKey = `star-${i.toString()}`;
        return (
          <button
            aria-label={`Rate ${i + 1} stars`}
            key={starKey}
            onClick={() => onRate(i + 1)}
            type="button"
          >
            <Star
              className={`h-4 w-4 cursor-pointer ${
                i < rating
                  ? "fill-yellow-400 text-yellow-400"
                  : "text-muted-foreground"
              }`}
            />
          </button>
        );
      })}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Plugin Detail View
// ---------------------------------------------------------------------------

function PluginDetail({
  plugin,
  onBack,
  onToggleInstall,
}: {
  plugin: PluginData;
  onBack: () => void;
  onToggleInstall: (id: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<string>("overview");

  return (
    <div className="space-y-6">
      {/* Back navigation */}
      <Button onClick={onBack} size="sm" variant="ghost">
        <ArrowLeft className="mr-1 h-4 w-4" />
        Back to Marketplace
      </Button>

      {/* Plugin header */}
      <div className="flex items-start gap-4">
        <div className="rounded-lg border p-3">{plugin.icon}</div>
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="font-bold text-2xl">{plugin.name}</h2>
            {plugin.verified && (
              <Badge
                className="border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-400"
                variant="outline"
              >
                Verified
              </Badge>
            )}
            {plugin.price === "paid" && (
              <Badge variant="secondary">Premium</Badge>
            )}
          </div>
          <p className="text-muted-foreground text-sm">
            By {plugin.author} | v{plugin.version}
          </p>
          <div className="flex items-center gap-4 text-sm">
            <span className="flex items-center gap-1">
              <Download className="h-3 w-3" />
              {plugin.installs.toLocaleString()} installs
            </span>
            <StarRating rating={plugin.rating} />
            <Badge variant="outline">{plugin.category}</Badge>
          </div>
        </div>
        <div className="flex gap-2">
          {plugin.installed && (
            <Button size="sm" variant="outline">
              <Settings className="mr-1 h-4 w-4" />
              Settings
            </Button>
          )}
          <Button
            onClick={() => onToggleInstall(plugin.id)}
            variant={plugin.installed ? "destructive" : "default"}
          >
            {plugin.installed ? (
              <>
                <Trash2 className="mr-1 h-4 w-4" /> Uninstall
              </>
            ) : (
              <>
                <Download className="mr-1 h-4 w-4" /> Install
              </>
            )}
          </Button>
        </div>
      </div>

      <Separator />

      {/* Tabbed content */}
      <Tabs onValueChange={setActiveTab} value={activeTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="screenshots">Screenshots</TabsTrigger>
          <TabsTrigger value="reviews">
            Reviews ({plugin.reviews.length})
          </TabsTrigger>
          <TabsTrigger value="changelog">Changelog</TabsTrigger>
        </TabsList>

        <TabsContent className="space-y-4 pt-4" value="overview">
          <div className="prose dark:prose-invert max-w-none">
            <p>{plugin.fullDescription}</p>
          </div>
          <div className="flex flex-wrap gap-1">
            {plugin.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        </TabsContent>

        <TabsContent className="space-y-4 pt-4" value="screenshots">
          {plugin.screenshots.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {plugin.screenshots.map((src) => (
                <div
                  className="flex aspect-video items-center justify-center rounded-lg border bg-muted"
                  key={src}
                >
                  <Image className="h-8 w-8 text-muted-foreground" />
                  <span className="ml-2 text-muted-foreground text-sm">
                    {src}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-8 text-center text-muted-foreground">
              No screenshots available.
            </p>
          )}
        </TabsContent>

        <TabsContent className="space-y-4 pt-4" value="reviews">
          {plugin.reviews.length > 0 ? (
            plugin.reviews.map((review) => (
              <Card key={review.id}>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{review.author}</span>
                    <div className="flex items-center gap-2">
                      <StarRating rating={review.rating} />
                      <span className="text-muted-foreground text-xs">
                        {review.date}
                      </span>
                    </div>
                  </div>
                  <p className="mt-2 text-sm">{review.content}</p>
                </CardContent>
              </Card>
            ))
          ) : (
            <p className="py-8 text-center text-muted-foreground">
              No reviews yet. Be the first to review this plugin.
            </p>
          )}
        </TabsContent>

        <TabsContent className="space-y-4 pt-4" value="changelog">
          {plugin.changelog.length > 0 ? (
            plugin.changelog.map((entry) => (
              <div className="space-y-1" key={entry.version}>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">v{entry.version}</Badge>
                  <span className="text-muted-foreground text-xs">
                    {entry.date}
                  </span>
                </div>
                <ul className="list-inside list-disc text-sm">
                  {entry.changes.map((change) => (
                    <li key={change}>{change}</li>
                  ))}
                </ul>
              </div>
            ))
          ) : (
            <p className="py-8 text-center text-muted-foreground">
              No changelog entries available.
            </p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plugin Settings Panel
// ---------------------------------------------------------------------------

function PluginSettingsPanel({
  plugin,
  onClose,
}: {
  plugin: PluginData;
  onClose: () => void;
}) {
  return (
    <Dialog onOpenChange={onClose} open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{plugin.name} Settings</DialogTitle>
          <DialogDescription>
            Configure the {plugin.name} plugin for your workspace.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="font-medium text-sm" htmlFor="plugin-api-key">
              API Key
            </label>
            <Input id="plugin-api-key" placeholder="Enter API key..." />
          </div>
          <div className="space-y-2">
            <label className="font-medium text-sm" htmlFor="plugin-webhook-url">
              Webhook URL
            </label>
            <Input id="plugin-webhook-url" placeholder="https://..." />
          </div>
          <div className="space-y-2">
            <label className="font-medium text-sm" htmlFor="plugin-notes">
              Notes
            </label>
            <Textarea
              id="plugin-notes"
              placeholder="Add configuration notes..."
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button onClick={onClose}>Save Settings</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Uninstall Confirmation Dialog
// ---------------------------------------------------------------------------

function UninstallConfirmDialog({
  plugin,
  onConfirm,
  onCancel,
}: {
  plugin: PluginData;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog onOpenChange={onCancel} open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Uninstall {plugin.name}?
          </DialogTitle>
          <DialogDescription>
            This will remove the plugin and all its configuration from your
            workspace. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onCancel} variant="outline">
            Cancel
          </Button>
          <Button onClick={onConfirm} variant="destructive">
            Uninstall
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export const PluginMarketplaceV2: FC = () => {
  const [plugins, setPlugins] = useState<PluginData[]>(INITIAL_PLUGINS);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<PluginCategory>("All");
  const [priceFilter, setPriceFilter] = useState<PriceFilter>("all");
  const [ratingFilter, setRatingFilter] = useState<string>("any");
  const [selectedPlugin, setSelectedPlugin] = useState<PluginData | null>(null);
  const [settingsPlugin, setSettingsPlugin] = useState<PluginData | null>(null);
  const [uninstallTarget, setUninstallTarget] = useState<PluginData | null>(
    null
  );

  const filteredPlugins = useMemo(() => {
    let list = plugins;

    if (activeCategory !== "All") {
      list = list.filter((p) => p.category === activeCategory);
    }

    if (priceFilter !== "all") {
      list = list.filter((p) => p.price === priceFilter);
    }

    if (ratingFilter !== "any") {
      const minRating = Number.parseFloat(ratingFilter);
      list = list.filter((p) => p.rating >= minRating);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.author.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q))
      );
    }

    return list;
  }, [plugins, searchQuery, activeCategory, priceFilter, ratingFilter]);

  const handleToggleInstall = useCallback(
    (pluginId: string) => {
      const plugin = plugins.find((p) => p.id === pluginId);
      if (!plugin) {
        return;
      }

      if (plugin.installed) {
        setUninstallTarget(plugin);
        return;
      }

      setPlugins((prev) =>
        prev.map((p) =>
          p.id === pluginId
            ? { ...p, installed: true, installs: p.installs + 1 }
            : p
        )
      );
    },
    [plugins]
  );

  const confirmUninstall = useCallback(() => {
    if (!uninstallTarget) {
      return;
    }
    setPlugins((prev) =>
      prev.map((p) =>
        p.id === uninstallTarget.id
          ? { ...p, installed: false, installs: p.installs - 1 }
          : p
      )
    );
    // If we are viewing the detail of the uninstalled plugin, update it
    if (selectedPlugin?.id === uninstallTarget.id) {
      setSelectedPlugin((prev) =>
        prev ? { ...prev, installed: false, installs: prev.installs - 1 } : null
      );
    }
    setUninstallTarget(null);
  }, [uninstallTarget, selectedPlugin]);

  // ── Detail view ──────────────────────────────────────────────────────────
  if (selectedPlugin) {
    // Keep detail in sync with plugin state
    const current = plugins.find((p) => p.id === selectedPlugin.id);
    return (
      <div>
        <PluginDetail
          onBack={() => setSelectedPlugin(null)}
          onToggleInstall={handleToggleInstall}
          plugin={current ?? selectedPlugin}
        />
        {settingsPlugin && (
          <PluginSettingsPanel
            onClose={() => setSettingsPlugin(null)}
            plugin={settingsPlugin}
          />
        )}
        {uninstallTarget && (
          <UninstallConfirmDialog
            onCancel={() => setUninstallTarget(null)}
            onConfirm={confirmUninstall}
            plugin={uninstallTarget}
          />
        )}
      </div>
    );
  }

  // ── Marketplace list view ────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-2xl tracking-tight">
            Plugin Marketplace
          </h2>
          <p className="text-muted-foreground">
            Extend Prometheus with integrations, tools, and AI-powered plugins.
          </p>
        </div>
        <Button asChild variant="outline">
          <a href="/plugins/create">
            <Plus className="mr-1 h-4 w-4" />
            Create Plugin
          </a>
        </Button>
      </div>

      {/* Search and filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search plugins by name, description, or tag..."
            value={searchQuery}
          />
        </div>

        <Select
          onValueChange={(v) => setPriceFilter(v as PriceFilter)}
          value={priceFilter}
        >
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="Price" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Prices</SelectItem>
            <SelectItem value="free">Free</SelectItem>
            <SelectItem value="paid">Premium</SelectItem>
          </SelectContent>
        </Select>

        <Select onValueChange={setRatingFilter} value={ratingFilter}>
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="Rating" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any Rating</SelectItem>
            <SelectItem value="4.5">4.5+</SelectItem>
            <SelectItem value="4.0">4.0+</SelectItem>
            <SelectItem value="3.0">3.0+</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Category pills */}
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

      {/* Plugin grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filteredPlugins.map((plugin) => (
          <Card className="flex flex-col" key={plugin.id}>
            <CardHeader className="flex flex-row items-start gap-3 space-y-0 pb-2">
              <div className="rounded-md border p-2">{plugin.icon}</div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold leading-none">{plugin.name}</h3>
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
                  {plugin.price === "paid" && (
                    <Badge variant="secondary">Premium</Badge>
                  )}
                </div>
              </div>
            </CardHeader>

            <CardContent className="flex flex-1 flex-col space-y-3">
              <p className="text-muted-foreground text-sm">
                {plugin.description}
              </p>

              <p className="text-muted-foreground/70 text-xs">
                By {plugin.author}
              </p>

              <div className="flex flex-wrap gap-1">
                {plugin.tags.slice(0, 3).map((tag) => (
                  <Badge className="text-[10px]" key={tag} variant="secondary">
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

              <div className="mt-auto flex gap-2 pt-1">
                <Button
                  className="flex-1"
                  onClick={() => setSelectedPlugin(plugin)}
                  size="sm"
                  variant="outline"
                >
                  <Eye className="mr-1 h-3 w-3" /> Details
                </Button>
                {plugin.installed ? (
                  <Button
                    className="flex-1"
                    onClick={() => setSettingsPlugin(plugin)}
                    size="sm"
                    variant="outline"
                  >
                    <Settings className="mr-1 h-3 w-3" /> Settings
                  </Button>
                ) : (
                  <Button
                    className="flex-1"
                    onClick={() => handleToggleInstall(plugin.id)}
                    size="sm"
                  >
                    <Download className="mr-1 h-3 w-3" /> Install
                  </Button>
                )}
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

      {/* Settings dialog */}
      {settingsPlugin && (
        <PluginSettingsPanel
          onClose={() => setSettingsPlugin(null)}
          plugin={settingsPlugin}
        />
      )}

      {/* Uninstall confirmation */}
      {uninstallTarget && (
        <UninstallConfirmDialog
          onCancel={() => setUninstallTarget(null)}
          onConfirm={confirmUninstall}
          plugin={uninstallTarget}
        />
      )}
    </div>
  );
};
