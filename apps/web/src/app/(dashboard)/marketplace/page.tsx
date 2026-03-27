"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@prometheus/ui";
import {
  Bot,
  Code,
  Download,
  FileCode,
  Loader2,
  Puzzle,
  Search,
  Star,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type Category = "all" | "agents" | "templates" | "tools" | "integrations";

interface MarketplaceItem {
  author: string;
  category: Category;
  description: string;
  featured: boolean;
  icon: string;
  id: string;
  installs: number;
  name: string;
  rating: number;
  ratingCount: number;
  tags: string[];
}

const MOCK_ITEMS: MarketplaceItem[] = [
  {
    id: "mkt-001",
    name: "Code Reviewer Agent",
    description:
      "Automated code review agent that checks for security vulnerabilities, performance issues, and best practices.",
    author: "Prometheus Team",
    category: "agents",
    rating: 4.8,
    ratingCount: 342,
    installs: 12_480,
    tags: ["code-review", "security", "best-practices"],
    icon: "CR",
    featured: true,
  },
  {
    id: "mkt-002",
    name: "Next.js SaaS Starter",
    description:
      "Full-stack SaaS template with auth, billing, dashboard, and API routes. Built with Next.js 15, tRPC, and Drizzle.",
    author: "SaaS Templates",
    category: "templates",
    rating: 4.9,
    ratingCount: 567,
    installs: 28_900,
    tags: ["nextjs", "saas", "starter", "typescript"],
    icon: "NS",
    featured: true,
  },
  {
    id: "mkt-003",
    name: "Database Migration Tool",
    description:
      "Analyze existing database schema and generate type-safe migration scripts with zero downtime strategies.",
    author: "DataOps Labs",
    category: "tools",
    rating: 4.6,
    ratingCount: 189,
    installs: 8750,
    tags: ["database", "migration", "postgresql"],
    icon: "DM",
    featured: false,
  },
  {
    id: "mkt-004",
    name: "Slack Notifications",
    description:
      "Send rich Slack notifications for deployments, PR reviews, and task completions with customizable templates.",
    author: "Prometheus Team",
    category: "integrations",
    rating: 4.7,
    ratingCount: 412,
    installs: 15_600,
    tags: ["slack", "notifications", "webhooks"],
    icon: "SN",
    featured: true,
  },
  {
    id: "mkt-005",
    name: "Test Generator Agent",
    description:
      "AI agent that analyzes your code and generates comprehensive unit, integration, and E2E tests.",
    author: "QA Automation Co",
    category: "agents",
    rating: 4.5,
    ratingCount: 278,
    installs: 11_200,
    tags: ["testing", "automation", "vitest", "playwright"],
    icon: "TG",
    featured: false,
  },
  {
    id: "mkt-006",
    name: "API Documentation Generator",
    description:
      "Automatically generate OpenAPI specs and interactive documentation from your TypeScript code.",
    author: "DocGen Inc",
    category: "tools",
    rating: 4.4,
    ratingCount: 156,
    installs: 6800,
    tags: ["api", "documentation", "openapi"],
    icon: "AD",
    featured: false,
  },
  {
    id: "mkt-007",
    name: "React Component Library",
    description:
      "Collection of 50+ production-ready React components with dark mode, accessibility, and full TypeScript support.",
    author: "UI Forge",
    category: "templates",
    rating: 4.7,
    ratingCount: 823,
    installs: 34_200,
    tags: ["react", "components", "ui", "accessible"],
    icon: "RC",
    featured: true,
  },
  {
    id: "mkt-008",
    name: "GitHub Actions Integration",
    description:
      "Bi-directional integration with GitHub Actions for CI/CD pipeline monitoring and control.",
    author: "Prometheus Team",
    category: "integrations",
    rating: 4.6,
    ratingCount: 298,
    installs: 13_400,
    tags: ["github", "ci-cd", "actions"],
    icon: "GA",
    featured: false,
  },
  {
    id: "mkt-009",
    name: "Dependency Updater Agent",
    description:
      "Keeps your dependencies up-to-date by automatically creating PRs for safe updates with changelog summaries.",
    author: "Prometheus Team",
    category: "agents",
    rating: 4.3,
    ratingCount: 167,
    installs: 7400,
    tags: ["dependencies", "automation", "security"],
    icon: "DU",
    featured: false,
  },
  {
    id: "mkt-010",
    name: "Linear Issue Sync",
    description:
      "Synchronize issues between Linear and Prometheus with bi-directional status updates and comments.",
    author: "Workflow Tools",
    category: "integrations",
    rating: 4.5,
    ratingCount: 134,
    installs: 5200,
    tags: ["linear", "issues", "sync"],
    icon: "LI",
    featured: false,
  },
  {
    id: "mkt-011",
    name: "Performance Profiler",
    description:
      "Analyze runtime performance of your application and suggest optimizations with before/after benchmarks.",
    author: "Perf Labs",
    category: "tools",
    rating: 4.2,
    ratingCount: 98,
    installs: 3800,
    tags: ["performance", "profiling", "optimization"],
    icon: "PP",
    featured: false,
  },
  {
    id: "mkt-012",
    name: "Django REST Template",
    description:
      "Production-ready Django REST framework template with JWT auth, permissions, and OpenAPI documentation.",
    author: "Python Templates",
    category: "templates",
    rating: 4.4,
    ratingCount: 245,
    installs: 9100,
    tags: ["django", "python", "rest-api"],
    icon: "DR",
    featured: false,
  },
];

const CATEGORY_ICONS: Record<string, typeof Bot> = {
  agents: Bot,
  templates: FileCode,
  tools: Zap,
  integrations: Puzzle,
};

function _renderStars(rating: number): string {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  return (
    "\u2605".repeat(full) + (half ? "\u00BD" : "") + "\u2606".repeat(empty)
  );
}

function formatInstalls(n: number): string {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`;
  }
  return String(n);
}

export default function MarketplaceBrowsePage() {
  const [items] = useState<MarketplaceItem[]>(MOCK_ITEMS);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const [installingId, setInstallingId] = useState<string | null>(null);

  const filteredItems = items.filter((item) => {
    if (category !== "all" && item.category !== category) {
      return false;
    }
    if (
      search &&
      !item.name.toLowerCase().includes(search.toLowerCase()) &&
      !item.description.toLowerCase().includes(search.toLowerCase()) &&
      !item.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))
    ) {
      return false;
    }
    return true;
  });

  function handleInstall(itemId: string) {
    setInstallingId(itemId);
    const item = items.find((i) => i.id === itemId);
    setTimeout(() => {
      setInstallingId(null);
      toast.success(`${item?.name ?? "Item"} installed successfully`);
    }, 1000);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl text-foreground">Marketplace</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Discover agents, templates, tools, and integrations for your
          workspace.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search marketplace..."
            value={search}
          />
        </div>
      </div>

      <Tabs onValueChange={(v) => setCategory(v as Category)} value={category}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="agents">
            <Bot className="mr-1.5 h-3.5 w-3.5" />
            Agents
          </TabsTrigger>
          <TabsTrigger value="templates">
            <FileCode className="mr-1.5 h-3.5 w-3.5" />
            Templates
          </TabsTrigger>
          <TabsTrigger value="tools">
            <Zap className="mr-1.5 h-3.5 w-3.5" />
            Tools
          </TabsTrigger>
          <TabsTrigger value="integrations">
            <Puzzle className="mr-1.5 h-3.5 w-3.5" />
            Integrations
          </TabsTrigger>
        </TabsList>

        <TabsContent className="pt-4" value={category}>
          {filteredItems.length === 0 && (
            <Card className="border-dashed">
              <CardContent className="p-12 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <Search className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="mt-4 text-muted-foreground text-sm">
                  No items found matching your search.
                </p>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredItems.map((item) => {
              const CategoryIcon = CATEGORY_ICONS[item.category] ?? Code;
              const isInstalling = installingId === item.id;

              return (
                <Card
                  className="flex flex-col transition-colors hover:border-muted-foreground/30"
                  key={item.id}
                >
                  <CardContent className="flex flex-1 flex-col pt-6">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 font-semibold text-primary text-sm">
                        {item.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-semibold text-foreground text-sm">
                            {item.name}
                          </p>
                          {item.featured && (
                            <Badge
                              className="shrink-0 text-xs"
                              variant="default"
                            >
                              Featured
                            </Badge>
                          )}
                        </div>
                        <p className="text-muted-foreground text-xs">
                          by {item.author}
                        </p>
                      </div>
                    </div>

                    <p className="mt-3 flex-1 text-muted-foreground text-sm leading-relaxed">
                      {item.description}
                    </p>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <Badge className="text-xs capitalize" variant="outline">
                        <CategoryIcon className="mr-1 h-3 w-3" />
                        {item.category}
                      </Badge>
                      {item.tags.slice(0, 2).map((tag) => (
                        <Badge
                          className="text-xs"
                          key={tag}
                          variant="secondary"
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t pt-4">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1">
                          <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
                          <span className="font-medium text-sm">
                            {item.rating}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            ({item.ratingCount})
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Download className="h-3.5 w-3.5" />
                          <span className="text-xs">
                            {formatInstalls(item.installs)}
                          </span>
                        </div>
                      </div>
                      <Button
                        disabled={isInstalling}
                        onClick={() => handleInstall(item.id)}
                        size="sm"
                        variant="outline"
                      >
                        {isInstalling ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          "Install"
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
