"use client";

import { use } from "react";
import { ReplayViewer } from "@/components/session/replay/replay-viewer";
import { trpc } from "@/lib/trpc";

export default function SessionReplayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: sessionId } = use(params);

  const eventsQuery = trpc.sessions.timeline.useQuery(
    { sessionId },
    { retry: 2 }
  );

  if (eventsQuery.isLoading) {
    return (
      <div className="flex h-[calc(100vh-theme(spacing.14)-theme(spacing.12))] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
          <span className="text-sm text-zinc-500">
            Loading session events...
          </span>
        </div>
      </div>
    );
  }

  if (eventsQuery.isError) {
    return (
      <div className="flex h-[calc(100vh-theme(spacing.14)-theme(spacing.12))] items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 text-sm">Failed to load session events</p>
          <p className="mt-1 text-xs text-zinc-500">
            {eventsQuery.error.message}
          </p>
          <button
            className="mt-3 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700"
            onClick={() => eventsQuery.refetch()}
            type="button"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const events = (eventsQuery.data?.events ?? []).map(
    (event: Record<string, unknown>) => ({
      id: String(event.id ?? ""),
      type: String(event.type ?? "message") as "message",
      timestamp: String(event.timestamp ?? new Date().toISOString()),
      data: (event.data ?? {}) as Record<string, unknown>,
      agentRole: event.agentRole ? String(event.agentRole) : null,
    })
  );

  return (
    <div className="h-[calc(100vh-theme(spacing.14)-theme(spacing.12))]">
      <ReplayViewer events={events} sessionId={sessionId} />
    </div>
  );
}
