"use client";

import { Badge, Button, Card, CardContent } from "@prometheus/ui";
import {
  Bot,
  CheckCircle2,
  Clock,
  ExternalLink,
  Unlink,
  XCircle,
} from "lucide-react";

export interface SyncedIssueItem {
  assignedToAgent: boolean;
  body: string | null;
  createdAt: string;
  externalId: string;
  externalStatus: string | null;
  externalUrl: string | null;
  id: string;
  lastSyncedAt: string | null;
  provider: string;
  sessionId: string | null;
  taskId: string | null;
  title: string | null;
}

interface IssueListProps {
  issues: SyncedIssueItem[];
  onAssign: (issueId: string) => void;
  onUnlink: (issueId: string) => void;
}

const STATUS_CONFIG: Record<
  string,
  {
    icon: React.ReactNode;
    variant: "success" | "warning" | "outline" | "destructive";
  }
> = {
  open: {
    variant: "success",
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  closed: {
    variant: "outline",
    icon: <XCircle className="h-3 w-3" />,
  },
  in_progress: {
    variant: "warning",
    icon: <Clock className="h-3 w-3" />,
  },
};

const PROVIDER_LABELS: Record<string, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  bitbucket: "Bitbucket",
  linear: "Linear",
  jira: "Jira",
};

function ProviderIcon({ provider }: { provider: string }) {
  // Simple text-based provider indicator
  const label = PROVIDER_LABELS[provider] ?? provider;
  return (
    <span className="inline-flex items-center rounded-md bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-400">
      {label}
    </span>
  );
}

function AgentStatusIndicator({
  assignedToAgent,
  taskId,
}: {
  assignedToAgent: boolean;
  taskId: string | null;
}) {
  if (!assignedToAgent) {
    return null;
  }

  return (
    <Badge variant="outline">
      <Bot className="mr-1 h-3 w-3" />
      {taskId ? "Working" : "Assigned"}
    </Badge>
  );
}

/**
 * Reusable issue list component for displaying synced external issues.
 * Shows status badges, provider icons, and agent status indicators.
 */
export function IssueList({ issues, onAssign, onUnlink }: IssueListProps) {
  return (
    <div className="space-y-2">
      {issues.map((issue) => {
        const defaultStatus = {
          variant: "success" as const,
          icon: <CheckCircle2 className="h-3 w-3" />,
        };
        const statusConfig =
          STATUS_CONFIG[issue.externalStatus ?? "open"] ?? defaultStatus;

        return (
          <Card key={issue.id}>
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm text-zinc-200">
                      {issue.title ?? `Issue #${issue.externalId}`}
                    </p>
                    <ProviderIcon provider={issue.provider} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={statusConfig.variant}>
                      {statusConfig.icon}
                      <span className="ml-1">
                        {issue.externalStatus ?? "open"}
                      </span>
                    </Badge>
                    <AgentStatusIndicator
                      assignedToAgent={issue.assignedToAgent}
                      taskId={issue.taskId}
                    />
                    <span className="text-xs text-zinc-500">
                      #{issue.externalId}
                    </span>
                    {issue.lastSyncedAt && (
                      <span className="text-xs text-zinc-600">
                        Synced{" "}
                        {new Date(issue.lastSyncedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {issue.assignedToAgent ? (
                  <Button
                    onClick={() => onUnlink(issue.id)}
                    size="sm"
                    variant="ghost"
                  >
                    <Unlink className="mr-1 h-3 w-3" />
                    Unlink
                  </Button>
                ) : (
                  <Button
                    onClick={() => onAssign(issue.id)}
                    size="sm"
                    variant="outline"
                  >
                    <Bot className="mr-1 h-3 w-3" />
                    Assign to Agent
                  </Button>
                )}
                {issue.externalUrl && (
                  <a
                    className="text-zinc-400 hover:text-zinc-200"
                    href={issue.externalUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
