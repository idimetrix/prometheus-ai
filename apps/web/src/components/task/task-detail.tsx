"use client";

import { useCallback, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "paused";
type TaskPriority = "critical" | "high" | "medium" | "low";

interface TaskEvent {
  /** Actor who performed the event */
  actor?: string;
  /** For comments, the full message body */
  body?: string;
  /** Human-readable description */
  description: string;
  /** Unique event id */
  id: string;
  /** ISO timestamp */
  timestamp: string;
  /** Type of event */
  type: "created" | "status_change" | "comment" | "assigned" | "linked_pr";
}

interface LinkedPR {
  id: string;
  number: number;
  status: "open" | "merged" | "closed";
  title: string;
  url: string;
}

interface TaskDetailData {
  assignee?: string;
  assigneeType?: "agent" | "user";
  createdAt: string;
  creditsReserved: number;
  creditsUsed: number;
  description: string;
  events: TaskEvent[];
  id: string;
  linkedPRs: LinkedPR[];
  priority: TaskPriority;
  projectId: string;
  sessionId?: string;
  status: TaskStatus;
  title: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<TaskStatus, string> = {
  queued: "bg-zinc-700 text-zinc-300",
  running: "bg-blue-500/20 text-blue-400",
  completed: "bg-green-500/20 text-green-400",
  failed: "bg-red-500/20 text-red-400",
  cancelled: "bg-zinc-600/20 text-zinc-500",
  paused: "bg-yellow-500/20 text-yellow-400",
};

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  critical: "text-red-400",
  high: "text-orange-400",
  medium: "text-yellow-400",
  low: "text-zinc-400",
};

const STATUS_OPTIONS: TaskStatus[] = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "paused",
];

