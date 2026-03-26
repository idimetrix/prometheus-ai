"use client";

import { Badge, Button, Card, ScrollArea } from "@prometheus/ui";
import { useCallback, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActivityEventType =
  | "task_submitted"
  | "task_completed"
  | "pr_created"
  | "pr_merged"
  | "deployment"
  | "comment"
  | "file_change";

export interface ActivityEvent {
  /** User or agent who triggered the event */
  actor: string;
  /** Actor type */
  actorType: "user" | "agent";
  /** Human-readable description */
  description: string;
  /** Unique event ID */
  id: string;
  /** Optional link target (e.g., task ID, PR URL) */
  linkHref?: string;
  /** Optional project ID */
  projectId?: string;
  /** Optional project name */
  projectName?: string;
  /** ISO timestamp */
  timestamp: string;
  /** Type of the activity event */
  type: ActivityEventType;
}

interface ActivityFeedProps {
  /** The events to display */
  events: ActivityEvent[];
  /** Whether more events can be loaded */
  hasMore?: boolean;
  /** Loading state */
  isLoading?: boolean;
  /** Callback when an event is clicked */
  onEventClick?: (event: ActivityEvent) => void;
  /** Callback to load more events */
  onLoadMore?: () => void;
  /** Available project names for filtering */
  projects?: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EVENT_CONFIG: Record<
  ActivityEventType,
  { color: string; icon: string; label: string }
> = {
  task_submitted: {
    icon: "+",
    color: "bg-blue-500/20 text-blue-300",
    label: "Task Submitted",
  },
  task_completed: {
    icon: "ok",
    color: "bg-green-500/20 text-green-300",
    label: "Task Completed",
  },
  pr_created: {
    icon: "PR",
    color: "bg-violet-500/20 text-violet-300",
    label: "PR Created",
  },
  pr_merged: {
    icon: "M",
    color: "bg-purple-500/20 text-purple-300",
    label: "PR Merged",
  },
  deployment: {
    icon: "D",
    color: "bg-amber-500/20 text-amber-300",
    label: "Deployment",
  },
  comment: {
    icon: "C",
    color: "bg-cyan-500/20 text-cyan-300",
    label: "Comment",
  },
  file_change: {
    icon: "F",
    color: "bg-zinc-500/20 text-zinc-300",
    label: "File Change",
  },
};

const ALL_EVENT_TYPES: ActivityEventType[] = [
  "task_submitted",
  "task_completed",
  "pr_created",
  "pr_merged",
  "deployment",
  "comment",
  "file_change",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const seconds = Math.floor(diff / 1000);

  if (seconds < 60) {
    return "just now";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  return new Date(ts).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EventIcon({ type }: { type: ActivityEventType }) {
  const config = EVENT_CONFIG[type];
  return (
    <span
      className={`inline-flex h-7 w-7 items-center justify-center rounded-full font-bold text-[9px] ${config.color}`}
    >
      {config.icon}
    </span>
  );
}

function EventRow({
  event,
  onClick,
}: {
  event: ActivityEvent;
  onClick?: (event: ActivityEvent) => void;
}) {
  const _config = EVENT_CONFIG[event.type];
  const isClickable = Boolean(onClick ?? event.linkHref);

  return (
    <button
      className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
        isClickable ? "cursor-pointer hover:bg-zinc-900/70" : "cursor-default"
      }`}
      onClick={() => onClick?.(event)}
      type="button"
    >
      <EventIcon type={event.type} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-xs text-zinc-300">
            {event.description}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <Badge
            className={`text-[9px] ${
              event.actorType === "agent"
                ? "bg-violet-500/15 text-violet-400"
                : "bg-zinc-700/50 text-zinc-400"
            }`}
            variant="secondary"
          >
            {event.actor}
          </Badge>
          {event.projectName && (
            <span className="truncate text-[10px] text-zinc-600">
              {event.projectName}
            </span>
          )}
          <span className="ml-auto shrink-0 text-[10px] text-zinc-600">
            {relativeTime(event.timestamp)}
          </span>
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ActivityFeed({
  events,
  hasMore = false,
  isLoading = false,
  onLoadMore,
  onEventClick,
  projects = [],
}: ActivityFeedProps) {
  const [typeFilter, setTypeFilter] = useState<ActivityEventType | "">("");
  const [projectFilter, setProjectFilter] = useState("");

  const handleTypeFilter = useCallback((value: string) => {
    setTypeFilter(value as ActivityEventType | "");
  }, []);

  const handleProjectFilter = useCallback((value: string) => {
    setProjectFilter(value);
  }, []);

  const filteredEvents = useMemo(() => {
    let result = events;
    if (typeFilter) {
      result = result.filter((e) => e.type === typeFilter);
    }
    if (projectFilter) {
      result = result.filter((e) => e.projectName === projectFilter);
    }
    return result;
  }, [events, typeFilter, projectFilter]);

  return (
    <Card className="flex h-full flex-col border-zinc-800 bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between border-zinc-800 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-sm text-zinc-200">Activity Feed</h3>
          <Badge className="bg-zinc-800 text-zinc-500" variant="secondary">
            {filteredEvents.length}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          {/* Event type filter */}
          <select
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 outline-none focus:border-violet-500"
            onChange={(e) => handleTypeFilter(e.target.value)}
            value={typeFilter}
          >
            <option value="">All events</option>
            {ALL_EVENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {EVENT_CONFIG[type].label}
              </option>
            ))}
          </select>

          {/* Project filter */}
          {projects.length > 0 && (
            <select
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 outline-none focus:border-violet-500"
              onChange={(e) => handleProjectFilter(e.target.value)}
              value={projectFilter}
            >
              <option value="">All projects</option>
              {projects.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Event list */}
      <ScrollArea className="flex-1">
        <div className="divide-y divide-zinc-800/50">
          {filteredEvents.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-xs text-zinc-600">
              {events.length === 0
                ? "No activity yet"
                : "No events match the current filters"}
            </div>
          ) : (
            filteredEvents.map((event) => (
              <EventRow event={event} key={event.id} onClick={onEventClick} />
            ))
          )}
        </div>
      </ScrollArea>

      {/* Load more */}
      {hasMore && (
        <div className="border-zinc-800 border-t px-4 py-2">
          <Button
            className="w-full text-xs"
            disabled={isLoading}
            onClick={onLoadMore}
            size="sm"
            variant="ghost"
          >
            {isLoading ? "Loading..." : "Load more"}
          </Button>
        </div>
      )}
    </Card>
  );
}
