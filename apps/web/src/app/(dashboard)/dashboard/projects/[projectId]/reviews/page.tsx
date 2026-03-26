"use client";

import { use, useCallback, useState } from "react";
import { toast } from "sonner";
import {
  type PendingReview,
  ReviewDashboard,
} from "@/components/code-review/review-dashboard";
import { trpc } from "@/lib/trpc";

export default function ReviewsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const [reviews, _setReviews] = useState<PendingReview[]>([]);

  const pullRequestsQuery = trpc.integrations.listPullRequests.useQuery(
    { projectId },
    {
      enabled: Boolean(projectId),
      refetchInterval: 30_000,
    }
  );

  // Transform PR data into PendingReview format
  const mappedReviews: PendingReview[] = (
    pullRequestsQuery.data?.pullRequests ?? []
  ).map((pr) => ({
    id: String(pr.number),
    title: pr.title,
    author: pr.author ?? "unknown",
    status: mapPrStatus(pr.status),
    updatedAt: pr.updatedAt ?? new Date().toISOString(),
    description: pr.description ?? undefined,
    diffs: (pr.diffs ?? []).map((d) => ({
      path: d.path,
      additions: d.additions ?? 0,
      deletions: d.deletions ?? 0,
      hunks: (d.hunks ?? []).map((h) => ({
        startLine: h.startLine ?? 1,
        lines: (h.lines ?? []).map((l) => ({
          lineNumber: l.lineNumber ?? 0,
          content: l.content ?? "",
          type: (l.type as "addition" | "deletion" | "context") ?? "context",
        })),
      })),
    })),
    comments: (pr.comments ?? []).map((c) => ({
      id: c.id ?? crypto.randomUUID(),
      author: c.author ?? "unknown",
      content: c.content ?? "",
      timestamp: c.timestamp ?? new Date().toISOString(),
      lineNumber: c.lineNumber ?? undefined,
      resolved: c.resolved ?? false,
    })),
  }));

  const allReviews = mappedReviews.length > 0 ? mappedReviews : reviews;

  const approveMutation = trpc.integrations.approvePullRequest.useMutation({
    onSuccess() {
      toast.success("PR approved!");
      pullRequestsQuery.refetch().catch(() => {
        // Background refresh — errors are non-critical
      });
    },
    onError(error) {
      toast.error(`Failed to approve: ${error.message}`);
    },
  });

  const commentMutation = trpc.integrations.commentOnPullRequest.useMutation({
    onSuccess() {
      toast.success("Comment added!");
      pullRequestsQuery.refetch().catch(() => {
        // Background refresh — errors are non-critical
      });
    },
    onError(error) {
      toast.error(`Failed to add comment: ${error.message}`);
    },
  });

  const requestChangesMutation =
    trpc.integrations.requestChangesPullRequest.useMutation({
      onSuccess() {
        toast.success("Changes requested.");
        pullRequestsQuery.refetch().catch(() => {
          // Background refresh — errors are non-critical
        });
      },
      onError(error) {
        toast.error(`Failed to request changes: ${error.message}`);
      },
    });

  const handleApprove = useCallback(
    (reviewId: string) => {
      approveMutation.mutate({
        projectId,
        prNumber: Number.parseInt(reviewId, 10),
      });
    },
    [projectId, approveMutation]
  );

  const handleComment = useCallback(
    (reviewId: string, comment: string) => {
      commentMutation.mutate({
        projectId,
        prNumber: Number.parseInt(reviewId, 10),
        comment,
      });
    },
    [projectId, commentMutation]
  );

  const handleRequestChanges = useCallback(
    (reviewId: string) => {
      requestChangesMutation.mutate({
        projectId,
        prNumber: Number.parseInt(reviewId, 10),
      });
    },
    [projectId, requestChangesMutation]
  );

  if (pullRequestsQuery.isLoading) {
    return (
      <div className="animate-pulse p-8">
        <div className="mb-4 h-8 w-48 rounded-lg bg-zinc-800" />
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div
              className="h-20 rounded-xl bg-zinc-800/50"
              key={`skeleton-${String(i)}`}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-bold text-2xl text-white">Code Reviews</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Review pull requests and provide feedback
          </p>
        </div>
        <button
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:border-zinc-500 hover:text-white"
          onClick={() => pullRequestsQuery.refetch()}
          type="button"
        >
          Refresh
        </button>
      </div>

      <ReviewDashboard
        onApprove={handleApprove}
        onComment={handleComment}
        onRequestChanges={handleRequestChanges}
        reviews={allReviews}
      />
    </div>
  );
}

function mapPrStatus(
  status: string
): "pending" | "approved" | "changes_requested" | "dismissed" {
  const map: Record<
    string,
    "pending" | "approved" | "changes_requested" | "dismissed"
  > = {
    open: "pending",
    approved: "approved",
    changes_requested: "changes_requested",
    merged: "approved",
    closed: "dismissed",
  };
  return map[status] ?? "pending";
}
