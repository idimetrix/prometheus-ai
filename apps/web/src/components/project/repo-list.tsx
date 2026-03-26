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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@prometheus/ui";
import {
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
  Star,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const INDEX_STATUS_BADGE: Record<
  string,
  "outline" | "secondary" | "success" | "destructive"
> = {
  pending: "outline",
  indexing: "secondary",
  indexed: "success",
  failed: "destructive",
};

interface RepoListProps {
  projectId: string;
}

export function RepoList({ projectId }: RepoListProps) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [provider, setProvider] = useState<"github" | "gitlab" | "bitbucket">(
    "github"
  );
  const [defaultBranch, setDefaultBranch] = useState("main");

  const reposQuery = trpc.projects.repos.list.useQuery({ projectId });
  const addMutation = trpc.projects.repos.add.useMutation();
  const removeMutation = trpc.projects.repos.remove.useMutation();
  const reindexMutation = trpc.projects.repos.reindex.useMutation();
  const setDefaultMutation = trpc.projects.repos.setDefault.useMutation();

  const repos = reposQuery.data?.repos ?? [];

  async function handleAdd() {
    if (!repoUrl) {
      return;
    }
    try {
      await addMutation.mutateAsync({
        projectId,
        repoUrl,
        provider,
        defaultBranch,
      });
      setAddDialogOpen(false);
      setRepoUrl("");
      reposQuery.refetch();
      toast.success("Repository added");
    } catch {
      toast.error("Failed to add repository");
    }
  }

  async function handleRemove(repoId: string) {
    try {
      await removeMutation.mutateAsync({ projectId, repoId });
      reposQuery.refetch();
      toast.success("Repository removed");
    } catch {
      toast.error("Failed to remove repository");
    }
  }

  async function handleReindex(repoId: string) {
    try {
      await reindexMutation.mutateAsync({ projectId, repoId });
      reposQuery.refetch();
      toast.success("Reindex triggered");
    } catch {
      toast.error("Failed to trigger reindex");
    }
  }

  async function handleSetDefault(repoId: string) {
    try {
      await setDefaultMutation.mutateAsync({ projectId, repoId });
      reposQuery.refetch();
      toast.success("Default repository updated");
    } catch {
      toast.error("Failed to set default repository");
    }
  }

  function extractRepoName(url: string): string {
    const parts = url.split("/");
    return parts.at(-1)?.replace(".git", "") ?? url;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">Repositories</CardTitle>
        <Dialog onOpenChange={setAddDialogOpen} open={addDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-1 h-4 w-4" />
              Add Repository
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Repository</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="repo-url">Repository URL</Label>
                <Input
                  id="repo-url"
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/org/repo"
                  value={repoUrl}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="provider">Provider</Label>
                <Select
                  onValueChange={(v) =>
                    setProvider(v as "github" | "gitlab" | "bitbucket")
                  }
                  value={provider}
                >
                  <SelectTrigger id="provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="github">GitHub</SelectItem>
                    <SelectItem value="gitlab">GitLab</SelectItem>
                    <SelectItem value="bitbucket">Bitbucket</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="branch">Default Branch</Label>
                <Input
                  id="branch"
                  onChange={(e) => setDefaultBranch(e.target.value)}
                  placeholder="main"
                  value={defaultBranch}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                disabled={addMutation.isPending || !repoUrl}
                onClick={handleAdd}
              >
                {addMutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Add Repository
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {reposQuery.isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {!reposQuery.isLoading && repos.length === 0 && (
          <p className="py-8 text-center text-muted-foreground text-sm">
            No repositories connected. Add one to get started.
          </p>
        )}
        {!reposQuery.isLoading && repos.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Repository</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Tech Stack</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Indexed</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {repos.map((repo) => (
                <TableRow key={repo.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {extractRepoName(repo.repoUrl)}
                      {repo.isPrimary && (
                        <Badge variant="outline">Primary</Badge>
                      )}
                      {repo.isMonorepo && (
                        <Badge variant="secondary">Monorepo</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="capitalize">{repo.provider}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <GitBranch className="h-3 w-3" />
                      {repo.defaultBranch}
                    </div>
                  </TableCell>
                  <TableCell>
                    {repo.techStack ? (
                      <span className="text-xs">
                        {JSON.stringify(repo.techStack)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">--</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        INDEX_STATUS_BADGE[repo.indexStatus] ?? "outline"
                      }
                    >
                      {repo.indexStatus}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {repo.lastIndexedAt
                      ? new Date(repo.lastIndexedAt).toLocaleDateString()
                      : "--"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {!repo.isPrimary && (
                        <Button
                          aria-label="Set as default"
                          onClick={() => handleSetDefault(repo.id)}
                          size="icon"
                          title="Set as default"
                          variant="ghost"
                        >
                          <Star className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        aria-label="Reindex"
                        disabled={reindexMutation.isPending}
                        onClick={() => handleReindex(repo.id)}
                        size="icon"
                        title="Reindex"
                        variant="ghost"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        aria-label="Remove repository"
                        disabled={removeMutation.isPending}
                        onClick={() => handleRemove(repo.id)}
                        size="icon"
                        title="Remove"
                        variant="ghost"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
