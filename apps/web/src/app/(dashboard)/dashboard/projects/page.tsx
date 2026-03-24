"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  Card,
  CardContent,
} from "@prometheus/ui";
import { Archive, Brain, FolderOpen, Plus, Zap } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const STATUS_VARIANTS: Record<string, "success" | "warning" | "outline"> = {
  active: "success",
  setup: "warning",
  archived: "outline",
};

export default function ProjectsPage() {
  const [statusFilter, setStatusFilter] = useState<
    "active" | "archived" | "setup" | undefined
  >(undefined);

  const projectsQuery = trpc.projects.list.useQuery(
    {
      limit: 50,
      status: statusFilter,
    },
    { retry: 2 }
  );
  const deleteMutation = trpc.projects.delete.useMutation();

  const projects = projectsQuery.data?.projects ?? [];

  async function handleArchive(projectId: string) {
    try {
      await deleteMutation.mutateAsync({ projectId });
      projectsQuery.refetch();
      toast.success("Project archived");
    } catch {
      toast.error("Failed to archive project");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-2xl text-foreground">Projects</h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Manage your engineering projects.
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/projects/new">
            <Plus className="mr-1 h-4 w-4" />
            New Project
          </Link>
        </Button>
      </div>

      <div className="flex gap-2">
        {(
          [
            { value: undefined, label: "All" },
            { value: "active", label: "Active" },
            { value: "setup", label: "Setup" },
            { value: "archived", label: "Archived" },
          ] as const
        ).map((filter) => (
          <Button
            key={filter.label}
            onClick={() => setStatusFilter(filter.value)}
            size="sm"
            variant={statusFilter === filter.value ? "default" : "outline"}
          >
            {filter.label}
          </Button>
        ))}
      </div>

      {projectsQuery.isLoading && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={`skeleton-${i.toString()}`}>
              <CardContent className="p-5">
                <div className="h-4 w-16 animate-pulse rounded bg-muted" />
                <div className="mt-3 h-5 w-40 animate-pulse rounded bg-muted" />
                <div className="mt-2 h-3 w-full animate-pulse rounded bg-muted" />
                <div className="mt-4 h-3 w-24 animate-pulse rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {!projectsQuery.isLoading && projects.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="p-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <FolderOpen className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="mt-4 text-muted-foreground text-sm">
              No projects yet
            </p>
            <p className="mt-1 text-muted-foreground/60 text-xs">
              Create your first project to get started.
            </p>
            <Button asChild className="mt-4" size="sm">
              <Link href="/dashboard/projects/new">Create Project</Link>
            </Button>
          </CardContent>
        </Card>
      )}
      {!projectsQuery.isLoading && projects.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => {
            const badgeVariant = STATUS_VARIANTS[project.status] ?? "outline";
            return (
              <Card
                className="group transition-colors hover:border-muted-foreground/30"
                key={project.id}
              >
                <CardContent className="p-5">
                  <div className="flex items-center justify-between">
                    <Badge variant={badgeVariant}>{project.status}</Badge>
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button asChild size="icon" variant="ghost">
                        <Link
                          href={
                            `/dashboard/projects/${project.id}/brain` as Route
                          }
                          title="Project Brain"
                        >
                          <Brain className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="icon" variant="ghost">
                            <Archive className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Archive Project</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to archive &quot;
                              {project.name}&quot;?
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleArchive(project.id)}
                            >
                              Archive
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>

                  <h3 className="mt-3 font-semibold text-foreground text-sm">
                    {project.name}
                  </h3>
                  {project.description && (
                    <p className="mt-1 line-clamp-2 text-muted-foreground text-xs">
                      {project.description}
                    </p>
                  )}

                  <div className="mt-4 flex items-center gap-3 text-[10px] text-muted-foreground">
                    {project.techStackPreset && (
                      <Badge variant="secondary">
                        {project.techStackPreset}
                      </Badge>
                    )}
                    <span>
                      Created {new Date(project.createdAt).toLocaleDateString()}
                    </span>
                  </div>

                  <div className="mt-3 flex gap-2">
                    <Button
                      asChild
                      className="flex-1"
                      size="sm"
                      variant="outline"
                    >
                      <Link
                        href={
                          `/dashboard/projects/${project.id}/brain` as Route
                        }
                      >
                        Brain
                      </Link>
                    </Button>
                    <Button
                      asChild
                      className="flex-1"
                      size="sm"
                      variant="ghost"
                    >
                      <Link href={`/new?projectId=${project.id}`}>
                        <Zap className="mr-1 h-3 w-3" />
                        New Task
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
