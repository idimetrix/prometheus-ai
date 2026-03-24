"use client";

import { useEffect, useRef } from "react";
import { useSessionStore } from "@/stores/session.store";

// ── Plan Panel ──────────────────────────────────────────────────

function PlanPanel() {
  const { planSteps } = useSessionStore();

  const stepIcon = (status: string) => {
    switch (status) {
      case "done":
      case "completed":
        return (
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-500/20">
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
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-500/20">
            <div className="h-2 w-2 animate-pulse rounded-full bg-violet-400" />
          </div>
        );
      case "failed":
        return (
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-500/20">
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
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-zinc-700">
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
                {stepIcon(step.status)}
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
            {Array.from(terminalLines.entries()).map(([lineNum, line]) => (
              <div className="flex gap-2" key={`terminal-line-${lineNum}`}>
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

// ── Code Panel ──────────────────────────────────────────────────

function CodePanel() {
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
                      key={`diff-line-${lineNum}`}
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

// ── File Tree Panel ─────────────────────────────────────────────

function FileTreePanel() {
  const { fileTree } = useSessionStore();

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
                <span
                  className={`text-xs ${
                    (
                      {
                        created: "text-green-400",
                        modified: "text-yellow-400",
                        deleted: "text-red-400",
                      } as Record<string, string>
                    )[file.status ?? ""] ?? "text-zinc-600"
                  }`}
                >
                  {(
                    { created: "+", modified: "M", deleted: "D" } as Record<
                      string,
                      string
                    >
                  )[file.status ?? ""] ?? "\u2022"}
                </span>
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

// ── Task Mode ───────────────────────────────────────────────────

interface TaskModeProps {
  sessionId: string;
}

export function TaskMode({ sessionId: _sessionId }: TaskModeProps) {
  return (
    <div className="grid h-full grid-cols-2 grid-rows-2 gap-3">
      <FileTreePanel />
      <PlanPanel />
      <TerminalPanel />
      <CodePanel />
    </div>
  );
}
