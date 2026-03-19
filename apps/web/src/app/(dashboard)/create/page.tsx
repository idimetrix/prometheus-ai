"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Textarea,
} from "@prometheus/ui";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Code2,
  Database,
  Globe,
  Layers,
  Loader2,
  Server,
  Sparkles,
  Wand2,
} from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const WHITESPACE_REGEX = /\s+/;

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface TechStackOption {
  category: "frontend" | "backend" | "database" | "infra";
  description: string;
  icon: typeof Globe;
  id: string;
  name: string;
}

interface ArchitectureLayer {
  components: string[];
  name: string;
}

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

const STEPS = [
  { label: "Describe", description: "Describe your project" },
  { label: "Tech Stack", description: "Choose technologies" },
  { label: "Architecture", description: "Preview structure" },
  { label: "Confirm", description: "Review and create" },
] as const;

const TECH_OPTIONS: TechStackOption[] = [
  {
    id: "nextjs",
    name: "Next.js",
    category: "frontend",
    description: "React framework with SSR/SSG",
    icon: Globe,
  },
  {
    id: "react-spa",
    name: "React SPA",
    category: "frontend",
    description: "Single-page application with Vite",
    icon: Globe,
  },
  {
    id: "vue",
    name: "Vue.js",
    category: "frontend",
    description: "Progressive JavaScript framework",
    icon: Globe,
  },
  {
    id: "svelte",
    name: "SvelteKit",
    category: "frontend",
    description: "Compiled UI framework",
    icon: Globe,
  },
  {
    id: "express",
    name: "Express.js",
    category: "backend",
    description: "Minimal Node.js framework",
    icon: Server,
  },
  {
    id: "fastify",
    name: "Fastify",
    category: "backend",
    description: "High-performance Node.js server",
    icon: Server,
  },
  {
    id: "hono",
    name: "Hono",
    category: "backend",
    description: "Ultrafast edge-ready framework",
    icon: Server,
  },
  {
    id: "django",
    name: "Django",
    category: "backend",
    description: "Python web framework",
    icon: Server,
  },
  {
    id: "rails",
    name: "Rails",
    category: "backend",
    description: "Ruby on Rails full-stack",
    icon: Server,
  },
  {
    id: "go",
    name: "Go (net/http)",
    category: "backend",
    description: "Go standard library HTTP",
    icon: Server,
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    category: "database",
    description: "Advanced relational database",
    icon: Database,
  },
  {
    id: "mysql",
    name: "MySQL",
    category: "database",
    description: "Popular relational database",
    icon: Database,
  },
  {
    id: "sqlite",
    name: "SQLite",
    category: "database",
    description: "Embedded file-based database",
    icon: Database,
  },
  {
    id: "mongodb",
    name: "MongoDB",
    category: "database",
    description: "Document-oriented NoSQL",
    icon: Database,
  },
  {
    id: "docker",
    name: "Docker",
    category: "infra",
    description: "Containerized deployment",
    icon: Layers,
  },
  {
    id: "vercel",
    name: "Vercel",
    category: "infra",
    description: "Serverless deployment",
    icon: Layers,
  },
  {
    id: "aws",
    name: "AWS",
    category: "infra",
    description: "Amazon Web Services",
    icon: Layers,
  },
];

const CATEGORY_LABELS: Record<string, string> = {
  frontend: "Frontend",
  backend: "Backend",
  database: "Database",
  infra: "Infrastructure",
};

const CATEGORY_ICONS: Record<string, typeof Globe> = {
  frontend: Globe,
  backend: Server,
  database: Database,
  infra: Layers,
};

/* -------------------------------------------------------------------------- */
/*  NLP Detection                                                             */
/* -------------------------------------------------------------------------- */

