"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@prometheus/ui";
import {
  ArrowLeft,
  Bot,
  CheckCircle,
  Code,
  Download,
  ExternalLink,
  FileCode,
  Globe,
  Loader2,
  Package,
  Puzzle,
  Star,
  Zap,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { use, useState } from "react";
import { toast } from "sonner";

interface VersionEntry {
  changes: string[];
  date: string;
  version: string;
}

interface Review {
  author: string;
  comment: string;
  date: string;
  id: string;
  rating: number;
}

const MOCK_ITEM = {
  id: "mkt-001",
  name: "Code Reviewer Agent",
  description:
    "Automated code review agent that checks for security vulnerabilities, performance issues, and best practices. Integrates directly with your PR workflow.",
  longDescription: `## Overview

The Code Reviewer Agent automatically analyzes your pull requests and provides detailed feedback on code quality, security, and performance.

### Features

- **Security Analysis**: Detects common vulnerabilities including SQL injection, XSS, CSRF, and insecure dependencies
- **Performance Review**: Identifies N+1 queries, memory leaks, unnecessary re-renders, and bundle size impacts
- **Best Practices**: Checks for code style consistency, proper error handling, and TypeScript best practices
- **Auto-Fix Suggestions**: Provides one-click fixes for common issues directly in your PR

### How It Works

1. Install the agent in your workspace
2. Configure which repositories to monitor
3. The agent automatically reviews new PRs within seconds
4. Review findings appear as inline comments on your PR
5. Accept or dismiss suggestions with a single click

### Configuration

The agent can be customized through a YAML configuration file in your repository root:

\`\`\`yaml
code-reviewer:
  severity: warning
  ignore:
    - "*.test.ts"
    - "*.spec.ts"
  rules:
    security: enabled
    performance: enabled
    style: enabled
\`\`\``,
  author: "Prometheus Team",
  authorUrl: "https://prometheus.dev",
  category: "agents",
  rating: 4.8,
  ratingCount: 342,
  installs: 12_480,
  tags: ["code-review", "security", "best-practices", "automation", "ai"],
  icon: "CR",
  featured: true,
  createdAt: "2025-08-15",
  updatedAt: "2026-03-20",
  license: "MIT",
  repoUrl: "https://github.com/prometheus-platform/code-reviewer-agent",
  requirements: ["Node.js 20+", "GitHub or GitLab integration"],
};

const MOCK_VERSIONS: VersionEntry[] = [
  {
    version: "2.4.0",
    date: "2026-03-20",
    changes: [
      "Added support for Biome linter rules",
      "Improved TypeScript 5.5 pattern detection",
      "Fixed false positive on optional chaining patterns",
      "Performance improvement: 40% faster analysis on large PRs",
    ],
  },
  {
    version: "2.3.2",
    date: "2026-03-05",
    changes: [
      "Fixed edge case with decorators in class methods",
      "Updated security vulnerability database",
    ],
  },
  {
    version: "2.3.1",
    date: "2026-02-18",
    changes: [
      "Hotfix for rate limiting on large monorepos",
      "Improved error messages for configuration issues",
    ],
  },
  {
    version: "2.3.0",
    date: "2026-02-01",
    changes: [
      "New: React Server Components pattern detection",
      "New: Auto-fix suggestions for common security issues",
      "Improved: Better handling of dynamic imports",
      "Fixed: Memory leak in long-running analysis sessions",
    ],
  },
  {
    version: "2.2.0",
    date: "2026-01-10",
    changes: [
      "Added GitLab integration support",
      "New performance rules for database queries",
      "Improved caching for faster subsequent analyses",
    ],
  },
];

const MOCK_REVIEWS: Review[] = [
  {
    id: "rev-001",
    author: "Elena Rodriguez",
    rating: 5,
    comment:
      "Incredible tool. Caught a SQL injection vulnerability in our codebase that we missed during manual review. The auto-fix suggestions are a game changer.",
    date: "2026-03-22",
  },
  {
    id: "rev-002",
    author: "Marcus Chen",
    rating: 5,
    comment:
      "We integrated this across all our repos and it has significantly improved our code quality. The TypeScript-specific rules are particularly useful.",
    date: "2026-03-18",
  },
  {
    id: "rev-003",
    author: "Priya Sharma",
    rating: 4,
    comment:
      "Very good overall. Sometimes gives false positives on complex generic types, but the team is responsive to feedback. The security scanning alone is worth the install.",
    date: "2026-03-10",
  },
  {
    id: "rev-004",
    author: "David Kim",
    rating: 5,
    comment:
      "Fast, accurate, and the inline comments make it easy to address issues. Reduced our review turnaround time by 60%.",
    date: "2026-02-28",
  },
  {
    id: "rev-005",
    author: "Sarah Okafor",
    rating: 4,
    comment:
      "Solid agent. Would love to see more customizable rule severity levels, but the existing configuration options cover most use cases well.",
    date: "2026-02-15",
  },
];

const CATEGORY_ICONS: Record<string, typeof Bot> = {
  agents: Bot,
  templates: FileCode,
  tools: Zap,
  integrations: Puzzle,
};

function renderStars(rating: number): string {
  return Array.from({ length: 5 })
    .map((_, i) => (i < Math.round(rating) ? "\u2605" : "\u2606"))
    .join("");
}

function formatInstalls(n: number): string {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`;
  }
  return String(n);
}

export default function MarketplaceItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: _itemId } = use(params);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [activeTab, setActiveTab] = useState("readme");

  const item = MOCK_ITEM;
  const CategoryIcon = CATEGORY_ICONS[item.category] ?? Code;

  function handleInstall() {
    if (isInstalled) {
      setIsInstalled(false);
      toast.success(`${item.name} uninstalled`);
      return;
    }
    setIsInstalling(true);
    setTimeout(() => {
      setIsInstalling(false);
      setIsInstalled(true);
      toast.success(`${item.name} installed successfully`);
    }, 1200);
  }

  return (
    <div className="space-y-6">
      <Link
        className="inline-flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
        href={"/marketplace" as Route}
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Marketplace
      </Link>

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex-1 space-y-6">
          <div className="flex items-start gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-primary/10 font-bold text-2xl text-primary">
              {item.icon}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h1 className="font-bold text-2xl text-foreground">
                  {item.name}
                </h1>
                {item.featured && <Badge variant="default">Featured</Badge>}
              </div>
              <p className="mt-1 text-muted-foreground">{item.description}</p>
              <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
                <div className="flex items-center gap-1.5">
                  <Star className="h-4 w-4 fill-amber-500 text-amber-500" />
                  <span className="font-medium">{item.rating}</span>
                  <span className="text-muted-foreground">
                    ({item.ratingCount} ratings)
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Download className="h-4 w-4" />
                  {formatInstalls(item.installs)} installs
                </div>
                <Badge className="capitalize" variant="outline">
                  <CategoryIcon className="mr-1 h-3 w-3" />
                  {item.category}
                </Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {item.tags.map((tag) => (
                  <Badge className="text-xs" key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <Button
              disabled={isInstalling}
              onClick={handleInstall}
              variant={isInstalled ? "destructive" : "default"}
            >
              {isInstalling && (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Installing...
                </>
              )}
              {!isInstalling && isInstalled && "Uninstall"}
              {!(isInstalling || isInstalled) && (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Install
                </>
              )}
            </Button>
            {item.repoUrl && (
              <Button
                onClick={() => window.open(item.repoUrl, "_blank")}
                variant="outline"
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Source Code
              </Button>
            )}
          </div>

          <Tabs onValueChange={setActiveTab} value={activeTab}>
            <TabsList>
              <TabsTrigger value="readme">README</TabsTrigger>
              <TabsTrigger value="versions">
                Versions ({MOCK_VERSIONS.length})
              </TabsTrigger>
              <TabsTrigger value="reviews">
                Reviews ({MOCK_REVIEWS.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent className="pt-4" value="readme">
              <Card>
                <CardContent className="prose prose-sm prose-invert max-w-none pt-6">
                  <div className="space-y-4">
                    <h2 className="font-bold text-foreground text-lg">
                      Overview
                    </h2>
                    <p className="text-muted-foreground">
                      The Code Reviewer Agent automatically analyzes your pull
                      requests and provides detailed feedback on code quality,
                      security, and performance.
                    </p>

                    <h3 className="font-semibold text-foreground">Features</h3>
                    <ul className="space-y-2 text-muted-foreground">
                      <li className="flex items-start gap-2">
                        <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                        <span>
                          <strong className="text-foreground">
                            Security Analysis:
                          </strong>{" "}
                          Detects common vulnerabilities including SQL
                          injection, XSS, CSRF, and insecure dependencies
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                        <span>
                          <strong className="text-foreground">
                            Performance Review:
                          </strong>{" "}
                          Identifies N+1 queries, memory leaks, unnecessary
                          re-renders, and bundle size impacts
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                        <span>
                          <strong className="text-foreground">
                            Best Practices:
                          </strong>{" "}
                          Checks for code style consistency, proper error
                          handling, and TypeScript best practices
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                        <span>
                          <strong className="text-foreground">
                            Auto-Fix Suggestions:
                          </strong>{" "}
                          Provides one-click fixes for common issues directly in
                          your PR
                        </span>
                      </li>
                    </ul>

                    <h3 className="font-semibold text-foreground">
                      How It Works
                    </h3>
                    <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                      <li>Install the agent in your workspace</li>
                      <li>Configure which repositories to monitor</li>
                      <li>
                        The agent automatically reviews new PRs within seconds
                      </li>
                      <li>
                        Review findings appear as inline comments on your PR
                      </li>
                      <li>Accept or dismiss suggestions with a single click</li>
                    </ol>

                    <h3 className="font-semibold text-foreground">
                      Configuration
                    </h3>
                    <p className="text-muted-foreground">
                      The agent can be customized through a YAML configuration
                      file in your repository root:
                    </p>
                    <pre className="overflow-x-auto rounded-lg bg-muted p-4 font-mono text-sm">
                      <code>{`code-reviewer:
  severity: warning
  ignore:
    - "*.test.ts"
    - "*.spec.ts"
  rules:
    security: enabled
    performance: enabled
    style: enabled`}</code>
                    </pre>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent className="pt-4" value="versions">
              <Card>
                <CardContent className="pt-6">
                  <div className="space-y-6">
                    {MOCK_VERSIONS.map((version, i) => (
                      <div key={version.version}>
                        <div className="flex items-center gap-3">
                          <Badge
                            className="font-mono"
                            variant={i === 0 ? "default" : "outline"}
                          >
                            v{version.version}
                          </Badge>
                          <span className="text-muted-foreground text-sm">
                            {version.date}
                          </span>
                          {i === 0 && (
                            <Badge className="text-xs" variant="secondary">
                              Latest
                            </Badge>
                          )}
                        </div>
                        <ul className="mt-2 space-y-1">
                          {version.changes.map((change) => (
                            <li
                              className="flex items-start gap-2 text-muted-foreground text-sm"
                              key={change}
                            >
                              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
                              {change}
                            </li>
                          ))}
                        </ul>
                        {i < MOCK_VERSIONS.length - 1 && (
                          <Separator className="mt-4" />
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent className="pt-4" value="reviews">
              <div className="space-y-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-6">
                      <div className="text-center">
                        <p className="font-bold text-4xl text-foreground">
                          {item.rating}
                        </p>
                        <div className="mt-1 text-amber-500">
                          {renderStars(item.rating)}
                        </div>
                        <p className="mt-1 text-muted-foreground text-xs">
                          {item.ratingCount} ratings
                        </p>
                      </div>
                      <div className="flex-1 space-y-1">
                        {[5, 4, 3, 2, 1].map((stars) => {
                          const ratingCounts: Record<number, number> = {
                            5: 245,
                            4: 78,
                            3: 12,
                            2: 5,
                            1: 2,
                          };
                          const count = ratingCounts[stars] ?? 0;
                          const percentage = Math.round(
                            (count / item.ratingCount) * 100
                          );
                          return (
                            <div
                              className="flex items-center gap-2"
                              key={stars}
                            >
                              <span className="w-8 text-right text-muted-foreground text-xs">
                                {stars}
                                <Star className="ml-0.5 inline h-3 w-3" />
                              </span>
                              <div className="h-2 flex-1 rounded-full bg-muted">
                                <div
                                  className="h-2 rounded-full bg-amber-500"
                                  style={{ width: `${percentage}%` }}
                                />
                              </div>
                              <span className="w-8 text-muted-foreground text-xs">
                                {count}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {MOCK_REVIEWS.map((review) => (
                  <Card key={review.id}>
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 font-medium text-primary text-sm">
                            {review.author.charAt(0)}
                          </div>
                          <div>
                            <p className="font-medium text-sm">
                              {review.author}
                            </p>
                            <p className="text-muted-foreground text-xs">
                              {review.date}
                            </p>
                          </div>
                        </div>
                        <div className="text-amber-500 text-sm">
                          {renderStars(review.rating)}
                        </div>
                      </div>
                      <p className="mt-3 text-muted-foreground text-sm leading-relaxed">
                        {review.comment}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <div className="w-full space-y-4 lg:w-72">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Author</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 font-medium text-primary">
                  {item.author.charAt(0)}
                </div>
                <div>
                  <p className="font-medium text-sm">{item.author}</p>
                  <p className="text-muted-foreground text-xs">
                    Verified Publisher
                  </p>
                </div>
              </div>
              {item.authorUrl && (
                <Button
                  className="w-full"
                  onClick={() => window.open(item.authorUrl, "_blank")}
                  size="sm"
                  variant="ghost"
                >
                  <Globe className="mr-2 h-4 w-4" />
                  Website
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Version</span>
                <span className="font-mono">v{MOCK_VERSIONS[0]?.version}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">License</span>
                <span>{item.license}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Installs</span>
                <span>{formatInstalls(item.installs)}</span>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Published</span>
                <span className="text-xs">{item.createdAt}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Updated</span>
                <span className="text-xs">{item.updatedAt}</span>
              </div>
              <Separator />
              <div>
                <p className="mb-2 text-muted-foreground">Requirements</p>
                <div className="space-y-1">
                  {item.requirements.map((req) => (
                    <div
                      className="flex items-center gap-1.5 text-xs"
                      key={req}
                    >
                      <CheckCircle className="h-3 w-3 text-green-500" />
                      {req}
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Related</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                "Test Generator Agent",
                "Dependency Updater",
                "Slack Notifications",
              ].map((name) => (
                <div
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                  key={name}
                >
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <span>{name}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
