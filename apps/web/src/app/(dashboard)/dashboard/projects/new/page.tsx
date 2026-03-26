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
import {
  CheckCircle,
  Code,
  FileText,
  Loader2,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  type TemplateDefinition,
  TemplateGallery,
} from "@/components/project/template-gallery";
import { logger } from "@/lib/logger";
import { trpc } from "@/lib/trpc";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CreationMode = "template" | "prompt";

const STEPS = ["Details", "Method", "Configure", "Confirm"] as const;

// ---------------------------------------------------------------------------
// File preview component
// ---------------------------------------------------------------------------

function FilePreview({
  files,
}: {
  files: Array<{ content: string; path: string }>;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border bg-card p-3">
      <div className="mb-2 flex items-center gap-1.5 text-muted-foreground text-xs">
        <FileText className="h-3.5 w-3.5" />
        <span>{files.length} files will be generated</span>
      </div>
      {files.map((file) => (
        <div key={file.path}>
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left font-mono text-xs hover:bg-muted/50"
            onClick={() =>
              setExpanded(expanded === file.path ? null : file.path)
            }
            type="button"
          >
            <Code className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="truncate text-foreground">{file.path}</span>
          </button>
          {expanded === file.path && (
            <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted/30 p-2 font-mono text-[11px] text-foreground/80 leading-relaxed">
              {file.content.slice(0, 2000)}
              {file.content.length > 2000 && "\n... (truncated)"}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function NewProjectPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<CreationMode>("template");
  const [selectedTemplate, setSelectedTemplate] =
    useState<TemplateDefinition | null>(null);
  const [prompt, setPrompt] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [previewFiles, setPreviewFiles] = useState<Array<{
    content: string;
    path: string;
  }> | null>(null);

  const scaffoldMutation = trpc.projects.scaffold.useMutation();

  function getSubmitLabel(): string {
    if (isCreating) {
      return mode === "template" ? "Scaffolding..." : "Creating...";
    }
    return mode === "template" ? "Scaffold Project" : "Create Project";
  }

  function handleTemplateSelect(template: TemplateDefinition) {
    setSelectedTemplate(template);
    // Clear preview when selecting new template
    setPreviewFiles(null);
  }

  async function handleCreate() {
    if (!name.trim()) {
      return;
    }
    if (mode === "template" && !selectedTemplate) {
      return;
    }
    if (mode === "prompt" && !prompt.trim()) {
      return;
    }

    setIsCreating(true);
    try {
      const result = await scaffoldMutation.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        template: mode === "template" ? selectedTemplate?.id : undefined,
        prompt: mode === "prompt" ? prompt.trim() : undefined,
      });

      if (result.scaffoldedFiles) {
        setPreviewFiles(result.scaffoldedFiles);
      }

      toast.success(
        mode === "template"
          ? "Project scaffolded from template!"
          : "Project created! An agent session will generate your files."
      );
      router.push(`/dashboard/projects/${result.project.id}/brain` as Route);
    } catch (err) {
      logger.error("Failed to scaffold project:", err);
      toast.error("Failed to create project");
      setIsCreating(false);
    }
  }

  const canProceedStep2 = name.trim().length > 0;
  const canProceedStep3 =
    mode === "template" ? selectedTemplate !== null : prompt.trim().length > 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-bold text-2xl text-foreground">
          Create New Project
        </h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Start from a template or describe what you want to build.
        </p>
        {/* Step indicator */}
        <div className="mt-4 flex items-center gap-3">
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
                {s < STEPS.length && (
                  <div className="mx-1 h-px w-8 bg-border" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Step 1: Project details */}
      {step === 1 && (
        <Card>
          <CardContent className="space-y-4 p-6">
            <div>
              <Label htmlFor="project-name">Project Name</Label>
              <Input
                className="mt-1.5"
                id="project-name"
                onChange={(e) => setName(e.target.value)}
                placeholder="my-awesome-app"
                value={name}
              />
            </div>
            <div>
              <Label htmlFor="project-description">
                Description{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Textarea
                className="mt-1.5"
                id="project-description"
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A brief description of your project..."
                rows={3}
                value={description}
              />
            </div>
            <div className="flex justify-end">
              <Button disabled={!canProceedStep2} onClick={() => setStep(2)}>
                Next
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Choose method */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <button
              className={`rounded-xl border p-6 text-left transition-all ${
                mode === "template"
                  ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                  : "border-border bg-card hover:border-muted-foreground/30"
              }`}
              onClick={() => setMode("template")}
              type="button"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Code className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div className="font-semibold text-foreground">
                    Start from Template
                  </div>
                  <div className="mt-0.5 text-muted-foreground text-xs">
                    Choose a pre-built project structure with best practices
                  </div>
                </div>
              </div>
            </button>
            <button
              className={`rounded-xl border p-6 text-left transition-all ${
                mode === "prompt"
                  ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                  : "border-border bg-card hover:border-muted-foreground/30"
              }`}
              onClick={() => setMode("prompt")}
              type="button"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Sparkles className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div className="font-semibold text-foreground">
                    Describe Your Project
                  </div>
                  <div className="mt-0.5 text-muted-foreground text-xs">
                    Tell us what you want and AI agents will scaffold it
                  </div>
                </div>
              </div>
            </button>
          </div>
          <div className="flex justify-between">
            <Button onClick={() => setStep(1)} variant="outline">
              Back
            </Button>
            <Button onClick={() => setStep(3)}>Next</Button>
          </div>
        </div>
      )}

      {/* Step 3: Configure (template selection or prompt) */}
      {step === 3 && mode === "template" && (
        <div className="space-y-4">
          <TemplateGallery
            onSelect={handleTemplateSelect}
            selected={selectedTemplate?.id ?? null}
          />
          <div className="flex justify-between">
            <Button onClick={() => setStep(2)} variant="outline">
              Back
            </Button>
            <Button disabled={!canProceedStep3} onClick={() => setStep(4)}>
              Next
            </Button>
          </div>
        </div>
      )}

      {step === 3 && mode === "prompt" && (
        <Card>
          <CardContent className="space-y-4 p-6">
            <div>
              <Label htmlFor="project-prompt">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  <span>Describe what you want to build</span>
                </div>
              </Label>
              <Textarea
                className="mt-2"
                id="project-prompt"
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="I want to build a SaaS platform for managing team tasks with real-time collaboration, user authentication, Stripe billing, and a dashboard with analytics charts..."
                rows={6}
                value={prompt}
              />
              <p className="mt-2 text-muted-foreground text-xs">
                Be specific about features, tech preferences, and integrations.
                The more detail, the better the scaffold.
              </p>
            </div>
            <div className="flex justify-between">
              <Button onClick={() => setStep(2)} variant="outline">
                Back
              </Button>
              <Button disabled={!canProceedStep3} onClick={() => setStep(4)}>
                Next
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Confirm */}
      {step === 4 && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Project Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="text-muted-foreground text-xs">Name</div>
                  <div className="mt-0.5 font-medium text-foreground text-sm">
                    {name}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Method</div>
                  <div className="mt-0.5 font-medium text-foreground text-sm">
                    {mode === "template"
                      ? `Template: ${selectedTemplate?.name}`
                      : "AI-Generated from Prompt"}
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
                {mode === "template" && selectedTemplate && (
                  <div className="md:col-span-2">
                    <div className="text-muted-foreground text-xs">
                      Tech Stack
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {selectedTemplate.techStack.map((tech) => (
                        <span
                          className="rounded-full bg-secondary px-2.5 py-0.5 text-secondary-foreground text-xs"
                          key={tech}
                        >
                          {tech}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {mode === "prompt" && (
                  <div className="md:col-span-2">
                    <div className="text-muted-foreground text-xs">Prompt</div>
                    <div className="mt-0.5 text-foreground text-sm">
                      {prompt.length > 200
                        ? `${prompt.slice(0, 200)}...`
                        : prompt}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* File preview for templates */}
          {previewFiles && previewFiles.length > 0 && (
            <FilePreview files={previewFiles} />
          )}

          <div className="flex justify-between">
            <Button onClick={() => setStep(3)} variant="outline">
              Back
            </Button>
            <Button disabled={isCreating} onClick={handleCreate}>
              {isCreating && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {getSubmitLabel()}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
