"use client";

import { MarkdownRenderer } from "@prometheus/ui";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SessionControls } from "@/components/session/session-controls";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
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
    <div className="flex h-full flex-col">
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

// ── Step Status Helpers ──────────────────────────────────────────

function getStepColor(status: string): string {
  if (status === "done" || status === "completed") {
    return "text-green-400";
  }
  if (status === "running" || status === "in_progress") {
    return "text-violet-400";
  }
  return "text-zinc-600";
}

function getStepIcon(status: string): string {
  if (status === "done" || status === "completed") {
    return "done";
  }
  if (status === "running" || status === "in_progress") {
    return "...";
  }
  return "o";
}

// ── Agent Activity Panel (Chat + Plan + Code Diff) ──────────────

interface ChatMessage {
  content: string;
  id: string;
  role: "user" | "agent" | "system";
  streaming?: boolean;
  timestamp: string;
}

function AgentPanel({
  disabled,
  onSend,
}: {
  disabled?: boolean;
  onSend: (content: string) => void;
  sessionId: string;
}) {
  const { events, reasoning, planSteps } = useSessionStore();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const messages: ChatMessage[] = [];

  for (const event of events) {
    if (event.type === "agent_output" && event.data.content) {
      messages.push({
        id: event.id,
        role: "agent",
        content: String(event.data.content),
        timestamp: event.timestamp,
      });
    } else if (event.type === "task_status" && event.data.status) {
      messages.push({
        id: event.id,
        role: "system",
        content: `Status changed to: ${String(event.data.status)}${event.data.message ? ` — ${String(event.data.message)}` : ""}`,
        timestamp: event.timestamp,
      });
    } else if (event.type === "error" && event.data.message) {
      messages.push({
        id: event.id,
        role: "system",
        content: `Error: ${String(event.data.message)}`,
        timestamp: event.timestamp,
      });
    }
  }

  const messageCount = messages.length;
  useEffect(() => {
    if (messageCount > 0 && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messageCount]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || disabled) {
      return;
    }
    onSend(trimmed);
    setInput("");
    inputRef.current?.focus();
  }, [input, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const ROLE_STYLES: Record<string, string> = {
    user: "ml-4 border-violet-500/20 bg-violet-500/10",
    agent: "mr-4 border-zinc-800 bg-zinc-900/50",
    system: "border-blue-500/20 bg-blue-500/5",
  };

  const ROLE_BADGES: Record<string, string> = {
    user: "bg-violet-500/20 text-violet-300",
    agent: "bg-green-500/20 text-green-300",
    system: "bg-blue-500/20 text-blue-300",
  };

  return (
    <div className="flex h-full flex-col">
      {/* Plan Steps (collapsible summary) */}
      {planSteps.length > 0 && (
        <div className="border-zinc-800 border-b px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="font-medium text-[10px] text-zinc-500 uppercase">
              Plan
            </span>
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
              {
                planSteps.filter(
                  (s) => s.status === "done" || s.status === "completed"
                ).length
              }
              /{planSteps.length}
            </span>
          </div>
          <div className="mt-1 space-y-0.5">
            {planSteps.slice(0, 5).map((step, i) => (
              <div
                className="flex items-center gap-1.5 text-[10px]"
                key={step.id}
              >
                <span className={getStepColor(step.status)}>
                  {getStepIcon(step.status)}
                </span>
                <span
                  className={
                    step.status === "done" || step.status === "completed"
                      ? "text-zinc-500 line-through"
                      : "text-zinc-300"
                  }
                >
                  {i + 1}. {step.title}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-auto p-3" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-zinc-600">
            <span>Waiting for agent output...</span>
            {reasoning.length > 0 && (
              <div className="max-w-full rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2 text-center text-violet-400 italic">
                {reasoning.at(-1)}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg) => (
              <div
                className={`rounded-lg border p-3 ${ROLE_STYLES[msg.role] ?? ROLE_STYLES.agent}`}
                key={msg.id}
              >
                <div className="mb-1 flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 font-medium text-[10px] ${ROLE_BADGES[msg.role] ?? ""}`}
                  >
                    {msg.role}
                  </span>
                  <span className="ml-auto text-[10px] text-zinc-600">
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <div className="mt-1">
                  {msg.role === "agent" ? (
                    <MarkdownRenderer
                      className="text-xs"
                      content={msg.content}
                    />
                  ) : (
                    <div
                      className={`text-xs leading-relaxed ${msg.role === "system" ? "text-blue-300" : "text-zinc-300"}`}
                    >
                      {msg.content}
                    </div>
                  )}
                </div>
                {msg.streaming && (
                  <span className="mt-1 inline-flex items-center gap-1">
                    <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400" />
                    <span
                      className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400"
                      style={{ animationDelay: "0.15s" }}
                    />
                    <span
                      className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-violet-400"
                      style={{ animationDelay: "0.3s" }}
                    />
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-zinc-800 border-t p-3">
        <div className="flex gap-2">
          <textarea
            aria-label="Message the agent"
            className="flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-violet-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message the agent... (Shift+Enter for newline)"
            ref={inputRef}
            rows={2}
            value={input}
          />
          <button
            className="shrink-0 self-end rounded-lg bg-violet-600 px-4 py-2 font-medium text-sm text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!input.trim() || disabled}
            onClick={handleSend}
            type="button"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Terminal Panel ───────────────────────────────────────────────

function TerminalPanel() {
  const terminalLines = useSessionStore((s) => s.terminalLines);
  const scrollRef = useRef<HTMLDivElement>(null);

  const lineCount = terminalLines.length;
  useEffect(() => {
    if (lineCount > 0 && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lineCount]);

  return (
    <div className="flex h-full flex-col bg-zinc-950">
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
            {terminalLines.map((line, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: terminal lines lack stable unique IDs
              <div className="flex gap-2" key={`${line.timestamp ?? ""}-${i}`}>
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

// ── Center Content (Code Diff + Preview placeholder) ────────────

function CenterPanel() {
  const { events } = useSessionStore();
  const diffs = events.filter(
    (e) => e.type === "file_diff" || e.type === "code_change"
  );

  return (
    <div className="flex h-full flex-col overflow-auto">
      {diffs.length === 0 ? (
        <div className="flex h-full items-center justify-center text-xs text-zinc-600">
          <div className="text-center">
            <p>Editor / Preview area</p>
            <p className="mt-1 text-zinc-700">
              Changes will appear here as the agent works
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3 p-3">
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

  const sessionQuery = trpc.sessions.get.useQuery({ sessionId }, { retry: 2 });
  const pauseMutation = trpc.sessions.pause.useMutation();
  const resumeMutation = trpc.sessions.resume.useMutation();
  const cancelMutation = trpc.sessions.cancel.useMutation();
  const sendMessageMutation = trpc.sessions.sendMessage.useMutation();

  const session = sessionQuery.data;
  const status = session?.status ?? sessionStatus ?? "loading";

  const isEnded =
    status === "completed" || status === "cancelled" || status === "failed";

  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

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

      {/* Workspace Layout with resizable panels */}
      <div className="min-h-0 flex-1">
        <WorkspaceLayout
          agentPanel={
            <AgentPanel
              disabled={isEnded}
              onSend={handleSendMessage}
              sessionId={sessionId}
            />
          }
          center={<CenterPanel />}
          fileTree={<FileTreePanel />}
          terminal={<TerminalPanel />}
        />
      </div>

      {/* Control bar (sticky bottom) */}
      <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-2">
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
