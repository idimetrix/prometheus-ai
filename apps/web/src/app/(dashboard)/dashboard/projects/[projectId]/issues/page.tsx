"use client";

import { Badge, Button, Card, CardContent } from "@prometheus/ui";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ExternalLink,
  GitPullRequest,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import {
  IssueList,
  type SyncedIssueItem,
} from "@/components/project/issue-list";
import { trpc } from "@/lib/trpc";

type ProviderFilter =
  | "github"
  | "gitlab"
  | "bitbucket"
  | "linear"
  | "jira"
  | undefined;
type StatusFilter = string | undefined;
type AssignedFilter = boolean | undefined;

function getCIBadgeVariant(
  status: string
): "success" | "destructive" | "outline" {
  if (status === "passed") {
    return "success";
  }
  if (status === "failed") {
    return "destructive";
  }
  return "outline";
}

function getReviewBadgeVariant(
  status: string
): "success" | "warning" | "outline" {
  if (status === "approved") {
    return "success";
  }
  if (status === "changes_requested") {
    return "warning";
  }
  return "outline";
}

function IssuesSection({
  isLoading,
  issues,
  onAssign,
  onSync,
  onUnlink,
}: {
  isLoading: boolean;
  issues: SyncedIssueItem[];
  onAssign: (id: string) => void;
  onSync: () => void;
  onUnlink: (id: string) => void;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (issues.length === 0) {
    return (
      <EmptyState
        action={{ label: "Sync Issues", onClick: onSync }}
        description="Sync issues from your connected provider to start."
        title="No synced issues"
      />
    );
  }

  return <IssueList issues={issues} onAssign={onAssign} onUnlink={onUnlink} />;
}

function PRsSection({
  isLoading,
  prs,
}: {
  isLoading: boolean;
  prs: Array<{
    baseBranch: string | null;
    branch: string | null;
    ciStatus: string | null;
    externalId: string;
    externalUrl: string | null;
    id: string;
    reviewStatus: string | null;
    title: string | null;
  }>;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (prs.length === 0) {
    return (
      <EmptyState
        description="Synced pull requests will appear here."
        title="No synced pull requests"
      />
    );
  }

  return (
    <div className="space-y-2">
      {prs.map((pr) => (
        <Card key={pr.id}>
          <CardContent className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <GitPullRequest className="h-4 w-4 text-violet-400" />
              <div>
                <p className="font-medium text-sm text-zinc-200">
                  {pr.title ?? `PR #${pr.externalId}`}
                </p>
                <p className="text-xs text-zinc-500">
                  {pr.branch ?? "unknown"} → {pr.baseBranch ?? "main"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {pr.ciStatus && (
                <Badge variant={getCIBadgeVariant(pr.ciStatus)}>
                  {pr.ciStatus === "passed" && (
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                  )}
                  {pr.ciStatus}
                </Badge>
              )}
              {pr.reviewStatus && (
                <Badge variant={getReviewBadgeVariant(pr.reviewStatus)}>
                  {pr.reviewStatus}
                </Badge>
              )}
              {pr.externalUrl && (
                <a
                  className="text-zinc-400 hover:text-zinc-200"
                  href={pr.externalUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function ProjectIssuesPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;

  const [providerFilter, setProviderFilter] =
    useState<ProviderFilter>(undefined);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(undefined);
  const [assignedFilter, setAssignedFilter] =
    useState<AssignedFilter>(undefined);
  const [syncing, setSyncing] = useState(false);

  const issuesQuery = trpc.issueSync.listSyncedIssues.useQuery(
    {
      projectId,
      provider: providerFilter,
      status: statusFilter,
      assignedToAgent: assignedFilter,
      limit: 50,
    },
    { retry: 2 }
  );

  const prsQuery = trpc.issueSync.listSyncedPRs.useQuery(
    { projectId, limit: 50 },
    { retry: 2 }
  );

  const syncStatusQuery = trpc.issueSync.getSyncStatus.useQuery(
    { projectId },
    { retry: 1 }
  );

  const syncIssuesMutation = trpc.issueSync.syncIssues.useMutation();
  const syncPRsMutation = trpc.issueSync.syncPRs.useMutation();
  const assignMutation = trpc.issueSync.assignToAgent.useMutation();
  const unlinkMutation = trpc.issueSync.unlinkIssue.useMutation();

  const issues = issuesQuery.data?.items ?? [];
  const prs = prsQuery.data?.items ?? [];
  const syncStatus = syncStatusQuery.data;

  async function handleSync(
    provider: "github" | "gitlab" | "bitbucket" | "linear" | "jira"
  ) {
    setSyncing(true);
    try {
      await Promise.all([
        syncIssuesMutation.mutateAsync({ projectId, provider }),
        syncPRsMutation.mutateAsync({ projectId, provider }),
      ]);
      await Promise.all([
        issuesQuery.refetch(),
        prsQuery.refetch(),
        syncStatusQuery.refetch(),
      ]);
      toast.success("Sync complete");
    } catch {
      toast.error("Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function handleAssign(issueId: string) {
    try {
      await assignMutation.mutateAsync({ issueId });
      await issuesQuery.refetch();
      toast.success("Issue assigned to agent");
    } catch {
      toast.error("Failed to assign issue");
    }
  }

  async function handleUnlink(issueId: string) {
    try {
      await unlinkMutation.mutateAsync({ issueId });
      await issuesQuery.refetch();
      toast.success("Issue unlinked");
    } catch {
      toast.error("Failed to unlink issue");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-semibold text-xl text-zinc-100">
            Issues & Pull Requests
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Synced from external providers. Assign issues to the AI agent for
            automated resolution.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {syncStatus?.lastSyncedAt && (
            <span className="text-xs text-zinc-500">
              Last synced: {new Date(syncStatus.lastSyncedAt).toLocaleString()}
            </span>
          )}
          <Button
            disabled={syncing}
            onClick={() => handleSync("github")}
            size="sm"
            variant="outline"
          >
            {syncing ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-3 w-3" />
            )}
            Sync Now
          </Button>
        </div>
      </div>

      {/* Sync Status Cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-zinc-400" />
              <span className="text-sm text-zinc-400">Issues</span>
            </div>
            <p className="mt-1 font-semibold text-2xl text-zinc-100">
              {syncStatus?.issueCount ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <GitPullRequest className="h-4 w-4 text-zinc-400" />
              <span className="text-sm text-zinc-400">Pull Requests</span>
            </div>
            <p className="mt-1 font-semibold text-2xl text-zinc-100">
              {syncStatus?.prCount ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-zinc-400" />
              <span className="text-sm text-zinc-400">Agent Assigned</span>
            </div>
            <p className="mt-1 font-semibold text-2xl text-zinc-100">
              {issues.filter((i) => i.assignedToAgent).length}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <select
          className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300"
          onChange={(e) =>
            setProviderFilter(
              e.target.value === ""
                ? undefined
                : (e.target.value as ProviderFilter)
            )
          }
          value={providerFilter ?? ""}
        >
          <option value="">All Providers</option>
          <option value="github">GitHub</option>
          <option value="gitlab">GitLab</option>
          <option value="bitbucket">Bitbucket</option>
          <option value="linear">Linear</option>
          <option value="jira">Jira</option>
        </select>

        <select
          className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300"
          onChange={(e) =>
            setStatusFilter(e.target.value === "" ? undefined : e.target.value)
          }
          value={statusFilter ?? ""}
        >
          <option value="">All Statuses</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="in_progress">In Progress</option>
        </select>

        <select
          className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300"
          onChange={(e) =>
            setAssignedFilter(
              e.target.value === "" ? undefined : e.target.value === "true"
            )
          }
          value={assignedFilter === undefined ? "" : String(assignedFilter)}
        >
          <option value="">All</option>
          <option value="true">Agent Assigned</option>
          <option value="false">Unassigned</option>
        </select>
      </div>

      {/* Issues List */}
      <div>
        <h2 className="mb-3 font-medium text-sm text-zinc-300">Issues</h2>
        <IssuesSection
          isLoading={issuesQuery.isLoading}
          issues={issues}
          onAssign={handleAssign}
          onSync={() => handleSync("github")}
          onUnlink={handleUnlink}
        />
      </div>

      {/* PRs List */}
      <div>
        <h2 className="mb-3 font-medium text-sm text-zinc-300">
          Pull Requests
        </h2>
        <PRsSection isLoading={prsQuery.isLoading} prs={prs} />
      </div>
    </div>
  );
}