const KEYWORD_MAP: Record<string, string[]> = {
  nextjs: ["next.js", "nextjs", "next js", "server-side rendering", "ssr"],
  "react-spa": ["react", "single page", "spa", "vite"],
  vue: ["vue", "vuejs", "vue.js"],
  svelte: ["svelte", "sveltekit"],
  express: ["express", "expressjs"],
  fastify: ["fastify"],
  hono: ["hono", "edge"],
  django: ["django", "python web"],
  rails: ["rails", "ruby on rails"],
  go: ["golang", "go backend", "go api"],
  postgres: ["postgres", "postgresql"],
  mysql: ["mysql"],
  sqlite: ["sqlite"],
  mongodb: ["mongo", "mongodb", "nosql"],
  docker: ["docker", "container"],
  vercel: ["vercel", "serverless"],
  aws: ["aws", "amazon"],
};

function detectTechFromDescription(description: string): string[] {
  const lower = description.toLowerCase();
  const detected: string[] = [];

  for (const [techId, keywords] of Object.entries(KEYWORD_MAP)) {
    for (const keyword of keywords) {
      if (lower.includes(keyword) && !detected.includes(techId)) {
        detected.push(techId);
      }
    }
  }

  // Default suggestions if nothing detected
  if (detected.length === 0) {
    if (
      lower.includes("web") ||
      lower.includes("app") ||
      lower.includes("site")
    ) {
      detected.push("nextjs", "postgres", "docker");
    } else if (lower.includes("api") || lower.includes("service")) {
      detected.push("hono", "postgres", "docker");
    } else if (lower.includes("mobile")) {
      detected.push("react-spa", "express", "postgres");
    }
  }

  return detected;
}

