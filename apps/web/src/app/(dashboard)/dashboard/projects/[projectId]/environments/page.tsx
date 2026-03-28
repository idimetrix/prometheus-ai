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
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@prometheus/ui";
import {
  Cpu,
  HardDrive,
  Loader2,
  MemoryStick,
  Pause,
  Play,
  Plus,
  Power,
  Trash2,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/10 text-green-600",
  suspended: "bg-yellow-500/10 text-yellow-600",
  terminated: "bg-red-500/10 text-red-600",
};

const PURPOSE_LABELS: Record<string, string> = {
  dev: "Development",
  test: "Testing",
  staging: "Staging",
};

export default function EnvironmentsPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newEnvPurpose, setNewEnvPurpose] = useState<
    "dev" | "test" | "staging"
  >("dev");

  const envsQuery = trpc.persistentEnvs.list.useQuery(
    { projectId },
    { retry: 2 }
  );

  const createMutation = trpc.persistentEnvs.create.useMutation();
  const suspendMutation = trpc.persistentEnvs.suspend.useMutation();
  const resumeMutation = trpc.persistentEnvs.resume.useMutation();
  const destroyMutation = trpc.persistentEnvs.destroy.useMutation();

  const environments = envsQuery.data?.environments ?? [];

  async function handleCreate() {
    try {
      await createMutation.mutateAsync({
        projectId,
        purpose: newEnvPurpose,
      });
      toast.success("Environment created");
      setCreateDialogOpen(false);
      envsQuery.refetch();
    } catch {
      toast.error("Failed to create environment");
    }
  }

  async function handleSuspend(envId: string) {
    try {
      await suspendMutation.mutateAsync({ envId });
      toast.success("Environment suspended");
      envsQuery.refetch();
    } catch {
      toast.error("Failed to suspend environment");
    }
  }

  async function handleResume(envId: string) {
    try {
      await resumeMutation.mutateAsync({ envId });
      toast.success("Environment resumed");
      envsQuery.refetch();
    } catch {
      toast.error("Failed to resume environment");
    }
  }

  async function handleDestroy(envId: string) {
    try {
      await destroyMutation.mutateAsync({ envId });
      toast.success("Environment destroyed");
      envsQuery.refetch();
    } catch {
      toast.error("Failed to destroy environment");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-2xl text-foreground">Environments</h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Persistent development environments for this project.
          </p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          New Environment
        </Button>
      </div>

      {/* Loading */}
      {envsQuery.isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!envsQuery.isLoading && environments.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="p-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Power className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="mt-4 text-muted-foreground text-sm">
              No environments yet
            </p>
            <p className="mt-1 text-muted-foreground/60 text-xs">
              Create a persistent environment for development, testing, or
              staging.
            </p>
            <Button
              className="mt-4"
              onClick={() => setCreateDialogOpen(true)}
              size="sm"
            >
              <Plus className="mr-1 h-4 w-4" />
              Create Environment
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Environment Cards */}
      {!envsQuery.isLoading && environments.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {environments.map((env) => (
            <Card key={env.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">
                      {env.id.slice(0, 12)}
                    </CardTitle>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Badge
                        className={STATUS_COLORS[env.status] ?? ""}
                        variant="secondary"
                      >
                        {env.status}
                      </Badge>
                      <Badge variant="outline">
                        {PURPOSE_LABELS[env.purpose ?? "dev"] ?? env.purpose}
                      </Badge>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Resource usage (mock data) */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <Cpu className="h-3.5 w-3.5" />
                    <span>CPU: 12%</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <MemoryStick className="h-3.5 w-3.5" />
                    <span>Memory: 256MB / 1GB</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <HardDrive className="h-3.5 w-3.5" />
                    <span>Disk: 1.2GB / 10GB</span>
                  </div>
                </div>

                {/* Last activity */}
                {env.lastActivityAt && (
                  <p className="text-muted-foreground text-xs">
                    Last active:{" "}
                    {new Date(env.lastActivityAt).toLocaleDateString()}
                  </p>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 pt-1">
                  {env.status === "active" && (
                    <Button
                      disabled={suspendMutation.isPending}
                      onClick={() => handleSuspend(env.id)}
                      size="sm"
                      variant="outline"
                    >
                      <Pause className="mr-1 h-3 w-3" />
                      Suspend
                    </Button>
                  )}
                  {env.status === "suspended" && (
                    <Button
                      disabled={resumeMutation.isPending}
                      onClick={() => handleResume(env.id)}
                      size="sm"
                      variant="outline"
                    >
                      <Play className="mr-1 h-3 w-3" />
                      Resume
                    </Button>
                  )}
                  {env.status !== "terminated" && (
                    <Button
                      disabled={destroyMutation.isPending}
                      onClick={() => handleDestroy(env.id)}
                      size="sm"
                      variant="destructive"
                    >
                      <Trash2 className="mr-1 h-3 w-3" />
                      Destroy
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Environment Dialog */}
      <Dialog onOpenChange={setCreateDialogOpen} open={createDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Create Environment</DialogTitle>
            <DialogDescription>
              Create a new persistent development environment for this project.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Purpose</Label>
              <Select
                onValueChange={(v) =>
                  setNewEnvPurpose(v as "dev" | "test" | "staging")
                }
                value={newEnvPurpose}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select purpose" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dev">Development</SelectItem>
                  <SelectItem value="test">Testing</SelectItem>
                  <SelectItem value="staging">Staging</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              onClick={() => setCreateDialogOpen(false)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={createMutation.isPending} onClick={handleCreate}>
              {createMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
