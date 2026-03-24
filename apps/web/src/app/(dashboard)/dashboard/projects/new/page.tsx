"use client";

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Textarea,
} from "@prometheus/ui";
import { CheckCircle, Loader2 } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { logger } from "@/lib/logger";
import { trpc } from "@/lib/trpc";

const PRESETS = [
  {
    id: "modern-saas",
    name: "Modern SaaS",
    desc: "Next.js + tRPC + Drizzle + PostgreSQL",
  },
  {
    id: "fullstack-minimal",
    name: "Full-Stack Minimal",
    desc: "Next.js + Prisma + SQLite",
  },
  {
    id: "django-react",
    name: "Django + React",
    desc: "Django REST + React SPA",
  },
  { id: "rails", name: "Rails + Hotwire", desc: "Ruby on Rails full-stack" },
  {
    id: "go-microservices",
    name: "Go Microservices",
    desc: "Go + gRPC + PostgreSQL",
  },
  {
    id: "laravel-vue",
    name: "Laravel + Vue",
    desc: "Laravel API + Vue.js frontend",
  },
  {
    id: "react-native",
    name: "React Native",
    desc: "Expo + React Native mobile",
  },
  {
    id: "rust-backend",
    name: "Rust Backend",
    desc: "Axum + SQLx + PostgreSQL",
  },
  { id: "custom", name: "Custom", desc: "Define your own tech stack" },
];

const STEPS = ["Details", "Tech Stack", "Confirm"] as const;

export default function NewProjectPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [preset, setPreset] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const createMutation = trpc.projects.create.useMutation();

  async function handleCreate() {
    if (!(name.trim() && preset)) {
      return;
    }
    setIsCreating(true);
    try {
      const project = await createMutation.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        techStackPreset: preset,
        repoUrl: repoUrl.trim() || undefined,
      });
      toast.success("Project created!");
      router.push(`/dashboard/projects/${project?.id}/brain` as Route);
    } catch (err) {
      logger.error("Failed to create project:", err);
      toast.error("Failed to create project");
      setIsCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-bold text-2xl text-foreground">
          Create New Project
        </h1>
        <div className="mt-3 flex items-center gap-3">
          {STEPS.map((label, i) => {
            const s = i + 1;
            return (
              <div className="flex items-center gap-2" key={label}>
                <div
                  className={`flex h-6 w-6 items-center justify-center rounded-full font-medium text-xs ${
                    step >= s
                      ? "bg-primary text-primary-foreground"
                      : "border text-muted-foreground"
                  }`}
                >
                  {step > s ? <CheckCircle className="h-4 w-4" /> : s}
                </div>
                <span
                  className={`text-xs ${
                    step >= s
                      ? "font-medium text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {label}
                </span>
                {s < 3 && <div className="mx-1 h-px w-8 bg-border" />}
              </div>
            );
          })}
        </div>
      </div>

      {step === 1 && (
        <Card>
          <CardContent className="space-y-4 p-6">
            <div>
              <Label htmlFor="project-name">Project Name</Label>
              <Input
                className="mt-1.5"
                id="project-name"
                onChange={(e) => setName(e.target.value)}
                placeholder="My Awesome SaaS"
                value={name}
              />
            </div>
            <div>
              <Label htmlFor="project-description">Description</Label>
              <Textarea
                className="mt-1.5"
                id="project-description"
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what you want to build..."
                rows={4}
                value={description}
              />
            </div>
            <div>
              <Label htmlFor="project-repo-url">
                Repository URL{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Input
                className="mt-1.5"
                id="project-repo-url"
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/org/repo"
                value={repoUrl}
              />
            </div>
            <div className="flex justify-end">
              <Button disabled={!name.trim()} onClick={() => setStep(2)}>
                Next
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            {PRESETS.map((p) => (
              <button
                className={`rounded-xl border p-4 text-left transition-all ${
                  preset === p.id
                    ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                    : "border-border bg-card hover:border-muted-foreground/30"
                }`}
                key={p.id}
                onClick={() => setPreset(p.id)}
                type="button"
              >
                <div className="font-medium text-foreground text-sm">
                  {p.name}
                </div>
                <div className="mt-1 text-muted-foreground text-xs">
                  {p.desc}
                </div>
              </button>
            ))}
          </div>
          <div className="flex justify-between">
            <Button onClick={() => setStep(1)} variant="outline">
              Back
            </Button>
            <Button disabled={!preset} onClick={() => setStep(3)}>
              Next
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <div className="text-muted-foreground text-xs">Name</div>
                  <div className="mt-0.5 font-medium text-foreground text-sm">
                    {name}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">
                    Tech Stack
                  </div>
                  <div className="mt-0.5 font-medium text-foreground text-sm">
                    {PRESETS.find((p) => p.id === preset)?.name}
                  </div>
                </div>
                {description && (
                  <div className="md:col-span-2">
                    <div className="text-muted-foreground text-xs">
                      Description
                    </div>
                    <div className="mt-0.5 text-foreground text-sm">
                      {description}
                    </div>
                  </div>
                )}
                {repoUrl && (
                  <div className="md:col-span-2">
                    <div className="text-muted-foreground text-xs">
                      Repository
                    </div>
                    <div className="mt-0.5 font-mono text-foreground text-sm">
                      {repoUrl}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
          <div className="flex justify-between">
            <Button onClick={() => setStep(2)} variant="outline">
              Back
            </Button>
            <Button disabled={isCreating} onClick={handleCreate}>
              {isCreating ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Project"
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
