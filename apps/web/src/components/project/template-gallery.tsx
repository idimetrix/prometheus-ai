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
import { useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TemplateDefinition {
  category: TemplateCategory;
  description: string;
  estimatedMinutes: number;
  id: string;
  name: string;
  techStack: string[];
}

type TemplateCategory =
  | "Web App"
  | "API"
  | "Mobile"
  | "CLI"
  | "Data Pipeline"
  | "E-Commerce";

// ---------------------------------------------------------------------------
// Template data
// ---------------------------------------------------------------------------

const TEMPLATES: TemplateDefinition[] = [
  {
    id: "nextjs-saas",
    name: "Next.js SaaS",
    description:
      "Full-stack SaaS with auth, billing, dashboard. Multi-tenant ready with subscription management.",
    category: "Web App",
    techStack: ["Next.js", "tRPC", "Drizzle", "Stripe", "Clerk"],
    estimatedMinutes: 45,
  },
  {
    id: "rest-api",
    name: "REST API",
    description:
      "Production-ready API with authentication, input validation, and auto-generated OpenAPI docs.",
    category: "API",
    techStack: ["Hono", "Drizzle", "Zod", "Swagger"],
    estimatedMinutes: 30,
  },
  {
    id: "react-dashboard",
    name: "React Dashboard",
    description:
      "Admin dashboard with interactive charts, data tables, and complex form handling.",
    category: "Web App",
    techStack: ["React", "Recharts", "TanStack Table"],
    estimatedMinutes: 35,
  },
  {
    id: "cli-tool",
    name: "CLI Tool",
    description:
      "Node.js command-line tool with subcommands, configuration management, and formatted output.",
    category: "CLI",
    techStack: ["Commander", "chalk", "inquirer"],
    estimatedMinutes: 20,
  },
  {
    id: "ecommerce",
    name: "E-Commerce",
    description:
      "Online store with product catalog, shopping cart, checkout flow, and payment processing.",
    category: "E-Commerce",
    techStack: ["Next.js", "Stripe", "Drizzle"],
    estimatedMinutes: 50,
  },
  {
    id: "mobile-app",
    name: "Mobile App",
    description:
      "Cross-platform mobile app with navigation, authentication, and native device integration.",
    category: "Mobile",
    techStack: ["React Native", "Expo", "React Navigation"],
    estimatedMinutes: 40,
  },
  {
    id: "data-pipeline",
    name: "Data Pipeline",
    description:
      "ETL pipeline with job scheduling, retry logic, and monitoring for data processing workflows.",
    category: "Data Pipeline",
    techStack: ["Node.js", "BullMQ", "PostgreSQL"],
    estimatedMinutes: 30,
  },
  {
    id: "chrome-extension",
    name: "Chrome Extension",
    description:
      "Browser extension with popup UI, content scripts, and background service worker.",
    category: "Web App",
    techStack: ["React", "Chrome APIs"],
    estimatedMinutes: 25,
  },
  {
    id: "fastapi-backend",
    name: "FastAPI Backend",
    description:
      "Python API with auto-generated OpenAPI documentation, async support, and ORM integration.",
    category: "API",
    techStack: ["FastAPI", "SQLAlchemy", "Pydantic"],
    estimatedMinutes: 30,
  },
  {
    id: "django-react",
    name: "Django + React",
    description:
      "Full-stack application with Django REST backend and React single-page frontend.",
    category: "Web App",
    techStack: ["Django", "DRF", "React"],
    estimatedMinutes: 45,
  },
];

const ALL_CATEGORIES: TemplateCategory[] = [
  "Web App",
  "API",
  "Mobile",
  "CLI",
  "Data Pipeline",
  "E-Commerce",
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TemplateGalleryProps {
  onSelect?: (template: TemplateDefinition) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TemplateGallery({ onSelect }: TemplateGalleryProps) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<
    TemplateCategory | "All"
  >("All");

  const filtered = useMemo(() => {
    const lowerSearch = search.toLowerCase();
    return TEMPLATES.filter((t) => {
      const matchesCategory =
        activeCategory === "All" || t.category === activeCategory;
      const matchesSearch =
        lowerSearch === "" ||
        t.name.toLowerCase().includes(lowerSearch) ||
        t.description.toLowerCase().includes(lowerSearch) ||
        t.techStack.some((tech) => tech.toLowerCase().includes(lowerSearch));
      return matchesCategory && matchesSearch;
    });
  }, [search, activeCategory]);

  return (
    <div className="space-y-6">
      {/* Search and filter controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <svg
            aria-hidden="true"
            className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <Input
            className="pl-9"
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates by name or technology..."
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
          {filtered.map((template) => (
            <button
              className="text-left"
              key={template.id}
              onClick={() => onSelect?.(template)}
              type="button"
            >
              <Card className="h-full transition-colors hover:border-primary/50 hover:shadow-md">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline">{template.category}</Badge>
                    <span className="text-muted-foreground text-xs">
                      ~{template.estimatedMinutes} min
                    </span>
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
                  <span className="text-muted-foreground text-xs">
                    Click to use this template
                  </span>
                </CardFooter>
              </Card>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export type { TemplateCategory, TemplateDefinition, TemplateGalleryProps };
