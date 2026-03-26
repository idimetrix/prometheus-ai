"use client";

import { MarkdownRenderer } from "@prometheus/ui";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SessionControls } from "@/components/session/session-controls";
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
  const terminalLines = useSessionStore((s) => s.terminalLines);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll when new terminal lines arrive
  const lineCount = terminalLines.length;
  useEffect(() => {
    if (lineCount > 0 && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lineCount]);

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

// ── Chat Panel ─────────────────────────────────────────────────

interface ChatMessage {
  content: string;
  id: string;
  role: "user" | "agent" | "system";
  streaming?: boolean;
  timestamp: string;
}

function ChatPanel({
  disabled,
  onSend,
}: {
  disabled?: boolean;
  onSend: (content: string) => void;
  sessionId: string;
}) {
  const { events, reasoning } = useSessionStore();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Derive chat messages from session events and terminal output
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

  // Auto-scroll on new messages
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
    user: "ml-8 border-violet-500/20 bg-violet-500/10",
    agent: "mr-8 border-zinc-800 bg-zinc-900/50",
    system: "border-blue-500/20 bg-blue-500/5",
  };

  const ROLE_BADGES: Record<string, string> = {
    user: "bg-violet-500/20 text-violet-300",
    agent: "bg-green-500/20 text-green-300",
    system: "bg-blue-500/20 text-blue-300",
  };

  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-800 bg-zinc-900/50">
      {/* Header */}
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
            d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="font-medium text-xs text-zinc-400">Chat</span>
        <span className="ml-auto rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
          {messages.length} messages
        </span>
      </div>

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
        await sendMessageMutation.mutateAsync({
          sessionId,
          content,
        });
      } catch {
        toast.error("Failed to send message");
      }
    },
    [sessionId, sendMessageMutation]
  );

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

      {/* Main layout: Chat (left) + Monitoring Panels (right) */}
      <div className="flex min-h-0 flex-1 gap-3">
        {/* Left: Chat panel */}
        <div className="flex w-1/2 min-w-0 flex-col lg:w-[45%]">
          <ChatPanel
            disabled={isEnded}
            onSend={handleSendMessage}
            sessionId={sessionId}
          />
        </div>

        {/* Right: Monitoring panels (2x2 grid) */}
        <div className="grid w-1/2 min-w-0 grid-cols-2 grid-rows-2 gap-3 lg:w-[55%]">
          <FileTreePanel />
          <PlanPanel />
          <TerminalPanel />
          <CodeDiffPanel />
        </div>
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
