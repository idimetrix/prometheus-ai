"use client";

import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Input,
} from "@prometheus/ui";
import {
  Clock,
  Code,
  Globe,
  Layers,
  Layout,
  Search,
  Server,
  Shield,
  Smartphone,
  Terminal,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TemplateDefinition {
  category: TemplateCategory;
  description: string;
  estimatedMinutes: number;
  icon: string;
  id: string;
  languages: string[];
  name: string;
  techStack: string[];
}

export type TemplateCategory =
  | "Full-Stack"
  | "Frontend"
  | "Backend"
  | "Mobile"
  | "Monorepo";

// ---------------------------------------------------------------------------
// Template data (matches config-stacks templates)
// ---------------------------------------------------------------------------

const SCAFFOLD_TEMPLATES: TemplateDefinition[] = [
  {
    id: "nextjs-trpc",
    name: "Next.js + tRPC",
    description:
      "Full-stack Next.js app with tRPC API layer, Drizzle ORM, Tailwind CSS, and shadcn/ui components.",
    category: "Full-Stack",
    techStack: ["Next.js", "tRPC", "Tailwind CSS", "Drizzle", "shadcn/ui"],
    languages: ["TypeScript"],
    icon: "globe",
    estimatedMinutes: 5,
  },
  {
    id: "fastapi-react",
    name: "FastAPI + React",
    description:
      "FastAPI Python backend with React + Vite frontend, SQLAlchemy ORM, and Tailwind CSS.",
    category: "Full-Stack",
    techStack: ["FastAPI", "React", "SQLAlchemy", "Tailwind CSS", "Vite"],
    languages: ["Python", "TypeScript"],
    icon: "zap",
    estimatedMinutes: 8,
  },
  {
    id: "express-api",
    name: "Express API",
    description:
      "Express.js REST API with Prisma ORM, Zod validation, and PostgreSQL.",
    category: "Backend",
    techStack: ["Express", "Prisma", "Zod", "PostgreSQL"],
    languages: ["TypeScript"],
    icon: "server",
    estimatedMinutes: 5,
  },
  {
    id: "django-htmx",
    name: "Django + HTMX",
    description:
      "Django server-rendered app with HTMX for dynamic interactivity, no JavaScript framework required.",
    category: "Full-Stack",
    techStack: ["Django", "HTMX", "Tailwind CSS", "PostgreSQL"],
    languages: ["Python"],
    icon: "layout",
    estimatedMinutes: 6,
  },
  {
    id: "go-fiber",
    name: "Go Fiber API",
    description:
      "Go REST API with Fiber web framework, pgx PostgreSQL driver, and zerolog structured logging.",
    category: "Backend",
    techStack: ["Go", "Fiber", "pgx", "PostgreSQL"],
    languages: ["Go"],
    icon: "terminal",
    estimatedMinutes: 4,
  },
  {
    id: "rust-axum",
    name: "Rust Axum API",
    description:
      "Rust API with Axum web framework, SQLx for type-safe PostgreSQL queries, and Tower middleware.",
    category: "Backend",
    techStack: ["Rust", "Axum", "SQLx", "PostgreSQL", "Tokio"],
    languages: ["Rust"],
    icon: "shield",
    estimatedMinutes: 5,
  },
  {
    id: "react-native",
    name: "React Native",
    description:
      "Cross-platform mobile app with Expo, Expo Router, React Query, and Zustand state management.",
    category: "Mobile",
    techStack: ["React Native", "Expo", "React Query", "Zustand"],
    languages: ["TypeScript"],
    icon: "smartphone",
    estimatedMinutes: 6,
  },
  {
    id: "monorepo-turbo",
    name: "Turborepo Monorepo",
    description:
      "Turborepo monorepo with Next.js web app, Hono API server, and shared UI/utils packages.",
    category: "Monorepo",
    techStack: ["Turborepo", "Next.js", "Hono", "pnpm"],
    languages: ["TypeScript"],
    icon: "layers",
    estimatedMinutes: 7,
  },
];

const ALL_CATEGORIES: TemplateCategory[] = [
  "Full-Stack",
  "Backend",
  "Frontend",
  "Mobile",
  "Monorepo",
];

// ---------------------------------------------------------------------------
// Icon map
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, React.ElementType> = {
  code: Code,
  globe: Globe,
  layers: Layers,
  layout: Layout,
  server: Server,
  shield: Shield,
  smartphone: Smartphone,
  terminal: Terminal,
  zap: Zap,
};

function TemplateIcon({
  icon,
  className,
}: {
  className?: string;
  icon: string;
}) {
  const IconComponent = ICON_MAP[icon] ?? Code;
  return <IconComponent className={className} />;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TemplateGalleryProps {
  onSelect?: (template: TemplateDefinition) => void;
  selected?: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TemplateGallery({ onSelect, selected }: TemplateGalleryProps) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<
    TemplateCategory | "All"
  >("All");

  const filtered = useMemo(() => {
    const lowerSearch = search.toLowerCase();
    return SCAFFOLD_TEMPLATES.filter((t) => {
      const matchesCategory =
        activeCategory === "All" || t.category === activeCategory;
      const matchesSearch =
        lowerSearch === "" ||
        t.name.toLowerCase().includes(lowerSearch) ||
        t.description.toLowerCase().includes(lowerSearch) ||
        t.techStack.some((tech) => tech.toLowerCase().includes(lowerSearch)) ||
        t.languages.some((lang) => lang.toLowerCase().includes(lowerSearch));
      return matchesCategory && matchesSearch;
    });
  }, [search, activeCategory]);

  return (
    <div className="space-y-6">
      {/* Search and filter controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates by name, technology, or language..."
            value={search}
          />
        </div>
      </div>

      {/* Category filters */}
      <div className="flex flex-wrap gap-2">
        <button
          className={`rounded-full px-3 py-1 font-medium text-xs transition-colors ${
            activeCategory === "All"
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
          }`}
          onClick={() => setActiveCategory("All")}
          type="button"
        >
          All
        </button>
        {ALL_CATEGORIES.map((category) => (
          <button
            className={`rounded-full px-3 py-1 font-medium text-xs transition-colors ${
              activeCategory === category
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
            }`}
            key={category}
            onClick={() => setActiveCategory(category)}
            type="button"
          >
            {category}
          </button>
        ))}
      </div>

      {/* Template grid */}
      {filtered.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground text-sm">
          No templates match your search. Try a different query or category.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((template) => {
            const isSelected = selected === template.id;
            return (
              <button
                className="text-left"
                key={template.id}
                onClick={() => onSelect?.(template)}
                type="button"
              >
                <Card
                  className={`h-full transition-all ${
                    isSelected
                      ? "border-primary bg-primary/5 shadow-md ring-1 ring-primary/30"
                      : "hover:border-primary/50 hover:shadow-md"
                  }`}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <TemplateIcon
                          className="h-4 w-4 text-muted-foreground"
                          icon={template.icon}
                        />
                        <Badge variant="outline">{template.category}</Badge>
                      </div>
                      <div className="flex items-center gap-1 text-muted-foreground text-xs">
                        <Clock className="h-3 w-3" />
                        <span>~{template.estimatedMinutes} min</span>
                      </div>
                    </div>
                    <CardTitle className="text-lg">{template.name}</CardTitle>
                    <CardDescription>{template.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="pb-3">
                    <div className="flex flex-wrap gap-1.5">
                      {template.techStack.map((tech) => (
                        <Badge key={tech} variant="secondary">
                          {tech}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                  <CardFooter>
                    <div className="flex items-center gap-2">
                      {template.languages.map((lang) => (
                        <span
                          className="text-muted-foreground text-xs"
                          key={lang}
                        >
                          {lang}
                        </span>
                      ))}
                    </div>
                  </CardFooter>
                </Card>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export type { TemplateGalleryProps };
