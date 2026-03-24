"use client";

import { Badge, Button, Card, CardContent } from "@prometheus/ui";
import {
  Activity,
  CheckCircle2,
  Clock,
  MessageSquare,
  Pause,
  XCircle,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc";

const STATUS_CONFIG: Record<
  string,
  {
    variant: "success" | "warning" | "outline" | "destructive";
    icon: React.ReactNode;
  }
> = {
  active: {
    variant: "success",
    icon: <Activity className="h-3 w-3" />,
  },
  completed: {
    variant: "outline",
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  failed: {
    variant: "destructive",
    icon: <XCircle className="h-3 w-3" />,
  },
  paused: {
    variant: "warning",
    icon: <Pause className="h-3 w-3" />,
  },
  cancelled: {
    variant: "outline",
    icon: <XCircle className="h-3 w-3" />,
  },
};

function formatDuration(
  startedAt: Date | string,
  endedAt?: Date | string | null
): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const seconds = Math.floor((end - start) / 1000);

  if (seconds < 60) {
    return `${seconds}s`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

export default function SessionsPage() {
  const [statusFilter, setStatusFilter] = useState<
    "active" | "completed" | "failed" | "paused" | "cancelled" | undefined
  >(undefined);

  const sessionsQuery = trpc.sessions.list.useQuery(
    {
      limit: 50,
      status: statusFilter,
    },
    { retry: 2 }
  );

  const sessions = sessionsQuery.data?.sessions ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-2xl text-foreground">Sessions</h1>
          <p className="mt-1 text-muted-foreground text-sm">
            View and manage agent sessions across all projects.
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        {(
          [
            { value: undefined, label: "All" },
            { value: "active", label: "Active" },
            { value: "completed", label: "Completed" },
            { value: "failed", label: "Failed" },
            { value: "paused", label: "Paused" },
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

      {sessionsQuery.isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={`skeleton-${i.toString()}`}>
              <CardContent className="flex items-center gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="h-4 w-48 animate-pulse rounded bg-muted" />
                  <div className="mt-2 h-3 w-32 animate-pulse rounded bg-muted" />
                </div>
                <div className="h-3 w-20 animate-pulse rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {!sessionsQuery.isLoading && sessions.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="p-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <MessageSquare className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="mt-4 text-muted-foreground text-sm">
              {statusFilter
                ? `No ${statusFilter} sessions found`
                : "No sessions yet"}
            </p>
            <p className="mt-1 text-muted-foreground/60 text-xs">
              Sessions are created when you submit tasks to your projects.
            </p>
          </CardContent>
        </Card>
      )}
      {!sessionsQuery.isLoading && sessions.length > 0 && (
        <div className="space-y-2">
          {sessions.map((session) => {
            const config = STATUS_CONFIG[session.status] ?? {
              variant: "outline" as const,
              icon: <Clock className="h-3 w-3" />,
            };
            return (
              <Link
                className="block"
                href={`/dashboard/sessions/${session.id}` as Route}
                key={session.id}
              >
                <Card className="transition-colors hover:border-muted-foreground/30">
                  <CardContent className="flex items-center gap-4 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-foreground text-sm">
                          {session.mode || "Untitled Session"}
                        </span>
                        <Badge variant={config.variant}>
                          <span className="mr-1">{config.icon}</span>
                          {session.status}
                        </Badge>
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-muted-foreground text-xs">
                        {session.project && (
                          <span className="truncate">
                            {session.project.name}
                          </span>
                        )}
                        {session.mode && (
                          <Badge variant="secondary">{session.mode}</Badge>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {session.startedAt
                            ? formatDuration(session.startedAt, session.endedAt)
                            : "Not started"}
                        </span>
                      </div>
                    </div>
                    <div className="text-right text-muted-foreground text-xs">
                      {session.startedAt
                        ? new Date(session.startedAt).toLocaleDateString(
                            undefined,
                            {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            }
                          )
                        : "Not started"}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
