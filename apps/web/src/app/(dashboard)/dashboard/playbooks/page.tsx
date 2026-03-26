"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@prometheus/ui";
import {
  BookOpen,
  ChevronRight,
  Loader2,
  Play,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const CATEGORIES = [
  { value: "all", label: "All" },
  { value: "code_quality", label: "Code Quality" },
  { value: "feature", label: "Feature" },
  { value: "devops", label: "DevOps" },
  { value: "testing", label: "Testing" },
  { value: "security", label: "Security" },
  { value: "refactoring", label: "Refactoring" },
  { value: "custom", label: "Custom" },
] as const;

type CategoryValue = (typeof CATEGORIES)[number]["value"];

const CATEGORY_COLORS: Record<string, string> = {
  code_quality: "bg-blue-500/10 text-blue-600",
  feature: "bg-green-500/10 text-green-600",
  devops: "bg-orange-500/10 text-orange-600",
  testing: "bg-purple-500/10 text-purple-600",
  security: "bg-red-500/10 text-red-600",
  refactoring: "bg-yellow-500/10 text-yellow-600",
  custom: "bg-gray-500/10 text-gray-600",
};

interface PlaybookParameter {
  default?: boolean | number | string;
  description?: string | null;
  name: string;
  options?: string[];
  required?: boolean;
  type: string;
}

function ParameterInput({
  param,
  value,
  onChange,
}: {
  onChange: (name: string, value: unknown) => void;
  param: PlaybookParameter;
  value: unknown;
}) {
  if (param.type === "boolean") {
    return (
      <Switch
        checked={Boolean(value)}
        onCheckedChange={(checked) => onChange(param.name, checked)}
      />
    );
  }

  if (param.type === "select" && param.options) {
    return (
      <Select
        onValueChange={(v) => onChange(param.name, v)}
        value={String(value ?? "")}
      >
        <SelectTrigger>
          <SelectValue placeholder={`Select ${param.name}`} />
        </SelectTrigger>
        <SelectContent>
          {param.options.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (param.type === "number") {
    return (
      <Input
        onChange={(e) => onChange(param.name, Number(e.target.value))}
        placeholder={
          param.default === undefined ? undefined : String(param.default)
        }
        type="number"
        value={String(value ?? "")}
      />
    );
  }

  return (
    <Input
      onChange={(e) => onChange(param.name, e.target.value)}
      placeholder={
        param.default === undefined ? undefined : String(param.default)
      }
      value={String(value ?? "")}
    />
  );
}

export default function PlaybooksPage() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<CategoryValue>("all");
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [selectedPlaybook, setSelectedPlaybook] = useState<{
    id: string;
    name: string;
    parameters: unknown;
  } | null>(null);
  const [runParams, setRunParams] = useState<Record<string, unknown>>({});
  const [selectedProjectId, setSelectedProjectId] = useState("");

  const playbooksQuery = trpc.playbooks.list.useQuery(
    {
      search: search || undefined,
      category:
        category === "all"
          ? undefined
          : (category as Exclude<CategoryValue, "all">),
      limit: 24,
    },
    { retry: 2 }
  );

  const projectsQuery = trpc.projects.list.useQuery(
    { limit: 50 },
    { retry: 2 }
  );

  const runMutation = trpc.playbooks.run.useMutation();

  const playbooks = playbooksQuery.data?.playbooks ?? [];
  const projects = projectsQuery.data?.projects ?? [];

  function openRunDialog(playbook: {
    id: string;
    name: string;
    parameters: unknown;
  }) {
    setSelectedPlaybook(playbook);
    const params = Array.isArray(playbook.parameters)
      ? (playbook.parameters as PlaybookParameter[])
      : [];
    const defaults: Record<string, unknown> = {};
    for (const param of params) {
      if (param.default !== undefined) {
        defaults[param.name] = param.default;
      }
    }
    setRunParams(defaults);
    setSelectedProjectId(projects[0]?.id ?? "");
    setRunDialogOpen(true);
  }

  async function handleRun() {
    if (!(selectedPlaybook && selectedProjectId)) {
      toast.error("Please select a project");
      return;
    }

    try {
      await runMutation.mutateAsync({
        playbookId: selectedPlaybook.id,
        projectId: selectedProjectId,
        parameters: runParams,
      });
      toast.success(`Playbook "${selectedPlaybook.name}" started`);
      setRunDialogOpen(false);
      setSelectedPlaybook(null);
    } catch {
      toast.error("Failed to start playbook run");
    }
  }

  function getDialogParams(): PlaybookParameter[] {
    if (!selectedPlaybook) {
      return [];
    }
    if (Array.isArray(selectedPlaybook.parameters)) {
      return selectedPlaybook.parameters as PlaybookParameter[];
    }
    return [];
  }

  const dialogParams = getDialogParams();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-2xl text-foreground">Playbooks</h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Pre-built automation workflows for common engineering tasks.
          </p>
        </div>
        <Button asChild>
          <Link href={"/dashboard/playbooks/new" as Route}>
            <Plus className="mr-1 h-4 w-4" />
            Create Custom
          </Link>
        </Button>
      </div>

      {/* Category filter tabs */}
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((cat) => (
          <Button
            key={cat.value}
            onClick={() => setCategory(cat.value)}
            size="sm"
            variant={category === cat.value ? "default" : "outline"}
          >
            {cat.label}
          </Button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search playbooks..."
          value={search}
        />
      </div>

      {/* Loading */}
      {playbooksQuery.isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!playbooksQuery.isLoading && playbooks.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="p-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <BookOpen className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="mt-4 text-muted-foreground text-sm">
              No playbooks found
            </p>
            <p className="mt-1 text-muted-foreground/60 text-xs">
              Try adjusting your search or filters.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Playbook Cards */}
      {!playbooksQuery.isLoading && playbooks.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {playbooks.map((playbook) => {
            const steps = Array.isArray(playbook.steps)
              ? (playbook.steps as { order: number; title: string }[])
              : [];
            const tags = Array.isArray(playbook.tags)
              ? (playbook.tags as string[])
              : [];

            return (
              <Card
                className="group relative transition-shadow hover:shadow-md"
                key={playbook.id}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="mb-1.5 flex items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded-md px-2 py-0.5 font-medium text-xs ${
                            CATEGORY_COLORS[playbook.category] ??
                            CATEGORY_COLORS.custom
                          }`}
                        >
                          {playbook.category.replace("_", " ")}
                        </span>
                        {playbook.isBuiltin && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 font-medium text-amber-600 text-xs">
                            <Sparkles className="h-3 w-3" />
                            Built-in
                          </span>
                        )}
                      </div>
                      <CardTitle className="text-base">
                        {playbook.name}
                      </CardTitle>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {playbook.description && (
                    <p className="line-clamp-2 text-muted-foreground text-sm">
                      {playbook.description}
                    </p>
                  )}

                  {/* Steps preview */}
                  {steps.length > 0 && (
                    <div className="space-y-1">
                      {steps.slice(0, 3).map((step) => (
                        <div
                          className="flex items-center gap-2 text-muted-foreground text-xs"
                          key={step.order}
                        >
                          <ChevronRight className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{step.title}</span>
                        </div>
                      ))}
                      {steps.length > 3 && (
                        <p className="text-muted-foreground/60 text-xs">
                          +{steps.length - 3} more steps
                        </p>
                      )}
                    </div>
                  )}

                  {/* Tags */}
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {tags.slice(0, 4).map((tag) => (
                        <Badge
                          className="text-[10px]"
                          key={tag}
                          variant="secondary"
                        >
                          {tag}
                        </Badge>
                      ))}
                      {tags.length > 4 && (
                        <Badge className="text-[10px]" variant="outline">
                          +{tags.length - 4}
                        </Badge>
                      )}
                    </div>
                  )}

                  {/* Footer */}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-muted-foreground text-xs">
                      {playbook.usageCount} runs
                    </span>
                    <Button
                      onClick={() =>
                        openRunDialog({
                          id: playbook.id,
                          name: playbook.name,
                          parameters: playbook.parameters,
                        })
                      }
                      size="sm"
                      variant="default"
                    >
                      <Play className="mr-1 h-3 w-3" />
                      Run
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Load more */}
      {playbooksQuery.data?.nextCursor && (
        <div className="flex justify-center">
          <Button
            disabled={playbooksQuery.isFetching}
            onClick={() => playbooksQuery.refetch()}
            variant="outline"
          >
            Load More
          </Button>
        </div>
      )}

      {/* Run Playbook Dialog */}
      <Dialog onOpenChange={setRunDialogOpen} open={runDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Run Playbook</DialogTitle>
            <DialogDescription>
              Configure parameters for &quot;{selectedPlaybook?.name}&quot;
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Project selector */}
            <div className="space-y-2">
              <Label>Project</Label>
              <Select
                onValueChange={setSelectedProjectId}
                value={selectedProjectId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Dynamic parameters */}
            {dialogParams.map((param) => (
              <div className="space-y-2" key={param.name}>
                <Label>
                  {param.name.replace(/_/g, " ")}
                  {param.required && (
                    <span className="ml-1 text-red-500">*</span>
                  )}
                </Label>
                {param.description && (
                  <p className="text-muted-foreground text-xs">
                    {param.description}
                  </p>
                )}
                <ParameterInput
                  onChange={(name, val) =>
                    setRunParams((prev) => ({ ...prev, [name]: val }))
                  }
                  param={param}
                  value={runParams[param.name]}
                />
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button onClick={() => setRunDialogOpen(false)} variant="outline">
              Cancel
            </Button>
            <Button
              disabled={runMutation.isPending || !selectedProjectId}
              onClick={handleRun}
            >
              {runMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              <Play className="mr-1 h-4 w-4" />
              Run Playbook
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