function StatusBadge({
  status,
  onStatusChange,
}: {
  status: TaskStatus;
  onStatusChange?: (newStatus: TaskStatus) => void;
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  return (
    <div className="relative">
      <button
        className={`rounded-full px-3 py-1 font-medium text-[11px] ${STATUS_COLORS[status]}`}
        onClick={() => {
          if (onStatusChange) {
            setDropdownOpen(!dropdownOpen);
          }
        }}
        type="button"
      >
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </button>
      {dropdownOpen && onStatusChange && (
        <div className="absolute top-full left-0 z-10 mt-1 rounded-lg border border-zinc-800 bg-zinc-900 py-1 shadow-lg">
          {STATUS_OPTIONS.map((opt) => (
            <button
              className={`block w-full px-4 py-1.5 text-left text-[12px] transition-colors hover:bg-zinc-800 ${
                opt === status ? "text-violet-400" : "text-zinc-400"
              }`}
              key={opt}
              onClick={() => {
                onStatusChange(opt);
                setDropdownOpen(false);
              }}
              type="button"
            >
              {opt.charAt(0).toUpperCase() + opt.slice(1)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PriorityIndicator({ priority }: { priority: TaskPriority }) {
  function getPriorityBars(p: TaskPriority): number {
    if (p === "critical") {
      return 4;
    }
    if (p === "high") {
      return 3;
    }
    if (p === "medium") {
      return 2;
    }
    return 1;
  }
  const bars = getPriorityBars(priority);
  return (
    <div className="flex items-center gap-1">
      <div className="flex gap-0.5">
        {Array.from({ length: 4 }).map((_, i) => {
          const barKey = `priority-bar-${i.toString()}`;
          return (
            <div
              className={`h-3 w-1 rounded-sm ${
                i < bars ? PRIORITY_COLORS[priority] : "bg-zinc-800"
              }`}
              key={barKey}
              style={
                i < bars
                  ? { backgroundColor: "currentColor", opacity: 0.8 }
                  : {}
              }
            />
          );
        })}
      </div>
      <span className={`text-[11px] ${PRIORITY_COLORS[priority]}`}>
        {priority.charAt(0).toUpperCase() + priority.slice(1)}
      </span>
    </div>
  );
}

function EventTimeline({ events }: { events: TaskEvent[] }) {
  return (
    <div className="space-y-3">
      {events.map((event) => (
        <div className="flex gap-3" key={event.id}>
          {/* Timeline dot */}
          <div className="flex flex-col items-center">
            <div
              className={`h-2 w-2 shrink-0 rounded-full ${(() => {
                if (event.type === "comment") {
                  return "bg-blue-400";
                }
                if (event.type === "status_change") {
                  return "bg-violet-400";
                }
                return "bg-zinc-600";
              })()}`}
            />
            <div className="w-px flex-1 bg-zinc-800" />
          </div>

          {/* Event content */}
          <div className="-mt-0.5 min-w-0 flex-1 pb-3">
            <div className="flex items-baseline gap-2">
              {event.actor && (
                <span className="font-medium text-[12px] text-zinc-300">
                  {event.actor}
                </span>
              )}
              <span className="text-[12px] text-zinc-500">
                {event.description}
              </span>
              <span className="ml-auto shrink-0 text-[10px] text-zinc-700">
                {new Date(event.timestamp).toLocaleString()}
              </span>
            </div>
            {event.body && (
              <div className="mt-1 whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-[12px] text-zinc-400">
                {event.body}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function LinkedPRList({ prs }: { prs: LinkedPR[] }) {
  if (prs.length === 0) {
    return (
      <div className="text-[12px] text-zinc-600">No linked pull requests</div>
    );
  }
  return (
    <div className="space-y-2">
      {prs.map((pr) => (
        <a
          className="flex items-center gap-2 rounded-lg border border-zinc-800 p-2 text-[12px] transition-colors hover:border-zinc-700"
          href={pr.url}
          key={pr.id}
          rel="noopener noreferrer"
          target="_blank"
        >
          <span
            className={`rounded-full px-2 py-0.5 font-medium text-[10px] ${(() => {
              if (pr.status === "open") {
                return "bg-green-500/20 text-green-400";
              }
              if (pr.status === "merged") {
                return "bg-purple-500/20 text-purple-400";
              }
              return "bg-red-500/20 text-red-400";
            })()}`}
          >
            {pr.status}
          </span>
          <span className="text-zinc-500">#{pr.number}</span>
          <span className="min-w-0 flex-1 truncate text-zinc-300">
            {pr.title}
          </span>
        </a>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface TaskDetailProps {
  onAddComment: (body: string) => void;
  onAssignToAgent: () => void;
  onDescriptionChange: (newDescription: string) => void;
  onStatusChange: (newStatus: TaskStatus) => void;
  onTitleChange: (newTitle: string) => void;
  task: TaskDetailData;
}

export function TaskDetail({
  task,
  onStatusChange,
  onTitleChange,
  onDescriptionChange,
  onAddComment,
  onAssignToAgent,
}: TaskDetailProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [descriptionDraft, setDescriptionDraft] = useState(task.description);
  const [commentDraft, setCommentDraft] = useState("");

  const handleTitleSave = useCallback(() => {
    if (titleDraft.trim() && titleDraft !== task.title) {
      onTitleChange(titleDraft.trim());
    }
    setEditingTitle(false);
  }, [titleDraft, task.title, onTitleChange]);

  const handleDescriptionSave = useCallback(() => {
    if (descriptionDraft !== task.description) {
      onDescriptionChange(descriptionDraft);
    }
    setEditingDescription(false);
  }, [descriptionDraft, task.description, onDescriptionChange]);

  const handleCommentSubmit = useCallback(() => {
    if (commentDraft.trim()) {
      onAddComment(commentDraft.trim());
      setCommentDraft("");
    }
  }, [commentDraft, onAddComment]);

  return (
    <div className="flex h-full gap-0 bg-zinc-950">
      {/* Main content */}
      <div className="flex-1 overflow-auto p-6">
        {/* Title */}
        <div className="mb-4">
          {editingTitle ? (
            <input
              autoFocus
              className="w-full bg-transparent font-semibold text-lg text-zinc-200 outline-none"
              onBlur={handleTitleSave}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleTitleSave();
                }
                if (e.key === "Escape") {
                  setTitleDraft(task.title);
                  setEditingTitle(false);
                }
              }}
              value={titleDraft}
            />
          ) : (
            <button
              className="w-full text-left font-semibold text-lg text-zinc-200 transition-colors hover:text-zinc-100"
              onClick={() => setEditingTitle(true)}
              type="button"
            >
              {task.title}
            </button>
          )}
        </div>

        {/* Status and priority row */}
        <div className="mb-6 flex items-center gap-3">
          <StatusBadge onStatusChange={onStatusChange} status={task.status} />
          <PriorityIndicator priority={task.priority} />
        </div>

        {/* Description */}
        <div className="mb-8">
          <h3 className="mb-2 font-medium text-[11px] text-zinc-500 uppercase tracking-wider">
            Description
          </h3>
          {editingDescription ? (
            <div>
              <textarea
                autoFocus
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-[13px] text-zinc-300 outline-none focus:border-zinc-700"
                onChange={(e) => setDescriptionDraft(e.target.value)}
                rows={4}
                value={descriptionDraft}
              />
              <div className="mt-2 flex gap-2">
                <button
                  className="rounded bg-violet-600 px-3 py-1 text-[11px] text-white transition-colors hover:bg-violet-500"
                  onClick={handleDescriptionSave}
                  type="button"
                >
                  Save
                </button>
                <button
                  className="rounded px-3 py-1 text-[11px] text-zinc-500 transition-colors hover:text-zinc-300"
                  onClick={() => {
                    setDescriptionDraft(task.description);
                    setEditingDescription(false);
                  }}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="w-full rounded-lg border border-transparent p-3 text-left text-[13px] text-zinc-400 transition-colors hover:border-zinc-800 hover:bg-zinc-900/50"
              onClick={() => setEditingDescription(true)}
              type="button"
            >
              {task.description || "Click to add a description..."}
            </button>
          )}
        </div>

        {/* Timeline */}
        <div className="mb-8">
          <h3 className="mb-3 font-medium text-[11px] text-zinc-500 uppercase tracking-wider">
            Activity
          </h3>
          <EventTimeline events={task.events} />
        </div>

        {/* Add comment */}
        <div className="mb-8">
          <h3 className="mb-2 font-medium text-[11px] text-zinc-500 uppercase tracking-wider">
            Add Comment
          </h3>
          <textarea
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-[13px] text-zinc-300 outline-none placeholder:text-zinc-600 focus:border-zinc-700"
            onChange={(e) => setCommentDraft(e.target.value)}
            placeholder="Write a comment..."
            rows={3}
            value={commentDraft}
          />
          <div className="mt-2 flex justify-end">
            <button
              className="rounded bg-violet-600 px-4 py-1.5 font-medium text-[12px] text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
              disabled={!commentDraft.trim()}
              onClick={handleCommentSubmit}
              type="button"
            >
              Comment
            </button>
          </div>
        </div>

        {/* Linked PRs */}
        <div>
          <h3 className="mb-3 font-medium text-[11px] text-zinc-500 uppercase tracking-wider">
            Linked Pull Requests
          </h3>
          <LinkedPRList prs={task.linkedPRs} />
        </div>
      </div>

      {/* Sidebar */}
      <div className="w-64 shrink-0 border-zinc-800 border-l bg-zinc-900/30 p-4">
        {/* Assignee */}
        <div className="mb-4">
          <h4 className="mb-1 text-[11px] text-zinc-600">Assignee</h4>
          {task.assignee ? (
            <div className="flex items-center gap-2">
              <div
                className={`h-6 w-6 rounded-full ${
                  task.assigneeType === "agent"
                    ? "bg-violet-500/20"
                    : "bg-blue-500/20"
                } flex items-center justify-center font-medium text-[10px] ${
                  task.assigneeType === "agent"
                    ? "text-violet-400"
                    : "text-blue-400"
                }`}
              >
                {task.assignee.charAt(0).toUpperCase()}
              </div>
              <span className="text-[12px] text-zinc-300">{task.assignee}</span>
              {task.assigneeType === "agent" && (
                <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[9px] text-violet-400">
                  Agent
                </span>
              )}
            </div>
          ) : (
            <button
              className="rounded bg-violet-600/20 px-3 py-1.5 font-medium text-[11px] text-violet-400 transition-colors hover:bg-violet-600/30"
              onClick={onAssignToAgent}
              type="button"
            >
              Assign to Agent
            </button>
          )}
        </div>

        {/* Credits */}
        <div className="mb-4">
          <h4 className="mb-1 text-[11px] text-zinc-600">Credits</h4>
          <div className="text-[12px] text-zinc-300">
            <div className="flex justify-between">
              <span>Used</span>
              <span>{task.creditsUsed}</span>
            </div>
            <div className="flex justify-between">
              <span>Reserved</span>
              <span>{task.creditsReserved}</span>
            </div>
          </div>
        </div>

        {/* Meta */}
        <div className="space-y-2">
          <div>
            <h4 className="mb-0.5 text-[11px] text-zinc-600">Created</h4>
            <span className="text-[12px] text-zinc-400">
              {new Date(task.createdAt).toLocaleString()}
            </span>
          </div>
          <div>
            <h4 className="mb-0.5 text-[11px] text-zinc-600">Updated</h4>
            <span className="text-[12px] text-zinc-400">
              {new Date(task.updatedAt).toLocaleString()}
            </span>
          </div>
          <div>
            <h4 className="mb-0.5 text-[11px] text-zinc-600">Task ID</h4>
            <span className="font-mono text-[11px] text-zinc-600">
              {task.id}
            </span>
          </div>
          {task.sessionId && (
            <div>
              <h4 className="mb-0.5 text-[11px] text-zinc-600">Session</h4>
              <span className="font-mono text-[11px] text-zinc-600">
                {task.sessionId}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
