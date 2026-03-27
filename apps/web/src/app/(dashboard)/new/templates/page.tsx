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
  Cloud,
  Code2,
  Database,
  Globe,
  Layers,
  Rocket,
  Search,
  Smartphone,
  Sparkles,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TemplateCategory =
  | "All"
  | "Web App"
  | "API"
  | "Mobile"
  | "Full Stack"
  | "AI/ML";

interface ProjectTemplate {
  category: TemplateCategory;
  description: string;
  icon: ReactNode;
  id: string;
  name: string;
  stars: number;
  techStack: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORIES: TemplateCategory[] = [
  "All",
  "Web App",
  "API",
  "Mobile",
  "Full Stack",
  "AI/ML",
];

const CATEGORY_ICONS: Record<TemplateCategory, ReactNode> = {
  All: <Layers className="h-4 w-4" />,
  "Web App": <Globe className="h-4 w-4" />,
  API: <Database className="h-4 w-4" />,
  Mobile: <Smartphone className="h-4 w-4" />,
  "Full Stack": <Code2 className="h-4 w-4" />,
  "AI/ML": <Sparkles className="h-4 w-4" />,
};

const STACK_COLORS: Record<string, string> = {
  "Next.js": "bg-zinc-800 text-zinc-200",
  React: "bg-blue-500/20 text-blue-400",
  TypeScript: "bg-blue-500/20 text-blue-300",
  Tailwind: "bg-cyan-500/20 text-cyan-400",
  PostgreSQL: "bg-blue-500/20 text-blue-400",
  Prisma: "bg-violet-500/20 text-violet-400",
  Drizzle: "bg-green-500/20 text-green-400",
  Django: "bg-green-500/20 text-green-400",
  Python: "bg-yellow-500/20 text-yellow-400",
  FastAPI: "bg-green-500/20 text-green-300",
  "React Native": "bg-blue-500/20 text-blue-400",
  Expo: "bg-violet-500/20 text-violet-300",
  Express: "bg-zinc-600/20 text-zinc-300",
  Hono: "bg-orange-500/20 text-orange-400",
  Redis: "bg-red-500/20 text-red-400",
  Docker: "bg-blue-500/20 text-blue-300",
  tRPC: "bg-blue-500/20 text-blue-400",
  Stripe: "bg-violet-500/20 text-violet-400",
  Auth: "bg-yellow-500/20 text-yellow-400",
  Flutter: "bg-blue-500/20 text-blue-400",
  Dart: "bg-blue-500/20 text-blue-300",
  Firebase: "bg-amber-500/20 text-amber-400",
  LangChain: "bg-green-500/20 text-green-400",
  OpenAI: "bg-zinc-700/20 text-zinc-300",
  Pinecone: "bg-violet-500/20 text-violet-400",
  PyTorch: "bg-red-500/20 text-red-400",
  MLflow: "bg-blue-500/20 text-blue-400",
  Remix: "bg-violet-500/20 text-violet-400",
  Supabase: "bg-green-500/20 text-green-400",
  Go: "bg-cyan-500/20 text-cyan-400",
  gRPC: "bg-green-500/20 text-green-400",
  Kubernetes: "bg-blue-500/20 text-blue-400",
};

// ---------------------------------------------------------------------------
// Template data
// ---------------------------------------------------------------------------

const TEMPLATES: ProjectTemplate[] = [
  {
    id: "tmpl_nextjs_saas",
    name: "Next.js SaaS Starter",
    description:
      "Production-ready SaaS template with authentication, billing, team management, and a dashboard. Built on Next.js App Router with server components.",
    category: "Full Stack",
    techStack: [
      "Next.js",
      "TypeScript",
      "Tailwind",
      "PostgreSQL",
      "Drizzle",
      "Stripe",
      "Auth",
    ],
    icon: <Rocket className="h-5 w-5 text-violet-400" />,
    stars: 4820,
  },
  {
    id: "tmpl_django_rest",
    name: "Django REST API",
    description:
      "Battle-tested Django REST Framework setup with JWT auth, pagination, filtering, OpenAPI docs, and Celery task queue integration.",
    category: "API",
    techStack: ["Django", "Python", "PostgreSQL", "Redis", "Docker"],
    icon: <Database className="h-5 w-5 text-green-400" />,
    stars: 3150,
  },
  {
    id: "tmpl_react_native",
    name: "React Native Mobile App",
    description:
      "Cross-platform mobile starter with Expo Router, native navigation, auth flow, push notifications, and offline-first architecture.",
    category: "Mobile",
    techStack: ["React Native", "Expo", "TypeScript"],
    icon: <Smartphone className="h-5 w-5 text-blue-400" />,
    stars: 2740,
  },
  {
    id: "tmpl_fastapi_ml",
    name: "FastAPI ML Service",
    description:
      "Machine learning API service with model serving, batch prediction endpoints, experiment tracking, and GPU-optimized Docker setup.",
    category: "AI/ML",
    techStack: ["FastAPI", "Python", "PyTorch", "MLflow", "Docker"],
    icon: <Sparkles className="h-5 w-5 text-amber-400" />,
    stars: 1980,
  },
  {
    id: "tmpl_remix_fullstack",
    name: "Remix Full Stack App",
    description:
      "Full stack Remix application with nested routes, form actions, optimistic UI, Supabase integration, and edge deployment config.",
    category: "Full Stack",
    techStack: ["Remix", "TypeScript", "Tailwind", "Supabase"],
    icon: <Globe className="h-5 w-5 text-violet-400" />,
    stars: 1650,
  },
  {
    id: "tmpl_hono_api",
    name: "Hono Edge API",
    description:
      "Lightweight, ultrafast API built with Hono for edge runtimes. Includes tRPC integration, Drizzle ORM, and Cloudflare Workers deployment.",
    category: "API",
    techStack: ["Hono", "TypeScript", "tRPC", "Drizzle"],
    icon: <Zap className="h-5 w-5 text-orange-400" />,
    stars: 1430,
  },
  {
    id: "tmpl_flutter_app",
    name: "Flutter Cross-Platform",
    description:
      "Flutter app template supporting iOS, Android, and Web with clean architecture, BLoC state management, and Firebase backend.",
    category: "Mobile",
    techStack: ["Flutter", "Dart", "Firebase"],
    icon: <Smartphone className="h-5 w-5 text-blue-400" />,
    stars: 2100,
  },
  {
    id: "tmpl_langchain_rag",
    name: "LangChain RAG Pipeline",
    description:
      "Retrieval-augmented generation pipeline with document ingestion, vector storage, conversational memory, and a chat API endpoint.",
    category: "AI/ML",
    techStack: ["LangChain", "Python", "OpenAI", "Pinecone", "FastAPI"],
    icon: <Sparkles className="h-5 w-5 text-green-400" />,
    stars: 3300,
  },
  {
    id: "tmpl_go_microservice",
    name: "Go Microservice",
    description:
      "Production-grade Go microservice with gRPC + REST gateway, structured logging, distributed tracing, health checks, and Kubernetes manifests.",
    category: "API",
    techStack: ["Go", "gRPC", "PostgreSQL", "Docker", "Kubernetes"],
    icon: <Cloud className="h-5 w-5 text-cyan-400" />,
    stars: 2560,
  },
  {
    id: "tmpl_vite_react",
    name: "Vite React Dashboard",
    description:
      "Modern React SPA with Vite, featuring data visualization, dark mode, responsive layouts, and a comprehensive component library.",
    category: "Web App",
    techStack: ["React", "TypeScript", "Tailwind"],
    icon: <Globe className="h-5 w-5 text-blue-400" />,
    stars: 1870,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStackColor(tech: string): string {
  return STACK_COLORS[tech] ?? "bg-zinc-700/20 text-zinc-400";
}

function formatStars(n: number): string {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`;
  }
  return String(n);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TemplatesPage() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<TemplateCategory>("All");

  const filtered = useMemo(() => {
    let results = TEMPLATES;

    if (category !== "All") {
      results = results.filter((t) => t.category === category);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      results = results.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.techStack.some((s) => s.toLowerCase().includes(q))
      );
    }

    return results;
  }, [search, category]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      {/* Page header */}
      <div>
        <h1 className="font-semibold text-2xl text-zinc-100">
          Project Templates
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Start your project with a production-ready template. Each template
          includes best practices, CI/CD configuration, and documentation.
        </p>
      </div>

      {/* Search + Category filter */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <Input
            className="border-zinc-800 bg-zinc-900 pl-9"
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates by name, tech, or description..."
            value={search}
          />
        </div>

        <div className="flex items-center gap-1.5">
          {CATEGORIES.map((cat) => (
            <button
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors ${
                category === cat
                  ? "bg-violet-500/20 font-medium text-violet-400"
                  : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              }`}
              key={cat}
              onClick={() => setCategory(cat)}
              type="button"
            >
              {CATEGORY_ICONS[cat]}
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Results count */}
      <div className="text-xs text-zinc-500">
        {filtered.length} template{filtered.length === 1 ? "" : "s"} found
      </div>

      {/* Template grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-800 border-dashed py-16">
          <Search className="mb-3 h-8 w-8 text-zinc-700" />
          <p className="text-sm text-zinc-500">
            No templates match your search
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            Try adjusting your filters or search query
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((template) => (
            <Card
              className="group flex flex-col border-zinc-800 bg-zinc-900/50 transition-colors hover:border-zinc-700"
              key={template.id}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900">
                    {template.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-sm text-zinc-200">
                      {template.name}
                    </h3>
                    <div className="mt-0.5 flex items-center gap-2">
                      <Badge
                        className="bg-zinc-800 text-zinc-400"
                        variant="secondary"
                      >
                        {template.category}
                      </Badge>
                      <span className="text-[10px] text-zinc-500">
                        {formatStars(template.stars)} stars
                      </span>
                    </div>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="flex flex-1 flex-col pt-0">
                <p className="mb-3 flex-1 text-xs text-zinc-400 leading-relaxed">
                  {template.description}
                </p>

                {/* Tech stack */}
                <div className="mb-4 flex flex-wrap gap-1">
                  {template.techStack.map((tech) => (
                    <Badge
                      className={getStackColor(tech)}
                      key={tech}
                      variant="secondary"
                    >
                      {tech}
                    </Badge>
                  ))}
                </div>

                <Button className="w-full" size="sm" variant="outline">
                  Use Template
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
