"use client";

import { use, useEffect, useRef, useState } from "react";
import { useSessionStream } from "@/hooks/use-session-stream";
import { trpc } from "@/lib/trpc";
import { useSessionStore } from "@/stores/session.store";

// ── FileTree Panel ──────────────────────────────────────────────

function FileTreePanel() {
  const { fileTree } = useSessionStore();

  const statusIcon = (status?: string) => {
    switch (status) {
      case "created":
        return <span className="text-green-400 text-xs">+</span>;
      case "modified":
        return <span className="text-xs text-yellow-400">M</span>;
      case "deleted":
        return <span className="text-red-400 text-xs">D</span>;
      case "read":
        return <span className="text-blue-400 text-xs">R</span>;
      default:
        return <span className="text-xs text-zinc-600">&bull;</span>;
    }
  };

  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-800 bg-zinc-900/50">
      <div className="flex items-center gap-2 border-zinc-800 border-b px-3 py-2">
        <svg
          aria-hidden="true"
          className="h-3.5 w-3.5 text-zinc-500"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="font-medium text-xs text-zinc-400">Files</span>
        <span className="ml-auto rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
          {fileTree.length}
        </span>
      </div>
      <div className="flex-1 overflow-auto p-2">
        {fileTree.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">
            No files yet
          </div>
        ) : (
          <div className="space-y-0.5">
            {fileTree.map((file) => (
              <div
                className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-zinc-800/50"
                key={file.path}
              >
                {statusIcon(file.status)}
                <span className="truncate font-mono text-zinc-300">
                  {file.path}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Plan Panel ──────────────────────────────────────────────────

function PlanPanel() {
  const { planSteps } = useSessionStore();

  const stepStatusIcon = (status: string) => {
    switch (status) {
      case "done":
      case "completed":
        return (
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500/20">
            <svg
              aria-hidden="true"
              className="h-3 w-3 text-green-400"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                d="m4.5 12.75 6 6 9-13.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        );
      case "running":
      case "in_progress":
        return (
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-500/20">
            <div className="h-2 w-2 animate-pulse rounded-full bg-violet-400" />
          </div>
        );
      case "failed":
        return (
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500/20">
            <svg
              aria-hidden="true"
              className="h-3 w-3 text-red-400"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                d="M6 18 18 6M6 6l12 12"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        );
      default:
        return (
          <div className="flex h-5 w-5 items-center justify-center rounded-full border border-zinc-700">
            <div className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
          </div>
        );
    }
  };

  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-800 bg-zinc-900/50">
      <div className="flex items-center gap-2 border-zinc-800 border-b px-3 py-2">
        <svg
          aria-hidden="true"
          className="h-3.5 w-3.5 text-zinc-500"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="font-medium text-xs text-zinc-400">Plan</span>
        <span className="ml-auto rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
          {
            planSteps.filter(
              (s) => s.status === "done" || s.status === "completed"
            ).length
          }
          /{planSteps.length}
        </span>
      </div>
      <div className="flex-1 overflow-auto p-2">
        {planSteps.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">
            Waiting for plan...
          </div>
        ) : (
          <div className="space-y-1">
            {planSteps.map((step, i) => (
              <div
                className={`flex items-start gap-2 rounded-lg px-2 py-2 ${
                  step.status === "running" || step.status === "in_progress"
                    ? "bg-violet-500/5"
                    : ""
                }`}
                key={step.id}
              >
                {stepStatusIcon(step.status)}
                <div className="min-w-0 flex-1">
                  <div
                    className={`font-medium text-xs ${
                      (
                        {
                          done: "text-zinc-500 line-through",
                          completed: "text-zinc-500 line-through",
                          running: "text-violet-300",
                          in_progress: "text-violet-300",
                        } as Record<string, string>
                      )[step.status] ?? "text-zinc-300"
                    }`}
                  >
                    {i + 1}. {step.title}
                  </div>
                  {step.description && (
                    <div className="mt-0.5 text-[10px] text-zinc-600">
                      {step.description}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Terminal Panel ───────────────────────────────────────────────

function TerminalPanel() {
  const { terminalLines } = useSessionStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-800 bg-zinc-950">
      <div className="flex items-center gap-2 border-zinc-800 border-b px-3 py-2">
        <div className="flex gap-1">
          <div className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
          <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/60" />
          <div className="h-2.5 w-2.5 rounded-full bg-green-500/60" />
        </div>
        <span className="font-medium text-xs text-zinc-500">Terminal</span>
        <span className="ml-auto text-[10px] text-zinc-600">
          {terminalLines.length} lines
        </span>
      </div>
      <div
        className="flex-1 overflow-auto p-3 font-mono text-xs"
        ref={scrollRef}
      >
        {terminalLines.length === 0 ? (
          <div className="flex h-full items-center justify-center text-zinc-700">
            <span className="animate-pulse">Waiting for output...</span>
          </div>
        ) : (
          <div className="space-y-0.5">
            {terminalLines.map((line) => (
              <div
                className="flex gap-2"
                key={`${line.timestamp ?? ""}-${line.content.slice(0, 50)}`}
              >
                {line.timestamp && (
                  <span className="shrink-0 text-zinc-700">
                    {new Date(line.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                )}
                <span
                  className={(() => {
                    if (
                      line.content.startsWith("[ERROR]") ||
                      line.content.startsWith("Error")
                    ) {
                      return "text-red-400";
                    }
                    if (line.content.startsWith("[WARN]")) {
                      return "text-yellow-400";
                    }
                    if (
                      line.content.startsWith("[THINK]") ||
                      line.content.startsWith("Reasoning:")
                    ) {
                      return "text-violet-400 italic";
                    }
                    if (
                      line.content.startsWith("[SUCCESS]") ||
                      line.content.startsWith("Done")
                    ) {
                      return "text-green-400";
                    }
                    return "text-zinc-300";
                  })()}
                >
                  {line.content}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Code Diff Panel ─────────────────────────────────────────────

function CodeDiffPanel() {
  const { events } = useSessionStore();
  const diffs = events.filter(
    (e) => e.type === "file_diff" || e.type === "code_change"
  );

  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-800 bg-zinc-900/50">
      <div className="flex items-center gap-2 border-zinc-800 border-b px-3 py-2">
        <svg
          aria-hidden="true"
          className="h-3.5 w-3.5 text-zinc-500"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="font-medium text-xs text-zinc-400">Changes</span>
        <span className="ml-auto rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
          {diffs.length}
        </span>
      </div>
      <div className="flex-1 overflow-auto p-2">
        {diffs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">
            No changes yet
          </div>
        ) : (
          <div className="space-y-3">
            {diffs.map((diff) => (
              <div
                className="rounded-lg border border-zinc-800 bg-zinc-950"
                key={diff.id}
              >
                <div className="border-zinc-800 border-b px-3 py-1.5">
                  <span className="font-mono text-[10px] text-zinc-400">
                    {String(diff.data?.filePath ?? `Change ${diff.id}`)}
                  </span>
                </div>
                <pre className="overflow-auto p-3 text-[11px] leading-relaxed">
                  {Array.from(
                    String(diff.data?.diff ?? diff.data?.content ?? "")
                      .split("\n")
                      .entries()
                  ).map(([lineNum, line]) => (
                    <div
                      className={(() => {
                        if (line.startsWith("+")) {
                          return "bg-green-500/10 text-green-400";
                        }
                        if (line.startsWith("-")) {
                          return "bg-red-500/10 text-red-400";
                        }
                        if (line.startsWith("@@")) {
                          return "text-violet-400";
                        }
                        return "text-zinc-500";
                      })()}
                      key={lineNum}
                    >
                      {line}
                    </div>
                  ))}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Session Page ───────────────────────────────────────────

export default function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: sessionId } = use(params);
  const { isConnected } = useSessionStream(sessionId);
  const { status: sessionStatus } = useSessionStore();

  const sessionQuery = trpc.sessions.get.useQuery(
    { sessionId },
    { retry: false }
  );
  const pauseMutation = trpc.sessions.pause.useMutation();
  const resumeMutation = trpc.sessions.resume.useMutation();
  const cancelMutation = trpc.sessions.cancel.useMutation();

  const session = sessionQuery.data;
  const status = session?.status ?? sessionStatus ?? "loading";

  const [approvalRequired, setApprovalRequired] = useState(false);

  async function handlePause() {
    await pauseMutation.mutateAsync({ sessionId });
    sessionQuery.refetch();
  }

  async function handleResume() {
    await resumeMutation.mutateAsync({ sessionId });
    sessionQuery.refetch();
  }

  async function handleCancel() {
    // biome-ignore lint/suspicious/noAlert: confirm dialog for destructive action
    if (!window.confirm("Are you sure you want to cancel this session?")) {
      return;
    }
    await cancelMutation.mutateAsync({ sessionId });
    sessionQuery.refetch();
  }

  return (
    <div className="flex h-[calc(100vh-theme(spacing.14)-theme(spacing.12))] flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className={`h-2 w-2 rounded-full ${
              isConnected ? "animate-pulse bg-green-500" : "bg-zinc-600"
            }`}
          />
          <span className="font-medium text-sm text-zinc-200">Session</span>
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
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span>{session?.mode ?? "task"} mode</span>
        </div>
      </div>

      {/* 4-panel layout */}
      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-3">
        {/* Top-left: File tree */}
        <FileTreePanel />

        {/* Top-right: Plan */}
        <PlanPanel />

        {/* Bottom-left: Terminal */}
        <TerminalPanel />

        {/* Bottom-right: Code diff */}
        <CodeDiffPanel />
      </div>

      {/* Control bar (sticky bottom) */}
      <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3">
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

        <div className="flex items-center gap-2">
          {approvalRequired && (
            <button
              className="rounded-lg bg-green-600 px-4 py-1.5 font-medium text-white text-xs transition-colors hover:bg-green-700"
              onClick={() => setApprovalRequired(false)}
              type="button"
            >
              Approve
            </button>
          )}

          {status === "active" && (
            <button
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-1.5 font-medium text-xs text-zinc-300 transition-colors hover:bg-zinc-700 disabled:opacity-50"
              disabled={pauseMutation.isPending}
              onClick={handlePause}
              type="button"
            >
              Pause
            </button>
          )}

          {status === "paused" && (
            <button
              className="rounded-lg bg-violet-600 px-4 py-1.5 font-medium text-white text-xs transition-colors hover:bg-violet-700 disabled:opacity-50"
              disabled={resumeMutation.isPending}
              onClick={handleResume}
              type="button"
            >
              Resume
            </button>
          )}

          <button
            className="rounded-lg border border-red-800/50 bg-red-950/50 px-4 py-1.5 font-medium text-red-400 text-xs transition-colors hover:bg-red-900/50 disabled:opacity-30"
            disabled={
              cancelMutation.isPending ||
              status === "completed" ||
              status === "cancelled" ||
              status === "failed"
            }
            onClick={handleCancel}
            type="button"
          >
            Cancel
          </button>

          <button
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-1.5 font-medium text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
            type="button"
          >
            Take Control
          </button>
        </div>
      </div>
    </div>
  );
}
