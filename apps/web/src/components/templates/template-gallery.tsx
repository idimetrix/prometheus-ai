"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@prometheus/ui";
import {
  BookOpen,
  Code2,
  Eye,
  GitFork,
  Globe,
  Layers,
  LayoutGrid,
  Rocket,
  Search,
  ShoppingCart,
  Smartphone,
  Star,
  Terminal,
  TrendingUp,
  Upload,
} from "lucide-react";
import { type FC, type ReactNode, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TemplateCategory =
  | "All"
  | "API"
  | "Blog"
  | "CLI"
  | "E-commerce"
  | "Library"
  | "Mobile"
  | "SaaS";

type FrameworkFilter =
  | "all"
  | "astro"
  | "express"
  | "nextjs"
  | "react-native"
  | "remix"
  | "sveltekit";

type LanguageFilter = "all" | "go" | "python" | "rust" | "typescript";

type DifficultyFilter = "all" | "advanced" | "beginner" | "intermediate";

interface TemplateData {
  author: string;
  category: TemplateCategory;
  description: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  featured: boolean;
  forkCount: number;
  framework: string;
  icon: ReactNode;
  id: string;
  language: string;
  name: string;
  previewUrl: string | null;
  starCount: number;
  techStack: string[];
  trending: boolean;
}

// ---------------------------------------------------------------------------
// Static data
// ---------------------------------------------------------------------------

const TEMPLATES: TemplateData[] = [
  {
    id: "tpl-saas-nextjs",
    name: "SaaS Starter Kit",
    author: "Prometheus Team",
    description:
      "Production-ready SaaS boilerplate with auth, billing, teams, and admin dashboard.",
    category: "SaaS",
    framework: "nextjs",
    language: "typescript",
    difficulty: "intermediate",
    icon: <Rocket className="h-5 w-5" />,
    techStack: ["Next.js", "Tailwind", "Stripe", "Clerk", "Drizzle"],
    starCount: 4200,
    forkCount: 890,
    previewUrl: "https://saas-demo.prometheus.dev",
    featured: true,
    trending: true,
  },
  {
    id: "tpl-ecommerce-nextjs",
    name: "Storefront Pro",
    author: "ShopBuilder",
    description:
      "Full e-commerce platform with cart, checkout, payments, and inventory management.",
    category: "E-commerce",
    framework: "nextjs",
    language: "typescript",
    difficulty: "advanced",
    icon: <ShoppingCart className="h-5 w-5" />,
    techStack: ["Next.js", "Tailwind", "Stripe", "Algolia", "PostgreSQL"],
    starCount: 3100,
    forkCount: 650,
    previewUrl: "https://store-demo.prometheus.dev",
    featured: true,
    trending: false,
  },
  {
    id: "tpl-blog-astro",
    name: "Dev Blog",
    author: "ContentFirst",
    description:
      "Fast, SEO-optimized developer blog with MDX, syntax highlighting, and RSS.",
    category: "Blog",
    framework: "astro",
    language: "typescript",
    difficulty: "beginner",
    icon: <BookOpen className="h-5 w-5" />,
    techStack: ["Astro", "MDX", "Tailwind", "Shiki"],
    starCount: 2800,
    forkCount: 720,
    previewUrl: "https://blog-demo.prometheus.dev",
    featured: false,
    trending: true,
  },
  {
    id: "tpl-api-express",
    name: "REST API Scaffold",
    author: "APIForge",
    description:
      "Production REST API with auth, validation, rate limiting, and OpenAPI docs.",
    category: "API",
    framework: "express",
    language: "typescript",
    difficulty: "intermediate",
    icon: <Globe className="h-5 w-5" />,
    techStack: ["Express", "Zod", "Drizzle", "OpenAPI", "Redis"],
    starCount: 1900,
    forkCount: 420,
    previewUrl: null,
    featured: false,
    trending: false,
  },
  {
    id: "tpl-mobile-rn",
    name: "Mobile App Starter",
    author: "AppCraft",
    description:
      "Cross-platform mobile app with navigation, auth flows, and offline support.",
    category: "Mobile",
    framework: "react-native",
    language: "typescript",
    difficulty: "intermediate",
    icon: <Smartphone className="h-5 w-5" />,
    techStack: ["React Native", "Expo", "NativeWind", "MMKV"],
    starCount: 2400,
    forkCount: 510,
    previewUrl: null,
    featured: false,
    trending: true,
  },
  {
    id: "tpl-cli-rust",
    name: "CLI Toolkit",
    author: "TerminalCraft",
    description:
      "Feature-rich CLI application with subcommands, config, and rich output.",
    category: "CLI",
    framework: "express",
    language: "rust",
    difficulty: "advanced",
    icon: <Terminal className="h-5 w-5" />,
    techStack: ["Rust", "Clap", "Tokio", "Serde"],
    starCount: 1600,
    forkCount: 280,
    previewUrl: null,
    featured: false,
    trending: false,
  },
  {
    id: "tpl-library-ts",
    name: "TypeScript Library",
    author: "Prometheus Team",
    description:
      "Zero-config TypeScript library with tests, docs, CI/CD, and npm publishing.",
    category: "Library",
    framework: "express",
    language: "typescript",
    difficulty: "beginner",
    icon: <Code2 className="h-5 w-5" />,
    techStack: ["TypeScript", "Vitest", "Tsup", "Typedoc"],
    starCount: 1200,
    forkCount: 340,
    previewUrl: null,
    featured: false,
    trending: false,
  },
  {
    id: "tpl-saas-remix",
    name: "Remix SaaS",
    author: "RemixCraft",
    description:
      "Full-stack SaaS with Remix, nested routes, forms, and server-side auth.",
    category: "SaaS",
    framework: "remix",
    language: "typescript",
    difficulty: "intermediate",
    icon: <Layers className="h-5 w-5" />,
    techStack: ["Remix", "Tailwind", "Prisma", "Fly.io"],
    starCount: 1800,
    forkCount: 380,
    previewUrl: "https://remix-saas-demo.prometheus.dev",
    featured: false,
    trending: false,
  },
  {
    id: "tpl-api-go",
    name: "Go REST API",
    author: "GoCraft",
    description:
      "High-performance Go API with Chi router, middleware, and structured logging.",
    category: "API",
    framework: "express",
    language: "go",
    difficulty: "intermediate",
    icon: <Globe className="h-5 w-5" />,
    techStack: ["Go", "Chi", "SQLC", "Zap"],
    starCount: 1100,
    forkCount: 220,
    previewUrl: null,
    featured: false,
    trending: false,
  },
  {
    id: "tpl-ecommerce-svelte",
    name: "SvelteKit Store",
    author: "SvelteMart",
    description:
      "Modern e-commerce with SvelteKit, server-side rendering, and Stripe integration.",
    category: "E-commerce",
    framework: "sveltekit",
    language: "typescript",
    difficulty: "intermediate",
    icon: <ShoppingCart className="h-5 w-5" />,
    techStack: ["SvelteKit", "Tailwind", "Stripe", "Drizzle"],
    starCount: 980,
    forkCount: 190,
    previewUrl: "https://svelte-store-demo.prometheus.dev",
    featured: false,
    trending: true,
  },
];

const CATEGORIES: TemplateCategory[] = [
  "All",
  "SaaS",
  "E-commerce",
  "Blog",
  "API",
  "Mobile",
  "CLI",
  "Library",
];

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner:
    "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400",
  intermediate:
    "border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-400",
  advanced:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TemplateCard({
  template,
  onUse,
  onPreview,
}: {
  template: TemplateData;
  onUse: (id: string) => void;
  onPreview: (id: string) => void;
}) {
  return (
    <Card className="flex flex-col">
      {/* Preview area */}
      <div className="flex aspect-video items-center justify-center rounded-t-lg border-b bg-muted">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          {template.icon}
          <span className="text-xs">{template.name}</span>
        </div>
      </div>

      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold leading-none">{template.name}</h3>
          {template.featured && (
            <Badge
              className="border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-950 dark:text-purple-400"
              variant="outline"
            >
              Featured
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground/70 text-xs">By {template.author}</p>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col space-y-3">
        <p className="text-muted-foreground text-sm">{template.description}</p>

        {/* Tech stack badges */}
        <div className="flex flex-wrap gap-1">
          {template.techStack.map((tech) => (
            <Badge className="text-[10px]" key={tech} variant="secondary">
              {tech}
            </Badge>
          ))}
        </div>

        {/* Metadata row */}
        <div className="flex items-center gap-3 text-muted-foreground text-xs">
          <span className="flex items-center gap-1">
            <Star className="h-3 w-3" />
            {template.starCount.toLocaleString()}
          </span>
          <span className="flex items-center gap-1">
            <GitFork className="h-3 w-3" />
            {template.forkCount.toLocaleString()}
          </span>
          <Badge
            className={`text-[10px] ${DIFFICULTY_COLORS[template.difficulty]}`}
            variant="outline"
          >
            {template.difficulty}
          </Badge>
        </div>

        {/* Actions */}
        <div className="mt-auto flex gap-2 pt-1">
          <Button
            className="flex-1"
            onClick={() => onUse(template.id)}
            size="sm"
          >
            <Rocket className="mr-1 h-3 w-3" /> Use Template
          </Button>
          {template.previewUrl ? (
            <Button
              onClick={() => onPreview(template.id)}
              size="sm"
              variant="outline"
            >
              <Eye className="mr-1 h-3 w-3" /> Preview
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export const TemplateGallery: FC = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<TemplateCategory>("All");
  const [frameworkFilter, setFrameworkFilter] =
    useState<FrameworkFilter>("all");
  const [languageFilter, setLanguageFilter] = useState<LanguageFilter>("all");
  const [difficultyFilter, setDifficultyFilter] =
    useState<DifficultyFilter>("all");
  const [activeTab, setActiveTab] = useState<string>("all");

  const filteredTemplates = useMemo(() => {
    let list = TEMPLATES;

    // Tab-based filtering
    if (activeTab === "featured") {
      list = list.filter((t) => t.featured);
    } else if (activeTab === "trending") {
      list = list.filter((t) => t.trending);
    }

    if (activeCategory !== "All") {
      list = list.filter((t) => t.category === activeCategory);
    }

    if (frameworkFilter !== "all") {
      list = list.filter((t) => t.framework === frameworkFilter);
    }

    if (languageFilter !== "all") {
      list = list.filter((t) => t.language === languageFilter);
    }

    if (difficultyFilter !== "all") {
      list = list.filter((t) => t.difficulty === difficultyFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.techStack.some((s) => s.toLowerCase().includes(q))
      );
    }

    return list;
  }, [
    searchQuery,
    activeCategory,
    frameworkFilter,
    languageFilter,
    difficultyFilter,
    activeTab,
  ]);

  function handleUseTemplate(templateId: string) {
    // In a real app this would open a project creation dialog
    const template = TEMPLATES.find((t) => t.id === templateId);
    if (template) {
      window.location.href = `/projects/new?template=${templateId}`;
    }
  }

  function handlePreview(templateId: string) {
    const template = TEMPLATES.find((t) => t.id === templateId);
    if (template?.previewUrl) {
      window.open(template.previewUrl, "_blank", "noopener");
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-2xl tracking-tight">
            Template Gallery
          </h2>
          <p className="text-muted-foreground">
            Start your project with community-built templates and boilerplates.
          </p>
        </div>
        <Button asChild variant="outline">
          <a href="/templates/submit">
            <Upload className="mr-1 h-4 w-4" />
            Submit Template
          </a>
        </Button>
      </div>

      {/* Featured / Trending / All tabs */}
      <Tabs onValueChange={setActiveTab} value={activeTab}>
        <TabsList>
          <TabsTrigger value="all">
            <LayoutGrid className="mr-1 h-4 w-4" />
            All Templates
          </TabsTrigger>
          <TabsTrigger value="featured">
            <Star className="mr-1 h-4 w-4" />
            Featured
          </TabsTrigger>
          <TabsTrigger value="trending">
            <TrendingUp className="mr-1 h-4 w-4" />
            Trending
          </TabsTrigger>
        </TabsList>

        {/* Shared content across all tabs */}
        <TabsContent className="space-y-6" value={activeTab}>
          {/* Search and filters */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search templates..."
                value={searchQuery}
              />
            </div>

            <Select
              onValueChange={(v) => setFrameworkFilter(v as FrameworkFilter)}
              value={frameworkFilter}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Framework" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Frameworks</SelectItem>
                <SelectItem value="nextjs">Next.js</SelectItem>
                <SelectItem value="remix">Remix</SelectItem>
                <SelectItem value="astro">Astro</SelectItem>
                <SelectItem value="sveltekit">SvelteKit</SelectItem>
                <SelectItem value="express">Express</SelectItem>
                <SelectItem value="react-native">React Native</SelectItem>
              </SelectContent>
            </Select>

            <Select
              onValueChange={(v) => setLanguageFilter(v as LanguageFilter)}
              value={languageFilter}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Language" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Languages</SelectItem>
                <SelectItem value="typescript">TypeScript</SelectItem>
                <SelectItem value="rust">Rust</SelectItem>
                <SelectItem value="go">Go</SelectItem>
                <SelectItem value="python">Python</SelectItem>
              </SelectContent>
            </Select>

            <Select
              onValueChange={(v) => setDifficultyFilter(v as DifficultyFilter)}
              value={difficultyFilter}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Difficulty" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Levels</SelectItem>
                <SelectItem value="beginner">Beginner</SelectItem>
                <SelectItem value="intermediate">Intermediate</SelectItem>
                <SelectItem value="advanced">Advanced</SelectItem>
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

          {/* Template grid */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredTemplates.map((template) => (
              <TemplateCard
                key={template.id}
                onPreview={handlePreview}
                onUse={handleUseTemplate}
                template={template}
              />
            ))}
          </div>

          {filteredTemplates.length === 0 && (
            <div className="py-12 text-center text-muted-foreground">
              No templates found matching your filters.
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};
