"use client";

import type { Route } from "next";
import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ApprovalGate } from "@/components/session/approval-gate";
import { SessionControls } from "@/components/session/session-controls";
import {
  createDefaultTaskProgress,
  TaskPhaseProgress,
  TaskPhaseProgressCompact,
} from "@/components/session/task-phase-progress";
import { AgentActivityPanel } from "@/components/workspace/panels/agent-activity-panel";
import { BrowserPreviewPanel } from "@/components/workspace/panels/browser-preview-panel";
import { ChatPanel } from "@/components/workspace/panels/chat-panel";
import { CodeEditorPanel } from "@/components/workspace/panels/code-editor-panel";
import { FileTreePanel } from "@/components/workspace/panels/file-tree-panel";
import { GitPanel } from "@/components/workspace/panels/git-panel";
import { PlanPanel } from "@/components/workspace/panels/plan-panel";
import { TerminalPanel } from "@/components/workspace/panels/terminal-panel";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { useSessionStream } from "@/hooks/use-session-stream";
import { trpc } from "@/lib/trpc";
import type { PendingCheckpoint } from "@/stores/session.store";
import { useSessionStore } from "@/stores/session.store";

// ── Right-side tabbed panel (Browser Preview, Git, Plan, Activity) ───

type RightTab = "preview" | "git" | "plan" | "activity";

const RIGHT_TABS: Array<{ id: RightTab; label: string }> = [
  { id: "preview", label: "Preview" },
  { id: "git", label: "Git" },
  { id: "plan", label: "Plan" },
  { id: "activity", label: "Activity" },
];

function TabbedRightPanel({ sessionId }: { sessionId: string }) {
  const [activeTab, setActiveTab] = useState<RightTab>("preview");

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-zinc-800 border-b bg-zinc-900/80">
        {RIGHT_TABS.map((tab) => (
          <button
            className={[
              "px-3 py-1.5 text-xs transition-colors",
              activeTab === tab.id
                ? "border-violet-500 border-b-2 text-white"
                : "text-zinc-500 hover:text-zinc-300",
            ].join(" ")}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "preview" && <BrowserPreviewPanel />}
        {activeTab === "git" && <GitPanel sandboxId={sessionId} />}
        {activeTab === "plan" && <PlanPanel />}
        {activeTab === "activity" && <AgentActivityPanel />}
      </div>
    </div>
  );
}

// ── Center tabbed panel (Code Editor + Chat) ─────────────────────────

type CenterTab = "editor" | "chat";

function TabbedCenterPanel({
  disabled,
  onSendMessage,
  sessionId,
}: {
  disabled: boolean;
  onSendMessage: (content: string) => void;
  sessionId: string;
}) {
  const [activeTab, setActiveTab] = useState<CenterTab>("editor");

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-zinc-800 border-b bg-zinc-900/80">
        <button
          className={[
            "px-3 py-1.5 text-xs transition-colors",
            activeTab === "editor"
              ? "border-violet-500 border-b-2 text-white"
              : "text-zinc-500 hover:text-zinc-300",
          ].join(" ")}
          onClick={() => setActiveTab("editor")}
          type="button"
        >
          Editor
        </button>
        <button
          className={[
            "px-3 py-1.5 text-xs transition-colors",
            activeTab === "chat"
              ? "border-violet-500 border-b-2 text-white"
              : "text-zinc-500 hover:text-zinc-300",
          ].join(" ")}
          onClick={() => setActiveTab("chat")}
          type="button"
        >
          Chat
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "editor" && <CodeEditorPanel />}
        {activeTab === "chat" && (
          <ChatPanel
            conversationId={sessionId}
            disabled={disabled}
            onSendMessage={onSendMessage}
          />
        )}
      </div>
    </div>
  );
}

// ── Main Workspace Page ──────────────────────────────────────────────