function generateArchitecture(selectedTech: string[]): ArchitectureLayer[] {
  const layers: ArchitectureLayer[] = [];

  const frontendTech = selectedTech.filter(
    (t) => TECH_OPTIONS.find((o) => o.id === t)?.category === "frontend"
  );
  const backendTech = selectedTech.filter(
    (t) => TECH_OPTIONS.find((o) => o.id === t)?.category === "backend"
  );
  const dbTech = selectedTech.filter(
    (t) => TECH_OPTIONS.find((o) => o.id === t)?.category === "database"
  );
  const infraTech = selectedTech.filter(
    (t) => TECH_OPTIONS.find((o) => o.id === t)?.category === "infra"
  );

  if (frontendTech.length > 0) {
    const names = frontendTech.map(
      (t) => TECH_OPTIONS.find((o) => o.id === t)?.name ?? t
    );
    layers.push({
      name: "Presentation Layer",
      components: [
        ...names,
        "Component Library",
        "State Management",
        "Routing",
      ],
    });
  }

  layers.push({
    name: "API Layer",
    components: [
      ...(backendTech.length > 0
        ? backendTech.map(
            (t) => TECH_OPTIONS.find((o) => o.id === t)?.name ?? t
          )
        : ["REST API"]),
      "Authentication",
      "Validation",
      "Rate Limiting",
    ],
  });

  if (dbTech.length > 0) {
    const names = dbTech.map(
      (t) => TECH_OPTIONS.find((o) => o.id === t)?.name ?? t
    );
    layers.push({
      name: "Data Layer",
      components: [...names, "ORM / Query Builder", "Migrations", "Seeds"],
    });
  }

  if (infraTech.length > 0) {
    const names = infraTech.map(
      (t) => TECH_OPTIONS.find((o) => o.id === t)?.name ?? t
    );
    layers.push({
      name: "Infrastructure",
      components: [...names, "CI/CD Pipeline", "Monitoring", "Logging"],
    });
  }

  return layers;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

function getStepIndicatorStyle(currentStep: number, stepIndex: number): string {
  if (currentStep === stepIndex) {
    return "bg-violet-500/20 font-medium text-violet-400";
  }
  if (currentStep > stepIndex) {
    return "bg-green-500/10 text-green-400";
  }
  return "text-zinc-600";
}

const LAYER_STYLES = [
  "border-cyan-500/20 bg-cyan-500/5",
  "border-blue-500/20 bg-blue-500/5",
  "border-green-500/20 bg-green-500/5",
  "border-orange-500/20 bg-orange-500/5",
] as const;

function getLayerStyle(idx: number): string {
  return LAYER_STYLES[idx] ?? LAYER_STYLES.at(-1) ?? "";
}

export default function CreateProjectPage() {
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [description, setDescription] = useState("");
  const [projectName, setProjectName] = useState("");
  const [selectedTech, setSelectedTech] = useState<string[]>([]);
  const [autoDetected, setAutoDetected] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);

  const createMutation = trpc.projects.create.useMutation();

  // Auto-detect tech when moving to step 2
  useEffect(() => {
    if (step === 1 && description.trim()) {
      const detected = detectTechFromDescription(description);
      setAutoDetected(detected);
      setSelectedTech((prev) => {
        if (prev.length === 0) {
          return detected;
        }
        return prev;
      });
    }
  }, [step, description]);

  // Auto-extract project name from description
  useEffect(() => {
    if (!projectName && description.length > 10) {
      const words = description.trim().split(WHITESPACE_REGEX).slice(0, 4);
      const candidate = words.join(" ");
      if (candidate.length > 3) {
        setProjectName(candidate);
      }
    }
  }, [description, projectName]);

  const architecture = generateArchitecture(selectedTech);

  function toggleTech(techId: string) {
    setSelectedTech((prev) =>
      prev.includes(techId)
        ? prev.filter((t) => t !== techId)
        : [...prev, techId]
    );
  }

  function getTechStackPreset(): string {
    if (selectedTech.includes("nextjs") && selectedTech.includes("postgres")) {
      return "modern-saas";
    }
    if (selectedTech.includes("django")) {
      return "django-react";
    }
    if (selectedTech.includes("rails")) {
      return "rails";
    }
    if (selectedTech.includes("go")) {
      return "go-microservices";
    }
    return "custom";
  }

  async function handleCreate() {
    if (!(projectName.trim() && description.trim())) {
      return;
    }
    setIsCreating(true);
    try {
      const project = await createMutation.mutateAsync({
        name: projectName.trim(),
        description: description.trim(),
        techStackPreset: getTechStackPreset(),
      });
      toast.success("Project created successfully!");
      router.push(`/dashboard/projects/${project?.id}` as Route);
    } catch {
      toast.error("Failed to create project");
      setIsCreating(false);
    }
  }

  const canAdvance = [
    description.trim().length >= 10, // Step 0: need description
    selectedTech.length > 0, // Step 1: need tech selection
    true, // Step 2: architecture is generated
    projectName.trim().length > 0, // Step 3: need name
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <Wand2 className="h-6 w-6 text-violet-400" />
          <h1 className="font-bold text-2xl text-zinc-100">Create Project</h1>
        </div>
        <p className="mt-1 text-sm text-zinc-500">
          Describe your vision and we will scaffold the perfect architecture.
        </p>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-1">
        {STEPS.map((s, i) => (
          <div className="flex items-center" key={s.label}>
            <button
              className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs transition-colors ${getStepIndicatorStyle(
                step,
                i
              )}`}
              disabled={i > step}
              onClick={() => {
                if (i <= step) {
                  setStep(i);
                }
              }}
              type="button"
            >
              {step > i ? (
                <CheckCircle className="h-3.5 w-3.5" />
              ) : (
                <span className="flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px]">
                  {i + 1}
                </span>
              )}
              {s.label}
            </button>
            {i < STEPS.length - 1 && (
              <div
                className={`mx-1 h-px w-6 ${
                  step > i ? "bg-green-500/40" : "bg-zinc-800"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step 0: Describe */}
      {step === 0 && (
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Sparkles className="h-4 w-4 text-violet-400" />
              Describe Your Project
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="project-description">
                What do you want to build?
              </Label>
              <Textarea
                className="mt-1.5 min-h-[160px]"
                id="project-description"
                onChange={(e) => setDescription(e.target.value)}
                placeholder="I want to build a real-time collaboration tool for teams, with features like shared documents, live cursors, presence indicators, and integrated chat. It should support authentication with Google and GitHub, have a REST API, and be deployable on Vercel..."
                value={description}
              />
              <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
                <span>{description.length} characters</span>
                <span>
                  {description.trim().length < 10
                    ? "Be descriptive for best results"
                    : "Looking good! We will auto-detect technologies."}
                </span>
              </div>
            </div>
            <div>
              <Label htmlFor="project-name">Project Name</Label>
              <Input
                className="mt-1.5"
                id="project-name"
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="My Awesome Project"
                value={projectName}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 1: Tech Stack */}
      {step === 1 && (
        <div className="space-y-4">
          {autoDetected.length > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-violet-500/20 bg-violet-500/5 px-4 py-3">
              <Sparkles className="h-4 w-4 shrink-0 text-violet-400" />
              <span className="text-sm text-zinc-300">
                We auto-detected{" "}
                <span className="font-medium text-violet-400">
                  {autoDetected.length} technologies
                </span>{" "}
                from your description. Adjust as needed.
              </span>
            </div>
          )}

          {(["frontend", "backend", "database", "infra"] as const).map(
            (category) => {
              const options = TECH_OPTIONS.filter(
                (t) => t.category === category
              );
              const CategoryIcon = CATEGORY_ICONS[category] ?? Globe;
              return (
                <div key={category}>
                  <h3 className="mb-2 flex items-center gap-2 font-medium text-sm text-zinc-300">
                    <CategoryIcon className="h-4 w-4 text-zinc-500" />
                    {CATEGORY_LABELS[category]}
                  </h3>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                    {options.map((tech) => {
                      const isSelected = selectedTech.includes(tech.id);
                      const isAutoDetected = autoDetected.includes(tech.id);
                      return (
                        <button
                          className={`relative rounded-lg border p-3 text-left transition-all ${
                            isSelected
                              ? "border-violet-500/50 bg-violet-500/10"
                              : "border-zinc-800 bg-zinc-900/30 hover:border-zinc-700"
                          }`}
                          key={tech.id}
                          onClick={() => toggleTech(tech.id)}
                          type="button"
                        >
                          {isAutoDetected && (
                            <span className="absolute top-2 right-2 rounded-full bg-violet-500/20 px-1.5 py-0.5 text-[9px] text-violet-400">
                              detected
                            </span>
                          )}
                          <div
                            className={`font-medium text-sm ${
                              isSelected ? "text-violet-300" : "text-zinc-300"
                            }`}
                          >
                            {tech.name}
                          </div>
                          <div className="mt-0.5 text-xs text-zinc-500">
                            {tech.description}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            }
          )}
        </div>
      )}

      {/* Step 2: Architecture Preview */}
      {step === 2 && (
        <div className="space-y-4">
          <Card className="border-zinc-800 bg-zinc-900/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Layers className="h-4 w-4 text-violet-400" />
                Architecture Preview
              </CardTitle>
            </CardHeader>
            <CardContent>
              {architecture.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  Select some technologies to see the architecture preview.
                </p>
              ) : (
                <div className="space-y-0">
                  {architecture.map((layer, idx) => (
                    <div key={layer.name}>
                      {/* Layer */}
                      <div
                        className={`rounded-lg border p-4 ${getLayerStyle(
                          idx
                        )}`}
                      >
                        <div className="mb-2 font-medium text-sm text-zinc-200">
                          {layer.name}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {layer.components.map((component) => (
                            <span
                              className="rounded-md border border-zinc-700/50 bg-zinc-800/50 px-2 py-0.5 text-xs text-zinc-400"
                              key={component}
                            >
                              {component}
                            </span>
                          ))}
                        </div>
                      </div>
                      {idx < architecture.length - 1 && (
                        <div className="flex justify-center py-1">
                          <div className="h-4 w-px bg-zinc-700" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* File tree preview */}
          <Card className="border-zinc-800 bg-zinc-900/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Code2 className="h-4 w-4 text-zinc-400" />
                Estimated Project Structure
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-mono text-xs text-zinc-500 leading-relaxed">
                <div className="text-zinc-300">{projectName || "project"}/</div>
                <div className="pl-4">
                  {selectedTech.some((t) =>
                    ["nextjs", "react-spa", "vue", "svelte"].includes(t)
                  ) && (
                    <>
                      <div>src/</div>
                      <div className="pl-4 text-zinc-600">
                        components/
                        <br />
                        pages/
                        <br />
                        styles/
                        <br />
                        lib/
                      </div>
                    </>
                  )}
                  {selectedTech.some((t) =>
                    ["express", "fastify", "hono", "go"].includes(t)
                  ) && (
                    <>
                      <div>api/</div>
                      <div className="pl-4 text-zinc-600">
                        routes/
                        <br />
                        middleware/
                        <br />
                        services/
                      </div>
                    </>
                  )}
                  {selectedTech.some((t) =>
                    ["postgres", "mysql", "sqlite", "mongodb"].includes(t)
                  ) && (
                    <>
                      <div>db/</div>
                      <div className="pl-4 text-zinc-600">
                        schema/
                        <br />
                        migrations/
                        <br />
                        seeds/
                      </div>
                    </>
                  )}
                  <div className="text-zinc-600">
                    tests/
                    <br />
                    package.json
                    <br />
                    tsconfig.json
                    <br />
                    {selectedTech.includes("docker") && (
                      <>
                        Dockerfile
                        <br />
                        docker-compose.yml
                        <br />
                      </>
                    )}
                    .env.example
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Step 3: Review & Confirm */}
      {step === 3 && (
        <div className="space-y-4">
          <Card className="border-zinc-800 bg-zinc-900/50">
            <CardHeader>
              <CardTitle className="text-sm">Project Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="text-xs text-zinc-500">Project Name</div>
                  <div className="mt-0.5 font-medium text-sm text-zinc-200">
                    {projectName}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500">Tech Stack Preset</div>
                  <div className="mt-0.5 font-medium text-sm text-zinc-200">
                    {getTechStackPreset()}
                  </div>
                </div>
              </div>

              <div>
                <div className="text-xs text-zinc-500">Description</div>
                <div className="mt-0.5 text-sm text-zinc-300">
                  {description}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-xs text-zinc-500">
                  Selected Technologies
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {selectedTech.map((techId) => {
                    const tech = TECH_OPTIONS.find((t) => t.id === techId);
                    return (
                      <Badge key={techId} variant="outline">
                        {tech?.name ?? techId}
                      </Badge>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-xs text-zinc-500">
                  Architecture Layers
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {architecture.map((layer) => (
                    <Badge key={layer.name} variant="outline">
                      {layer.name} ({layer.components.length} components)
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-900/50">
            <CardContent className="p-4">
              <div className="flex items-center gap-3 text-sm text-zinc-400">
                <Sparkles className="h-5 w-5 shrink-0 text-violet-400" />
                <p>
                  PROMETHEUS will analyze your description, generate an optimal
                  architecture, and scaffold the full project with
                  production-ready code, tests, and CI/CD configuration.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Navigation buttons */}
      <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <div>
          {step > 0 && (
            <Button onClick={() => setStep((s) => s - 1)} variant="outline">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Back
            </Button>
          )}
        </div>

        <div className="flex items-center gap-3">
          {step < 3 ? (
            <Button
              disabled={!canAdvance[step]}
              onClick={() => setStep((s) => s + 1)}
            >
              Next
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          ) : (
            <Button
              disabled={isCreating || !projectName.trim()}
              onClick={handleCreate}
            >
              {isCreating ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Sparkles className="mr-1.5 h-4 w-4" />
                  Create Project
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
