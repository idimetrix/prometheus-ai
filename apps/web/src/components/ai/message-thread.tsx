"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface ToolCallBlock {
  args?: Record<string, unknown>;
  id: string;
  name: string;
  result?: string;
  status: "pending" | "running" | "completed" | "failed";
}

interface FileChangeBlock {
  additions: number;
  deletions: number;
  filePath: string;
}

interface ThreadMessage {
  codeBlocks?: Array<{ code: string; language: string }>;
  content: string;
  fileChanges?: FileChangeBlock[];
  id: string;
  reasoning?: string;
  role: "user" | "assistant" | "system";
  timestamp: number;
  toolCalls?: ToolCallBlock[];
}

interface AIMessageThreadProps {
  isStreaming?: boolean;
  messages: ThreadMessage[];
  onRetry?: (messageId: string) => void;
}

/* -------------------------------------------------------------------------- */
/*  Sub-components                                                             */
/* -------------------------------------------------------------------------- */

function ToolCallIndicator({ toolCall }: { toolCall: ToolCallBlock }) {
  const statusIcon: Record<ToolCallBlock["status"], string> = {
    completed: "check",
    failed: "x",
    pending: "...",
    running: "~",
  };
  const statusColor: Record<ToolCallBlock["status"], string> = {
    completed: "text-green-400",
    failed: "text-red-400",
    pending: "text-zinc-400",
    running: "text-blue-400 animate-pulse",
  };

  return (
    <div className="flex items-center gap-2 rounded border border-zinc-700 bg-zinc-800/50 px-3 py-1.5 text-xs">
      <span className={statusColor[toolCall.status]}>
        [{statusIcon[toolCall.status]}]
      </span>
      <span className="font-mono text-zinc-300">{toolCall.name}</span>
      {toolCall.result && (
        <span className="max-w-xs truncate text-zinc-500">
          {toolCall.result}
        </span>
      )}
    </div>
  );
}

function FileChangeIndicator({ change }: { change: FileChangeBlock }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="font-mono text-zinc-300">{change.filePath}</span>
      {change.additions > 0 && (
        <span className="text-green-400">+{change.additions}</span>
      )}
      {change.deletions > 0 && (
        <span className="text-red-400">-{change.deletions}</span>
      )}
    </div>
  );
}

function ReasoningBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded border border-yellow-900/40 bg-yellow-950/20 px-3 py-2">
      <button
        className="flex w-full items-center gap-1 text-xs text-yellow-500"
        onClick={() => setExpanded((prev) => !prev)}
        type="button"
      >
        <span>{expanded ? "v" : ">"}</span>
        <span>Thinking</span>
      </button>
      {expanded && (
        <p className="mt-1 text-xs text-zinc-400 leading-relaxed">{text}</p>
      )}
    </div>
  );
}

function MessageBubble({
  message,
  onRetry,
}: {
  message: ThreadMessage;
  onRetry?: (id: string) => void;
}) {
  const roleStyles: Record<ThreadMessage["role"], string> = {
    assistant: "bg-zinc-800/60 border-zinc-700",
    system: "bg-yellow-950/20 border-yellow-900/30",
    user: "bg-blue-950/20 border-blue-900/30",
  };

  return (
    <div
      className={`rounded-lg border p-4 ${roleStyles[message.role]}`}
      data-message-id={message.id}
    >
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium text-xs text-zinc-400 capitalize">
          {message.role}
        </span>
        <span className="text-[11px] text-zinc-600">
          {new Date(message.timestamp).toLocaleTimeString()}
        </span>
      </div>

      {/* Reasoning */}
      {message.reasoning && <ReasoningBlock text={message.reasoning} />}

      {/* Content */}
      <div className="mt-1 whitespace-pre-wrap text-sm text-zinc-200 leading-relaxed">
        {message.content}
      </div>

      {/* Code blocks */}
      {message.codeBlocks?.map((block) => (
        <pre
          className="mt-2 overflow-x-auto rounded bg-zinc-900 p-3 font-mono text-xs text-zinc-300"
          key={`code-${message.id}-${block.language}-${block.code.slice(0, 30)}`}
        >
          <div className="mb-1 text-[10px] text-zinc-500 uppercase">
            {block.language}
          </div>
          <code>{block.code}</code>
        </pre>
      ))}

      {/* Tool calls */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {message.toolCalls.map((tc) => (
            <ToolCallIndicator key={tc.id} toolCall={tc} />
          ))}
        </div>
      )}

      {/* File changes */}
      {message.fileChanges && message.fileChanges.length > 0 && (
        <div className="mt-2 flex flex-col gap-1 rounded border border-zinc-700 bg-zinc-900/50 p-2">
          <span className="text-[10px] text-zinc-500 uppercase">
            File Changes
          </span>
          {message.fileChanges.map((fc) => (
            <FileChangeIndicator change={fc} key={fc.filePath} />
          ))}
        </div>
      )}

      {/* Retry button */}
      {message.role === "assistant" && onRetry && (
        <button
          className="mt-2 text-xs text-zinc-500 hover:text-zinc-300"
          onClick={() => onRetry(message.id)}
          type="button"
        >
          Retry
        </button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main Component                                                             */
/* -------------------------------------------------------------------------- */

export function AIMessageThread({
  messages,
  isStreaming = false,
  onRetry,
}: AIMessageThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current && autoScroll) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [autoScroll]);

  useEffect(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) {
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 60;
    setAutoScroll(isNearBottom);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex-1 space-y-3 overflow-y-auto p-4"
        onScroll={handleScroll}
        ref={scrollRef}
      >
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} onRetry={onRetry} />
        ))}

        {isStreaming && (
          <div className="flex items-center gap-2 px-4 py-2">
            <div className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />
            <span className="text-xs text-zinc-500">
              Agent is responding...
            </span>
          </div>
        )}
      </div>

      {!autoScroll && (
        <button
          className="mx-auto mb-2 rounded-full bg-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-600"
          onClick={() => {
            setAutoScroll(true);
            scrollToBottom();
          }}
          type="button"
        >
          Scroll to bottom
        </button>
      )}
    </div>
  );
}

export type { FileChangeBlock, ThreadMessage, ToolCallBlock };