export default function WorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: sessionId } = use(params);
  const { isConnected } = useSessionStream(sessionId);
  const sessionStatus = useSessionStore((s) => s.status);
  const taskProgress = useSessionStore((s) => s.taskProgress);
  const confidenceScore = useSessionStore((s) => s.confidenceScore);
  const creditHistory = useSessionStore((s) => s.creditHistory);
  const setTaskProgress = useSessionStore((s) => s.setTaskProgress);

  const sessionQuery = trpc.sessions.get.useQuery({ sessionId }, { retry: 2 });
  const pauseMutation = trpc.sessions.pause.useMutation();
  const resumeMutation = trpc.sessions.resume.useMutation();
  const cancelMutation = trpc.sessions.cancel.useMutation();
  const retryMutation = trpc.sessions.retry.useMutation();
  const sendMessageMutation = trpc.sessions.sendMessage.useMutation();
  const resolveCheckpointMutation =
    trpc.sessions.resolveCheckpoint.useMutation();

  const pendingCheckpoints = useSessionStore((s) => s.pendingCheckpoints);
  const addPendingCheckpoint = useSessionStore((s) => s.addPendingCheckpoint);
  const removePendingCheckpoint = useSessionStore(
    (s) => s.removePendingCheckpoint
  );
  const allEvents = useSessionStore((s) => s.events);

  // Watch for checkpoint events
  useEffect(() => {
    for (const event of allEvents) {
      if (event.type === "checkpoint" && event.data.checkpointId) {
        const ckpt: PendingCheckpoint = {
          checkpointId: String(event.data.checkpointId),
          type: String(event.data.type ?? "approval"),
          title: String(event.data.title ?? "Approval Required"),
          description: String(event.data.description ?? ""),
          data: (event.data.data as Record<string, unknown>) ?? {},
          timeoutMs: Number(event.data.timeoutMs ?? 120_000),
          createdAt: event.timestamp,
        };
        addPendingCheckpoint(ckpt);
      }
      if (event.type === "checkpoint_resolved" && event.data.checkpointId) {
        removePendingCheckpoint(String(event.data.checkpointId));
      }
    }
  }, [allEvents, addPendingCheckpoint, removePendingCheckpoint]);

  const handleCheckpointApprove = useCallback(
    async (checkpointId: string) => {
      try {
        await resolveCheckpointMutation.mutateAsync({
          sessionId,
          checkpointId,
          action: "approve",
        });
        removePendingCheckpoint(checkpointId);
        toast.success("Checkpoint approved");
      } catch {
        toast.error("Failed to approve checkpoint");
      }
    },
    [sessionId, resolveCheckpointMutation, removePendingCheckpoint]
  );

  const handleCheckpointReject = useCallback(
    async (checkpointId: string, reason: string) => {
      try {
        await resolveCheckpointMutation.mutateAsync({
          sessionId,
          checkpointId,
          action: "reject",
          message: reason || undefined,
        });
        removePendingCheckpoint(checkpointId);
        toast.success("Checkpoint rejected");
      } catch {
        toast.error("Failed to reject checkpoint");
      }
    },
    [sessionId, resolveCheckpointMutation, removePendingCheckpoint]
  );

  const session = sessionQuery.data;
  const status = session?.status ?? sessionStatus ?? "loading";

  const isEnded =
    status === "completed" || status === "cancelled" || status === "failed";

  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // Initialize default task progress when session becomes active
  useEffect(() => {
    if (status === "active" && !taskProgress) {
      setTaskProgress(createDefaultTaskProgress(sessionId));
    }
  }, [status, taskProgress, sessionId, setTaskProgress]);

  const totalCreditsConsumed = useMemo(
    () => creditHistory.reduce((sum, entry) => sum + entry.credits, 0),
    [creditHistory]
  );

  const estimatedCostUsd = useMemo(
    () => totalCreditsConsumed * 0.0001,
    [totalCreditsConsumed]
  );

  let confTextClass = "text-red-400";
  let confBarClass = "bg-red-500";
  if (confidenceScore > 0.7) {
    confTextClass = "text-green-400";
    confBarClass = "bg-green-500";
  } else if (confidenceScore >= 0.4) {
    confTextClass = "text-yellow-400";
    confBarClass = "bg-yellow-500";
  }

  const handleSendMessage = useCallback(
    async (content: string) => {
      try {
        await sendMessageMutation.mutateAsync({ sessionId, content });
      } catch {
        toast.error("Failed to send message");
      }
    },
    [sessionId, sendMessageMutation]
  );

  return (
    <div className="flex h-[calc(100vh-theme(spacing.14)-theme(spacing.12))] flex-col gap-1">
      {/* Header */}
      <div className="flex items-center justify-between px-2">
        <div className="flex items-center gap-3">
          <span
            className={`h-2 w-2 rounded-full ${
              isConnected ? "animate-pulse bg-green-500" : "bg-zinc-600"
            }`}
          />
          <Link
            className="font-medium text-sm text-zinc-200 transition-colors hover:text-violet-400"
            href={`/dashboard/sessions/${sessionId}` as Route}
          >
            Session
          </Link>
          <span className="text-xs text-zinc-600">/</span>
          <span className="font-medium text-sm text-white">Workspace</span>
          <span className="font-mono text-xs text-zinc-500">{sessionId}</span>
          <span
            className={`rounded-full px-2 py-0.5 font-medium text-[10px] ${
              (
                {
                  active: "bg-green-500/10 text-green-400",
                  paused: "bg-yellow-500/10 text-yellow-400",
                  completed: "bg-blue-500/10 text-blue-400",
                  failed: "bg-red-500/10 text-red-400",
                } as Record<string, string>
              )[status] ?? "bg-zinc-800 text-zinc-400"
            }`}
          >
            {status}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <TaskPhaseProgressCompact />
          <span>{session?.mode ?? "task"} mode</span>
          {confidenceScore > 0 && (
            <span className={`font-mono ${confTextClass}`}>
              {Math.round(confidenceScore * 100)}% conf
            </span>
          )}
          {totalCreditsConsumed > 0 && (
            <span className="font-mono text-zinc-500">
              {totalCreditsConsumed.toLocaleString()} credits
            </span>
          )}
        </div>
      </div>

      {/* Task Phase Progress Bar */}
      {!isEnded && (
        <div className="px-2">
          <TaskPhaseProgress />
        </div>
      )}

      {/* Pending checkpoint approval gates */}
      {pendingCheckpoints.length > 0 && (
        <div className="space-y-2 px-2">
          {pendingCheckpoints.map((ckpt) => (
            <ApprovalGate
              action={ckpt.type}
              checkpointId={ckpt.checkpointId}
              description={ckpt.description}
              details={ckpt.data}
              key={ckpt.checkpointId}
              onApprove={handleCheckpointApprove}
              onReject={handleCheckpointReject}
              riskLevel={ckpt.type === "high_stakes" ? "critical" : "medium"}
            />
          ))}
        </div>
      )}

      {/* Workspace Layout with all panels assembled */}
      <div className="min-h-0 flex-1">
        <WorkspaceLayout
          agentPanel={<TabbedRightPanel sessionId={sessionId} />}
          center={
            <TabbedCenterPanel
              disabled={isEnded}
              onSendMessage={handleSendMessage}
              sessionId={sessionId}
            />
          }
          fileTree={<FileTreePanel />}
          terminal={<TerminalPanel />}
        />
      </div>

      {/* Control bar (sticky bottom) */}
      <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-2">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                isConnected ? "bg-green-500" : "bg-red-500"
              }`}
            />
            <span className="text-xs text-zinc-400">
              {isConnected ? "Live" : "Disconnected"}
            </span>
          </div>

          {totalCreditsConsumed > 0 && (
            <div className="flex items-center gap-1.5 text-[10px]">
              <svg
                aria-hidden="true"
                className="h-3 w-3 text-yellow-500"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path d="M10.75 10.818a2.608 2.608 0 0 1-.873 1.214c-.546.44-1.276.673-2.133.673a4.21 4.21 0 0 1-1.279-.2 2.349 2.349 0 0 1-.96-.609 2.372 2.372 0 0 1-.535-.858A3.2 3.2 0 0 1 4.8 10c0-.668.167-1.241.502-1.72a3.41 3.41 0 0 1 1.316-1.125c.546-.29 1.14-.435 1.782-.435.68 0 1.265.152 1.754.456.49.304.855.71 1.095 1.218.24.509.36 1.07.36 1.684 0 .282-.031.558-.093.827-.062.27-.164.525-.306.766ZM10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />
              </svg>
              <span className="font-mono text-zinc-400">
                {totalCreditsConsumed.toLocaleString()} credits
              </span>
              <span className="text-zinc-600">
                (~${estimatedCostUsd.toFixed(4)})
              </span>
            </div>
          )}

          {confidenceScore > 0 && (
            <div className="flex items-center gap-1.5 text-[10px]">
              <div className="h-1.5 w-8 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${confBarClass}`}
                  style={{ width: `${Math.round(confidenceScore * 100)}%` }}
                />
              </div>
              <span className={`font-mono ${confTextClass}`}>
                {Math.round(confidenceScore * 100)}%
              </span>
            </div>
          )}
        </div>

        <SessionControls
          onCancel={async () => {
            setShowCancelConfirm(true);
          }}
          onPause={async () => {
            try {
              await pauseMutation.mutateAsync({ sessionId });
              sessionQuery.refetch();
            } catch {
              toast.error("Failed to pause session. Please try again.");
            }
          }}
          onResume={async () => {
            try {
              await resumeMutation.mutateAsync({ sessionId });
              sessionQuery.refetch();
            } catch {
              toast.error("Failed to resume session. Please try again.");
            }
          }}
          onRetry={async () => {
            try {
              await retryMutation.mutateAsync({
                sessionId,
                fromCheckpoint: true,
              });
              sessionQuery.refetch();
              toast.success("Session retry initiated");
            } catch {
              toast.error("Failed to retry session. Please try again.");
            }
          }}
          sessionId={sessionId}
          status={status}
        />
      </div>

      {/* Cancel confirmation dialog */}
      {showCancelConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setShowCancelConfirm(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setShowCancelConfirm(false);
            }
          }}
          role="presentation"
        >
          <div
            aria-label="Cancel session confirmation"
            aria-modal="true"
            className="max-w-md rounded-lg border border-zinc-800 bg-zinc-900 p-6"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="dialog"
          >
            <h3 className="font-semibold text-lg text-zinc-100">
              Cancel Session?
            </h3>
            <p className="mt-2 text-sm text-zinc-400">
              Are you sure you want to cancel this session? This action cannot
              be undone.
            </p>
            <div className="mt-4 flex justify-end gap-3">
              <button
                className="rounded-md px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200"
                onClick={() => setShowCancelConfirm(false)}
                type="button"
              >
                Keep Running
              </button>
              <button
                className="rounded-md bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-500"
                onClick={async () => {
                  setShowCancelConfirm(false);
                  try {
                    await cancelMutation.mutateAsync({ sessionId });
                    sessionQuery.refetch();
                  } catch {
                    toast.error("Failed to cancel session. Please try again.");
                  }
                }}
                type="button"
              >
                Cancel Session
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
